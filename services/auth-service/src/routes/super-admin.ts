// Super-admin API — manages subscription plans + tenant assignments.
//
// All routes require `isSuperAdmin=true` on the authed User (checked by
// requireSuperAdmin). SuperAdmin users are cross-tenant: a super admin in
// Tenant X can edit plans + subscriptions for any tenant. Guard with care.
//
// Endpoints:
//   GET  /super/tenants                       list every tenant + active plan
//   GET  /super/tenants/:tenantId/plans       list plans for a tenant
//   POST /super/tenants/:tenantId/plans       create plan
//   PATCH /super/plans/:planId                edit plan
//   DELETE /super/plans/:planId               delete plan
//   POST /super/tenants/:tenantId/subscribe   switch tenant to plan
//
// After any write that affects a tenant's active plan, we invalidate the
// in-process requireModule cache so route gating picks up the new state
// immediately.

import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import {
  auditSuperAdmin,
  invalidateSubscriptionCache,
  requireAuth,
  requireSuperAdmin,
} from "@lumaara/service-auth";
import { MODULES } from "@lumaara/shared-types";

export const superAdminRouter = Router();

superAdminRouter.use(requireAuth, requireSuperAdmin, auditSuperAdmin("super-admin"));

const planSchema = z.object({
  name: z.string().min(1).max(80),
  tier: z.enum(["starter", "pro", "enterprise", "custom"]),
  priceMonthlyInr: z.coerce.number().nonnegative().default(0),
  allowedModules: z.array(z.string().min(1)),
  allowedSubmodules: z.array(z.string().min(1)),
  isDefault: z.boolean().default(false),
});

const planPatchSchema = planSchema.partial();

superAdminRouter.get("/tenants", async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true, slug: true, name: true, createdAt: true,
      tenantSubscriptions: {
        where: { isActive: true },
        orderBy: { startDate: "desc" },
        take: 1,
        include: { plan: { select: { id: true, name: true, tier: true, allowedModules: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    tenants.map((t) => ({
      id: t.id, slug: t.slug, name: t.name, createdAt: t.createdAt,
      activePlan: t.tenantSubscriptions[0]?.plan ?? null,
    })),
  );
});

superAdminRouter.get("/tenants/:tenantId/plans", async (req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { tenantId: req.params.tenantId },
    orderBy: { createdAt: "asc" },
  });
  res.json(plans);
});

superAdminRouter.post("/tenants/:tenantId/plans", async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const invalidModules = parsed.data.allowedModules.filter((m) => !(MODULES as readonly string[]).includes(m));
  if (invalidModules.length > 0)
    return res.status(400).json({ error: `Unknown modules: ${invalidModules.join(", ")}` });

  try {
    const plan = await prisma.subscriptionPlan.create({
      data: {
        tenantId: req.params.tenantId,
        ...parsed.data,
      },
    });
    invalidateSubscriptionCache(req.params.tenantId);
    res.status(201).json(plan);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "A plan with this name already exists for this tenant" });
    throw e;
  }
});

superAdminRouter.patch("/plans/:planId", async (req, res) => {
  const parsed = planPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.planId } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (parsed.data.allowedModules) {
    const invalidModules = parsed.data.allowedModules.filter((m) => !(MODULES as readonly string[]).includes(m));
    if (invalidModules.length > 0)
      return res.status(400).json({ error: `Unknown modules: ${invalidModules.join(", ")}` });
  }

  const plan = await prisma.subscriptionPlan.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  invalidateSubscriptionCache(existing.tenantId);
  res.json(plan);
});

superAdminRouter.delete("/plans/:planId", async (req, res) => {
  const existing = await prisma.subscriptionPlan.findUnique({
    where: { id: req.params.planId },
    include: { _count: { select: { subscriptions: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.subscriptions > 0)
    return res.status(400).json({ error: "Plan has active subscriptions — reassign tenant first" });
  await prisma.subscriptionPlan.delete({ where: { id: existing.id } });
  invalidateSubscriptionCache(existing.tenantId);
  res.status(204).end();
});

superAdminRouter.post("/tenants/:tenantId/subscribe", async (req, res) => {
  const schema = z.object({ planId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: parsed.data.planId, tenantId: req.params.tenantId },
  });
  if (!plan) return res.status(400).json({ error: "Plan not found for this tenant" });

  const [, sub] = await prisma.$transaction([
    prisma.tenantSubscription.updateMany({
      where: { tenantId: req.params.tenantId, isActive: true },
      data: { isActive: false, endDate: new Date() },
    }),
    prisma.tenantSubscription.create({
      data: {
        tenantId: req.params.tenantId,
        planId: plan.id,
        isActive: true,
      },
    }),
  ]);
  invalidateSubscriptionCache(req.params.tenantId);
  res.json({ ok: true, subscription: sub });
});

// A tenant-local endpoint that any authed user (not just super admin) can
// hit to find out which modules + submodules their plan allows. Shell uses
// this to filter the sidebar nav.
export const myPlanRouter = Router();
myPlanRouter.use(requireAuth);
myPlanRouter.get("/", async (req, res) => {
  const sub = await prisma.tenantSubscription.findFirst({
    where: { tenantId: req.auth!.tenantId, isActive: true },
    orderBy: { startDate: "desc" },
    include: { plan: true },
  });
  // Look up the flag even without a subscription — a super admin's own
  // tenant (e.g. `platform`) typically has no plan, and reporting
  // isSuperAdmin: false there hides every module from them.
  const me = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { isSuperAdmin: true },
  });
  if (!sub) {
    return res.json({ allowedModules: [], allowedSubmodules: [], tier: null, isSuperAdmin: !!me?.isSuperAdmin });
  }
  res.json({
    allowedModules: sub.plan.allowedModules,
    allowedSubmodules: sub.plan.allowedSubmodules,
    tier: sub.plan.tier,
    planName: sub.plan.name,
    isSuperAdmin: !!me?.isSuperAdmin,
  });
});
