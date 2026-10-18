import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const taxTemplateRouter = Router();

const p = perms("TaxTemplate");

// A tax template is now a header + multiple rows. Backward compat: pre-turn-45
// templates have `rate`+`accountId` set at the header level and no rows —
// SI/PI application logic (in sales-invoices.ts / purchase-invoices.ts) prefers
// rows when present and falls back to header fields otherwise.
const rowSchema = z.object({
  description: z.string().min(1),
  rate: z.coerce.number().min(0).max(100),
  accountId: z.string().min(1),
  sortOrder: z.coerce.number().int().default(0),
  chargeType: z
    .enum(["On Net Total", "On Previous Row Total", "Actual"])
    .default("On Net Total"),
  amount: z.coerce.number().nonnegative().default(0), // used only for Actual
});

const upsertSchema = z.object({
  name: z.string().min(1),
  templateType: z.enum(["Sales", "Purchase"]),
  isDefault: z.boolean().default(false),
  // At least one row required. UI presents an add-row editor.
  rows: z.array(rowSchema).min(1),
});

// Validates every row's accountId belongs to the tenant and is a leaf.
async function validateRowAccounts(
  tenantId: string,
  rows: z.infer<typeof rowSchema>[],
): Promise<string | null> {
  const ids = [...new Set(rows.map((r) => r.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: ids }, tenantId, isGroup: false, disabled: false },
    select: { id: true },
  });
  if (accounts.length !== ids.length)
    return "One or more tax accounts are invalid (must be leaf, non-disabled, tenant-owned)";
  return null;
}

// List, optionally filtered by templateType (?type=Sales|Purchase).
// Includes rows + resolved account names on both header (legacy) and rows.
taxTemplateRouter.get("/", p.read, async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const rows = await prisma.taxTemplate.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(type ? { templateType: type } : {}),
    },
    include: {
      account: { select: { accountName: true, rootType: true } },
      rows: {
        include: { account: { select: { accountName: true, rootType: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ templateType: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

taxTemplateRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.taxTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      account: { select: { accountName: true } },
      rows: {
        include: { account: { select: { accountName: true, rootType: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

taxTemplateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const err = await validateRowAccounts(tenantId, data.rows);
  if (err) return res.status(400).json({ error: err });

  if (data.isDefault) {
    await prisma.taxTemplate.updateMany({
      where: { tenantId, templateType: data.templateType, isDefault: true },
      data: { isDefault: false },
    });
  }

  try {
    const row = await prisma.taxTemplate.create({
      data: {
        tenantId,
        name: data.name,
        templateType: data.templateType,
        isDefault: data.isDefault,
        // Header rate/accountId no longer required — leave null on new
        // templates. Legacy templates keep whatever's already there.
        rows: {
          create: data.rows.map((r) => ({
            description: r.description,
            rate: new Prisma.Decimal(r.rate),
            accountId: r.accountId,
            sortOrder: r.sortOrder,
            chargeType: r.chargeType,
            amount: new Prisma.Decimal(r.amount),
          })),
        },
      },
      include: {
        rows: {
          include: { account: { select: { accountName: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Tax template name already exists" });
    }
    throw e;
  }
});

taxTemplateRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.taxTemplate.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const err = await validateRowAccounts(tenantId, data.rows);
  if (err) return res.status(400).json({ error: err });

  if (data.isDefault && !existing.isDefault) {
    await prisma.taxTemplate.updateMany({
      where: { tenantId, templateType: data.templateType, isDefault: true },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.taxTemplateRow.deleteMany({ where: { taxTemplateId: existing.id } });
    return tx.taxTemplate.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        templateType: data.templateType,
        isDefault: data.isDefault,
        rows: {
          create: data.rows.map((r) => ({
            description: r.description,
            rate: new Prisma.Decimal(r.rate),
            accountId: r.accountId,
            sortOrder: r.sortOrder,
            chargeType: r.chargeType,
            amount: new Prisma.Decimal(r.amount),
          })),
        },
      },
      include: {
        rows: {
          include: { account: { select: { accountName: true } } },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });
  res.json(updated);
});

taxTemplateRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.taxTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { salesInvoices: true, purchaseInvoices: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.salesInvoices + existing._count.purchaseInvoices > 0) {
    return res.status(400).json({
      error: `Cannot delete: template is referenced by ${existing._count.salesInvoices} sales + ${existing._count.purchaseInvoices} purchase invoices`,
    });
  }
  await prisma.taxTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});
