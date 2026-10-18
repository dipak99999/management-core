import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  resolveTaxTemplate,
  computeInvoiceTaxLines,
  emitEvent,
  validateCustomData,
  generateAndStoreIrn,
  cancelStoredIrn,
  checkCumulativeYtdSalesCrossed,
  attributeInvoice,
  daysBetween,
  parseReminderThresholds,
  pickReminderKind,
  sendPaymentReminder,
  companyPrefix,
  computeDeferredSchedule,
  computeLoyaltyDiscount,
  resolveCompanyForVoucher,
  latestScheduleDueDate,
  materializeSchedule,
  normalizeCouponCode,
  sumRedeemedPoints,
  validateCoupon,
  validateAllocations,
  type ReminderKind,
  type AllocationInput,
} from "@lumaara/db";
import { cancelGLEntries, postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { getAllowedCompanyIds, idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const salesInvoiceRouter = Router();

const p = perms("SalesInvoice");

// B12: round grandTotal to whole units (banker's rounding via toFixed +
// re-parse). Returns 0 delta when tenant has no round-off account configured.
function roundGrandTotal(grand: Prisma.Decimal, hasRoundOffAccount: boolean) {
  if (!hasRoundOffAccount) {
    return { roundedTotal: grand, roundingAdjustment: new Prisma.Decimal(0) };
  }
  const roundedNum = Math.round(Number(grand));
  const rounded = new Prisma.Decimal(roundedNum);
  const adjustment = rounded.sub(grand);
  return { roundedTotal: rounded, roundingAdjustment: adjustment };
}

// D7: when caller passes a salesPersonId but no commissionPercent, fall
// back to the sales person's default rate.
async function resolveCommissionPercent(
  tenantId: string,
  salesPersonId: string | null | undefined,
  explicit: number | null | undefined,
): Promise<number> {
  if (explicit != null) return explicit;
  if (!salesPersonId) return 0;
  const sp = await prisma.salesPerson.findFirst({
    where: { id: salesPersonId, tenantId },
    select: { defaultCommissionPercent: true },
  });
  return sp ? Number(sp.defaultCommissionPercent) : 0;
}

// B15: on a return, all qty must be ≤ 0 (a mix would be nonsensical).
function validateReturnSign(items: { qty: number }[], isReturn: boolean): string | null {
  if (isReturn && items.some((i) => i.qty > 0))
    return "Credit Note lines must all have qty ≤ 0";
  if (!isReturn && items.some((i) => i.qty < 0))
    return "Set isReturn=true to create a Credit Note (negative qty)";
  return null;
}

// India TCS 206C(1H) snapshot resolver. Returns the category snapshot fields
// when TCS applies (customer has default category, cumulative FY sales cross
// threshold, this SI is not a return). Otherwise null.
//
// The snapshot flows through: SI create persists tcsAmount + tcsAccountId;
// SI submit posts the extra Debtors debit + TCS Payable credit and sets
// outstandingAmt = grandTotal + tcsAmount; /reports/tcs-27eq aggregates for
// the quarterly return.
async function resolveTcsSnapshot(
  tenantId: string,
  customerId: string,
  netTotal: Prisma.Decimal,
  postingDate: string | null | undefined,
): Promise<{
  categoryId: string;
  sectionCode: string | null;
  rate: Prisma.Decimal;
  amount: Prisma.Decimal;
  accountId: string;
} | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { taxCollectionCategoryId: true },
  });
  if (!customer?.taxCollectionCategoryId) return null;
  const cat = await prisma.taxCollectionCategory.findFirst({
    where: { id: customer.taxCollectionCategoryId, tenantId, disabled: false },
  });
  if (!cat) return null;

  const threshold = Number(cat.thresholdAmount);
  if (threshold > 0) {
    if (cat.cumulativeYtd) {
      const check = await checkCumulativeYtdSalesCrossed(prisma, {
        tenantId,
        customerId,
        invoiceDate: postingDate ? new Date(postingDate) : new Date(),
        currentNetAmount: Number(netTotal),
        thresholdAmount: threshold,
      });
      if (!check.crossed) return null;
    } else if (Number(netTotal) < threshold) {
      return null;
    }
  }
  const amount = netTotal.mul(cat.rate).div(100);
  return {
    categoryId: cat.id,
    sectionCode: cat.sectionCode ?? null,
    rate: cat.rate,
    amount,
    accountId: cat.accountId,
  };
}

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  // B15: qty can be negative on Credit Notes.
  qty: z.coerce.number().refine((v) => v !== 0, "qty cannot be zero"),
  rate: z.coerce.number().nonnegative(),
  description: z.string().optional().nullable(),
  // B11: per-line tax override. Falls back to invoice-level template when
  // absent. `computeInvoiceTaxLines` groups by effective template.
  taxTemplateId: z.string().optional().nullable(),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  postingDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  currency: z.string().default("INR"),
  conversionRate: z.coerce.number().positive().default(1),
  taxTemplateId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  // B15: Credit Note = SalesInvoice with `isReturn = true`, usually pointing
  // back at the original via `returnAgainstId`. Server enforces `isReturn`
  // ↔ (all qty ≤ 0) so a document type + sign stay consistent. When
  // `returnAgainstId` is set + return is Submitted, the original's
  // outstanding is reduced by |grandTotal| so the customer credit lands in
  // one place.
  isReturn: z.boolean().default(false),
  returnAgainstId: z.string().optional().nullable(),
  // D7: sales person + commission snapshot. commissionPercent defaults from
  // the sales person's rate but can be overridden per invoice.
  salesPersonId: z.string().optional().nullable(),
  commissionPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  items: z.array(itemLineSchema).min(1),
  // I5: custom fields
  customData: z.record(z.unknown()).optional().nullable(),
  // D10: staggered payment schedule. When set, submit materializes an
  // InvoicePaymentSchedule from the template AND overwrites dueDate to the
  // latest installment.
  paymentTermsTemplateId: z.string().optional().nullable(),
  // D4: coupon code (denormalized string). Submit re-validates + bumps
  // CouponCode.usedCount atomically. Line rates should already reflect the
  // coupon's discount if the operator hit /coupon-codes/apply — this field
  // is the audit trail + usage-cap enforcement path.
  couponCode: z.string().optional().nullable(),
  // Multi-company Phase 2: explicit companyId at doctype level. If omitted,
  // the create handler resolves the tenant's default Company. Every GLEntry
  // posted from this invoice is stamped with this companyId regardless of
  // per-account company.
  companyId: z.string().optional().nullable(),
});


salesInvoiceRouter.get("/", p.read, async (req, res) => {
  // Multi-company Phase 7: respect global company scope. Explicit
  // `?companyId=` from the picker takes precedence; when omitted, the
  // user's allowlist restricts the result set. Admins see everything.
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
  const rows = await prisma.salesInvoice.findMany({
    where: { tenantId: req.auth!.tenantId, ...companyWhere },
    include: {
      customer: { select: { customerName: true } },
      items: true,
      taxes: true,
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

salesInvoiceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      items: { include: { item: true } },
      taxes: true,
      taxTemplate: true,
      paymentTermsTemplate: { select: { id: true, name: true } },
      paymentSchedule: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: invoice + items + taxes (with account names) + applied payments
// (from PaymentEntryReference) + GL entries posted by this invoice. Single
// round-trip so the detail page renders without waterfall calls.
salesInvoiceRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      customer: true,
      items: { include: { item: true } },
      taxes: { include: { account: { select: { accountName: true } } } },
      taxTemplate: true,
      paymentTermsTemplate: { select: { id: true, name: true } },
      paymentSchedule: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [paymentRefs, glEntries] = await Promise.all([
    prisma.paymentEntryReference.findMany({
      where: {
        referenceDoctype: "SalesInvoice",
        referenceId: inv.id,
        paymentEntry: { tenantId },
      },
      include: {
        paymentEntry: {
          select: {
            id: true,
            name: true,
            paymentType: true,
            postingDate: true,
            modeOfPayment: true,
            status: true,
            paidAmount: true,
          },
        },
      },
      orderBy: { paymentEntry: { postingDate: "desc" } },
    }),
    prisma.gLEntry.findMany({
      where: {
        tenantId,
        voucherType: "SalesInvoice",
        voucherId: inv.id,
        isCancelled: false,
      },
      include: { account: { select: { accountName: true, rootType: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  res.json({ invoice: inv, paymentRefs, glEntries });
});

// Update a Draft invoice. Server enforces status=Draft. Inside a transaction:
// deletes existing child rows (items + taxes) then recreates them. Safe
// because Drafts have no GL entries.
salesInvoiceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res
      .status(400)
      .json({ error: `Cannot edit invoice in status ${existing.status}` });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "SalesInvoice",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
      { docId: existing.id },
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid for this tenant" });

  const signErr = validateReturnSign(p.items, p.isReturn);
  if (signErr) return res.status(400).json({ error: signErr });
  if (p.returnAgainstId) {
    const orig = await prisma.salesInvoice.findFirst({
      where: { id: p.returnAgainstId, tenantId, customerId: p.customerId },
      select: { id: true, status: true },
    });
    if (!orig) return res.status(400).json({ error: "Invalid returnAgainstId" });
    if (orig.status === "Draft" || orig.status === "Cancelled")
      return res.status(400).json({ error: `Cannot return against ${orig.status} invoice` });
  }

  // B11: resolve invoice-level + any per-line template overrides. Pre-load
  // every referenced templateId in one round trip so `computeInvoiceTaxLines`
  // can stay synchronous.
  const templateIds = Array.from(
    new Set(
      [
        p.taxTemplateId ?? null,
        ...p.items.map((i) => i.taxTemplateId ?? null),
      ].filter((v): v is string => !!v),
    ),
  );
  const templateMap = new Map<string, Awaited<ReturnType<typeof resolveTaxTemplate>>>();
  try {
    for (const id of templateIds) {
      templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Sales"));
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const invoiceLevelTemplate = p.taxTemplateId
    ? templateMap.get(p.taxTemplateId) ?? null
    : null;

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
  }));
  const netTotal = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    p.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const taxAmount = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(taxAmount);

  // B12: rounding — tenant must have a round-off account configured to enable.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultRoundOffAccountId: true },
  });
  const { roundedTotal, roundingAdjustment } = roundGrandTotal(
    grandTotal,
    !!tenant?.defaultRoundOffAccountId,
  );
  const commissionPercent = await resolveCommissionPercent(
    tenantId,
    p.salesPersonId,
    p.commissionPercent,
  );

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: existing.id } });
    await tx.salesInvoiceTax.deleteMany({ where: { salesInvoiceId: existing.id } });
    return tx.salesInvoice.update({
      where: { id: existing.id },
      data: {
        customerId: p.customerId,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        dueDate: p.dueDate ? new Date(p.dueDate) : null,
        currency: p.currency,
        conversionRate: new Prisma.Decimal(p.conversionRate),
        taxTemplateId: invoiceLevelTemplate?.id ?? null,
        remarks: p.remarks ?? null,
        netTotal,
        totalTaxes: taxAmount,
        grandTotal,
        roundedTotal,
        roundingAdjustment,
        isReturn: p.isReturn,
        returnAgainstId: p.returnAgainstId ?? null,
        salesPersonId: p.salesPersonId ?? null,
        commissionPercent: new Prisma.Decimal(commissionPercent),
        customData: customData ?? undefined,
        // Outstanding tracks the amount the customer actually owes — the
        // rounded value once rounding is enabled. Credit Notes carry a
        // negative outstanding until applied against the source invoice.
        outstandingAmt: roundedTotal,
        paymentTermsTemplateId: p.paymentTermsTemplateId ?? null,
        couponCode: p.couponCode ? normalizeCouponCode(p.couponCode) : null,
        ...(p.companyId !== undefined ? { companyId: p.companyId } : {}),
        items: { create: lines },
        taxes: taxLines.length
          ? {
              create: taxLines.map((r) => ({
                description: r.description,
                rate: r.rate,
                taxAmount: r.taxAmount,
                accountId: r.accountId,
                chargeType: r.chargeType,
                taxTemplateId: r.taxTemplateId ?? invoiceLevelTemplate?.id ?? null,
              })),
            }
          : undefined,
      },
      include: { items: true, taxes: true },
    });
  });

  res.json(updated);
});

salesInvoiceRouter.post("/", p.create, idempotency("POST /sales-invoices"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "SalesInvoice",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size) {
    return res.status(400).json({ error: "One or more items are invalid for this tenant" });
  }

  const signErr = validateReturnSign(p.items, p.isReturn);
  if (signErr) return res.status(400).json({ error: signErr });
  if (p.returnAgainstId) {
    const orig = await prisma.salesInvoice.findFirst({
      where: { id: p.returnAgainstId, tenantId, customerId: p.customerId },
      select: { id: true, status: true },
    });
    if (!orig) return res.status(400).json({ error: "Invalid returnAgainstId" });
    if (orig.status === "Draft" || orig.status === "Cancelled")
      return res.status(400).json({ error: `Cannot return against ${orig.status} invoice` });
  }

  // B11: resolve invoice-level + any per-line template overrides. Pre-load
  // every referenced templateId in one round trip so `computeInvoiceTaxLines`
  // can stay synchronous. Snapshot rows onto the SI so later template edits
  // don't rewrite history.
  const templateIds = Array.from(
    new Set(
      [
        p.taxTemplateId ?? null,
        ...p.items.map((i) => i.taxTemplateId ?? null),
      ].filter((v): v is string => !!v),
    ),
  );
  const templateMap = new Map<string, Awaited<ReturnType<typeof resolveTaxTemplate>>>();
  try {
    for (const id of templateIds) {
      templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Sales"));
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const invoiceLevelTemplate = p.taxTemplateId
    ? templateMap.get(p.taxTemplateId) ?? null
    : null;

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
  }));

  const netTotal = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    p.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const taxAmount = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const totalTaxes = taxAmount;
  const grandTotal = netTotal.add(totalTaxes);

  // B12: rounding.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultRoundOffAccountId: true },
  });
  const { roundedTotal, roundingAdjustment } = roundGrandTotal(
    grandTotal,
    !!tenant?.defaultRoundOffAccountId,
  );
  const commissionPercent = await resolveCommissionPercent(
    tenantId,
    p.salesPersonId,
    p.commissionPercent,
  );

  // India TCS 206C(1H) — auto-snapshot when the customer has a default TCS
  // category AND the cumulative-YTD sales cross the threshold. Returns is
  // excluded (credit notes don't trigger TCS). When the snapshot is
  // non-null, SI submit posts an extra CR line to tcsAccountId and includes
  // the tcsAmount in outstandingAmt so the customer actually owes the
  // extra money. Cancel reverses via the shared cancelGLEntries path.
  const tcs = p.isReturn
    ? null
    : await resolveTcsSnapshot(tenantId, p.customerId, netTotal, p.postingDate);


  let company;
  try {
    company = await resolveCompanyForVoucher(prisma, tenantId, p.companyId);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  // B15: Credit Notes use the CN- series to distinguish from regular SINV-.
  // Multi-company Phase 3: prefix is company-scoped ("SINV-AC-0001")
  // when the tenant has a Company; base prefix otherwise (legacy).
  const basePrefix = p.isReturn ? "CN-" : "SINV-";
  const name = await nextName(prisma, tenantId, companyPrefix(basePrefix, company?.code));

  const row = await prisma.salesInvoice.create({
    data: {
      tenantId,
      name,
      companyId: company?.id ?? null,
      customerId: p.customerId,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
      currency: p.currency,
      conversionRate: new Prisma.Decimal(p.conversionRate),
      taxTemplateId: invoiceLevelTemplate?.id ?? null,
      remarks: p.remarks ?? null,
      netTotal,
      totalTaxes,
      grandTotal,
      roundedTotal,
      roundingAdjustment,
      isReturn: p.isReturn,
      returnAgainstId: p.returnAgainstId ?? null,
      customData: customData ?? undefined,
      outstandingAmt: roundedTotal,
      status: "Draft",
      paymentTermsTemplateId: p.paymentTermsTemplateId ?? null,
      couponCode: p.couponCode ? normalizeCouponCode(p.couponCode) : null,
      tcsCategoryId: tcs?.categoryId ?? null,
      tcsSection: tcs?.sectionCode ?? null,
      tcsRate: tcs?.rate ?? new Prisma.Decimal(0),
      tcsAmount: tcs?.amount ?? new Prisma.Decimal(0),
      tcsAccountId: tcs?.accountId ?? null,
      items: { create: lines },
      taxes: taxLines.length
        ? {
            create: taxLines.map((r) => ({
              description: r.description,
              rate: r.rate,
              taxAmount: r.taxAmount,
              accountId: r.accountId,
              chargeType: r.chargeType,
              taxTemplateId: r.taxTemplateId ?? invoiceLevelTemplate?.id ?? null,
            })),
          }
        : undefined,
    },
    include: {
      items: true,
      taxes: true,
      customer: { select: { customerName: true } },
    },
  });

  res.status(201).json(row);
});

// Submit: posts GL entries. Amounts are in the invoice's currency; each line
// is multiplied by conversionRate so the ledger is always in base currency.
//   Debit  Debtors   (roundedTotal × fx)  [party = customer]
//   Credit Sales     (netTotal × fx)
//   Credit Tax accts (per-tax taxAmount × fx)
//   ± Round Off      (roundingAdjustment × fx)  [B12: only if non-zero]
// Debtors is debited at roundedTotal (customer owes the rounded amount).
// The rounding delta (roundedTotal − grandTotal) is booked to the tenant's
// round-off account with sign that balances the entry:
//   adjustment > 0 (rounded up)  → credit Round Off (income-ish, reduces exp)
//   adjustment < 0 (rounded down) → debit  Round Off (expense)
salesInvoiceRouter.post("/:id/submit", p.submit, idempotency("POST /sales-invoices/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const override = req.query.override === "true";
  try {
    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          taxes: true,
          items: {
            include: {
              item: {
                select: {
                  enableDeferredRevenue: true,
                  deferredRevenueMonths: true,
                },
              },
            },
          },
        },
      });
      if (!inv) throw new Error("Not found");
      if (inv.status !== "Draft")
        throw new Error(`Cannot submit invoice in status ${inv.status}`);

      // D6: credit limit check. Skip for Credit Notes (they reduce
      // exposure). Skip when limit is 0 (unset). Skip when the caller
      // passes ?override=true and the customer has bypass allowed.
      if (!inv.isReturn) {
        const cust = await tx.customer.findFirst({
          where: { id: inv.customerId, tenantId },
          select: { creditLimit: true, creditLimitBypassAllowed: true, customerName: true },
        });
        if (cust && Number(cust.creditLimit) > 0) {
          if (override && !cust.creditLimitBypassAllowed)
            throw new Error(
              "Credit-limit override not allowed for this customer",
            );
          if (!override) {
            const openAgg = await tx.salesInvoice.aggregate({
              where: {
                tenantId,
                customerId: inv.customerId,
                status: "Submitted",
                outstandingAmt: { gt: 0 },
                id: { not: inv.id },
              },
              _sum: { outstandingAmt: true },
            });
            const currentOpen = Number(openAgg._sum.outstandingAmt ?? 0);
            const newTotal = currentOpen + Number(inv.roundedTotal || inv.grandTotal);
            if (newTotal > Number(cust.creditLimit)) {
              throw new Error(
                `Credit limit exceeded for ${cust.customerName}: current outstanding ${currentOpen.toFixed(2)} + this invoice ${Number(inv.roundedTotal || inv.grandTotal).toFixed(2)} > limit ${Number(cust.creditLimit).toFixed(2)}. Pass ?override=true if allowed.`,
              );
            }
          }
        }
      }

      const roundAdj = Number(inv.roundingAdjustment);
      const needsRoundOff = roundAdj !== 0;
      const defaultsKeys: Parameters<typeof requireTenantDefaults>[2] = [
        "defaultReceivableAccountId",
        "defaultIncomeAccountId",
      ];
      if (needsRoundOff) defaultsKeys.push("defaultRoundOffAccountId");
      // Multi-company Phase 4: pass inv.companyId so per-company overrides
      // (e.g. Company B has its own Debtors account) apply. Null companyId
      // = pure tenant-defaults lookup (legacy behavior).
      const defaults = await requireTenantDefaults(tx, tenantId, defaultsKeys, inv.companyId);

      const fx = Number(inv.conversionRate);
      // TCS 206C(1H) — when snapshotted at create time, TCS is collected
      // FROM the customer (adds to what they owe). Included in the Debtors
      // debit alongside grandTotal + rounding, and credited to the
      // snapshotted TCS Payable account. Not applied to returns (isReturn
      // implies the credit-note undoes the sale, so no TCS to collect).
      const tcsAmount = Number(inv.tcsAmount) || 0;
      const tcsApplies = tcsAmount > 0 && !inv.isReturn && !!inv.tcsAccountId;

      // Use roundedTotal for the Debtors post so what the customer owes = what
      // the ledger records. Falls back to grandTotal for legacy rows where
      // roundedTotal wasn't set (0 → treat as grandTotal).
      const arValueBeforeLoyalty =
        (Number(inv.roundedTotal) || Number(inv.grandTotal)) +
        (tcsApplies ? tcsAmount : 0);

      // D5+: loyalty auto-apply. When Redeemed LoyaltyPointEntries exist for
      // this SI (module 16 /redeem creates them), compute the currency
      // discount using the customer's active program's rate and subtract
      // from Debtors. A separate DR leg posts to
      // Tenant.defaultLoyaltyDiscountAccountId so the entry stays balanced.
      //
      // Skipped for returns (isReturn) — Credit Notes don't consume points.
      // Also skipped when the tenant hasn't configured the discount account;
      // the earlier /redeem call already logged the ledger entry, so we
      // fail fast here rather than silently double-count.
      let loyaltyDiscount = 0;
      if (!inv.isReturn) {
        const cust = await tx.customer.findFirst({
          where: { id: inv.customerId, tenantId },
          select: { loyaltyProgramId: true },
        });
        if (cust?.loyaltyProgramId) {
          const [prog, redemptions] = await Promise.all([
            tx.loyaltyProgram.findFirst({
              where: { id: cust.loyaltyProgramId, tenantId },
            }),
            tx.loyaltyPointEntry.findMany({
              where: {
                tenantId,
                customerId: inv.customerId,
                entryType: "Redeemed",
                salesInvoiceId: inv.id,
              },
              select: { salesInvoiceId: true, entryType: true, points: true },
            }),
          ]);
          const points = sumRedeemedPoints(
            redemptions.map((r) => ({
              entryType: r.entryType,
              points: r.points,
              salesInvoiceId: r.salesInvoiceId,
            })),
            inv.id,
          );
          if (prog && points > 0) {
            loyaltyDiscount = computeLoyaltyDiscount(points, prog);
            if (loyaltyDiscount > 0) {
              // Require the discount account to be configured — silent
              // fallback would either double-count (if we do nothing) or
              // unbalance the entry (if we short the Debtors leg without
              // posting the other side).
              const tenantForLoyalty = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { defaultLoyaltyDiscountAccountId: true },
              });
              if (!tenantForLoyalty?.defaultLoyaltyDiscountAccountId) {
                throw new Error(
                  `Loyalty discount of ${loyaltyDiscount} cannot be applied — tenant has no defaultLoyaltyDiscountAccountId set.`,
                );
              }
            }
          }
        }
      }
      const arValue = arValueBeforeLoyalty - loyaltyDiscount;
      // B15: Credit Note (isReturn) inverts the whole entry — Debtors goes
      // credit, Sales/Tax go debit. Values are always positive in the ledger;
      // the invoice-level `isReturn` flag is what shows a "-100" to users.
      // netTotal + taxAmount are stored negative on returns, so |value|
      // gives us the correct magnitudes to post.
      const isReturn = inv.isReturn;
      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        remarks?: string;
        partyType?: string;
        partyId?: string;
      }[] = [];
      const push = (accountId: string, dr: number, cr: number, extra?: object) =>
        lines.push(
          isReturn
            ? { accountId, debit: cr, credit: dr, ...(extra ?? {}) }
            : { accountId, debit: dr, credit: cr, ...(extra ?? {}) },
        );
      push(
        defaults.defaultReceivableAccountId!,
        Math.abs(arValue) * fx,
        0,
        { partyType: "Customer", partyId: inv.customerId },
      );
      // D12: split the Sales credit between immediate revenue + deferred
      // liability. For each item line with enableDeferredRevenue=true, the
      // line's net (qty × rate) moves to Tenant.defaultDeferredRevenueAccountId
      // (a liability) instead of the income account. The scheduler tick
      // then walks the DeferredRevenueSchedule rows monthly and JEs each
      // installment out of deferred into recognized income.
      // Skipped for returns — Credit Notes don't create deferred rev.
      // Decimal accumulator: JS-number += on line.amount drifted enough on
      // multi-line invoices to unbalance the GL entry by a paisa vs the
      // Debtors debit above. Convert to number at the push site only.
      const fxD = new Prisma.Decimal(inv.conversionRate);
      let deferredNet = new Prisma.Decimal(0);
      if (!inv.isReturn) {
        for (const line of inv.items) {
          if (!line.item.enableDeferredRevenue) continue;
          deferredNet = deferredNet.add(new Prisma.Decimal(line.amount).abs());
        }
      }
      const immediateNet = new Prisma.Decimal(inv.netTotal).abs().sub(deferredNet);
      if (immediateNet.gt(new Prisma.Decimal("0.0001"))) {
        push(
          defaults.defaultIncomeAccountId!,
          0,
          immediateNet.mul(fxD).toNumber(),
        );
      }
      if (deferredNet.gt(new Prisma.Decimal("0.0001"))) {
        const tenantForDeferred = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { defaultDeferredRevenueAccountId: true },
        });
        if (!tenantForDeferred?.defaultDeferredRevenueAccountId) {
          throw new Error(
            `Cannot post deferred revenue of ${deferredNet.toFixed(2)} — tenant has no defaultDeferredRevenueAccountId set.`,
          );
        }
        push(
          tenantForDeferred.defaultDeferredRevenueAccountId,
          0,
          deferredNet.mul(fxD).toNumber(),
          { remarks: `Deferred revenue (${inv.name})` },
        );
      }
      for (const t of inv.taxes)
        push(
          t.accountId,
          0,
          Math.abs(Number(t.taxAmount)) * fx,
          { remarks: t.description },
        );
      if (needsRoundOff) {
        const adjBase = Math.abs(roundAdj) * fx;
        const adjSign = roundAdj > 0 ? 1 : -1;
        // roundedTotal − grandTotal > 0 (rounded UP): Debtors got debited
        // extra vs the item+tax credits → we need an offsetting CREDIT to the
        // round-off account. Sign flips for rounded down. Returns swap.
        push(
          defaults.defaultRoundOffAccountId!,
          adjSign < 0 ? adjBase : 0,
          adjSign > 0 ? adjBase : 0,
          { remarks: "Rounding adjustment" },
        );
      }
      if (tcsApplies) {
        // TCS 206C(1H) collected from customer. Debtors already includes
        // this amount above; balance by crediting the TCS Payable account.
        push(inv.tcsAccountId!, 0, tcsAmount * fx, {
          remarks: `TCS ${inv.tcsSection ?? "206C-1H"}`,
        });
      }
      if (loyaltyDiscount > 0) {
        // D5+: loyalty redemption discount. Debtors was reduced by this
        // amount above (arValue = arValueBeforeLoyalty − loyaltyDiscount);
        // this DR to the loyalty-discount account balances the entry.
        // Guarded above so defaultLoyaltyDiscountAccountId is guaranteed
        // non-null when we reach here.
        const t2 = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { defaultLoyaltyDiscountAccountId: true },
        });
        push(
          t2!.defaultLoyaltyDiscountAccountId!,
          loyaltyDiscount * fx,
          0,
          { remarks: `Loyalty discount (${inv.name})` },
        );
      }

      await postGLEntries(tx, {
        tenantId,
        postingDate: inv.postingDate,
        voucherType: "SalesInvoice",
        voucherId: inv.id,
        voucherName: inv.name,
        companyId: inv.companyId,
        lines,
      });

      // B15: apply the return against the source invoice, if any. Reduces
      // source outstanding by |arValue|; flips source to Paid at zero. The
      // return's own outstanding is set to zero (it settled directly).
      if (isReturn && inv.returnAgainstId) {
        const orig = await tx.salesInvoice.findFirst({
          where: { id: inv.returnAgainstId, tenantId },
        });
        if (!orig)
          throw new Error("Return source invoice missing");
        const reduce = new Prisma.Decimal(Math.abs(arValue));
        const newOutstanding = new Prisma.Decimal(orig.outstandingAmt).sub(reduce);
        await tx.salesInvoice.update({
          where: { id: orig.id },
          data: {
            outstandingAmt: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
            status: newOutstanding.lte(0.0001) ? "Paid" : orig.status,
          },
        });
        await tx.salesInvoice.update({
          where: { id: inv.id },
          data: { outstandingAmt: new Prisma.Decimal(0) },
        });
      }

      // D5: auto-award loyalty points if the customer has an enabled
      // program. Skip returns (isReturn) — Credit Notes shouldn't earn
      // points. Uses roundedTotal for the base since that's what the party
      // actually paid.
      if (!inv.isReturn) {
        const cust = await tx.customer.findFirst({
          where: { id: inv.customerId, tenantId },
          select: { loyaltyProgramId: true },
        });
        if (cust?.loyaltyProgramId) {
          const prog = await tx.loyaltyProgram.findFirst({
            where: { id: cust.loyaltyProgramId, tenantId, enabled: true },
          });
          if (prog) {
            const base = Number(inv.roundedTotal) || Number(inv.grandTotal);
            const pts = Math.floor(base * Number(prog.pointsPerCurrency));
            if (pts > 0) {
              const expiry = new Date();
              expiry.setMonth(expiry.getMonth() + prog.expiryMonths);
              await tx.loyaltyPointEntry.create({
                data: {
                  tenantId,
                  programId: prog.id,
                  customerId: inv.customerId,
                  entryType: "Earned",
                  points: pts,
                  postingDate: inv.postingDate,
                  expiryDate: expiry,
                  salesInvoiceId: inv.id,
                  remarks: `Auto-awarded on ${inv.name}`,
                },
              });
            }
          }
        }
      }

      // D4: coupon consumption. When the invoice carries a couponCode,
      // re-validate against the CouponCode row (defends against the row
      // being disabled or cap-reached between create and submit) and
      // atomically bump usedCount. Any validation failure aborts the whole
      // submit — line rates already reflect the discount, so submitting
      // without consuming the coupon would create ledger drift.
      if (!inv.isReturn && inv.couponCode) {
        const c = await tx.couponCode.findFirst({
          where: { tenantId, code: inv.couponCode },
        });
        if (!c) throw new Error(`Coupon ${inv.couponCode} not found`);
        const check = validateCoupon(c);
        if (!check.ok)
          throw new Error(`Coupon ${inv.couponCode}: ${check.reason}`);
        await tx.couponCode.update({
          where: { id: c.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // D12: deferred revenue schedule materialization. For each SI item
      // line whose Item has enableDeferredRevenue=true, create a
      // DeferredRevenueSchedule of `deferredRevenueMonths` rows starting
      // from the invoice's postingDate. The scheduler tick will book each
      // installment on/after its dueDate.
      // Skipped for returns — Credit Notes don't create deferred rev.
      if (!inv.isReturn) {
        for (const line of inv.items) {
          if (!line.item.enableDeferredRevenue) continue;
          const rows = computeDeferredSchedule(
            Math.abs(Number(line.amount)),
            line.item.deferredRevenueMonths,
            inv.postingDate,
          );
          if (rows.length === 0) continue;
          await tx.deferredRevenueSchedule.createMany({
            data: rows.map((r) => ({
              tenantId,
              salesInvoiceItemId: line.id,
              installmentNo: r.installmentNo,
              dueDate: r.dueDate,
              amount: new Prisma.Decimal(r.amount),
            })),
          });
        }
      }

      // D10: staggered payment schedule. When the invoice was created with
      // a paymentTermsTemplateId, materialize the InvoicePaymentSchedule
      // rows here (submit-time so the amount reflects taxes/rounding, not
      // the pre-tax value from create-time). We also overwrite `dueDate` to
      // the latest installment so:
      //   (a) the invoice isn't flagged overdue until the final tranche
      //       lapses (payment reminders keep their SI.dueDate contract), AND
      //   (b) the classic single-dueDate UI still shows something meaningful.
      // Skipped for Credit Notes (returns don't need a payment schedule).
      let scheduleDueOverride: Date | null = null;
      if (!inv.isReturn && inv.paymentTermsTemplateId) {
        const template = await tx.paymentTermsTemplate.findFirst({
          where: { id: inv.paymentTermsTemplateId, tenantId, enabled: true },
          include: { terms: { orderBy: { sortOrder: "asc" } } },
        });
        if (template && template.terms.length > 0) {
          const rows = materializeSchedule(
            template.terms.map((t) => ({
              description: t.description,
              invoicePortion: t.invoicePortion,
              dueDays: t.dueDays,
              sortOrder: t.sortOrder,
            })),
            inv.postingDate,
            arValue,
          );
          await tx.invoicePaymentSchedule.createMany({
            data: rows.map((r) => ({
              tenantId,
              salesInvoiceId: inv.id,
              sortOrder: r.sortOrder,
              description: r.description,
              invoicePortion: new Prisma.Decimal(r.invoicePortion),
              dueDate: r.dueDate,
              amount: new Prisma.Decimal(r.amount),
            })),
          });
          scheduleDueOverride = latestScheduleDueDate(rows);
        }
      }

      // outstandingAmt = what the customer owes. Includes TCS when applied,
      // matching the Debtors debit above. Set only when moving Draft →
      // Submitted (Credit Notes set outstandingAmt=0 in the return-handling
      // block above; don't stomp that here).
      return tx.salesInvoice.update({
        where: { id: inv.id },
        data: inv.isReturn
          ? { status: "Submitted" }
          : {
              status: "Submitted",
              outstandingAmt: new Prisma.Decimal(arValue),
              ...(scheduleDueOverride ? { dueDate: scheduleDueOverride } : {}),
            },
      });
    });
    // L9: fire event for webhook subscribers. Fire-and-forget so slow
    // outbound endpoints don't block the response.
    void emitEvent(prisma, tenantId, "SalesInvoice.submit", {
      id: result.id,
      name: result.name,
      customerId: result.customerId,
      grandTotal: Number(result.grandTotal),
      currency: result.currency,
    }).catch((err: unknown) => {
      // Never block the submit response, but a silent swallow means the
      // downstream webhook never fires and nobody notices. Log to stderr in
      // the same JSON shape as installCrashHandlers so journald captures it.
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "warn", kind: "emitEvent.failed", event: "SalesInvoice.submit",
        tenantId, id: result.id,
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      }));
    });
    // Marketing P3: revenue attribution. Best-effort — attribution failure
    // MUST NOT block the submit response. Uses `netTotal` (revenue net of
    // tax) as the amount split across recent AttributionTouchpoints per the
    // default LastTouch model with a 90-day window. Skip on returns
    // (Credit Notes) since they don't earn attributable revenue.
    if (!result.isReturn) {
      void attributeInvoice(prisma, {
        tenantId,
        invoiceId: result.id,
        customerId: result.customerId,
        amount: Number(result.netTotal),
        postingDate: result.postingDate,
      }).catch((err: unknown) => {
        console.warn(
          `[sales-invoice.submit] attributeInvoice failed invoice=${result.id} tenant=${tenantId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    void publishRealtime(tenantId, "sales-invoice", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// O-einvoice: generate + cancel IRN via the IRP adapter. Currently backed by
// the deterministic stub adapter (see packages/db/src/einvoice.ts). Wiring
// the live adapter is a per-tenant integration + env flag change.
salesInvoiceRouter.post("/:id/einvoice/generate", p.submit, async (req, res) => {
  const r = await generateAndStoreIrn(prisma, req.params.id, req.auth!.tenantId);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, irn: r.irn });
});

salesInvoiceRouter.post("/:id/einvoice/cancel", p.cancel, async (req, res) => {
  const reason =
    (typeof req.body?.reason === "string" && req.body.reason) || "User-initiated cancel";
  const r = await cancelStoredIrn(prisma, req.params.id, req.auth!.tenantId, reason);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// DELETE a draft invoice. Only works while the invoice is in Draft — once
// submitted, use /cancel instead (preserves the GL audit trail). Also
// rejected if items have already been shipped/received via a linked DN
// (the FK constraint will enforce this but we check first for a nicer error).
salesInvoiceRouter.delete("/:id", p.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, status: true, name: true },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (inv.status !== "Draft") {
    return res.status(409).json({
      error: `Can only delete Draft invoices (status: ${inv.status}). Use /cancel to reverse a submitted invoice.`,
    });
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: inv.id } });
      await tx.salesInvoice.delete({ where: { id: inv.id } });
    });
    res.status(204).send();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ error: `Delete failed: ${msg}` });
  }
});

salesInvoiceRouter.post("/:id/cancel", p.cancel, idempotency("POST /sales-invoices/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!inv) throw new Error("Not found");
      if (inv.status === "Cancelled") throw new Error("Already cancelled");

      // Reverse GL if this invoice had been posted.
      if (inv.status === "Submitted" || inv.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "SalesInvoice",
          voucherId: inv.id,
        });
        // B15: if this was a Credit Note that had been applied against a
        // source invoice, add its magnitude back to that invoice's outstanding.
        if (inv.isReturn && inv.returnAgainstId) {
          const orig = await tx.salesInvoice.findFirst({
            where: { id: inv.returnAgainstId, tenantId },
          });
          if (orig) {
            const arValue = Number(inv.roundedTotal) || Number(inv.grandTotal);
            const restore = new Prisma.Decimal(Math.abs(arValue));
            await tx.salesInvoice.update({
              where: { id: orig.id },
              data: {
                outstandingAmt: new Prisma.Decimal(orig.outstandingAmt).add(restore),
                status: orig.status === "Paid" ? "Submitted" : orig.status,
              },
            });
          }
        }
      }

      return tx.salesInvoice.update({
        where: { id: inv.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "sales-invoice", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// ---------- Payment reminders (per invoice) ----------
// The scheduler tick auto-sends these; these routes let staff view the
// history + fire a one-off manual reminder from the SI detail page.

salesInvoiceRouter.get("/:id/reminders", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.paymentReminder.findMany({
    where: { tenantId, salesInvoiceId: inv.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

const manualSendSchema = z.object({
  // Optional — when omitted the server picks the next-due kind using the
  // tenant's thresholds (same helper the scheduler tick uses). Explicit
  // kind is useful for "send the escalation now" clicks from a manager.
  kind: z.enum(["First", "Second", "Final"]).optional(),
  // D10: optional — when set, targets a specific installment row on the
  // invoice's payment schedule (per-installment reminder path). The
  // subject/body reference the installment amount + label; dedup keys
  // off (invoice × row × kind).
  paymentScheduleId: z.string().optional().nullable(),
});

salesInvoiceRouter.post("/:id/reminders/send", p.write, async (req, res) => {
  const parsed = manualSendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      customer: { select: { email: true, customerName: true } },
      paymentReminders: { select: { kind: true, paymentScheduleId: true } },
      paymentSchedule: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (inv.status !== "Submitted") {
    return res
      .status(400)
      .json({ error: `Cannot send reminder for invoice in status ${inv.status}` });
  }
  if (Number(inv.outstandingAmt) <= 0) {
    return res.status(400).json({ error: "Invoice is fully paid — nothing to remind about." });
  }
  if (!inv.customer.email) {
    return res.status(400).json({ error: "Customer has no email on file." });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, reminderThresholds: true },
  });
  if (!tenant) return res.status(500).json({ error: "Tenant missing" });

  // Per-installment or invoice-level? Decide upfront so daysOverdue,
  // outstanding, and pickReminderKind's alreadySent list all reference
  // the same unit.
  const targetRow = parsed.data.paymentScheduleId
    ? inv.paymentSchedule.find((r) => r.id === parsed.data.paymentScheduleId)
    : null;
  if (parsed.data.paymentScheduleId && !targetRow) {
    return res.status(400).json({
      error: "paymentScheduleId does not belong to this invoice",
    });
  }

  const dueDateForCalc = targetRow?.dueDate ?? inv.dueDate;
  if (!dueDateForCalc) {
    return res.status(400).json({
      error: "Invoice has no due date — cannot compute days overdue.",
    });
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.max(0, daysBetween(dueDateForCalc, today));

  const scopedReminders = targetRow
    ? inv.paymentReminders.filter((r) => r.paymentScheduleId === targetRow.id)
    : inv.paymentReminders.filter((r) => r.paymentScheduleId == null);

  // Resolve which kind to send. Explicit request wins; else fall back to
  // pickReminderKind against the tenant's thresholds (may be null if
  // nothing's due — respond helpfully instead of silently failing).
  let kind: ReminderKind | null = parsed.data.kind ?? null;
  if (!kind) {
    const thresholds = parseReminderThresholds(tenant.reminderThresholds);
    if (!thresholds) {
      return res.status(400).json({
        error:
          "No reminder thresholds configured on this tenant. Pass ?kind=First (or Second/Final) explicitly.",
      });
    }
    kind = pickReminderKind(
      days,
      thresholds,
      scopedReminders.map((r) => r.kind as ReminderKind),
    );
    if (!kind) {
      const scope = targetRow ? "this installment" : "this invoice";
      return res.status(400).json({
        error: `No reminder is due — ${scope} is ${days} days overdue and all applicable tiers have been sent.`,
      });
    }
  }

  try {
    const rowOutstanding = targetRow
      ? Number(targetRow.amount) - Number(targetRow.paidAmount)
      : null;
    const out = await sendPaymentReminder(prisma, {
      tenantId,
      tenantName: tenant.name,
      invoice: {
        id: inv.id,
        name: inv.name,
        outstandingAmt: inv.outstandingAmt,
        customer: {
          email: inv.customer.email,
          customerName: inv.customer.customerName,
        },
      },
      kind,
      daysOverdue: days,
      trigger: "Manual",
      installment: targetRow
        ? {
            id: targetRow.id,
            outstandingAmt: rowOutstanding ?? 0,
            label: `Installment ${targetRow.sortOrder + 1} of ${inv.paymentSchedule.length}`,
          }
        : undefined,
    });
    res.json({ ok: true, kind, ...out });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Deal splits — multi-salesperson attribution on a SalesInvoice.
// See packages/db/src/deal-splits.ts for the semantics. Empty list ⇒
// fallback to SalesInvoice.salesPersonId at 100 %.
// ────────────────────────────────────────────────────────────────────────

salesInvoiceRouter.get("/:id/allocations", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.salesInvoiceSalesPersonAllocation.findMany({
    where: { salesInvoiceId: inv.id },
    include: { salesPerson: { select: { name: true, defaultCommissionPercent: true } } },
    orderBy: { allocationPct: "desc" },
  });
  res.json(rows);
});

const allocationsBodySchema = z.object({
  allocations: z
    .array(
      z.object({
        salesPersonId: z.string().min(1),
        allocationPct: z.coerce.number().min(0).max(100),
        commissionRate: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .max(20),
});

salesInvoiceRouter.put("/:id/allocations", p.write, async (req, res) => {
  const parsed = allocationsBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const inv = await prisma.salesInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, status: true },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });
  if (inv.status === "Cancelled") {
    return res.status(400).json({ error: "Cannot edit allocations on a cancelled invoice" });
  }

  const inputs: AllocationInput[] = parsed.data.allocations.map((a) => ({
    salesPersonId: a.salesPersonId,
    allocationPct: a.allocationPct,
    commissionRate: a.commissionRate,
  }));
  const v = validateAllocations(inputs);
  if (!v.ok) return res.status(400).json({ error: v.error });

  // Verify every salesPersonId belongs to this tenant. Cheap: one IN query.
  if (inputs.length > 0) {
    const ids = Array.from(new Set(inputs.map((a) => a.salesPersonId)));
    const found = await prisma.salesPerson.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, defaultCommissionPercent: true },
    });
    if (found.length !== ids.length) {
      return res.status(400).json({ error: "One or more salesPersonId values are not in this tenant" });
    }
    const commissionByPerson = new Map(
      found.map((f) => [f.id, Number(f.defaultCommissionPercent)]),
    );
    // Default missing commissionRate to the salesperson's master rate
    // AT TIME OF INSERT so historic commissions don't drift later.
    for (const a of inputs) {
      if (a.commissionRate == null) {
        a.commissionRate = commissionByPerson.get(a.salesPersonId) ?? 0;
      }
    }
  }

  // Replace-all: simpler than diffing, race-safe inside the tx.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.salesInvoiceSalesPersonAllocation.deleteMany({
      where: { salesInvoiceId: inv.id },
    });
    if (inputs.length === 0) return [];
    await tx.salesInvoiceSalesPersonAllocation.createMany({
      data: inputs.map((a) => ({
        tenantId,
        salesInvoiceId: inv.id,
        salesPersonId: a.salesPersonId,
        allocationPct: new Prisma.Decimal(a.allocationPct),
        commissionRate: new Prisma.Decimal(a.commissionRate ?? 0),
      })),
    });
    return tx.salesInvoiceSalesPersonAllocation.findMany({
      where: { salesInvoiceId: inv.id },
      include: { salesPerson: { select: { name: true } } },
      orderBy: { allocationPct: "desc" },
    });
  });
  res.json(rows);
});
