import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Repost Item Valuation — audit + trigger record for asynchronously
// recomputing the moving-average valuation chain of a single (item,
// warehouse) bin. Route creates a Queued row; the scheduler tick picks
// it up and runs the actual walk inside a $transaction. Async because
// a long SLE chain (thousands of rows for a fast-moving warehouse)
// shouldn't hold the HTTP request thread.

export const repostItemValuationRouter = Router();

// Reuse StockReconciliation ACL — same class of user (operations/admin)
// can trigger both a physical count adjustment and a valuation repost.
const p = perms("StockReconciliation");

const createSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  fromDate: z.string().datetime(),
});

repostItemValuationRouter.get("/", p.read, async (req, res) => {
  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.repostItemValuation.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

repostItemValuationRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.repostItemValuation.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      item: { select: { id: true, itemCode: true, itemName: true } },
      warehouse: { select: { id: true, warehouseName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

repostItemValuationRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  // Validate item + warehouse belong to tenant.
  const [item, warehouse] = await Promise.all([
    prisma.item.findFirst({
      where: { id: body.itemId, tenantId, isStockItem: true },
      select: { id: true },
    }),
    prisma.warehouse.findFirst({
      where: { id: body.warehouseId, tenantId, disabled: false, isGroup: false },
      select: { id: true },
    }),
  ]);
  if (!item)
    return res.status(400).json({ error: "Invalid or non-stock item" });
  if (!warehouse)
    return res.status(400).json({ error: "Invalid or disabled/group warehouse" });

  // If there's already a Queued or Processing row for this bin, refuse
  // — two concurrent reposts would race on the same SLEs.
  const inFlight = await prisma.repostItemValuation.findFirst({
    where: {
      tenantId,
      itemId: body.itemId,
      warehouseId: body.warehouseId,
      status: { in: ["Queued", "Processing"] },
    },
    select: { id: true, status: true },
  });
  if (inFlight)
    return res.status(409).json({
      error: `A ${inFlight.status} repost already exists for this bin (id ${inFlight.id})`,
    });

  const row = await prisma.repostItemValuation.create({
    data: {
      tenantId,
      itemId: body.itemId,
      warehouseId: body.warehouseId,
      fromDate: new Date(body.fromDate),
      status: "Queued",
      createdBy: req.auth!.userId,
    },
  });
  res.status(201).json(row);
});
