import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  applyPricingRule,
  pickBestPricingRule,
  prisma,
  type PricingRuleContext,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D3: Pricing Rules. Conditional discount/rate overrides. `/lookup` is the
// hot path — SI/PI/Quote/SO forms call it on item pick to auto-apply the
// best matching rule. Precedence + applied-rate math live in
// packages/db/src/pricing-rules.ts (with tests); this file just handles
// CRUD and the DB fetch for lookup.

export const pricingRuleRouter = Router();

const p = perms("PricingRule");

const upsertSchema = z.object({
  title: z.string().min(1),
  applyOn: z.enum(["Selling", "Buying"]).default("Selling"),
  itemId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  customerGroupId: z.string().optional().nullable(),
  territoryId: z.string().optional().nullable(),
  minQty: z.coerce.number().nonnegative().default(0),
  maxQty: z.coerce.number().positive().optional().nullable(),
  ruleType: z.enum(["Discount %", "Rate"]).default("Discount %"),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  ratePrice: z.coerce.number().nonnegative().default(0),
  priority: z.coerce.number().int().default(0),
  validFrom: z.string().datetime().optional().nullable(),
  validUpto: z.string().datetime().optional().nullable(),
  disabled: z.boolean().default(false),
});

pricingRuleRouter.get("/", p.read, async (req, res) => {
  const type =
    typeof req.query.applyOn === "string" ? req.query.applyOn : undefined;
  const rows = await prisma.pricingRule.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(type ? { applyOn: type } : {}),
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  res.json(rows);
});

// IMPORTANT: /lookup must be registered BEFORE /:id — Express matches the
// first pattern that fits, so /:id would otherwise gobble the /lookup path
// (searching for a rule with id="lookup") and return 404.
//
// Lookup — find best rule for a specific (item, customer, qty) at a given
// time. Loads the customer's customerGroupId + territoryId so
// group/territory-scoped rules match too. Returns:
//   { rule: PricingRule | null, appliedRate: number }
//
// baseRate is echoed unchanged when no rule applies, so the client can use
// the response as the authoritative rate without a fallback branch.
pricingRuleRouter.get("/lookup", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";
  const customerId =
    typeof req.query.customerId === "string" ? req.query.customerId : "";
  const qty = req.query.qty ? Number(req.query.qty) : 1;
  const baseRate = req.query.baseRate ? Number(req.query.baseRate) : 0;
  const applyOn =
    (typeof req.query.applyOn === "string" ? req.query.applyOn : "Selling") as
      | "Selling"
      | "Buying";
  const at =
    typeof req.query.at === "string" ? new Date(req.query.at) : new Date();
  if (!itemId) return res.status(400).json({ error: "itemId is required" });

  let customerGroupId: string | null = null;
  let territoryId: string | null = null;
  if (customerId) {
    const c = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { customerGroupId: true, territoryId: true },
    });
    customerGroupId = c?.customerGroupId ?? null;
    territoryId = c?.territoryId ?? null;
  }

  // Wide net at the DB layer — anything that COULD match. The pure helper
  // narrows down using specificity + priority + validity window. Cheaper
  // than the previous 8-clause AND/OR block, and keeps the interesting
  // logic testable.
  const candidates = await prisma.pricingRule.findMany({
    where: {
      tenantId,
      applyOn,
      disabled: false,
      OR: [{ itemId: null }, { itemId }],
    },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });

  const ctx: PricingRuleContext = {
    applyOn,
    itemId,
    customerId: customerId || null,
    customerGroupId,
    territoryId,
    qty,
    at,
  };
  const rule = pickBestPricingRule(candidates, ctx);
  const appliedRate = applyPricingRule(baseRate, rule);
  res.json({ rule, appliedRate });
});

pricingRuleRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pricingRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

pricingRuleRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.pricingRule.create({
    data: {
      ...parsed.data,
      tenantId: req.auth!.tenantId,
      minQty: new Prisma.Decimal(parsed.data.minQty),
      maxQty:
        parsed.data.maxQty != null ? new Prisma.Decimal(parsed.data.maxQty) : null,
      discountPercent: new Prisma.Decimal(parsed.data.discountPercent),
      ratePrice: new Prisma.Decimal(parsed.data.ratePrice),
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
    },
  });
  res.status(201).json(row);
});

pricingRuleRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.pricingRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.pricingRule.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      minQty: new Prisma.Decimal(parsed.data.minQty),
      maxQty:
        parsed.data.maxQty != null ? new Prisma.Decimal(parsed.data.maxQty) : null,
      discountPercent: new Prisma.Decimal(parsed.data.discountPercent),
      ratePrice: new Prisma.Decimal(parsed.data.ratePrice),
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
    },
  });
  res.json(row);
});

pricingRuleRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.pricingRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.pricingRule.delete({ where: { id: existing.id } });
  res.status(204).send();
});
