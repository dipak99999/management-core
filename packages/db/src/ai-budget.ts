// Per-tenant AI monthly spend cap.
//
// Problem: without a ceiling, a single runaway agent or a malicious tenant
// uploading junk for extraction can rack up thousands of dollars of OpenAI
// / Anthropic spend before anyone notices. Current state: no cap exists —
// AgentPolicy.maxCostUsdPerTask is per-task ($1 default) but a tenant can
// run unlimited tasks.
//
// Fix: compute month-to-date spend across every billable AI surface
// (AgentStep.costUsd + AIExtractionJob.inputTokens*priceIn + outputTokens*priceOut)
// and compare against a configurable cap. Throws AiBudgetExceededError when
// over, which route handlers map to HTTP 402.
//
// Deliberately computes on-the-fly (no cached counter) — correctness over
// throughput. The 2 queries per check are indexed scans by tenantId +
// createdAt; on a 1k-task-per-month tenant this is ~sub-millisecond.
//
// Env knobs:
//   AI_MONTHLY_BUDGET_USD_DEFAULT   per-tenant cap when the tenant has no
//                                   explicit budget row (default: 100)
//   AI_BUDGET_ENFORCE               "true" to actually block (default: true
//                                   in prod, false otherwise so dev tests
//                                   don't trip)
//
// Not implemented yet (follow-ups):
//   * Per-tenant override via TenantAiBudget model (needs a migration;
//     currently every tenant shares the env default)
//   * "Soft cap" warnings before the hard stop (fire a notification at 80%)

import { prisma } from "./index";

export class AiBudgetExceededError extends Error {
  readonly code = "AI_BUDGET_EXCEEDED";
  constructor(
    readonly tenantId: string,
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(
      `AI budget exceeded for tenant ${tenantId}: $${spentUsd.toFixed(2)} spent this month, $${budgetUsd.toFixed(2)} budget. Raise AI_MONTHLY_BUDGET_USD_DEFAULT or wait until next month.`,
    );
    this.name = "AiBudgetExceededError";
  }
}

// Rough per-model prices for extract/triage jobs that bill in tokens. The
// AgentStep path already stores dollar cost, so the agent surface uses that
// directly. Prices here only matter for the token-metered surfaces where
// cost wasn't captured at submit time.
//
// $ per 1M tokens. Underestimate the cheapest-plausible model; the goal is
// to catch runaways, not to be a billing meter.
const APPROX_USD_PER_INPUT_TOKEN = 0.15 / 1_000_000;  // gpt-4o-mini input
const APPROX_USD_PER_OUTPUT_TOKEN = 0.60 / 1_000_000; // gpt-4o-mini output

function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function defaultBudgetUsd(): number {
  const raw = Number(process.env.AI_MONTHLY_BUDGET_USD_DEFAULT);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 100; // sensible default — a chatty tenant on gpt-4o-mini can
              // comfortably stay under this.
}

function enforceEnabled(): boolean {
  const flag = process.env.AI_BUDGET_ENFORCE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  // Default: enforce in prod, don't enforce elsewhere (so dev + CI test
  // suites don't trip after seeded data accumulates).
  return process.env.NODE_ENV === "production";
}

/**
 * Month-to-date AI spend for a tenant across every surface we track:
 *   - AgentStep.costUsd (sum)
 *   - AIExtractionJob.inputTokens * price_in + outputTokens * price_out
 *
 * Returns a dollar amount. Cheap: two indexed sum queries.
 */
export async function monthToDateAiSpendUsd(tenantId: string): Promise<number> {
  const since = monthStartUtc();
  const [agentSteps, extractJobs] = await Promise.all([
    prisma.agentStep.aggregate({
      where: { tenantId, startedAt: { gte: since } },
      _sum: { costUsd: true },
    }),
    prisma.aIExtractionJob.aggregate({
      where: { tenantId, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const agentUsd = Number(agentSteps._sum?.costUsd ?? 0);
  const inputTok = Number(extractJobs._sum?.inputTokens ?? 0);
  const outputTok = Number(extractJobs._sum?.outputTokens ?? 0);
  const extractUsd =
    inputTok * APPROX_USD_PER_INPUT_TOKEN + outputTok * APPROX_USD_PER_OUTPUT_TOKEN;
  return agentUsd + extractUsd;
}

/**
 * Throws AiBudgetExceededError if the tenant has already spent >= the
 * monthly cap. Call BEFORE firing an LLM request.
 *
 * Safe to call hot — the two aggregates total <5ms on an indexed table.
 * If you need to batch many checks (e.g. a scheduler fanning out), gate
 * on the first one per tick instead.
 *
 * Returns the current spend + cap in all cases so callers can show a
 * progress bar / warn at 80% without a second query.
 */
export async function assertAiBudgetAvailable(
  tenantId: string,
): Promise<{ spentUsd: number; budgetUsd: number; enforced: boolean }> {
  const budgetUsd = defaultBudgetUsd();
  const enforced = enforceEnabled();
  const spentUsd = await monthToDateAiSpendUsd(tenantId);
  if (enforced && spentUsd >= budgetUsd) {
    throw new AiBudgetExceededError(tenantId, spentUsd, budgetUsd);
  }
  return { spentUsd, budgetUsd, enforced };
}
