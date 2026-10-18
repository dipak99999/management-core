import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D2: Customer Group hierarchical master. Same tree pattern as Account /
// Warehouse. Leaf groups (isGroup=false) are what customers link to.

export const customerGroupRouter = Router();

const p = perms("CustomerGroup");

const upsertSchema = z.object({
  groupName: z.string().min(1),
  parentId: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
});

customerGroupRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.customerGroup.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { groupName: "asc" },
  });
  res.json(rows);
});

customerGroupRouter.get("/tree", p.read, async (req, res) => {
  const rows = await prisma.customerGroup.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { groupName: "asc" },
  });
  type Node = (typeof rows)[number] & { children: Node[] };
  const byId = new Map<string, Node>();
  const roots: Node[] = [];
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  for (const r of rows) {
    const n = byId.get(r.id)!;
    if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId)!.children.push(n);
    else roots.push(n);
  }
  res.json(roots);
});

customerGroupRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  if (parsed.data.parentId) {
    const parent = await prisma.customerGroup.findFirst({
      where: { id: parsed.data.parentId, tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
  }
  try {
    const row = await prisma.customerGroup.create({
      data: { ...parsed.data, tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Group name already exists" });
    throw e;
  }
});

customerGroupRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.customerGroup.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.customerGroup.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

customerGroupRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.customerGroup.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { customers: true, children: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.customers > 0 || existing._count.children > 0)
    return res.status(400).json({
      error: `Cannot delete: has ${existing._count.customers} customers + ${existing._count.children} sub-groups`,
    });
  await prisma.customerGroup.delete({ where: { id: existing.id } });
  res.status(204).send();
});
