import type { Prisma, PrismaClient } from "@prisma/client";

// Atomic tenant-scoped name allocator. Replaces the pre-turn-46 pattern of
// `SELECT max(name)+1` which races: two concurrent creates read the same max,
// both format the same "next", and only the second sees the unique-constraint
// error (or silently corrupts if the constraint is missing).
//
// Implementation: one Postgres UPSERT that atomically increments and returns
// the new value. The DB does the locking; no application-level retries needed.
//
// Usage:
//   const name = await nextName(tx, tenantId, "SINV-");
//   // => "SINV-0001", "SINV-0002", ...

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function nextName(
  db: AnyClient,
  tenantId: string,
  prefix: string,
  width = 4,
): Promise<string> {
  const rows = await db.$queryRaw<{ counter: number }[]>`
    INSERT INTO naming_series_counters (id, "tenantId", prefix, counter)
    VALUES (gen_random_uuid()::text, ${tenantId}, ${prefix}, 1)
    ON CONFLICT ("tenantId", prefix)
    DO UPDATE SET counter = naming_series_counters.counter + 1
    RETURNING counter
  `;
  const counter = rows[0]?.counter ?? 1;
  return `${prefix}${String(counter).padStart(width, "0")}`;
}

// One-time backfill: for tenants with pre-turn-46 named rows, seed the counter
// to the max existing suffix so we don't collide. Call once from a migration
// script or from `seedTenantDefaults` for new tenants (starts at 0, harmless).
export async function seedNamingSeriesCounter(
  db: AnyClient,
  tenantId: string,
  prefix: string,
  maxExisting: number,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO naming_series_counters (id, "tenantId", prefix, counter)
    VALUES (gen_random_uuid()::text, ${tenantId}, ${prefix}, ${maxExisting})
    ON CONFLICT ("tenantId", prefix)
    DO UPDATE SET counter = GREATEST(naming_series_counters.counter, ${maxExisting})
  `;
}
