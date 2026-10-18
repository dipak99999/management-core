import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Read-only Item endpoint hosted by stock-service so stock-web can render Item
// dropdowns without a cross-service call. Item writes still go through
// accounting-service (which owns the Item master).

export const itemsReadRouter = Router();

itemsReadRouter.get("/", perms("Item").read, async (req, res) => {
  const rows = await prisma.item.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { itemCode: "asc" },
    select: {
      id: true,
      itemCode: true,
      itemName: true,
      stockUom: true,
      standardRate: true,
      isStockItem: true,
    },
  });
  res.json(rows);
});
