import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 61 — Bulk Edit Tool.
//
// Generic doctype-scoped patch endpoint. Operator picks N rows in the
// list view + one field + one new value → we update all N in a single
// transaction. Kept intentionally narrow (single field per call) so the
// audit + validation surface stays predictable.
//
// Allowlist per doctype: only fields explicitly listed can be bulk
// edited. Everything else requires a per-doc route (which enforces
// its own business rules). This avoids "bulk change SI.status to
// Submitted" which would skip the submit workflow.

export const bulkEditRouter = Router();
const p = perms("Account"); // Admin-only surface

// Per-doctype: field name → Prisma model key + zod validator + optional
// friendly label for the UI to enumerate available fields.
interface BulkField {
  field: string;
  label: string;
  validator: z.ZodType;
  // Post-parse transform for e.g. converting to Prisma.Decimal.
  transform?: (v: unknown) => unknown;
}

interface DoctypeConfig {
  model: string; // Prisma model access key
  fields: BulkField[];
}

const DOCTYPE_MAP: Record<string, DoctypeConfig> = {
  Customer: {
    model: "customer",
    fields: [
      { field: "customerGroup", label: "Customer Group", validator: z.string().max(100).nullable() },
      { field: "territory", label: "Territory", validator: z.string().max(100).nullable() },
      { field: "taxWithholdingCategoryId", label: "TDS Category", validator: z.string().nullable() },
      { field: "defaultPaymentTermsTemplateId", label: "Default Payment Terms", validator: z.string().nullable() },
    ],
  },
  Supplier: {
    model: "supplier",
    fields: [
      { field: "supplierGroup", label: "Supplier Group", validator: z.string().max(100).nullable() },
      { field: "taxWithholdingCategoryId", label: "TDS Category", validator: z.string().nullable() },
      { field: "defaultPaymentTermsTemplateId", label: "Default Payment Terms", validator: z.string().nullable() },
    ],
  },
  Item: {
    model: "item",
    fields: [
      { field: "isStockItem", label: "Is Stock Item", validator: z.boolean() },
      { field: "isSalesItem", label: "Is Sales Item", validator: z.boolean() },
      { field: "isPurchaseItem", label: "Is Purchase Item", validator: z.boolean() },
      { field: "defaultSalesTaxTemplateId", label: "Default Sales Tax Template", validator: z.string().nullable() },
      { field: "defaultPurchaseTaxTemplateId", label: "Default Purchase Tax Template", validator: z.string().nullable() },
      {
        field: "standardRate",
        label: "Standard Rate",
        validator: z.coerce.number().nonnegative(),
        transform: (v) => new Prisma.Decimal(v as number),
      },
    ],
  },
  Employee: {
    model: "employee",
    fields: [
      { field: "branchId", label: "Branch", validator: z.string().nullable() },
      { field: "departmentId", label: "Department", validator: z.string().nullable() },
      { field: "gradeId", label: "Grade", validator: z.string().nullable() },
      { field: "reportsToId", label: "Reports To", validator: z.string().nullable() },
    ],
  },
};

// Enumeration endpoint for the UI: list allowable (doctype, field) combos.
bulkEditRouter.get("/schema", p.read, async (_req, res) => {
  const schema = Object.entries(DOCTYPE_MAP).map(([doctype, cfg]) => ({
    doctype,
    fields: cfg.fields.map((f) => ({ field: f.field, label: f.label })),
  }));
  res.json(schema);
});

const bulkPatchSchema = z.object({
  doctype: z.string(),
  ids: z.array(z.string().min(1)).min(1).max(1000),
  field: z.string(),
  // Value shape depends on the field's own validator — validated below.
  value: z.unknown(),
});

bulkEditRouter.post("/patch", p.write, async (req, res) => {
  const parsed = bulkPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { doctype, ids, field, value } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const cfg = DOCTYPE_MAP[doctype];
  if (!cfg) return res.status(400).json({ error: `Doctype ${doctype} not in bulk-edit allowlist` });
  const fieldCfg = cfg.fields.find((f) => f.field === field);
  if (!fieldCfg) {
    return res.status(400).json({
      error: `Field ${field} not bulk-editable on ${doctype}. Allowed: ${cfg.fields.map((f) => f.field).join(", ")}`,
    });
  }

  const valueParsed = fieldCfg.validator.safeParse(value);
  if (!valueParsed.success) return res.status(400).json({ error: valueParsed.error.flatten() });
  const finalValue = fieldCfg.transform ? fieldCfg.transform(valueParsed.data) : valueParsed.data;

  // Verify all IDs are in this tenant before the update — we don't want
  // a bulk patch to accidentally touch cross-tenant rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[cfg.model];
  if (!model?.count || !model?.updateMany) {
    return res.status(500).json({ error: "Doctype model not accessible" });
  }
  const found = await model.count({ where: { id: { in: ids }, tenantId } });
  if (found !== new Set(ids).size) {
    return res.status(400).json({ error: "One or more IDs invalid or off-tenant" });
  }

  const result = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txModel = (tx as any)[cfg.model];
    const r = await txModel.updateMany({
      where: { id: { in: ids }, tenantId },
      data: { [field]: finalValue },
    });
    // Explicit audit entry with the diff so ops can trace bulk ops.
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: req.auth!.userId,
        userEmail: req.auth!.email,
        method: "POST-bulk-patch",
        path: req.originalUrl,
        doctype,
        statusCode: 200,
        payload: {
          doctype,
          field,
          value: finalValue,
          idCount: ids.length,
          idsSample: ids.slice(0, 20), // sample to keep payload bounded
          updated: r.count,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return r.count;
  });
  res.json({ updated: result, doctype, field });
});
