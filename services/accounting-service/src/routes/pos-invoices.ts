import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  resolveTaxTemplate,
  computeInvoiceTaxLines,
  emitEvent,
  createRazorpayOrder,
  verifyPaymentSignature,
  validateTenderTotal,
} from "@lumaara/db";
import { postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { perms } from "@lumaara/service-auth";

export const posInvoiceRouter = Router();

const p = perms("SalesInvoice");

// ------------------------- Cashier checkout ---------------------------------
// Creates a SalesInvoice (isPos=true, posOpeningId set) + one PaymentEntry
// per tender mode, submits BOTH inside one transaction. Reuses the standard
// GL posting logic so downstream reporting (GST, aging, GL) treats POS sales
// identically to regular sales.
//
// Skipped in v1 (compared to /sales-invoices/:id/submit): credit-limit check,
// TCS snapshot, loyalty auto-award, revenue attribution, IRP e-invoice.
// POS sales are typically walk-in cash — the rewire lands when a design
// partner needs those flows at the counter.

const cartLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  description: z.string().optional().nullable(),
  taxTemplateId: z.string().optional().nullable(),
});

// One tender line = one payment method + its portion of the total. Split
// tender lands as N PE rows, one per mode, each referencing the SI with
// allocatedAmount = tender.amount. Cashier UI enforces that sum(tenders) ==
// grandTotal; the server double-checks with a 0.01 tolerance for rounding.
const tenderSchema = z.object({
  mode: z.enum(["Cash", "Card", "UPI", "Razorpay"]),
  amount: z.coerce.number().positive(),
  reference: z.string().optional().nullable(),      // card last-4, UPI txn id, etc — informational
  razorpayOrderId: z.string().optional().nullable(),
  razorpayPaymentId: z.string().optional().nullable(),
  razorpaySignature: z.string().optional().nullable(),
});

const checkoutSchema = z.object({
  posOpeningId: z.string().min(1),
  customerId: z.string().min(1),
  items: z.array(cartLineSchema).min(1),
  taxTemplateId: z.string().optional().nullable(),
  tenders: z.array(tenderSchema).min(1),
  remarks: z.string().optional().nullable(),
});

posInvoiceRouter.post("/checkout", p.create, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const body = parsed.data;

  // Session enforcement is intentionally OUTSIDE the tx — cheaper, and the
  // opening row won't disappear mid-tx (it's guarded by unique constraint +
  // strict single-active-per-user rule from pos-opening.ts).
  const opening = await prisma.pOSOpeningEntry.findFirst({
    where: { id: body.posOpeningId, tenantId, userId, status: "Open" },
    include: {
      posProfile: {
        include: {
          incomeAccount: { select: { id: true } },
        },
      },
    },
  });
  if (!opening) {
    return res
      .status(400)
      .json({ error: "No active POS session for this user (opening id invalid or closed)" });
  }
  const profile = opening.posProfile;
  const methods = (profile.paymentMethods as unknown as {
    mode: string;
    accountId: string;
    integrationId?: string | null;
  }[]) ?? [];
  const modeToAccount = new Map(methods.map((m) => [m.mode, m.accountId]));

  // Every tender.mode must be enabled on the profile.
  for (const t of body.tenders) {
    if (!modeToAccount.has(t.mode)) {
      return res
        .status(400)
        .json({ error: `Payment method "${t.mode}" is not enabled on this POS profile` });
    }
  }

  // Customer belongs-to-tenant.
  const customer = await prisma.customer.findFirst({
    where: { id: body.customerId, tenantId },
    select: { id: true },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customerId" });

  // Items belong to tenant.
  const itemIds = [...new Set(body.items.map((i) => i.itemId))];
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== itemIds.length)
    return res.status(400).json({ error: "One or more items are invalid for this tenant" });

  // Resolve tax templates once.
  const templateIds = [
    ...new Set(
      [body.taxTemplateId, ...body.items.map((i) => i.taxTemplateId ?? null)].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const templateMap = new Map<
    string,
    Awaited<ReturnType<typeof resolveTaxTemplate>>
  >();
  try {
    for (const id of templateIds) {
      templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Sales"));
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const invoiceLevelTemplate = body.taxTemplateId
    ? templateMap.get(body.taxTemplateId) ?? null
    : null;

  // Line + totals math (identical to sales-invoices create).
  const lines = body.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    body.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  // Round grand total per tenant round-off account — same shape as SI create.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultRoundOffAccountId: true, defaultIncomeAccountId: true },
  });
  const hasRoundOff = !!tenant?.defaultRoundOffAccountId;
  const roundedNum = hasRoundOff ? Math.round(Number(grandTotal)) : Number(grandTotal);
  const roundedTotal = new Prisma.Decimal(roundedNum);
  const roundingAdjustment = roundedTotal.sub(grandTotal);

  // Split-tender must exactly cover the rounded total (0.01 tolerance).
  // Pure helper — covered by pos.test.ts.
  const tenderErr = validateTenderTotal(body.tenders, Number(roundedTotal));
  if (tenderErr) return res.status(400).json({ error: tenderErr });

  // Razorpay signature verification (outside the tx — one HTTP round-trip
  // per Razorpay tender to fetch integration secrets, then hash-compare).
  // Fails here abort the checkout with 400 before we open the tx.
  for (const t of body.tenders) {
    if (t.mode !== "Razorpay") continue;
    if (!t.razorpayOrderId || !t.razorpayPaymentId || !t.razorpaySignature) {
      return res.status(400).json({
        error: "Razorpay tender missing razorpayOrderId/PaymentId/Signature",
      });
    }
    const method = methods.find((m) => m.mode === "Razorpay");
    if (!method?.integrationId)
      return res.status(400).json({ error: "Razorpay integration not configured on profile" });
    const integ = await prisma.tenantIntegration.findFirst({
      where: { id: method.integrationId, tenantId, isActive: true },
      select: { secrets: true },
    });
    if (!integ)
      return res.status(400).json({ error: "Razorpay integration not found/active" });
    const secret = (integ.secrets as { keySecret?: string } | null)?.keySecret;
    if (!secret)
      return res.status(400).json({ error: "Razorpay keySecret missing on integration" });
    const ok = verifyPaymentSignature(
      secret,
      t.razorpayOrderId,
      t.razorpayPaymentId,
      t.razorpaySignature,
    );
    if (!ok)
      return res
        .status(400)
        .json({ error: "Razorpay signature verification failed" });
  }

  const result = await prisma.$transaction(async (tx) => {
    // ---- Create + submit the SalesInvoice ----------------------------------
    const siName = await nextName(tx, tenantId, "POS-INV-");
    const inv = await tx.salesInvoice.create({
      data: {
        tenantId,
        name: siName,
        customerId: body.customerId,
        postingDate: new Date(),
        currency: "INR",
        conversionRate: new Prisma.Decimal(1),
        taxTemplateId: invoiceLevelTemplate?.id ?? null,
        remarks: body.remarks ?? null,
        netTotal,
        totalTaxes,
        grandTotal,
        roundedTotal,
        roundingAdjustment,
        outstandingAmt: new Prisma.Decimal(0), // POS invoices settle in the same tx
        status: "Paid",
        isPos: true,
        posProfileId: profile.id,
        posOpeningId: opening.id,
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
      include: { taxes: true },
    });

    // Post SI GL (same shape as SalesInvoice submit; no TCS, no return
    // handling because POS is walk-in forward-only).
    const defaultsKeys: Parameters<typeof requireTenantDefaults>[2] = [
      "defaultReceivableAccountId",
    ];
    if (Number(roundingAdjustment) !== 0) defaultsKeys.push("defaultRoundOffAccountId");
    const defaults = await requireTenantDefaults(tx, tenantId, defaultsKeys);
    const incomeAccountId =
      profile.incomeAccountId ?? tenant?.defaultIncomeAccountId;
    if (!incomeAccountId)
      throw new Error(
        "No income account: POSProfile.incomeAccountId and Tenant.defaultIncomeAccountId both null",
      );

    const siLines: {
      accountId: string;
      debit: number;
      credit: number;
      partyType?: string;
      partyId?: string;
      remarks?: string;
    }[] = [
      {
        accountId: defaults.defaultReceivableAccountId!,
        debit: Number(roundedTotal),
        credit: 0,
        partyType: "Customer",
        partyId: body.customerId,
      },
      { accountId: incomeAccountId, debit: 0, credit: Number(netTotal) },
    ];
    for (const t of inv.taxes)
      siLines.push({
        accountId: t.accountId,
        debit: 0,
        credit: Number(t.taxAmount),
        remarks: t.description,
      });
    const roundAdj = Number(roundingAdjustment);
    if (roundAdj !== 0) {
      const abs = Math.abs(roundAdj);
      siLines.push({
        accountId: defaults.defaultRoundOffAccountId!,
        debit: roundAdj < 0 ? abs : 0,
        credit: roundAdj > 0 ? abs : 0,
        remarks: "Rounding adjustment",
      });
    }
    await postGLEntries(tx, {
      tenantId,
      postingDate: inv.postingDate,
      voucherType: "SalesInvoice",
      voucherId: inv.id,
      voucherName: inv.name,
      lines: siLines,
    });

    // ---- One PaymentEntry per tender ---------------------------------------
    const paymentEntries: string[] = [];
    for (const tender of body.tenders) {
      const peName = await nextName(tx, tenantId, "POS-PE-");
      const modeAccountId = modeToAccount.get(tender.mode)!;
      const pe = await tx.paymentEntry.create({
        data: {
          tenantId,
          name: peName,
          paymentType: "Receive",
          partyType: "Customer",
          partyId: body.customerId,
          paidAmount: new Prisma.Decimal(tender.amount),
          currency: "INR",
          conversionRate: new Prisma.Decimal(1),
          modeOfPayment: tender.mode,
          postingDate: inv.postingDate,
          status: "Submitted",
          remarks: tender.reference
            ? `POS ${inv.name} ref=${tender.reference}`
            : `POS ${inv.name}`,
          references: {
            create: [
              {
                referenceDoctype: "SalesInvoice",
                referenceId: inv.id,
                allocatedAmount: new Prisma.Decimal(tender.amount),
              },
            ],
          },
        },
      });

      // PE GL: Dr <mode account>, Cr Debtors. Since this PE settles part of
      // the SI just posted above at the same conversionRate=1, there's no
      // FX delta to worry about.
      await postGLEntries(tx, {
        tenantId,
        postingDate: pe.postingDate,
        voucherType: "PaymentEntry",
        voucherId: pe.id,
        voucherName: pe.name,
        lines: [
          { accountId: modeAccountId, debit: tender.amount, credit: 0 },
          {
            accountId: defaults.defaultReceivableAccountId!,
            debit: 0,
            credit: tender.amount,
            partyType: "Customer",
            partyId: body.customerId,
          },
        ],
      });
      paymentEntries.push(pe.id);
    }

    return { invoiceId: inv.id, invoiceName: inv.name, paymentEntryIds: paymentEntries };
  });

  void emitEvent(prisma, tenantId, "SalesInvoice.submit", {
    id: result.invoiceId,
    name: result.invoiceName,
    customerId: body.customerId,
    grandTotal: Number(roundedTotal),
    currency: "INR",
    isPos: true,
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", kind: "emitEvent.failed", event: "SalesInvoice.submit",
      tenantId, id: result.invoiceId, isPos: true,
      error: err instanceof Error ? err.message : String(err),
      time: new Date().toISOString(),
    }));
  });

  res.status(201).json(result);
});

// ------------------------- List POS invoices --------------------------------
// Cashier UI: recent sales in the current session (for the receipt-reprint
// menu). Manager view: filter by openingId or dates.
posInvoiceRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const openingId = typeof req.query.openingId === "string" ? req.query.openingId : null;
  const rows = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      isPos: true,
      ...(openingId ? { posOpeningId: openingId } : {}),
    },
    include: {
      customer: { select: { customerName: true } },
    },
    orderBy: { postingDate: "desc" },
    take: 100,
  });
  res.json(rows);
});

// ------------------------- Razorpay checkout --------------------------------
// Cashier UI calls this BEFORE opening the Razorpay hosted checkout: it
// creates an order at Razorpay and returns the orderId + keyId that the
// browser SDK needs. On success callback, the cashier UI passes the returned
// razorpayPaymentId + signature into POST /checkout as part of the tender.
const razorpayOrderSchema = z.object({
  posProfileId: z.string().min(1),
  amount: z.coerce.number().positive(),
  receipt: z.string().max(40).optional(),
});

posInvoiceRouter.post("/razorpay/order", p.create, async (req, res) => {
  const parsed = razorpayOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const profile = await prisma.pOSProfile.findFirst({
    where: { id: parsed.data.posProfileId, tenantId, disabled: false },
    select: { paymentMethods: true },
  });
  if (!profile) return res.status(404).json({ error: "POSProfile not found" });
  const methods = (profile.paymentMethods as unknown as {
    mode: string;
    integrationId?: string | null;
  }[]) ?? [];
  const razorpay = methods.find((m) => m.mode === "Razorpay");
  if (!razorpay?.integrationId)
    return res.status(400).json({ error: "Razorpay not enabled on this profile" });
  const integ = await prisma.tenantIntegration.findFirst({
    where: { id: razorpay.integrationId, tenantId, isActive: true },
  });
  if (!integ) return res.status(400).json({ error: "Razorpay integration inactive" });
  const secrets = integ.secrets as { keyId?: string; keySecret?: string } | null;
  if (!secrets?.keyId || !secrets?.keySecret)
    return res.status(400).json({ error: "Razorpay keyId/keySecret missing" });

  try {
    const order = await createRazorpayOrder({
      keyId: secrets.keyId,
      keySecret: secrets.keySecret,
      amount: parsed.data.amount,
      currency: "INR",
      receipt: parsed.data.receipt ?? `pos-${Date.now()}`,
      notes: { source: "lumaara-pos", tenantId },
    });
    // Return keyId (public) — browser needs it to open Razorpay checkout.
    res.json({ order, keyId: secrets.keyId });
  } catch (e) {
    return res
      .status(502)
      .json({ error: e instanceof Error ? e.message : "Razorpay createOrder failed" });
  }
});
