import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, resolveRate } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// FX rate master. See schema comment for context.

export const exchangeRateRouter = Router();

const p = perms("Currency"); // reuse Currency doctype perms

const upsertSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .transform((s) => s.slice(0, 10)),
  rate: z.coerce.number().positive(),
  source: z.string().optional().nullable(),
});

exchangeRateRouter.get("/", p.read, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const rows = await prisma.exchangeRate.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(from ? { fromCurrency: from } : {}),
      ...(to ? { toCurrency: to } : {}),
    },
    orderBy: [{ effectiveDate: "desc" }, { fromCurrency: "asc" }],
    take: 500,
  });
  res.json(rows);
});

// Latest rate ≤ asOf for a currency pair. Returns null if none configured —
// caller falls back to 1 (silent — the form user is expected to type manually).
exchangeRateRouter.get("/latest", p.read, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from.toUpperCase() : "";
  const to = typeof req.query.to === "string" ? req.query.to.toUpperCase() : "";
  const asOfRaw = typeof req.query.asOf === "string" ? req.query.asOf : "";
  const via = typeof req.query.via === "string" ? req.query.via.toUpperCase() : "USD";
  if (!from || !to)
    return res.status(400).json({ error: "from + to required" });
  const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
  const resolved = await resolveRate(prisma, req.auth!.tenantId, from, to, asOf, via);
  if (!resolved) return res.json({ rate: null });
  res.json(resolved);
});

exchangeRateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  try {
    const row = await prisma.exchangeRate.upsert({
      where: {
        tenantId_fromCurrency_toCurrency_effectiveDate: {
          tenantId: req.auth!.tenantId,
          fromCurrency: d.fromCurrency.toUpperCase(),
          toCurrency: d.toCurrency.toUpperCase(),
          effectiveDate: new Date(d.effectiveDate),
        },
      },
      create: {
        tenantId: req.auth!.tenantId,
        fromCurrency: d.fromCurrency.toUpperCase(),
        toCurrency: d.toCurrency.toUpperCase(),
        effectiveDate: new Date(d.effectiveDate),
        rate: new Prisma.Decimal(d.rate),
        source: d.source ?? "Manual",
      },
      update: {
        rate: new Prisma.Decimal(d.rate),
        source: d.source ?? "Manual",
      },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

exchangeRateRouter.delete("/:id", p.delete, async (req, res) => {
  const row = await prisma.exchangeRate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.exchangeRate.delete({ where: { id: row.id } });
  res.status(204).send();
});
