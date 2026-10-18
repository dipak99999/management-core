import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D2: Territory tree. Same shape as CustomerGroup.

export const territoryRouter = Router();

const p = perms("Territory");

const upsertSchema = z.object({
  territoryName: z.string().min(1),
  parentId: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
});

territoryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.territory.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { territoryName: "asc" },
  });
  res.json(rows);
});

territoryRouter.get("/tree", p.read, async (req, res) => {
  const rows = await prisma.territory.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { territoryName: "asc" },
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

territoryRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  if (parsed.data.parentId) {
    const parent = await prisma.territory.findFirst({
      where: { id: parsed.data.parentId, tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
  }
  try {
    const row = await prisma.territory.create({
      data: { ...parsed.data, tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Territory name already exists" });
    throw e;
  }
});

territoryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.territory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.territory.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

territoryRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.territory.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { customers: true, children: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.customers > 0 || existing._count.children > 0)
    return res.status(400).json({
      error: `Cannot delete: has ${existing._count.customers} customers + ${existing._count.children} sub-territories`,
    });
  await prisma.territory.delete({ where: { id: existing.id } });
  res.status(204).send();
});
