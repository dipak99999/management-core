import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Read-through masters so projects-web can render party/assignee dropdowns
// without cross-service calls. Writes still go through accounting-service /
// hr-service (which own these masters).

export const customersReadRouter = Router();
customersReadRouter.get("/", perms("Customer").read, async (req, res) => {
  const rows = await prisma.customer.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { customerName: "asc" },
    select: { id: true, customerName: true },
  });
  res.json(rows);
});

export const employeesReadRouter = Router();
employeesReadRouter.get("/", perms("Employee").read, async (req, res) => {
  const rows = await prisma.employee.findMany({
    where: { tenantId: req.auth!.tenantId, status: "Active" },
    orderBy: { employeeName: "asc" },
    select: { id: true, employeeCode: true, employeeName: true },
  });
  res.json(rows);
});

// Items catalog for timesheet-to-invoice: the user picks one Item (usually a
// service like "Consulting Hours") to represent hours on the generated SIs.
export const itemsReadRouter = Router();
itemsReadRouter.get("/", perms("Item").read, async (req, res) => {
  const rows = await prisma.item.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { itemName: "asc" },
    select: {
      id: true,
      itemCode: true,
      itemName: true,
      stockUom: true,
      isStockItem: true,
    },
  });
  res.json(rows);
});
