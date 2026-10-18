import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

/**
 * Per-user saved filter sets backing `useSavedViews` from @lumaara/web-ui.
 *
 * Shape is deliberately generic: `filters` is caller-defined JSON, keyed
 * by a client-chosen `listKey` string (e.g. "stock-web:pick-lists"). This
 * is distinct from `/list-views`, which is the ERPNext-style column +
 * filter + sort structure used by the generic doctype list surface.
 */
export const userViewRouter = Router();
userViewRouter.use(requireAuth);

const upsertSchema = z.object({
  listKey: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  filters: z.unknown(),
  isDefault: z.boolean().default(false),
});

userViewRouter.get("/", async (req, res) => {
  const auth = req.auth!;
  const listKey = typeof req.query.listKey === "string" ? req.query.listKey : undefined;
  const rows = await prisma.userListView.findMany({
    where: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      ...(listKey ? { listKey } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  res.json(rows);
});

userViewRouter.post("/", async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.userListView.updateMany({
        where: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          listKey: parsed.data.listKey,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }
    return tx.userListView.create({
      data: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        listKey: parsed.data.listKey,
        name: parsed.data.name,
        filters: parsed.data.filters as Prisma.InputJsonValue,
        isDefault: parsed.data.isDefault,
      },
    });
  });
  res.status(201).json(row);
});

userViewRouter.put("/:id", async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const existing = await prisma.userListView.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId, userId: auth.userId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.userListView.updateMany({
        where: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          listKey: existing.listKey,
          isDefault: true,
          NOT: { id: existing.id },
        },
        data: { isDefault: false },
      });
    }
    return tx.userListView.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.filters !== undefined
          ? { filters: parsed.data.filters as Prisma.InputJsonValue }
          : {}),
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
      },
    });
  });
  res.json(row);
});

userViewRouter.delete("/:id", async (req, res) => {
  const auth = req.auth!;
  const existing = await prisma.userListView.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId, userId: auth.userId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.userListView.delete({ where: { id: existing.id } });
  res.status(204).send();
});
