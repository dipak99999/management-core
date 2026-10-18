import { prisma } from "@lumaara/db";
import type { AuthContext } from "@lumaara/shared-types";

// Multi-company Phase 6: per-user company allowlist.
//
// Semantics — decided by product: **role-based default**.
//   * Tenant admins (legacy `role="admin"` OR `roles` contains
//     "SystemManager") bypass entirely. Also bypass for
//     `role="oauth-client"` since those are backend integrations that
//     act with tenant-wide scope.
//   * All other users: `UserCompanyAccess` rows are their allowlist.
//     Zero rows = deny everything. An admin must add rows to grant
//     access.
//   * Backwards compat: a one-shot backfill (see
//     packages/db/src/backfill-user-company-access.ts) grandfathers
//     every existing non-admin user by inserting one row per (user,
//     company). So on rollout nobody loses access; only NEW non-admin
//     users start deny-by-default.
//
// The helper is intentionally a per-request lookup rather than baked
// into `req.auth`. Reason: only a handful of endpoints care (mostly
// reports + /companies + IC JE routes). Loading it eagerly on every
// request adds latency to hot paths (invoice submit, inbox lookups)
// that don't need it. Callers that DO care lookup once per request
// and can cache on `req` if they touch it multiple times.

export function isCompanyAccessBypassed(auth: AuthContext): boolean {
  if (auth.role === "admin" || auth.role === "oauth-client") return true;
  if (auth.roles?.includes("SystemManager")) return true;
  return false;
}

/**
 * Returns the company IDs this user may see. `null` means "no
 * restriction" — admin bypass or grandfathered.
 *
 * Note the two paths that return null:
 *   * Bypass roles → obvious.
 *   * Non-bypass user with zero rows → in the *grandfathered* world we
 *     assume backfill ran and 0 rows means "explicitly denied all". BUT
 *     we return an empty array in that case (not null) so filters
 *     produce empty result sets, not tenant-wide leaks. Callers must
 *     treat `[]` correctly (Prisma `in: []` returns nothing — correct).
 */
export async function getAllowedCompanyIds(
  auth: AuthContext,
): Promise<string[] | null> {
  if (isCompanyAccessBypassed(auth)) return null;
  const rows = await prisma.userCompanyAccess.findMany({
    where: { userId: auth.userId, tenantId: auth.tenantId },
    select: { companyId: true },
  });
  return rows.map((r) => r.companyId);
}

/**
 * Convenience: assert the given companyId is accessible to this user.
 * Throws when it's not (caller should `.catch` and return 403). No-op
 * when the user is bypass-privileged.
 */
export async function assertCompanyAccess(
  auth: AuthContext,
  companyId: string,
): Promise<void> {
  if (isCompanyAccessBypassed(auth)) return;
  const row = await prisma.userCompanyAccess.findFirst({
    where: { userId: auth.userId, tenantId: auth.tenantId, companyId },
    select: { id: true },
  });
  if (!row) {
    throw new Error("You don't have access to that company");
  }
}

/**
 * Convert allowedCompanyIds → a Prisma where fragment for a
 * `companyId` column. Handles the three cases:
 *   * null (bypass) → {} (no restriction)
 *   * non-empty array → { companyId: { in: [...] } }
 *   * empty array → { companyId: { in: [] } } (matches nothing —
 *     correct behavior for a locked-down user)
 *
 * If your model treats `companyId=null` as "shared" (Account,
 * GLEntry), pass `includeShared: true` to OR that in.
 */
export function companyIdWhere(
  allowed: string[] | null,
  includeShared = false,
): Record<string, unknown> {
  if (allowed === null) return {};
  if (includeShared) {
    return {
      OR: [{ companyId: { in: allowed } }, { companyId: null }],
    };
  }
  return { companyId: { in: allowed } };
}
