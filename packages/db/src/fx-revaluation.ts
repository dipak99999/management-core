// Module 57 — Foreign currency revaluation.
//
// Problem: an SI in USD for $1000 was booked at rate 82 → Debtors 82,000 INR.
// At period end the spot rate is 85. The receivable is really worth
// 85,000 INR today — booking it at 82,000 understates the balance sheet.
//
// Revaluation:
//   1. Find every OPEN foreign-currency AR / AP row (outstandingAmt > 0
//      and currency != tenant base).
//   2. For each: newBaseValue = outstandingAmt × rateAsOf.
//      oldBaseValue = outstandingAmt × invoice.conversionRate.
//      delta = newBaseValue - oldBaseValue.
//   3. Post a single JE:
//        DR/CR Debtors (per SI aggregate) for AR deltas
//        DR/CR Creditors (per PI aggregate) for AP deltas
//        Offset: FX gain/loss account
//   4. Reversal: mark the JE `isReversing=true` so the FX Revaluation
//      scheduler auto-flips it on the first day of the next period
//      (accruals-style; the actual settlement JE at payment time picks
//      up the "real" FX gain/loss with no double-counting).
//
// Sign convention: from the tenant's perspective at period-end.
//   AR up (currency strengthened): asset up → DR Debtors, CR FX Gain
//   AR down: DR FX Loss, CR Debtors
//   AP up: liability up → DR FX Loss, CR Creditors
//   AP down: DR Creditors, CR FX Gain

export interface OpenAR {
  id: string;
  name: string;
  customerId: string;
  currency: string;
  outstandingAmt: number; // in foreign currency
  originalRate: number; // invoice.conversionRate (foreign → base)
}

export interface OpenAP {
  id: string;
  name: string;
  supplierId: string;
  currency: string;
  outstandingAmt: number;
  originalRate: number;
}

export interface RateAsOf {
  currency: string; // 3-letter code
  rate: number; // foreign → base as of revaluation date
}

export interface RevaluationLine {
  kind: "AR" | "AP";
  docId: string;
  docName: string;
  currency: string;
  outstandingFx: number;
  originalRate: number;
  currentRate: number;
  oldBaseValue: number;
  newBaseValue: number;
  delta: number; // newBaseValue - oldBaseValue (in base currency)
}

export interface RevaluationSummary {
  lines: RevaluationLine[];
  totals: {
    arDelta: number; // sum of AR deltas (positive = increase Debtors)
    apDelta: number; // sum of AP deltas (positive = increase Creditors)
    netFxGainLoss: number; // arDelta - apDelta from tenant's POV (gain > 0)
  };
  skipped: {
    baseCurrencyDocs: number; // in tenant's base currency, nothing to reval
    missingRate: string[]; // currencies with no rate provided
  };
}

// Pure: takes pre-fetched AR/AP + rate table, returns the reval breakdown.
// The route does the Prisma reads + JE write.
export function computeRevaluation(
  ar: OpenAR[],
  ap: OpenAP[],
  rates: RateAsOf[],
  baseCurrency: string,
): RevaluationSummary {
  const rateByCurrency = new Map(rates.map((r) => [r.currency.toUpperCase(), r.rate]));
  const missingRate = new Set<string>();
  const lines: RevaluationLine[] = [];
  let baseCurrencyDocs = 0;

  function processDoc(kind: "AR" | "AP", d: OpenAR | OpenAP) {
    if (d.currency.toUpperCase() === baseCurrency.toUpperCase()) {
      baseCurrencyDocs += 1;
      return;
    }
    const currentRate = rateByCurrency.get(d.currency.toUpperCase());
    if (currentRate === undefined) {
      missingRate.add(d.currency.toUpperCase());
      return;
    }
    const oldBaseValue = d.outstandingAmt * d.originalRate;
    const newBaseValue = d.outstandingAmt * currentRate;
    const delta = newBaseValue - oldBaseValue;
    // Skip zero-delta docs — no ledger movement needed.
    if (Math.abs(delta) < 0.005) return;
    lines.push({
      kind,
      docId: d.id,
      docName: d.name,
      currency: d.currency,
      outstandingFx: d.outstandingAmt,
      originalRate: d.originalRate,
      currentRate,
      oldBaseValue,
      newBaseValue,
      delta,
    });
  }

  for (const d of ar) processDoc("AR", d);
  for (const d of ap) processDoc("AP", d);

  const arDelta = lines.filter((l) => l.kind === "AR").reduce((s, l) => s + l.delta, 0);
  const apDelta = lines.filter((l) => l.kind === "AP").reduce((s, l) => s + l.delta, 0);
  const netFxGainLoss = arDelta - apDelta;

  return {
    lines,
    totals: { arDelta, apDelta, netFxGainLoss },
    skipped: {
      baseCurrencyDocs,
      missingRate: [...missingRate].sort(),
    },
  };
}

// Build the JE line-items from a summary. Aggregates by (party account,
// side) so we post a small number of lines (e.g. one Debtors DR/CR and
// one Creditors DR/CR) plus the FX offset — not one line per invoice.
export interface JELine {
  accountId: string;
  debit: number;
  credit: number;
  remarks: string;
}

export function buildRevaluationJE(params: {
  summary: RevaluationSummary;
  debtorsAccountId: string;
  creditorsAccountId: string;
  fxGainLossAccountId: string;
}): JELine[] {
  const { summary, debtorsAccountId, creditorsAccountId, fxGainLossAccountId } = params;
  const lines: JELine[] = [];
  const { arDelta, apDelta } = summary.totals;

  // AR aggregate:
  //   arDelta > 0 (Debtors up): DR Debtors delta / CR FX Gain delta
  //   arDelta < 0 (Debtors down): DR FX Loss |delta| / CR Debtors |delta|
  if (Math.abs(arDelta) >= 0.005) {
    if (arDelta > 0) {
      lines.push({ accountId: debtorsAccountId, debit: arDelta, credit: 0, remarks: "FX reval — Debtors up" });
    } else {
      lines.push({ accountId: debtorsAccountId, debit: 0, credit: -arDelta, remarks: "FX reval — Debtors down" });
    }
  }
  // AP aggregate:
  //   apDelta > 0 (Creditors up): DR FX Loss delta / CR Creditors delta
  //   apDelta < 0 (Creditors down): DR Creditors |delta| / CR FX Gain
  if (Math.abs(apDelta) >= 0.005) {
    if (apDelta > 0) {
      lines.push({ accountId: creditorsAccountId, debit: 0, credit: apDelta, remarks: "FX reval — Creditors up" });
    } else {
      lines.push({ accountId: creditorsAccountId, debit: -apDelta, credit: 0, remarks: "FX reval — Creditors down" });
    }
  }
  // FX offset — netFxGainLoss = arDelta - apDelta from tenant's POV.
  //   Net > 0 → net gain → CR FX Gain
  //   Net < 0 → net loss → DR FX Loss
  const net = arDelta - apDelta;
  if (Math.abs(net) >= 0.005) {
    if (net > 0) {
      lines.push({ accountId: fxGainLossAccountId, debit: 0, credit: net, remarks: "FX reval offset — net gain" });
    } else {
      lines.push({ accountId: fxGainLossAccountId, debit: -net, credit: 0, remarks: "FX reval offset — net loss" });
    }
  }
  return lines;
}
