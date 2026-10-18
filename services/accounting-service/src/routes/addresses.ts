import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D1: polymorphic address CRUD. Each row links to Customer | Supplier | Lead
// via linkedDoctype + linkedId. UI queries by these to render address panels
// on the party detail pages.

export const addressRouter = Router();

const p = perms("Address");

const upsertSchema = z.object({
  linkedDoctype: z.enum(["Customer", "Supplier", "Lead"]),
  linkedId: z.string().min(1),
  addressType: z
    .enum(["Billing", "Shipping", "Office", "Other"])
    .default("Billing"),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  isPrimary: z.boolean().default(false),
});

// The parent-doctype validation is per-doctype: only allow linking to a
// party that belongs to this tenant. Keeps the polymorphic link safe.
async function validateParent(
  tenantId: string,
  linkedDoctype: string,
  linkedId: string,
): Promise<string | null> {
  if (linkedDoctype === "Customer") {
    const c = await prisma.customer.findFirst({ where: { id: linkedId, tenantId } });
    return c ? null : "Invalid customer";
  }
  if (linkedDoctype === "Supplier") {
    const s = await prisma.supplier.findFirst({ where: { id: linkedId, tenantId } });
    return s ? null : "Invalid supplier";
  }
  if (linkedDoctype === "Lead") {
    const l = await prisma.lead.findFirst({ where: { id: linkedId, tenantId } });
    return l ? null : "Invalid lead";
  }
  return "Unknown linkedDoctype";
}

addressRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const linkedDoctype =
    typeof req.query.linkedDoctype === "string" ? req.query.linkedDoctype : undefined;
  const linkedId =
    typeof req.query.linkedId === "string" ? req.query.linkedId : undefined;
  const rows = await prisma.address.findMany({
    where: {
      tenantId,
      ...(linkedDoctype ? { linkedDoctype } : {}),
      ...(linkedId ? { linkedId } : {}),
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  res.json(rows);
});

addressRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateParent(
    tenantId,
    parsed.data.linkedDoctype,
    parsed.data.linkedId,
  );
  if (err) return res.status(400).json({ error: err });
  // If this row is marked primary, demote any existing primary of same
  // (doctype, id) so exactly one primary per party at a time.
  if (parsed.data.isPrimary) {
    await prisma.address.updateMany({
      where: {
        tenantId,
        linkedDoctype: parsed.data.linkedDoctype,
        linkedId: parsed.data.linkedId,
        isPrimary: true,
      },
      data: { isPrimary: false },
    });
  }
  const row = await prisma.address.create({
    data: { tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});

addressRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.address.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.isPrimary) {
    await prisma.address.updateMany({
      where: {
        tenantId: existing.tenantId,
        linkedDoctype: parsed.data.linkedDoctype,
        linkedId: parsed.data.linkedId,
        isPrimary: true,
        NOT: { id: existing.id },
      },
      data: { isPrimary: false },
    });
  }
  const row = await prisma.address.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

addressRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.address.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.address.delete({ where: { id: existing.id } });
  res.status(204).send();
});
