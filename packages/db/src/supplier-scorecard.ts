// Module 46 — Supplier Scorecard: pure scoring helpers.
//
// Every criterion resolves to a number in [0, 100]. The overall score
// is Σ(criterion score × criterion weight) / Σ(weights) — normalizing
// by the weight sum keeps the total bounded even if the tenant's
// weights don't sum to 100. Standing derives from the total.
//
// The helpers are intentionally kept pure — they take pre-fetched raw
// data (e.g. a list of PRs/POs for the period) and return the score.
// Data fetching lives in the caller (services/…/routes/…). That way
// the scoring math has cheap unit tests and could be reused for
// what-if scenarios ("what would this supplier score if we treated
// late delivery differently?") without a DB round trip.

export type CriterionFormula =
  | "OnTimeDelivery"
  | "Fulfillment"
  | "ResponseRate";

export const STANDINGS = [
  { min: 90, label: "Very Good" },
  { min: 75, label: "Good" },
  { min: 50, label: "Average" },
  { min: 25, label: "Poor" },
  { min: 0, label: "Very Poor" },
] as const;

export function standingForScore(score: number): string {
  for (const s of STANDINGS) if (score >= s.min) return s.label;
  return "Very Poor";
}

// OnTime = (deliveries received on-or-before their PO's deliveryDate)
// / (total deliveries) × 100. If a PR line has no PO or no deliveryDate,
// it's excluded from both numerator and denominator (can't judge
// timeliness without the target date).
export interface OnTimeInput {
  // PR lines that received during the period, joined with their PO's
  // deliveryDate (null if unlinked / no target).
  receipts: Array<{ postingDate: Date; deliveryDate: Date | null }>;
}
export function scoreOnTimeDelivery(input: OnTimeInput): number {
  const graded = input.receipts.filter((r) => r.deliveryDate !== null);
  if (graded.length === 0) return 100; // no signal → don't penalize
  const onTime = graded.filter((r) => r.postingDate <= (r.deliveryDate as Date)).length;
  return (onTime / graded.length) * 100;
}

// Fulfillment = Σ(received qty) / Σ(ordered qty) across the supplier's
// PO items whose PO was Submitted (any received qty counts, including
// zero) in the period. Cap at 100 so over-delivery doesn't inflate.
export interface FulfillmentInput {
  poItems: Array<{ orderedQty: number; receivedQty: number }>;
}
export function scoreFulfillment(input: FulfillmentInput): number {
  const totalOrdered = input.poItems.reduce((s, i) => s + i.orderedQty, 0);
  if (totalOrdered === 0) return 100;
  const totalReceived = input.poItems.reduce((s, i) => s + i.receivedQty, 0);
  const ratio = totalReceived / totalOrdered;
  return Math.min(100, ratio * 100);
}

// ResponseRate = (RFQ invitations where supplier filed a SQ) /
// (total RFQ invitations) × 100 within the period.
export interface ResponseRateInput {
  invitations: Array<{ responseStatus: string }>;
}
export function scoreResponseRate(input: ResponseRateInput): number {
  if (input.invitations.length === 0) return 100; // no invites, no penalty
  const responded = input.invitations.filter((i) => i.responseStatus === "Quoted").length;
  return (responded / input.invitations.length) * 100;
}

// Combines the three raw scores using the criterion weights. Renormalizes
// the weights so a total of 100 is guaranteed regardless of the tenant's
// input. Returns the total + per-criterion breakdown for the periods row.
export interface WeightedInput {
  criteria: Array<{ formula: CriterionFormula; weight: number }>;
  scores: Partial<Record<CriterionFormula, number>>;
}
export function combineWeighted(input: WeightedInput): {
  total: number;
  breakdown: Record<string, number>;
} {
  const totalWeight = input.criteria.reduce((s, c) => s + c.weight, 0);
  const breakdown: Record<string, number> = {};
  if (totalWeight === 0) return { total: 0, breakdown };
  let total = 0;
  for (const c of input.criteria) {
    const s = input.scores[c.formula] ?? 0;
    breakdown[c.formula] = s;
    total += (s * c.weight) / totalWeight;
  }
  return { total, breakdown };
}

// ---------- Full recompute (data fetch + score + upsert period) ----------
//
// Lives in @lumaara/db so both the manual `POST /:id/recompute` route
// and the weekly scheduler tick call the same code. Takes the caller's
// Prisma instance so it composes naturally with $transaction if needed.

import type { Prisma, PrismaClient } from "@prisma/client";
type AnyClient = PrismaClient | Prisma.TransactionClient;

export interface ScorecardShape {
  id: string;
  tenantId: string;
  supplierId: string;
  criteria: Array<{ formula: string; weight: Prisma.Decimal }>;
}

export async function recomputeScorecard(
  db: AnyClient,
  scorecard: ScorecardShape,
  fromDate: Date,
  toDate: Date,
) {
  const [receipts, poItems, invitations] = await Promise.all([
    db.purchaseReceiptItem.findMany({
      where: {
        purchaseReceipt: {
          tenantId: scorecard.tenantId,
          supplierId: scorecard.supplierId,
          status: "Submitted",
          postingDate: { gte: fromDate, lte: toDate },
        },
        purchaseOrderItem: { isNot: null },
      },
      select: {
        purchaseReceipt: { select: { postingDate: true } },
        purchaseOrderItem: {
          select: { purchaseOrder: { select: { deliveryDate: true } } },
        },
      },
    }),
    db.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          tenantId: scorecard.tenantId,
          supplierId: scorecard.supplierId,
          status: { in: ["Submitted", "To Receive", "Completed"] },
          transactionDate: { gte: fromDate, lte: toDate },
        },
      },
      select: { qty: true, receivedQty: true },
    }),
    db.rFQSupplier.findMany({
      where: {
        supplierId: scorecard.supplierId,
        rfq: {
          tenantId: scorecard.tenantId,
          status: { in: ["Submitted", "Awarded"] },
          transactionDate: { gte: fromDate, lte: toDate },
        },
      },
      select: { responseStatus: true },
    }),
  ]);

  const rawScores: Record<CriterionFormula, number> = {
    OnTimeDelivery: scoreOnTimeDelivery({
      receipts: receipts.map((r) => ({
        postingDate: r.purchaseReceipt.postingDate,
        deliveryDate: r.purchaseOrderItem?.purchaseOrder.deliveryDate ?? null,
      })),
    }),
    Fulfillment: scoreFulfillment({
      poItems: poItems.map((i) => ({
        orderedQty: Number(i.qty),
        receivedQty: Number(i.receivedQty),
      })),
    }),
    ResponseRate: scoreResponseRate({ invitations }),
  };

  const combined = combineWeighted({
    criteria: scorecard.criteria.map((c) => ({
      formula: c.formula as CriterionFormula,
      weight: Number(c.weight),
    })),
    scores: rawScores,
  });
  const standing = standingForScore(combined.total);

  const Decimal = (
    await import("@prisma/client")
  ).Prisma.Decimal;

  const period = await db.supplierScorecardPeriod.upsert({
    where: {
      scorecardId_fromDate_toDate: {
        scorecardId: scorecard.id,
        fromDate,
        toDate,
      },
    },
    create: {
      scorecardId: scorecard.id,
      fromDate,
      toDate,
      score: new Decimal(combined.total.toFixed(2)),
      standing,
      breakdown: combined.breakdown as unknown as Prisma.InputJsonValue,
    },
    update: {
      score: new Decimal(combined.total.toFixed(2)),
      standing,
      breakdown: combined.breakdown as unknown as Prisma.InputJsonValue,
      computedAt: new Date(),
    },
  });

  await db.supplierScorecard.update({
    where: { id: scorecard.id },
    data: {
      latestScore: new Decimal(combined.total.toFixed(2)),
      latestStanding: standing,
      latestScoredAsOf: new Date(),
    },
  });

  return period;
}
