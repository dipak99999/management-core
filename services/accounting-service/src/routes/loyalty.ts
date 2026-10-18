import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  computeLoyaltyBalance,
  findExpiringSoon,
  prisma,
  quoteRedemption,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D5: Loyalty program CRUD + entries (read-only) + customer balance +
// redemption. Points are awarded automatically on SI submit when the
// customer has a program (see sales-invoices.ts). Expiry sweep is a
// separate scheduler tick (see services/scheduler/src/jobs/loyalty-expiry.ts).

export const loyaltyProgramRouter = Router();
export const loyaltyEntryRouter = Router();

const pp = perms("LoyaltyProgram");
const pe = perms("LoyaltyPointEntry");

const programSchema = z.object({
  name: z.string().min(1),
  pointsPerCurrency: z.coerce.number().nonnegative().default(0.01),
  minRedemptionPoints: z.coerce.number().int().nonnegative().default(0),
  maxRedemptionPercent: z.coerce.number().min(0).max(100).default(100),
  expiryMonths: z.coerce.number().int().positive().default(24),
  enabled: z.boolean().default(true),
});

loyaltyProgramRouter.get("/", pp.read, async (req, res) => {
  const rows = await prisma.loyaltyProgram.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

loyaltyProgramRouter.post("/", pp.create, async (req, res) => {
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.loyaltyProgram.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        pointsPerCurrency: new Prisma.Decimal(parsed.data.pointsPerCurrency),
        minRedemptionPoints: parsed.data.minRedemptionPoints,
        maxRedemptionPercent: new Prisma.Decimal(parsed.data.maxRedemptionPercent),
        expiryMonths: parsed.data.expiryMonths,
        enabled: parsed.data.enabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Program name already exists" });
    throw e;
  }
});

loyaltyProgramRouter.put("/:id", pp.write, async (req, res) => {
  const parsed = programSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.loyaltyProgram.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.loyaltyProgram.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      pointsPerCurrency: new Prisma.Decimal(parsed.data.pointsPerCurrency),
      minRedemptionPoints: parsed.data.minRedemptionPoints,
      maxRedemptionPercent: new Prisma.Decimal(parsed.data.maxRedemptionPercent),
      expiryMonths: parsed.data.expiryMonths,
      enabled: parsed.data.enabled,
    },
  });
  res.json(row);
});

loyaltyProgramRouter.delete("/:id", pp.delete, async (req, res) => {
  const existing = await prisma.loyaltyProgram.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { customers: true, entries: true } },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.customers > 0 || existing._count.entries > 0)
    return res.status(400).json({
      error: `Cannot delete: has ${existing._count.customers} customers + ${existing._count.entries} entries`,
    });
  await prisma.loyaltyProgram.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- Entries ----------

loyaltyEntryRouter.get("/", pe.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customerId =
    typeof req.query.customerId === "string" ? req.query.customerId : undefined;
  const rows = await prisma.loyaltyPointEntry.findMany({
    where: { tenantId, ...(customerId ? { customerId } : {}) },
    include: {
      program: { select: { name: true } },
      customer: { select: { customerName: true } },
    },
    orderBy: { postingDate: "desc" },
    take: 200,
  });
  res.json(rows);
});

// D5: customer balance. Delegates to the pure helper so the expiration-at-
// read-time rule (Earned rows past expiryDate no longer count) is exercised
// by tests AND stays consistent with the scheduler expiry sweep. Also
// returns rows expiring within 90 days for a portal "use it or lose it"
// notice.
loyaltyEntryRouter.get("/balance", pe.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customerId =
    typeof req.query.customerId === "string" ? req.query.customerId : "";
  if (!customerId)
    return res.status(400).json({ error: "customerId required" });
  const rows = await prisma.loyaltyPointEntry.findMany({
    where: { tenantId, customerId },
  });
  const now = new Date();
  const balance = computeLoyaltyBalance(rows, now);
  const expiringSoon = findExpiringSoon(rows, now, 90);
  res.json({ balance, expiringSoon });
});

// D5: redemption. Redeems `points` against a Draft SalesInvoice by (a)
// creating a Redeemed entry, (b) stamping the invoice's `loyaltyPoints`
// + `loyaltyAmount` — the invoice submit path uses these to reduce the
// grand total. Runs `quoteRedemption` server-side too so a stale client
// preview can't over-redeem.
const redeemSchema = z.object({
  customerId: z.string().min(1),
  points: z.coerce.number().int().positive(),
  salesInvoiceId: z.string().min(1),
});

loyaltyEntryRouter.post("/redeem", pe.create, async (req, res) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { customerId, points, salesInvoiceId } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [cust, si] = await Promise.all([
        tx.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { loyaltyProgramId: true },
        }),
        tx.salesInvoice.findFirst({
          where: { id: salesInvoiceId, tenantId, customerId },
          select: { id: true, status: true, grandTotal: true },
        }),
      ]);
      if (!cust) throw new Error("Customer not found");
      if (!cust.loyaltyProgramId) throw new Error("Customer has no loyalty program");
      if (!si) throw new Error("Invoice not found or belongs to a different customer");
      if (si.status !== "Draft") throw new Error(`Cannot redeem against a ${si.status} invoice`);

      const prog = await tx.loyaltyProgram.findFirst({
        where: { id: cust.loyaltyProgramId, tenantId },
      });
      if (!prog) throw new Error("Program not found");

      const entries = await tx.loyaltyPointEntry.findMany({
        where: { tenantId, customerId },
      });
      const balance = computeLoyaltyBalance(entries, new Date());

      const quote = quoteRedemption({
        requestedPoints: points,
        balance,
        program: prog,
        invoiceTotal: Number(si.grandTotal),
      });
      if (!quote.ok) throw new Error(quote.reason ?? "Redemption denied");

      const entry = await tx.loyaltyPointEntry.create({
        data: {
          tenantId,
          programId: prog.id,
          customerId,
          entryType: "Redeemed",
          points: quote.pointsRedeemed,
          postingDate: new Date(),
          salesInvoiceId,
          remarks: `Redemption against invoice ${salesInvoiceId} — discount ${quote.discountAmount}`,
        },
      });
      return { entry, quote };
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});
