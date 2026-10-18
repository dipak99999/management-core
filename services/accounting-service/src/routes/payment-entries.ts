import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  companyPrefix,
  emitEvent,
  resolveCompanyForVoucher,
  validateCustomData,
  checkCumulativeYtdCrossed,
  allocateToSchedule,
  reverseFromSchedule,
  type AllocatableRow,
  type PrismaDelegateLike,
} from "@lumaara/db";
import {
  accountForPaymentMode,
  cancelGLEntries,
  postGLEntries,
  requireTenantDefaults,
} from "../lib/gl-posting";
import { submitPaymentEntryTx } from "../lib/pe-submit";
import { getAllowedCompanyIds, idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const paymentEntryRouter = Router();

const p = perms("PaymentEntry");

// D10: FIFO allocation of PE apply → InvoicePaymentSchedule rows.
// Called from every PE→invoice write path (submit, apply-advance, cancel).
// No-op when the invoice has no schedule (single-payment / non-templated
// invoices) — the invoice's outstandingAmt update carries the whole story.
//
// direction:
//   "apply"  → forward FIFO (fill oldest installment first)
//   "reverse" → LIFO (unwind most-recent paid installment first)
//
// The allocation is best-effort: if the schedule and the invoice
// outstanding drift (e.g. a manual DB tweak), we still apply what we can
// and don't error — the parent invoice's outstandingAmt is the money-of-
// record, this table is for per-installment UX.
async function allocatePEToSchedule(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    invoiceType: "SalesInvoice" | "PurchaseInvoice";
    invoiceId: string;
    amount: number;
    direction: "apply" | "reverse";
  },
): Promise<void> {
  const scheduleWhere =
    args.invoiceType === "SalesInvoice"
      ? { tenantId: args.tenantId, salesInvoiceId: args.invoiceId }
      : { tenantId: args.tenantId, purchaseInvoiceId: args.invoiceId };
  const rows = await tx.invoicePaymentSchedule.findMany({
    where: scheduleWhere,
  });
  if (rows.length === 0) return;

  const allocRows: AllocatableRow[] = rows.map((r) => ({
    id: r.id,
    dueDate: r.dueDate,
    sortOrder: r.sortOrder,
    amount: Number(r.amount),
    paidAmount: Number(r.paidAmount),
  }));

  const result =
    args.direction === "apply"
      ? allocateToSchedule(allocRows, args.amount)
      : reverseFromSchedule(allocRows, args.amount);

  for (const c of result.changes) {
    // Derive new status inline — the helper already exposes newPaidAmount.
    const src = rows.find((r) => r.id === c.id)!;
    const newPaid = c.newPaidAmount;
    const amt = Number(src.amount);
    // Compare on UTC-midnight so a PE posted late in the day doesn't flip
    // an installment overdue an hour before its dueDate rolls over.
    const dueMid = new Date(
      Date.UTC(
        src.dueDate.getUTCFullYear(),
        src.dueDate.getUTCMonth(),
        src.dueDate.getUTCDate(),
      ),
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let newStatus: string;
    if (newPaid >= amt && amt > 0) newStatus = "Paid";
    else if (newPaid > 0) newStatus = "Partial";
    else if (today.getTime() > dueMid.getTime()) newStatus = "Overdue";
    else newStatus = "Upcoming";

    await tx.invoicePaymentSchedule.update({
      where: { id: c.id },
      data: {
        paidAmount: new Prisma.Decimal(newPaid),
        status: newStatus,
      },
    });
  }
}

// Bidirectional: Receive (from Customer against SalesInvoice) | Pay (to Supplier against PurchaseInvoice).
// referenceDoctype is validated against paymentType in the handler.

const referenceSchema = z.object({
  referenceDoctype: z.enum(["SalesInvoice", "PurchaseInvoice"]),
  referenceId: z.string().min(1),
  allocatedAmount: z.coerce.number().positive(),
});

const createSchema = z.object({
  paymentType: z.enum(["Receive", "Pay"]),
  partyType: z.enum(["Customer", "Supplier", "Employee"]),
  partyId: z.string().min(1),
  paidAmount: z.coerce.number().positive(),
  postingDate: z.string().datetime().optional(),
  currency: z.string().default("INR"),
  // FX rate from `currency` → tenant baseCurrency. Multiplied into GL amounts
  // at submit so the ledger stays in base regardless of PE currency.
  conversionRate: z.coerce.number().positive().default(1),
  modeOfPayment: z.string().default("Cash"),
  // Cheque payment details — only relevant when modeOfPayment=Bank + paid
  // via cheque. Both optional; the /print-cheque route enforces
  // chequeNumber must be set before printing.
  chequeNumber: z.string().optional().nullable(),
  chequeDate: z.string().datetime().optional().nullable(),
  remarks: z.string().optional().nullable(),
  references: z.array(referenceSchema).default([]),
  // B13: TDS on Pay-type payments. If withholdingCategoryId is set, the route
  // snapshots the category's rate + account. withholdingAmount is auto-
  // computed at paidAmount × rate/100 unless the caller sends an explicit
  // override (useful when threshold logic or a partial section applies).
  withholdingCategoryId: z.string().optional().nullable(),
  withholdingAmount: z.coerce.number().nonnegative().optional().nullable(),
  customData: z.record(z.unknown()).optional().nullable(),
  // Multi-company Phase 2: doctype-level companyId. Falls back to tenant
  // default when omitted; stamps every GLEntry posted from this payment.
  companyId: z.string().optional().nullable(),
});


// Given paymentType + partyType, return the compatible reference doctype (or
// null when references aren't applicable — Employee settlements are on-account
// against Employee Payable, no invoice refs).
function expectedFor(
  paymentType: "Receive" | "Pay",
  partyType: "Customer" | "Supplier" | "Employee",
): { referenceDoctype: "SalesInvoice" | "PurchaseInvoice" | null; ok: boolean } {
  if (paymentType === "Receive" && partyType === "Customer")
    return { referenceDoctype: "SalesInvoice", ok: true };
  if (paymentType === "Pay" && partyType === "Supplier")
    return { referenceDoctype: "PurchaseInvoice", ok: true };
  if (paymentType === "Pay" && partyType === "Employee")
    return { referenceDoctype: null, ok: true };
  return { referenceDoctype: null, ok: false };
}

paymentEntryRouter.get("/", p.read, async (req, res) => {
  // Multi-company Phase 7: honor global scope + user allowlist.
  const requested =
    typeof req.query.companyId === "string" && req.query.companyId.length > 0
      ? req.query.companyId
      : null;
  const allowed = await getAllowedCompanyIds(req.auth!);
  if (requested && allowed !== null && !allowed.includes(requested)) {
    return res.status(403).json({ error: "You don't have access to that company" });
  }
  const companyWhere = requested
    ? { companyId: requested }
    : allowed !== null
      ? { companyId: { in: allowed } }
      : {};
  const rows = await prisma.paymentEntry.findMany({
    where: { tenantId: req.auth!.tenantId, ...companyWhere },
    include: { references: true },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

paymentEntryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.paymentEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { references: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: payment + references with resolved invoice names + party name
// (customer or supplier) + GL entries. References are polymorphic — batch
// fetch both invoice tables and stitch back onto rows.
paymentEntryRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const pe = await prisma.paymentEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: { references: true },
  });
  if (!pe) return res.status(404).json({ error: "Not found" });

  // Resolve party name (polymorphic).
  let partyName: string | null = null;
  if (pe.partyType === "Customer") {
    const c = await prisma.customer.findFirst({
      where: { id: pe.partyId, tenantId },
      select: { customerName: true },
    });
    partyName = c?.customerName ?? null;
  } else if (pe.partyType === "Supplier") {
    const s = await prisma.supplier.findFirst({
      where: { id: pe.partyId, tenantId },
      select: { supplierName: true },
    });
    partyName = s?.supplierName ?? null;
  } else if (pe.partyType === "Employee") {
    const e = await prisma.employee.findFirst({
      where: { id: pe.partyId, tenantId },
      select: { employeeName: true, employeeCode: true },
    });
    partyName = e ? `${e.employeeName} (${e.employeeCode})` : null;
  }

  const siRefIds = pe.references
    .filter((r) => r.referenceDoctype === "SalesInvoice")
    .map((r) => r.referenceId);
  const piRefIds = pe.references
    .filter((r) => r.referenceDoctype === "PurchaseInvoice")
    .map((r) => r.referenceId);

  const [siMap, piMap, glEntries] = await Promise.all([
    siRefIds.length
      ? prisma.salesInvoice
          .findMany({
            where: { id: { in: siRefIds }, tenantId },
            select: {
              id: true,
              name: true,
              grandTotal: true,
              outstandingAmt: true,
              status: true,
            },
          })
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
    piRefIds.length
      ? prisma.purchaseInvoice
          .findMany({
            where: { id: { in: piRefIds }, tenantId },
            select: {
              id: true,
              name: true,
              grandTotal: true,
              outstandingAmt: true,
              status: true,
            },
          })
          .then((rows) => new Map(rows.map((r) => [r.id, r])))
      : Promise.resolve(new Map()),
    prisma.gLEntry.findMany({
      where: {
        tenantId,
        voucherType: "PaymentEntry",
        voucherId: pe.id,
        isCancelled: false,
      },
      include: { account: { select: { accountName: true, rootType: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const resolvedRefs = pe.references.map((r) => {
    const map = r.referenceDoctype === "SalesInvoice" ? siMap : piMap;
    const inv = map.get(r.referenceId);
    return {
      ...r,
      invoiceName: inv?.name ?? null,
      invoiceGrandTotal: inv?.grandTotal ?? null,
      invoiceOutstanding: inv?.outstandingAmt ?? null,
      invoiceStatus: inv?.status ?? null,
    };
  });

  res.json({ paymentEntry: pe, partyName, references: resolvedRefs, glEntries });
});

// Update a Draft payment. Rejects if Submitted (would need to reverse
// allocations + GL first via cancel). References wiped and recreated.
paymentEntryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.paymentEntry.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit payment in status ${existing.status}` });

  const err = await validatePayload(p, tenantId);
  if (err) return res.status(400).json({ error: err });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "PaymentEntry",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
      { docId: existing.id },
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  let withholding: Awaited<ReturnType<typeof resolveWithholding>>;
  try {
    // Pass existing.id so the cumulative-YTD check excludes this PE's prior
    // paidAmount from the "already paid" total (avoids double-counting on edit).
    withholding = await resolveWithholding(tenantId, p, existing.id);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentEntryReference.deleteMany({
      where: { paymentEntryId: existing.id },
    });
    return tx.paymentEntry.update({
      where: { id: existing.id },
      data: {
        paymentType: p.paymentType,
        partyType: p.partyType,
        partyId: p.partyId,
        paidAmount: new Prisma.Decimal(p.paidAmount),
        currency: p.currency,
        conversionRate: new Prisma.Decimal(p.conversionRate),
        modeOfPayment: p.modeOfPayment,
        chequeNumber: p.chequeNumber ?? null,
        chequeDate: p.chequeDate ? new Date(p.chequeDate) : null,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        remarks: p.remarks ?? null,
        customData: customData ?? undefined,
        withholdingCategoryId: withholding?.categoryId ?? null,
        withholdingRate: withholding?.rate ?? new Prisma.Decimal(0),
        withholdingAmount: withholding?.amount ?? new Prisma.Decimal(0),
        withholdingAccountId: withholding?.accountId ?? null,
        withholdingSection: withholding?.sectionCode ?? null,
        ...(p.companyId !== undefined ? { companyId: p.companyId } : {}),
        references: {
          create: p.references.map((r) => ({
            referenceDoctype: r.referenceDoctype,
            referenceId: r.referenceId,
            allocatedAmount: new Prisma.Decimal(r.allocatedAmount),
          })),
        },
      },
      include: { references: true },
    });
  });
  res.json(updated);
});

// B13: resolve the effective withholding category + snapshot rate/account.
// Only applies to Pay + Supplier. Category can come from the PE (explicit
// override) or, when omitted, from Supplier.taxWithholdingCategoryId.
//
// Threshold semantics:
//   * category.cumulativeYtd = true (default): TDS applies once cumulative
//     Submitted PE.paidAmount to this supplier in the current FY (Apr-Mar)
//     crosses `thresholdAmount`. Every payment from then on has TDS.
//   * category.cumulativeYtd = false: TDS applies when this single payment
//     is ≥ threshold. Legacy per-payment behavior.
//
// When updating an existing PE, `excludePeId` prevents the PE's prior
// paidAmount from being double-counted in the cumulative check.
async function resolveWithholding(
  tenantId: string,
  p: z.infer<typeof createSchema>,
  excludePeId?: string,
): Promise<
  | {
      categoryId: string;
      rate: Prisma.Decimal;
      accountId: string;
      amount: Prisma.Decimal;
      sectionCode: string | null;
    }
  | null
> {
  if (p.paymentType !== "Pay" || p.partyType !== "Supplier") return null;
  let categoryId = p.withholdingCategoryId ?? null;
  if (!categoryId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: p.partyId, tenantId },
      select: { taxWithholdingCategoryId: true },
    });
    categoryId = supplier?.taxWithholdingCategoryId ?? null;
  }
  if (!categoryId) return null;
  const cat = await prisma.taxWithholdingCategory.findFirst({
    where: { id: categoryId, tenantId, disabled: false },
  });
  if (!cat) throw new Error("Invalid TDS category");

  const threshold = Number(cat.thresholdAmount);
  if (threshold > 0) {
    if (cat.cumulativeYtd) {
      const check = await checkCumulativeYtdCrossed(prisma, {
        tenantId,
        supplierId: p.partyId,
        paymentDate: p.postingDate ? new Date(p.postingDate) : new Date(),
        currentPaidAmount: p.paidAmount,
        thresholdAmount: threshold,
        excludePeId,
      });
      if (!check.crossed) return null;
    } else if (p.paidAmount < threshold) {
      return null;
    }
  }
  // Explicit override wins; otherwise auto-compute.
  const amount =
    p.withholdingAmount != null
      ? new Prisma.Decimal(p.withholdingAmount)
      : new Prisma.Decimal(p.paidAmount).mul(cat.rate).div(100);
  if (amount.gt(p.paidAmount))
    throw new Error("TDS amount cannot exceed paid amount");
  return {
    categoryId: cat.id,
    rate: cat.rate,
    accountId: cat.accountId,
    amount,
    sectionCode: cat.sectionCode ?? null,
  };
}

async function validatePayload(
  p: z.infer<typeof createSchema>,
  tenantId: string,
): Promise<string | null> {
  const expected = expectedFor(p.paymentType, p.partyType);
  if (!expected.ok)
    return `paymentType=${p.paymentType} is not compatible with partyType=${p.partyType}`;

  // Party existence check per type.
  if (p.partyType === "Customer") {
    const c = await prisma.customer.findFirst({ where: { id: p.partyId, tenantId } });
    if (!c) return "Invalid customer";
  } else if (p.partyType === "Supplier") {
    const s = await prisma.supplier.findFirst({ where: { id: p.partyId, tenantId } });
    if (!s) return "Invalid supplier";
  } else if (p.partyType === "Employee") {
    const e = await prisma.employee.findFirst({ where: { id: p.partyId, tenantId } });
    if (!e) return "Invalid employee";
  }

  // Employee settlements are on-account — invoice references not supported yet.
  if (p.partyType === "Employee" && p.references.length > 0)
    return "Employee payments cannot carry invoice references (settle on-account against Employee Payable)";

  if (p.references.length > 0 && expected.referenceDoctype) {
    const badDoctype = p.references.find(
      (r) => r.referenceDoctype !== expected.referenceDoctype,
    );
    if (badDoctype)
      return `referenceDoctype must be ${expected.referenceDoctype} for paymentType=${p.paymentType}`;
    const refIds = p.references.map((r) => r.referenceId);
    if (expected.referenceDoctype === "SalesInvoice") {
      const invoices = await prisma.salesInvoice.findMany({
        where: { id: { in: refIds }, tenantId, customerId: p.partyId },
        select: { id: true },
      });
      if (invoices.length !== new Set(refIds).size)
        return "One or more referenced sales invoices are invalid for this customer";
    } else if (expected.referenceDoctype === "PurchaseInvoice") {
      const invoices = await prisma.purchaseInvoice.findMany({
        where: { id: { in: refIds }, tenantId, supplierId: p.partyId },
        select: { id: true },
      });
      if (invoices.length !== new Set(refIds).size)
        return "One or more referenced purchase invoices are invalid for this supplier";
    }
    const alloc = p.references.reduce((s, r) => s + r.allocatedAmount, 0);
    if (alloc > p.paidAmount + 0.0001)
      return `Allocated amount (${alloc}) exceeds paid amount (${p.paidAmount})`;
  }
  return null;
}

paymentEntryRouter.post("/", p.create, idempotency("POST /payment-entries"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const err = await validatePayload(p, tenantId);
  if (err) return res.status(400).json({ error: err });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "PaymentEntry",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  let withholding: Awaited<ReturnType<typeof resolveWithholding>>;
  try {
    withholding = await resolveWithholding(tenantId, p);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  let company;
  try {
    company = await resolveCompanyForVoucher(prisma, tenantId, p.companyId);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const name = await nextName(prisma, tenantId, companyPrefix("PE-", company?.code));

  const row = await prisma.paymentEntry.create({
    data: {
      tenantId,
      name,
      companyId: company?.id ?? null,
      paymentType: p.paymentType,
      partyType: p.partyType,
      partyId: p.partyId,
      paidAmount: new Prisma.Decimal(p.paidAmount),
      currency: p.currency,
      conversionRate: new Prisma.Decimal(p.conversionRate),
      modeOfPayment: p.modeOfPayment,
      chequeNumber: p.chequeNumber ?? null,
      chequeDate: p.chequeDate ? new Date(p.chequeDate) : null,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      remarks: p.remarks ?? null,
      status: "Draft",
      customData: customData ?? undefined,
      withholdingCategoryId: withholding?.categoryId ?? null,
      withholdingRate: withholding?.rate ?? new Prisma.Decimal(0),
      withholdingAmount: withholding?.amount ?? new Prisma.Decimal(0),
      withholdingAccountId: withholding?.accountId ?? null,
      withholdingSection: withholding?.sectionCode ?? null,
      references: {
        create: p.references.map((r) => ({
          referenceDoctype: r.referenceDoctype,
          referenceId: r.referenceId,
          allocatedAmount: new Prisma.Decimal(r.allocatedAmount),
        })),
      },
    },
    include: { references: true },
  });

  res.status(201).json(row);
});

// Submit: atomically applies allocations. Works for both SalesInvoice and PurchaseInvoice.
paymentEntryRouter.post("/:id/submit", p.submit, idempotency("POST /payment-entries/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) =>
      submitPaymentEntryTx(tx, { tenantId, peId: req.params.id }),
    );

    void emitEvent(prisma, req.auth!.tenantId, "PaymentEntry.submit", {
      id: result.id,
      name: result.name,
      paymentType: result.paymentType,
      partyType: result.partyType,
      partyId: result.partyId,
      paidAmount: Number(result.paidAmount),
      currency: result.currency,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "warn", kind: "emitEvent.failed", event: "PaymentEntry.submit",
        tenantId: req.auth!.tenantId, id: result.id,
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      }));
    });
    void publishRealtime(tenantId, "payment", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    const status = msg === "Not found" ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

paymentEntryRouter.post("/:id/cancel", p.cancel, idempotency("POST /payment-entries/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pe = await tx.paymentEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: { references: true },
      });
      if (!pe) throw new Error("Not found");
      if (pe.status === "Cancelled") throw new Error("Already cancelled");

      if (pe.status === "Submitted") {
        // Reverse GL first.
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "PaymentEntry",
          voucherId: pe.id,
        });

        for (const ref of pe.references) {
          if (ref.referenceDoctype === "SalesInvoice") {
            const inv = await tx.salesInvoice.findFirst({
              where: { id: ref.referenceId, tenantId },
            });
            if (!inv) continue;
            const restored = new Prisma.Decimal(inv.outstandingAmt).add(ref.allocatedAmount);
            await tx.salesInvoice.update({
              where: { id: inv.id },
              data: {
                outstandingAmt: restored,
                status: inv.status === "Paid" ? "Submitted" : inv.status,
              },
            });
            // D10: LIFO reverse the schedule allocation. Symmetric with
            // the FIFO apply on submit; keeps sum(paidAmount) === sum(refs).
            await allocatePEToSchedule(tx, {
              tenantId,
              invoiceType: "SalesInvoice",
              invoiceId: inv.id,
              amount: Number(ref.allocatedAmount),
              direction: "reverse",
            });
          } else if (ref.referenceDoctype === "PurchaseInvoice") {
            const inv = await tx.purchaseInvoice.findFirst({
              where: { id: ref.referenceId, tenantId },
            });
            if (!inv) continue;
            const restored = new Prisma.Decimal(inv.outstandingAmt).add(ref.allocatedAmount);
            await tx.purchaseInvoice.update({
              where: { id: inv.id },
              data: {
                outstandingAmt: restored,
                status: inv.status === "Paid" ? "Submitted" : inv.status,
              },
            });
            await allocatePEToSchedule(tx, {
              tenantId,
              invoiceType: "PurchaseInvoice",
              invoiceId: inv.id,
              amount: Number(ref.allocatedAmount),
              direction: "reverse",
            });
          }
        }
      }

      return tx.paymentEntry.update({
        where: { id: pe.id },
        data: { status: "Cancelled" },
        include: { references: true },
      });
    });

    void publishRealtime(tenantId, "payment", { id: result.id, status: "Cancelled" });

    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    const status = msg === "Not found" ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

// B14: allocate an already-Submitted PE (an "advance") against an invoice
// that was raised after the payment. No new GL is posted — the PE already
// carried the party-account balance at submit time; we just record the ref
// and reduce the invoice's outstanding. Cancel of the PE reverses this
// through the same code path as any other ref.
//
// Body: `{ invoiceId, allocatedAmount }`. Refuses to allocate more than the
// PE's remaining unallocated amount or the invoice's outstanding.
paymentEntryRouter.post("/:id/allocate-advance", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const body = z
    .object({
      invoiceId: z.string().min(1),
      allocatedAmount: z.coerce.number().positive(),
    })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const pe = await tx.paymentEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: { references: true },
      });
      if (!pe) throw new Error("Not found");
      if (pe.status !== "Submitted")
        throw new Error(
          "Only Submitted payments can be allocated as advances (current: " +
            pe.status +
            ")",
        );
      if (pe.paymentType === "Receive" && pe.partyType !== "Customer")
        throw new Error("Receive PE must have partyType=Customer to allocate");
      if (pe.paymentType === "Pay" && pe.partyType !== "Supplier")
        throw new Error("Pay PE must have partyType=Supplier to allocate");

      // Money arithmetic — Decimal throughout. JS floats drifted enough on
      // ₹100k+ payments to reject legitimate allocations by a paisa.
      const allocated = pe.references.reduce(
        (s, r) => s.add(new Prisma.Decimal(r.allocatedAmount)),
        new Prisma.Decimal(0),
      );
      const remaining = new Prisma.Decimal(pe.paidAmount).sub(allocated);
      const requested = new Prisma.Decimal(body.data.allocatedAmount);
      if (requested.sub(remaining).gt(new Prisma.Decimal("0.0001")))
        throw new Error(
          `Allocation ${requested.toFixed(2)} exceeds PE remaining unallocated (${remaining.toFixed(2)})`,
        );

      const isSales = pe.paymentType === "Receive";
      // Cast to the shared delegate shape so we can call the same 2 methods
      // on either SalesInvoice or PurchaseInvoice without a wider `any`.
      const docTable = (isSales
        ? tx.salesInvoice
        : tx.purchaseInvoice) as unknown as PrismaDelegateLike;
      const partyField = isSales ? "customerId" : "supplierId";
      const doctype = isSales ? "SalesInvoice" : "PurchaseInvoice";

      const inv = (await docTable.findFirst({
        where: { id: body.data.invoiceId, tenantId, [partyField]: pe.partyId },
      })) as {
        id: string;
        name: string;
        status: string;
        outstandingAmt: Prisma.Decimal;
      } | null;
      if (!inv)
        throw new Error(
          `Invoice ${body.data.invoiceId} not found for this ${pe.partyType.toLowerCase()}`,
        );
      if (inv.status === "Cancelled" || inv.status === "Draft")
        throw new Error(`Cannot allocate to invoice in status ${inv.status}`);
      const newOutstanding = new Prisma.Decimal(inv.outstandingAmt).sub(
        body.data.allocatedAmount,
      );
      if (newOutstanding.lt(-0.0001))
        throw new Error(
          `Allocation exceeds outstanding on ${inv.name} (${inv.outstandingAmt.toString()})`,
        );
      await docTable.update({
        where: { id: inv.id },
        data: {
          outstandingAmt: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
          status: newOutstanding.lte(0.0001) ? "Paid" : inv.status,
        },
      });
      await tx.paymentEntryReference.create({
        data: {
          paymentEntryId: pe.id,
          referenceDoctype: doctype,
          referenceId: inv.id,
          allocatedAmount: new Prisma.Decimal(body.data.allocatedAmount),
        },
      });
      // D10: FIFO allocate to the invoice's payment schedule (no-op when
      // no schedule). Symmetric with the PE submit path.
      await allocatePEToSchedule(tx, {
        tenantId,
        invoiceType: doctype,
        invoiceId: inv.id,
        amount: body.data.allocatedAmount,
        direction: "apply",
      });
      return tx.paymentEntry.findFirst({
        where: { id: pe.id },
        include: { references: true },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    const status = msg === "Not found" ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

// B14 report: unallocated advance balance per party. Useful for the
// Customer/Supplier detail pages ("outstanding advances = X") and the
// Payment page "apply-advance" flow. Returns each party's PE list where
// paidAmount − Σreferences > 0.
paymentEntryRouter.get("/advance-balances", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const partyType = typeof req.query.partyType === "string" ? req.query.partyType : "";
  const partyId = typeof req.query.partyId === "string" ? req.query.partyId : "";
  if (!["Customer", "Supplier"].includes(partyType))
    return res.status(400).json({ error: "partyType must be Customer or Supplier" });
  const rows = await prisma.paymentEntry.findMany({
    where: {
      tenantId,
      status: "Submitted",
      partyType,
      ...(partyId ? { partyId } : {}),
      // Direction matches: Customer→Receive, Supplier→Pay.
      paymentType: partyType === "Customer" ? "Receive" : "Pay",
    },
    include: { references: true },
    orderBy: { postingDate: "desc" },
  });
  const advances = rows
    .map((pe) => {
      const allocated = pe.references.reduce(
        (s, r) => s + Number(r.allocatedAmount),
        0,
      );
      const remaining = Number(pe.paidAmount) - allocated;
      return { id: pe.id, name: pe.name, postingDate: pe.postingDate, partyId: pe.partyId, paidAmount: Number(pe.paidAmount), remaining, currency: pe.currency };
    })
    .filter((a) => a.remaining > 0.0001);
  res.json(advances);
});
