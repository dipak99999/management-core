import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D7: Sales Person master. Attached to SalesInvoice for attribution +
// commission tracking.

export const salesPersonRouter = Router();

const p = perms("SalesPerson");

const upsertSchema = z.object({
  name: z.string().min(1),
  employeeId: z.string().optional().nullable(),
  defaultCommissionPercent: z.coerce.number().min(0).max(100).default(0),
  enabled: z.boolean().default(true),
});

salesPersonRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.salesPerson.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
    },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

salesPersonRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.salesPerson.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        employeeId: parsed.data.employeeId ?? null,
        defaultCommissionPercent: new Prisma.Decimal(
          parsed.data.defaultCommissionPercent,
        ),
        enabled: parsed.data.enabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Sales person name already exists" });
    throw e;
  }
});

salesPersonRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.salesPerson.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.salesPerson.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      employeeId: parsed.data.employeeId ?? null,
      defaultCommissionPercent: new Prisma.Decimal(
        parsed.data.defaultCommissionPercent,
      ),
      enabled: parsed.data.enabled,
    },
  });
  res.json(row);
});

salesPersonRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.salesPerson.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { invoices: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.invoices > 0)
    return res.status(400).json({
      error: `Cannot delete: attached to ${existing._count.invoices} invoices`,
    });
  await prisma.salesPerson.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// D7: commission report. Aggregates commission per sales person over a
// date range.
//
// Deal-split aware: if a SalesInvoice has rows in
// SalesInvoiceSalesPersonAllocation, those are the source of truth
// (each row contributes attributedRevenue = grandTotal * allocationPct
// / 100 and commission = attributedRevenue * commissionRate / 100).
// Otherwise falls back to the single-person model
// (grandTotal * SI.commissionPercent → SI.salesPersonId).
salesPersonRouter.get("/commission-report", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const from =
    typeof req.query.from === "string"
      ? new Date(req.query.from)
      : new Date(new Date().setMonth(new Date().getMonth() - 1));
  const to =
    typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      status: { in: ["Submitted", "Paid"] },
      isReturn: false,
      postingDate: { gte: from, lte: to },
    },
    select: {
      id: true,
      name: true,
      postingDate: true,
      grandTotal: true,
      commissionPercent: true,
      salesPersonId: true,
      salesPerson: { select: { id: true, name: true } },
      salesTeam: {
        select: {
          salesPersonId: true,
          allocationPct: true,
          commissionRate: true,
          salesPerson: { select: { id: true, name: true } },
        },
      },
    },
  });

  const bySP = new Map<
    string,
    { name: string; count: number; totalSales: number; commission: number }
  >();
  const bump = (id: string, name: string, sales: number, commission: number) => {
    const g = bySP.get(id) ?? { name, count: 0, totalSales: 0, commission: 0 };
    g.count++;
    g.totalSales += sales;
    g.commission += commission;
    bySP.set(id, g);
  };

  for (const inv of invoices) {
    const grand = Number(inv.grandTotal);
    if (inv.salesTeam.length > 0) {
      for (const a of inv.salesTeam) {
        const attr = (grand * Number(a.allocationPct)) / 100;
        const comm = (attr * Number(a.commissionRate)) / 100;
        bump(a.salesPerson.id, a.salesPerson.name, attr, comm);
      }
    } else if (inv.salesPerson) {
      bump(
        inv.salesPerson.id,
        inv.salesPerson.name,
        grand,
        (grand * Number(inv.commissionPercent)) / 100,
      );
    }
  }
  res.json({
    rows: [...bySP.entries()].map(([id, v]) => ({ id, ...v })),
    invoices: invoices.length,
    from: from.toISOString(),
    to: to.toISOString(),
  });
});
