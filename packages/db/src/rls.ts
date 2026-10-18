import type { PrismaClient } from "@prisma/client";

// Row-Level Security session wiring. The policies in migration
// 20261002010000_rls_poc rely on the Postgres session setting
// `app.current_tenant_id` matching the row's tenantId. This module
// provides two helpers to set that setting correctly:
//
//   • withTenant(prisma, tenantId, fn) — opens a transaction, sets the
//     session var, runs fn with the transaction client, returns the
//     result. Use for request handlers that need to read/write tenant-
//     scoped data under RLS.
//   • withSuperAdmin(prisma, fn) — same but sets `app.bypass_rls=true`
//     so the super-admin UI can read cross-tenant data.
//
// Keeping these as explicit transaction wrappers (rather than magic
// middleware on the global PrismaClient) keeps the control flow visible
// and makes the "whose data am I touching" question answerable from a
// code review.

export async function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // `set_config(.., ..., true)` scopes the setting to this transaction
    // only, so pool reuse can't leak the setting into the next request.
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      tenantId,
    );
    return fn(tx);
  });
}

export async function withSuperAdmin<T>(
  prisma: PrismaClient,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT set_config('app.bypass_rls', 'true', true)`,
    );
    return fn(tx);
  });
}
