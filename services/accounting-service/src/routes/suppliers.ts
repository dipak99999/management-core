import { Router } from "express";
import { z } from "zod";
import { isValidPan, prisma, validateCustomData } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const supplierRouter = Router();

const p = perms("Supplier");

const upsertSchema = z.object({
  supplierName: z.string().min(1),
  supplierType: z.enum(["Company", "Individual"]).default("Company"),
  supplierGroup: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
  // India PAN — 10 chars, format-validated below. Required for 26Q filing
  // (TDS return). Uppercase normalization applied server-side so mixed-case
  // input from wizards is accepted.
  pan: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : v))
    .refine((v) => !v || isValidPan(v), {
      message: "PAN must be 10 chars: [A-Z]{5}[0-9]{4}[A-Z]",
    }),
  // B13: default TDS category. PE form auto-populates from here; can be
  // overridden per PE.
  taxWithholdingCategoryId: z.string().optional().nullable(),
  // D10: default payment terms template. PI create form auto-populates
  // from here on supplier pick; overridable per invoice.
  defaultPaymentTermsTemplateId: z.string().optional().nullable(),
  customData: z.record(z.unknown()).optional().nullable(),
});

async function validateTdsCategory(
  tenantId: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  if (!categoryId) return null;
  const c = await prisma.taxWithholdingCategory.findFirst({
    where: { id: categoryId, tenantId, disabled: false },
    select: { id: true },
  });
  return c ? null : "Invalid TDS category";
}

supplierRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.supplier.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

supplierRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.supplier.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Master detail: supplier + activity history (bills, payments, outstanding).
supplierRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const supplier = await prisma.supplier.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!supplier) return res.status(404).json({ error: "Not found" });

  const [bills, outstandingAgg, payments, totalBilled] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: { tenantId, supplierId: supplier.id },
      select: {
        id: true,
        name: true,
        supplierInvoiceNo: true,
        postingDate: true,
        status: true,
        currency: true,
        grandTotal: true,
        outstandingAmt: true,
      },
      orderBy: { postingDate: "desc" },
      take: 50,
    }),
    prisma.purchaseInvoice.aggregate({
      where: {
        tenantId,
        supplierId: supplier.id,
        status: "Submitted",
        outstandingAmt: { gt: 0 },
      },
      _sum: { outstandingAmt: true },
      _count: true,
    }),
    prisma.paymentEntry.findMany({
      where: {
        tenantId,
        partyType: "Supplier",
        partyId: supplier.id,
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
      take: 50,
    }),
    prisma.purchaseInvoice.aggregate({
      where: { tenantId, supplierId: supplier.id, status: { in: ["Submitted", "Paid"] } },
      _sum: { grandTotal: true },
    }),
  ]);

  res.json({
    supplier,
    stats: {
      outstanding: Number(outstandingAgg._sum.outstandingAmt ?? 0),
      openBills: outstandingAgg._count,
      lifetimeBilled: Number(totalBilled._sum.grandTotal ?? 0),
    },
    bills,
    payments,
  });
});

supplierRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const tdsErr = await validateTdsCategory(tenantId, parsed.data.taxWithholdingCategoryId);
  if (tdsErr) return res.status(400).json({ error: tdsErr });
  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Supplier",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.supplier.create({
    data: { ...rest, tenantId, customData: customData ?? undefined },
  });
  res.status(201).json(row);
});

supplierRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.supplier.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.taxWithholdingCategoryId !== undefined) {
    const tdsErr = await validateTdsCategory(tenantId, parsed.data.taxWithholdingCategoryId);
    if (tdsErr) return res.status(400).json({ error: tdsErr });
  }
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Supplier",
        parsed.data.customData as Record<string, unknown> | null,
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.supplier.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
  });
  res.json(row);
});

supplierRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.supplier.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.supplier.delete({ where: { id: existing.id } });
  res.status(204).send();
});
