import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const currencyRouter = Router();

const p = perms("Currency");

const upsertSchema = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1),
  symbol: z.string().min(1).max(4),
  isEnabled: z.boolean().default(true),
});

// GET / — includes each tenant's baseCurrency in the response envelope so
// forms can highlight it and skip the conversionRate input when currency==base.
currencyRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [tenant, rows] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { baseCurrency: true },
    }),
    prisma.currency.findMany({
      where: { tenantId, isEnabled: true },
      orderBy: { code: "asc" },
    }),
  ]);
  res.json({ baseCurrency: tenant?.baseCurrency ?? "INR", rows });
});

currencyRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.currency.create({
      data: { ...parsed.data, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Currency code already exists" });
    }
    throw e;
  }
});
