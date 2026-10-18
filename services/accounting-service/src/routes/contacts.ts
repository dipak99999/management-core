import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D1: polymorphic contact CRUD. Same shape as addresses.

export const contactRouter = Router();

const p = perms("Contact");

const upsertSchema = z.object({
  linkedDoctype: z.enum(["Customer", "Supplier", "Lead"]),
  linkedId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  isPrimary: z.boolean().default(false),
});

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

contactRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const linkedDoctype =
    typeof req.query.linkedDoctype === "string" ? req.query.linkedDoctype : undefined;
  const linkedId =
    typeof req.query.linkedId === "string" ? req.query.linkedId : undefined;
  const rows = await prisma.contact.findMany({
    where: {
      tenantId,
      ...(linkedDoctype ? { linkedDoctype } : {}),
      ...(linkedId ? { linkedId } : {}),
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  res.json(rows);
});

contactRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateParent(
    tenantId,
    parsed.data.linkedDoctype,
    parsed.data.linkedId,
  );
  if (err) return res.status(400).json({ error: err });
  if (parsed.data.isPrimary) {
    await prisma.contact.updateMany({
      where: {
        tenantId,
        linkedDoctype: parsed.data.linkedDoctype,
        linkedId: parsed.data.linkedId,
        isPrimary: true,
      },
      data: { isPrimary: false },
    });
  }
  const row = await prisma.contact.create({
    data: { tenantId, ...parsed.data },
  });
  res.status(201).json(row);
});

contactRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.contact.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.isPrimary) {
    await prisma.contact.updateMany({
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
  const row = await prisma.contact.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

contactRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.contact.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.contact.delete({ where: { id: existing.id } });
  res.status(204).send();
});
