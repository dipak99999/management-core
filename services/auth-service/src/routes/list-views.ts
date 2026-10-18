import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// I3: ListView. User-owned column/filter layout for a doctype's list page.
// isShared makes it visible to everyone in the tenant; isDefault picks the
// applied view when no ?view= is set. Only owner can modify.

export const listViewRouter = Router();
listViewRouter.use(requireAuth);

const p = perms("ListView");

const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"]),
  value: z.unknown(),
});
const sortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(["asc", "desc"]),
});

const upsertSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
  isShared: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  columns: z.array(z.string()).min(1),
  filters: z.array(filterSchema).optional().nullable(),
  sortBy: z.array(sortSchema).optional().nullable(),
});

// List: my views + shared views for a given doctype.
listViewRouter.get("/", p.read, async (req, res) => {
  const auth = req.auth!;
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const rows = await prisma.listView.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(doctype ? { doctype } : {}),
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
    orderBy: [{ doctype: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

listViewRouter.get("/:id", p.read, async (req, res) => {
  const auth = req.auth!;
  const row = await prisma.listView.findFirst({
    where: {
      id: req.params.id,
      tenantId: auth.tenantId,
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

listViewRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        // per-user default: clear owner's other defaults for this doctype
        await tx.listView.updateMany({
          where: {
            tenantId: auth.tenantId,
            doctype: parsed.data.doctype,
            ownerUserId: auth.userId,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      return tx.listView.create({
        data: {
          tenantId: auth.tenantId,
          ownerUserId: auth.userId,
          doctype: parsed.data.doctype,
          name: parsed.data.name,
          isShared: parsed.data.isShared,
          isDefault: parsed.data.isDefault,
          columns: parsed.data.columns as unknown as Prisma.InputJsonValue,
          filters: (parsed.data.filters ?? []) as unknown as Prisma.InputJsonValue,
          sortBy: (parsed.data.sortBy ?? []) as unknown as Prisma.InputJsonValue,
        },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "List view name already exists for this doctype" });
    throw e;
  }
});

listViewRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const existing = await prisma.listView.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== auth.userId)
    return res.status(403).json({ error: "Only the owner can modify this view" });

  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.listView.updateMany({
        where: {
          tenantId: auth.tenantId,
          doctype: existing.doctype,
          ownerUserId: auth.userId,
          isDefault: true,
          NOT: { id: existing.id },
        },
        data: { isDefault: false },
      });
    }
    return tx.listView.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.isShared !== undefined ? { isShared: parsed.data.isShared } : {}),
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        ...(parsed.data.columns !== undefined
          ? { columns: parsed.data.columns as unknown as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.filters !== undefined
          ? { filters: (parsed.data.filters ?? []) as unknown as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.sortBy !== undefined
          ? { sortBy: (parsed.data.sortBy ?? []) as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  });
  res.json(row);
});

listViewRouter.delete("/:id", p.delete, async (req, res) => {
  const auth = req.auth!;
  const existing = await prisma.listView.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== auth.userId)
    return res.status(403).json({ error: "Only the owner can delete this view" });
  await prisma.listView.delete({ where: { id: existing.id } });
  res.status(204).send();
});
