import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// Module 53 — Service Contract routes.
//
// Support agreement CRUD + a usage-decrement endpoint the ticket
// handler can call when a ticket resolves against a covered
// customer. When usedUnits >= entitledUnits, contract flips to
// Exhausted.

export const serviceContractRouter = Router();
const p = perms("DeskTicket");

const upsertSchema = z.object({
  customerId: z.string().min(1),
  slaPolicyId: z.string().optional().nullable(),
  contractType: z.enum(["Fixed Hours", "Unlimited", "Per Ticket"]).default("Fixed Hours"),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  entitledUnits: z.coerce.number().nonnegative().default(0),
  contractValue: z.coerce.number().nonnegative().default(0),
  currency: z.string().default("INR"),
  notes: z.string().max(1000).optional().nullable(),
});

serviceContractRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.serviceContract.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { customerName: true } },
      slaPolicy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

serviceContractRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.serviceContract.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { customer: true, slaPolicy: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Ticket handler can query GET /active-for-customer/:customerId to
// find a covering contract at ticket-create time. Returns the most
// recent Active contract that hasn't expired.
serviceContractRouter.get("/active-for-customer/:customerId", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const row = await prisma.serviceContract.findFirst({
    where: {
      tenantId,
      customerId: req.params.customerId,
      status: "Active",
      startDate: { lte: now },
      endDate: { gte: now },
    },
    orderBy: { startDate: "desc" },
    include: { slaPolicy: true },
  });
  res.json(row);
});

serviceContractRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const startDate = new Date(b.startDate);
  const endDate = new Date(b.endDate);
  if (endDate < startDate) {
    return res.status(400).json({ error: "endDate must be on or after startDate" });
  }
  const customer = await prisma.customer.findFirst({ where: { id: b.customerId, tenantId } });
  if (!customer) return res.status(400).json({ error: "Customer not found" });

  const name = await nextName(prisma, tenantId, "SC-");
  const row = await prisma.serviceContract.create({
    data: {
      tenantId,
      name,
      customerId: b.customerId,
      slaPolicyId: b.slaPolicyId ?? null,
      contractType: b.contractType,
      startDate,
      endDate,
      entitledUnits: new Prisma.Decimal(b.entitledUnits),
      contractValue: new Prisma.Decimal(b.contractValue),
      currency: b.currency,
      notes: b.notes ?? null,
      status: "Active",
    },
  });
  res.status(201).json(row);
});

// Decrement usage. When cumulative used >= entitled (for Fixed
// Hours + Per Ticket contracts), status flips to Exhausted.
const useSchema = z.object({ units: z.coerce.number().positive() });
serviceContractRouter.post("/:id/use", p.write, async (req, res) => {
  const parsed = useSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const row = await prisma.serviceContract.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Active") {
    return res.status(400).json({ error: `Contract not active (status: ${row.status})` });
  }
  const newUsed = Number(row.usedUnits) + parsed.data.units;
  const flipExhausted =
    row.contractType !== "Unlimited" && newUsed >= Number(row.entitledUnits);
  const updated = await prisma.serviceContract.update({
    where: { id: row.id },
    data: {
      usedUnits: new Prisma.Decimal(newUsed),
      ...(flipExhausted ? { status: "Exhausted" } : {}),
    },
  });
  res.json(updated);
});

serviceContractRouter.post("/:id/cancel", p.cancel, idempotency("POST /service-contracts/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.serviceContract.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const updated = await prisma.serviceContract.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});
