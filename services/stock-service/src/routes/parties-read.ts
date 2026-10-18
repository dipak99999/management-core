import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Read-only Customer + Supplier endpoints hosted by stock-service so stock-web
// can render party dropdowns without cross-service calls. Writes still go
// through accounting-service (which owns these masters).

export const customersReadRouter = Router();

customersReadRouter.get("/", perms("Customer").read, async (req, res) => {
  const rows = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { customerName: "asc" },
    select: { id: true, customerName: true },
  });
  res.json(rows);
});

export const suppliersReadRouter = Router();

suppliersReadRouter.get("/", perms("Supplier").read, async (req, res) => {
  const rows = await prisma.supplier.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { supplierName: "asc" },
    select: { id: true, supplierName: true },
  });
  res.json(rows);
});
