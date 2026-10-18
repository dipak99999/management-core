import type { Prisma } from "@prisma/client";
import type { TenantDefaults } from "./gl-posting";

// Multi-company Phase 4: per-company default account resolution.
//
// Every field on `TenantDefaults` (and two extras — Loyalty + Deferred
// Revenue) is mirrored on `Company` as an optional override. The resolver
// walks: Company override → Tenant fallback → null. `requireEffectiveDefaults`
// is the drop-in replacement for `requireTenantDefaults`; pass an optional
// companyId to opt into the override lookup. When companyId is null/omitted,
// behaves identically to the tenant-only helper.
//
// Design note: we don't cache — this is called at most once per voucher
// submit, and the field count (20) fits in a single row fetch anyway. Adding
// a cache would just be extra invalidation surface for negligible gain.

export type EffectiveDefaults = TenantDefaults & {
  defaultLoyaltyDiscountAccountId: string | null;
  defaultDeferredRevenueAccountId: string | null;
};

const ALL_FIELDS = [
  "defaultReceivableAccountId",
  "defaultPayableAccountId",
  "defaultCashAccountId",
  "defaultBankAccountId",
  "defaultIncomeAccountId",
  "defaultExpenseAccountId",
  "defaultStockInHandAccountId",
  "defaultCogsAccountId",
  "defaultStockReceivedButNotBilledAccountId",
  "defaultSalaryExpenseAccountId",
  "defaultEmployeePayableAccountId",
  "defaultStatutoryPayableAccountId",
  "defaultFxGainLossAccountId",
  "defaultLoanReceivableAccountId",
  "defaultInterestIncomeAccountId",
  "defaultRetainedEarningsAccountId",
  "defaultRoundOffAccountId",
  "defaultStockAdjustmentAccountId",
  "defaultLoyaltyDiscountAccountId",
  "defaultDeferredRevenueAccountId",
] as const satisfies ReadonlyArray<keyof EffectiveDefaults>;

const SELECT = Object.fromEntries(ALL_FIELDS.map((f) => [f, true])) as {
  [K in keyof EffectiveDefaults]: true;
};

export async function requireEffectiveDefaults(
  tx: Prisma.TransactionClient,
  tenantId: string,
  required: Array<keyof EffectiveDefaults>,
  companyId?: string | null,
): Promise<EffectiveDefaults> {
  const [tenant, company] = await Promise.all([
    tx.tenant.findUnique({
      where: { id: tenantId },
      select: SELECT,
    }),
    companyId
      ? tx.company.findFirst({
          where: { id: companyId, tenantId },
          select: SELECT,
        })
      : Promise.resolve(null),
  ]);
  if (!tenant) throw new Error("Tenant not found");

  const resolved = {} as EffectiveDefaults;
  for (const f of ALL_FIELDS) {
    const companyVal = company?.[f] ?? null;
    const tenantVal = (tenant as EffectiveDefaults)[f] ?? null;
    resolved[f] = companyVal ?? tenantVal;
  }

  for (const key of required) {
    if (!resolved[key]) {
      throw new Error(
        `Missing default account "${key}" — set it on Company ${companyId ?? "(none)"} or on the tenant`,
      );
    }
  }
  return resolved;
}

// Pure helper — resolves a single override without going to the DB. Useful
// when the caller has already fetched both tenant + company records for
// other reasons and doesn't want a redundant query.
export function pickEffective<T extends Partial<EffectiveDefaults>>(
  tenant: T,
  company: T | null | undefined,
  field: keyof EffectiveDefaults,
): string | null {
  const companyVal = company?.[field] ?? null;
  const tenantVal = tenant[field] ?? null;
  return (companyVal ?? tenantVal) as string | null;
}
