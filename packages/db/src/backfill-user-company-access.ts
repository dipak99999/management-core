import type { Prisma, PrismaClient } from "@prisma/client";

// Multi-company Phase 6: grandfather existing users into the
// per-user company allowlist so nobody loses access on rollout.
//
// Rules (matches the role-based default):
//   * Users with role="admin" OR a "SystemManager" UserRole → skip
//     entirely (they bypass allowlist checks; adding rows would be
//     misleading).
//   * All other users get one UserCompanyAccess row per company that
//     exists in their tenant, capped at the ones they should already
//     be able to see (i.e., every non-disabled company in the tenant).
//   * Idempotent per (user, company) via the schema's @@unique — we
//     use skipDuplicates so re-running is a no-op for anyone who
//     already has rows.
//
// Called from `POST /companies/backfill-user-access` (admin-only) and
// safe to run any number of times. Returns per-tenant counts.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export interface UserAccessBackfillResult {
  usersConsidered: number;
  adminsSkipped: number;
  rowsCreated: number;
}

export async function backfillUserCompanyAccess(
  db: AnyClient,
  tenantId: string,
): Promise<UserAccessBackfillResult> {
  const companies = await db.company.findMany({
    where: { tenantId, disabled: false },
    select: { id: true },
  });
  if (companies.length === 0) {
    return { usersConsidered: 0, adminsSkipped: 0, rowsCreated: 0 };
  }

  const users = await db.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      role: true,
      userRoles: { select: { role: { select: { roleName: true } } } },
    },
  });

  let adminsSkipped = 0;
  const inserts: Array<{ tenantId: string; userId: string; companyId: string }> = [];
  for (const u of users) {
    const isAdmin =
      u.role === "admin" ||
      u.userRoles.some((ur) => ur.role.roleName === "SystemManager");
    if (isAdmin) {
      adminsSkipped += 1;
      continue;
    }
    for (const c of companies) {
      inserts.push({ tenantId, userId: u.id, companyId: c.id });
    }
  }

  if (inserts.length === 0) {
    return { usersConsidered: users.length, adminsSkipped, rowsCreated: 0 };
  }

  const result = await db.userCompanyAccess.createMany({
    data: inserts,
    skipDuplicates: true,
  });

  return {
    usersConsidered: users.length,
    adminsSkipped,
    rowsCreated: result.count,
  };
}
