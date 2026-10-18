import type { NextFunction, Request, Response } from "express";
import { prisma } from "@lumaara/db";
import { planAllows, submoduleForPath, type ModuleKey } from "@lumaara/shared-types";

// Subscription module gate — returns 403 if the tenant's active plan
// doesn't include the module/submodule that owns this route.
//
// Behavior:
//   • Looks up the tenant's single active TenantSubscription (there is at
//     most one). Fetches its plan.
//   • Resolves the request path to a submodule via the shared registry.
//   • If the plan doesn't allow it, 403 with a structured body so the UI
//     can show a "Upgrade your plan" banner.
//   • If the request path has no gate (unknown route or admin stuff),
//     passes through — gating is opt-in by registering the path in
//     MODULE_REGISTRY.
//   • Super admins bypass all gates (they're managing the subscription
//     system itself).
//
// Cache: planAllowCache is a tiny in-process LRU keyed by tenantId; TTL
// 60s. Keeps route-level checks cheap under load. Invalidated on write
// via `invalidateSubscriptionCache(tenantId)` from the admin UI.

interface PlanSnapshot {
  modules: string[];
  submodules: string[];
  fetchedAt: number;
}

const planCache = new Map<string, PlanSnapshot>();
const CACHE_TTL_MS = 60_000;

export function invalidateSubscriptionCache(tenantId: string): void {
  planCache.delete(tenantId);
}

async function activePlanFor(tenantId: string): Promise<PlanSnapshot | null> {
  const cached = planCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  const sub = await prisma.tenantSubscription.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { startDate: "desc" },
    include: { plan: true },
  });
  if (!sub) {
    planCache.set(tenantId, { modules: [], submodules: [], fetchedAt: Date.now() });
    return null;
  }
  const snapshot: PlanSnapshot = {
    modules: sub.plan.allowedModules,
    submodules: sub.plan.allowedSubmodules,
    fetchedAt: Date.now(),
  };
  planCache.set(tenantId, snapshot);
  return snapshot;
}

/**
 * Express middleware factory. Install AFTER requireAuth. If `moduleKey` is
 * passed, enforces at module granularity; otherwise auto-detects from the
 * request path via MODULE_REGISTRY.
 */
export function requireModule(moduleKey?: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Pass-through if the request isn't authed yet — downstream requireAuth
    // on the specific route will enforce auth. This lets the gate be
    // installed globally once per service without blocking login / health
    // / webhook endpoints.
    if (!req.auth) return next();

    // Super admins skip the gate — they manage the subscription system.
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return next();

    const plan = await activePlanFor(req.auth.tenantId);
    if (!plan) {
      return res.status(402).json({
        error: "Tenant has no active subscription",
        code: "NO_ACTIVE_PLAN",
      });
    }

    // Auto-detect from path when caller didn't force a module. Use
    // originalUrl because Express strips the router's mount prefix from
    // req.path — a request to `/customers` sees req.path === "/" when
    // this middleware is chained inside the `/customers` router.
    const detectedPath = req.originalUrl.split("?")[0];
    const detected = moduleKey
      ? { module: moduleKey, submodule: undefined as string | undefined }
      : submoduleForPath(detectedPath);

    if (!detected) {
      // Unknown route — let it through. The author can register the path
      // in MODULE_REGISTRY to enforce gating.
      return next();
    }

    if (!planAllows({ allowedModules: plan.modules, allowedSubmodules: plan.submodules },
      detected.module, detected.submodule)) {
      return res.status(403).json({
        error: `Your plan doesn't include "${detected.submodule ?? detected.module}". Contact your admin to upgrade.`,
        code: "MODULE_NOT_IN_PLAN",
        module: detected.module,
        submodule: detected.submodule,
      });
    }

    next();
  };
}

/**
 * Super-admin-only gate. Combines auth check + isSuperAdmin check in one
 * middleware. Used by the super-admin plan management routes.
 */
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: "Unauthenticated" });
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { isSuperAdmin: true },
  });
  if (!user?.isSuperAdmin) return res.status(403).json({ error: "Super admin required" });
  next();
}
