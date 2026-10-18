// M57 deferred fix — FX rate resolution with triangulation.
//
// resolveRate(from, to, asOf) tries:
//   1. Direct pair (from → to) with effectiveDate ≤ asOf.
//   2. Inverse pair (to → from) and reciprocate.
//   3. Triangle via USD: (from → USD) * (USD → to), each hop trying
//      direct then inverse.
//
// Returns null when nothing resolves — the caller decides whether to
// fall back to 1 or reject.

export interface ResolvedRate {
  rate: number;
  source: string;
  effectiveDate?: Date | null;
}

interface ExchangeRateRow {
  fromCurrency: string;
  toCurrency: string;
  effectiveDate: Date;
  rate: unknown; // Prisma Decimal
  source: string | null;
}

interface RateDb {
  exchangeRate: {
    findFirst: (args: {
      where: {
        tenantId: string;
        fromCurrency: string;
        toCurrency: string;
        effectiveDate: { lte: Date };
      };
      orderBy: { effectiveDate: "desc" };
    }) => Promise<ExchangeRateRow | null>;
  };
}

async function findDirect(
  db: RateDb,
  tenantId: string,
  from: string,
  to: string,
  asOf: Date,
): Promise<ExchangeRateRow | null> {
  return db.exchangeRate.findFirst({
    where: { tenantId, fromCurrency: from, toCurrency: to, effectiveDate: { lte: asOf } },
    orderBy: { effectiveDate: "desc" },
  });
}

async function resolveHop(
  db: RateDb,
  tenantId: string,
  from: string,
  to: string,
  asOf: Date,
): Promise<ResolvedRate | null> {
  if (from === to) return { rate: 1, source: "identity" };
  const direct = await findDirect(db, tenantId, from, to, asOf);
  if (direct) {
    return {
      rate: Number(direct.rate),
      source: direct.source ?? "manual",
      effectiveDate: direct.effectiveDate,
    };
  }
  const inv = await findDirect(db, tenantId, to, from, asOf);
  if (inv && Number(inv.rate) > 0) {
    return {
      rate: 1 / Number(inv.rate),
      source: `inverse of ${inv.source ?? "manual"}`,
      effectiveDate: inv.effectiveDate,
    };
  }
  return null;
}

export async function resolveRate(
  db: RateDb,
  tenantId: string,
  from: string,
  to: string,
  asOf: Date,
  intermediate: string = "USD",
): Promise<ResolvedRate | null> {
  const direct = await resolveHop(db, tenantId, from, to, asOf);
  if (direct) return direct;
  if (from === intermediate || to === intermediate) return null;

  const leg1 = await resolveHop(db, tenantId, from, intermediate, asOf);
  if (!leg1) return null;
  const leg2 = await resolveHop(db, tenantId, intermediate, to, asOf);
  if (!leg2) return null;
  const rate = leg1.rate * leg2.rate;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const effectiveDate = leg1.effectiveDate && leg2.effectiveDate
    ? (leg1.effectiveDate < leg2.effectiveDate ? leg1.effectiveDate : leg2.effectiveDate)
    : (leg1.effectiveDate ?? leg2.effectiveDate ?? null);
  return {
    rate,
    source: `triangle via ${intermediate} (${leg1.source} * ${leg2.source})`,
    effectiveDate,
  };
}
