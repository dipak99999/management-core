import { Router } from "express";
import { z } from "zod";
import {
  applyPricingRule,
  normalizeCouponCode,
  prisma,
  validateCoupon,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D4: Coupon Codes. A code gates a PricingRule; the rule defines the actual
// discount. On apply, we validate the code + return the linked rule so the
// UI can preview the discounted rate. The actual usedCount increment
// happens on SI submit (see sales-invoices.ts) — the /apply endpoint is a
// preview only, so a customer bouncing between checkout screens doesn't
// consume the coupon.

export const couponCodeRouter = Router();

const p = perms("CouponCode");

const upsertSchema = z.object({
  code: z.string().min(1),
  pricingRuleId: z.string().min(1),
  maxUses: z.coerce.number().int().positive().optional().nullable(),
  validFrom: z.string().datetime().optional().nullable(),
  validUpto: z.string().datetime().optional().nullable(),
  disabled: z.boolean().default(false),
});

couponCodeRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.couponCode.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      pricingRule: { select: { title: true, ruleType: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

couponCodeRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const rule = await prisma.pricingRule.findFirst({
    where: { id: parsed.data.pricingRuleId, tenantId },
  });
  if (!rule) return res.status(400).json({ error: "Invalid pricing rule" });
  try {
    const row = await prisma.couponCode.create({
      data: {
        tenantId,
        code: normalizeCouponCode(parsed.data.code),
        pricingRuleId: parsed.data.pricingRuleId,
        maxUses: parsed.data.maxUses ?? null,
        validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
        validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
        disabled: parsed.data.disabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Coupon code already exists" });
    throw e;
  }
});

couponCodeRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.couponCode.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.couponCode.update({
    where: { id: existing.id },
    data: {
      code: parsed.data.code,
      pricingRuleId: parsed.data.pricingRuleId,
      maxUses: parsed.data.maxUses ?? null,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validUpto: parsed.data.validUpto ? new Date(parsed.data.validUpto) : null,
      disabled: parsed.data.disabled,
    },
  });
  res.json(row);
});

couponCodeRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.couponCode.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.couponCode.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// D4: apply — validates the code + returns the linked pricing rule + the
// discounted rate for a specific baseRate. Preview only; doesn't consume
// a use. Returns 400 with a reason string when invalid. Code lookup is
// case-insensitive + trims whitespace via normalizeCouponCode so
// customer-typed inputs don't need pixel-perfect casing.
couponCodeRouter.get("/apply", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rawCode = typeof req.query.code === "string" ? req.query.code : "";
  const baseRate = req.query.baseRate ? Number(req.query.baseRate) : 0;
  const code = normalizeCouponCode(rawCode);
  if (!code) return res.status(400).json({ error: "code required" });
  const coupon = await prisma.couponCode.findFirst({
    where: { tenantId, code },
    include: { pricingRule: true },
  });
  if (!coupon) return res.status(400).json({ error: "Coupon not found" });
  const check = validateCoupon(coupon);
  if (!check.ok) return res.status(400).json({ error: check.reason });
  // Rate math via the shared pricing-rules helper — keeps coupon + rule
  // application arithmetically identical to the SI/PI form's rule lookup.
  const appliedRate = applyPricingRule(baseRate, coupon.pricingRule);
  res.json({ coupon, rule: coupon.pricingRule, appliedRate });
});
