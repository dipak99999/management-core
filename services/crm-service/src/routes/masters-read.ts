import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

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
    },
  });
  res.json(rows);
});

export const customersReadRouter = Router();
customersReadRouter.get("/", perms("Customer").read, async (req, res) => {
  const rows = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { customerName: "asc" },
    select: { id: true, customerName: true, email: true, mobile: true, gstin: true },
  });
  res.json(rows);
});

// Warehouses read-through so the SO → Delivery Note convert dialog can let the
// user pick a source warehouse without a cross-service call.
export const warehousesReadRouter = Router();
warehousesReadRouter.get("/", perms("Warehouse").read, async (req, res) => {
  const rows = await prisma.warehouse.findMany({
    where: { tenantId: req.auth!.tenantId, disabled: false, isGroup: false },
    orderBy: { warehouseName: "asc" },
    select: { id: true, warehouseName: true },
  });
  res.json(rows);
});
