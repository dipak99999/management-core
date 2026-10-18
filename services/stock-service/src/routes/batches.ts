import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C6: read + limited write for Batch. Manual create/edit is allowed so ops
// can pre-register a batch before the first receipt (adjust dates later);
// PR/DN routes are what actually change batchQty.

export const batchRouter = Router();

const p = perms("Batch");

batchRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const expiringWithinDays =
    typeof req.query.expiringWithinDays === "string"
      ? Number(req.query.expiringWithinDays)
      : null;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const now = new Date();
  const cutoff =
    expiringWithinDays != null
      ? new Date(now.getTime() + expiringWithinDays * 24 * 60 * 60 * 1000)
      : null;
  const rows = await prisma.batch.findMany({
    where: {
      tenantId,
      ...(itemId ? { itemId } : {}),
      ...(q ? { batchNo: { contains: q } } : {}),
      ...(cutoff
        ? {
            expiryDate: { lte: cutoff, gte: now },
          }
        : {}),
    },
    include: {
      item: { select: { itemCode: true, itemName: true } },
    },
    orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }],
    take: 500,
  });
  res.json(rows);
});

batchRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.batch.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { item: { select: { itemCode: true, itemName: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
