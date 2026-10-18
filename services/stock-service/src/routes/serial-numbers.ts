import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C5: read-only browser for SerialNo records. Filtering by item, warehouse,
// status, or search string. Serial records are only ever mutated by PR /
// DN routes (submit/cancel) — no manual create/edit endpoint.

export const serialNoRouter = Router();

const p = perms("SerialNo");

serialNoRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const warehouseId =
    typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const rows = await prisma.serialNo.findMany({
    where: {
      tenantId,
      ...(itemId ? { itemId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(status ? { status } : {}),
      ...(q ? { serialNo: { contains: q } } : {}),
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

serialNoRouter.get("/:serialNo", p.read, async (req, res) => {
  const row = await prisma.serialNo.findFirst({
    where: {
      tenantId: req.auth!.tenantId,
      serialNo: req.params.serialNo,
    },
    include: {
      item: { select: { itemCode: true, itemName: true } },
      warehouse: { select: { warehouseName: true } },
      purchaseReceiptItem: {
        include: { purchaseReceipt: { select: { name: true, postingDate: true } } },
      },
      deliveryNoteItem: {
        include: { deliveryNote: { select: { name: true, postingDate: true } } },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
