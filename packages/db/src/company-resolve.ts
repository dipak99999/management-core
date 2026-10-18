import type { Prisma, PrismaClient } from "@prisma/client";

// Multi-company Phase 3: resolves the effective Company for a voucher.
// Returns id + code so the caller can:
//   1. Stamp companyId on the doctype row + on GLEntries via postGLEntries.
//   2. Compose per-company numbering series ("SI-AC-0001") via companyPrefix().
//
// Resolution order mirrors the SI/PI/PE/JE route handlers (Phase 2):
//   1. Explicit `requested` id → validated against tenant + disabled=false.
//   2. Tenant's default Company (isDefault=true, disabled=false).
//   3. null — legacy tenant with no default (rare after Phase 2 autoseed).
//
// Throws when `requested` is set but doesn't resolve — callers should catch
// and 400. Missing tenant default is NOT an error, it's a graceful null so
// legacy code paths keep working.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export interface ResolvedCompany {
  id: string;
  code: string;
}

export async function resolveCompanyForVoucher(
  db: AnyClient,
  tenantId: string,
  requested: string | null | undefined,
): Promise<ResolvedCompany | null> {
  if (requested) {
    const c = await db.company.findFirst({
      where: { id: requested, tenantId, disabled: false },
      select: { id: true, code: true },
    });
    if (!c) throw new Error("companyId does not belong to this tenant or is disabled");
    return { id: c.id, code: c.code };
  }
  const def = await db.company.findFirst({
    where: { tenantId, isDefault: true, disabled: false },
    select: { id: true, code: true },
  });
  return def ? { id: def.id, code: def.code } : null;
}

// Compose a numbering-series prefix scoped to a company. When code is empty
// or null, returns the base prefix unchanged (matches Phase 1/2 single-
// company tenants). When code is set, inserts it before the counter:
//   companyPrefix("SINV-", "AC") -> "SINV-AC-"
//   companyPrefix("SINV-", null) -> "SINV-"
//
// Design note: we prepend the code AFTER the doctype prefix so ERPNext-
// familiar operators still see "SINV-*" at a glance. The counter is
// per-(tenant, prefix), so SI-AC-* and SI-BC-* have independent sequences.
export function companyPrefix(basePrefix: string, code: string | null | undefined): string {
  if (!code) return basePrefix;
  return `${basePrefix}${code}-`;
}
