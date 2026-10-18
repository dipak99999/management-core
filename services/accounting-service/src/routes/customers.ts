import { Router } from "express";
import { z } from "zod";
import { isValidPan, prisma, validateCustomData } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const customerRouter = Router();

const p = perms("Customer");

const upsertSchema = z.object({
  customerName: z.string().min(1),
  customerType: z.enum(["Company", "Individual"]).default("Company"),
  customerGroup: z.string().optional().nullable(),
  territory: z.string().optional().nullable(),
  // D2: normalized segmentation FKs. Validated below.
  customerGroupId: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  // D5: loyalty program enrollment.
  loyaltyProgramId: z.string().optional().nullable(),
  // D6: credit limit (0 = no limit) + explicit override permission.
  creditLimit: z.coerce.number().nonnegative().default(0),
  creditLimitBypassAllowed: z.boolean().default(false),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  // India PAN — used for TCS 206C(1H) reporting when tenant collects tax
  // at source on customer sales.
  pan: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : v))
    .refine((v) => !v || isValidPan(v), {
      message: "PAN must be 10 chars: [A-Z]{5}[0-9]{4}[A-Z]",
    }),
  // Default TCS category. SI create auto-populates from here; can be
  // overridden per SI. Symmetric to Supplier.taxWithholdingCategoryId.
  taxCollectionCategoryId: z.string().optional().nullable(),
  // D10: default payment terms template — SI create form auto-populates
  // from here on customer pick; overridable per invoice.
  defaultPaymentTermsTemplateId: z.string().optional().nullable(),
  // Custom fields: keyed by CustomField.fieldName. Validated server-side.
  customData: z.record(z.unknown()).optional().nullable(),
});

async function validateSegmentation(
  tenantId: string,
  customerGroupId: string | null | undefined,
  territoryId: string | null | undefined,
): Promise<string | null> {
  if (customerGroupId) {
    const g = await prisma.customerGroup.findFirst({
      where: { id: customerGroupId, tenantId, isGroup: false },
    });
    if (!g) return "Invalid customer group (must be a leaf, non-group row)";
  }
  if (territoryId) {
    const t = await prisma.territory.findFirst({
      where: { id: territoryId, tenantId, isGroup: false },
    });
    if (!t) return "Invalid territory (must be a leaf, non-group row)";
  }
  return null;
}

customerRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.customer.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
  // Opt-in aggregates so the list page can show lifetime-billed + last
  // activity without an N+1. Guarded behind ?stats=1 so legacy callers
  // keep the fast response.
  if (req.query.stats !== "1") {
    return res.json(rows);
  }
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return res.json(rows);
  const [billed, lastInv] = await Promise.all([
    prisma.salesInvoice.groupBy({
      by: ["customerId"],
      where: {
        tenantId,
        customerId: { in: ids },
        status: { in: ["Submitted", "Paid"] },
        isReturn: false,
      },
      _sum: { grandTotal: true },
    }),
    prisma.salesInvoice.groupBy({
      by: ["customerId"],
      where: { tenantId, customerId: { in: ids } },
      _max: { postingDate: true },
    }),
  ]);
  const billedMap = new Map(billed.map((b) => [b.customerId, Number(b._sum.grandTotal ?? 0)]));
  const lastMap = new Map(lastInv.map((l) => [l.customerId, l._max.postingDate]));
  res.json(
    rows.map((r) => ({
      ...r,
      lifetimeBilled: billedMap.get(r.id) ?? 0,
      lastActivityAt: lastMap.get(r.id) ?? null,
    })),
  );
});

customerRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Master detail: customer + activity history (invoices, payments, outstanding).
// Recent-N caps applied server-side to keep the response small.
customerRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  // D12: Customer 360 — one endpoint, everything about the customer.
  const customer = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      customerGroupRel: { select: { groupName: true } },
      territoryRel: { select: { territoryName: true } },
      loyaltyProgram: { select: { name: true, pointsPerCurrency: true } },
    },
  });
  if (!customer) return res.status(404).json({ error: "Not found" });

  const [
    invoices,
    outstandingAgg,
    paymentRefs,
    totalBilled,
    contacts,
    addresses,
    loyaltyEntries,
    openSOs,
    openQuotes,
    subscriptions,
  ] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { tenantId, customerId: customer.id },
      select: {
        id: true,
        name: true,
        postingDate: true,
        dueDate: true,
        status: true,
        currency: true,
        grandTotal: true,
        outstandingAmt: true,
        isReturn: true,
      },
      orderBy: { postingDate: "desc" },
      take: 50,
    }),
    prisma.salesInvoice.aggregate({
      where: {
        tenantId,
        customerId: customer.id,
        status: "Submitted",
        outstandingAmt: { gt: 0 },
      },
      _sum: { outstandingAmt: true, grandTotal: true },
      _count: true,
    }),
    prisma.paymentEntry.findMany({
      where: {
        tenantId,
        partyType: "Customer",
        partyId: customer.id,
        status: { in: ["Submitted", "Draft"] },
      },
      select: {
        id: true,
        name: true,
        postingDate: true,
        modeOfPayment: true,
        paidAmount: true,
        status: true,
      },
      orderBy: { postingDate: "desc" },
      take: 20,
    }),
    prisma.salesInvoice.aggregate({
      where: { tenantId, customerId: customer.id, status: { in: ["Submitted", "Paid"] }, isReturn: false },
      _sum: { grandTotal: true },
    }),
    prisma.contact.findMany({
      where: { tenantId, linkedDoctype: "Customer", linkedId: customer.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.address.findMany({
      where: { tenantId, linkedDoctype: "Customer", linkedId: customer.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.loyaltyPointEntry.findMany({
      where: { tenantId, customerId: customer.id },
      select: { entryType: true, points: true, expiryDate: true },
    }),
    prisma.salesOrder.count({
      where: {
        tenantId,
        customerId: customer.id,
        status: { notIn: ["Draft", "Cancelled", "Completed"] },
      },
    }),
    prisma.quotation.count({
      where: {
        tenantId,
        customerId: customer.id,
        status: { in: ["Draft", "Submitted"] },
      },
    }),
    prisma.subscription.count({
      where: { tenantId, customerId: customer.id, status: "Active" },
    }),
  ]);

  // D5: loyalty balance = Σ Earned − Σ (Redeemed + Expired).
  let loyaltyBalance = 0;
  for (const l of loyaltyEntries) {
    if (l.entryType === "Earned") loyaltyBalance += l.points;
    else loyaltyBalance -= l.points;
  }

  // D12: outstanding by age bucket. Use each SI's dueDate (or postingDate if
  // absent) to bucket days-overdue.
  const now = Date.now();
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const inv of invoices) {
    if (inv.status !== "Submitted" || Number(inv.outstandingAmt) <= 0) continue;
    const ref = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.postingDate);
    const overdueDays = Math.max(0, (now - ref.getTime()) / 86400000);
    const amt = Number(inv.outstandingAmt);
    if (overdueDays === 0) ageing.current += amt;
    else if (overdueDays <= 30) ageing.d1_30 += amt;
    else if (overdueDays <= 60) ageing.d31_60 += amt;
    else if (overdueDays <= 90) ageing.d61_90 += amt;
    else ageing.d90_plus += amt;
  }

  // D6: credit exposure — % of limit used by open outstanding.
  const outstanding = Number(outstandingAgg._sum.outstandingAmt ?? 0);
  const creditLimit = Number(customer.creditLimit ?? 0);
  const creditUsedPct = creditLimit > 0 ? (outstanding / creditLimit) * 100 : null;

  res.json({
    customer,
    stats: {
      outstanding,
      openInvoices: outstandingAgg._count,
      lifetimeBilled: Number(totalBilled._sum.grandTotal ?? 0),
      loyaltyBalance,
      openSOs,
      openQuotes,
      activeSubscriptions: subscriptions,
      creditLimit,
      creditUsedPct,
    },
    ageing,
    contacts,
    addresses,
    invoices,
    payments: paymentRefs,
  });
});

customerRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const segErr = await validateSegmentation(
    tenantId,
    parsed.data.customerGroupId,
    parsed.data.territoryId,
  );
  if (segErr) return res.status(400).json({ error: segErr });
  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Customer",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.customer.create({
    data: { ...rest, tenantId, customData: customData ?? undefined },
  });
  res.status(201).json(row);
});

customerRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (
    parsed.data.customerGroupId !== undefined ||
    parsed.data.territoryId !== undefined
  ) {
    const segErr = await validateSegmentation(
      tenantId,
      parsed.data.customerGroupId,
      parsed.data.territoryId,
    );
    if (segErr) return res.status(400).json({ error: segErr });
  }
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Customer",
        parsed.data.customData as Record<string, unknown> | null,
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.customer.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
  });
  res.json(row);
});

customerRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.customer.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  try {
    await prisma.customer.delete({ where: { id: existing.id } });
  } catch (e) {
    // Prisma P2003 = FK constraint violation (customer referenced by
    // delivery notes, invoices, orders, …). Return 409 instead of
    // letting the unhandledRejection handler kill the whole service.
    if (
      e != null &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2003"
    ) {
      return res.status(409).json({
        error:
          "Customer is referenced by other records (invoices, delivery notes, orders). Delete or reassign those first.",
      });
    }
    throw e;
  }
  res.status(204).send();
});
