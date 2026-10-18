import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

/**
 * Per-tenant AI spend snapshot for today, feeding the <AIBudgetPill>.
 * `used` aggregates AgentStep.costUsd over the current UTC day; `limit`
 * reads AI_TENANT_DAILY_USD_LIMIT (string → number, default 25).
 *
 * This is a lightweight read endpoint — cost accounting itself happens
 * inside the AI call paths that write AgentStep rows. If a tenant adds
 * more AI surfaces, their costs show up here automatically as long as
 * they also write an AgentStep.
 */
export const aiBudgetRouter = Router();
aiBudgetRouter.use(requireAuth);

aiBudgetRouter.get("/", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const agg = await prisma.agentStep.aggregate({
    where: { tenantId, startedAt: { gte: start } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
  });

  const used = Number(agg._sum.costUsd ?? 0);
  const limit = Number(process.env.AI_TENANT_DAILY_USD_LIMIT ?? "25");

  res.json({
    used,
    limit,
    currency: "USD",
    inputTokens: agg._sum.inputTokens ?? 0,
    outputTokens: agg._sum.outputTokens ?? 0,
    windowStart: start.toISOString(),
  });
});
