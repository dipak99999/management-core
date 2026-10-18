import { Router } from "express";
import { prisma, seedFinanceAnalytics } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Trigger endpoint for seeding the 18 Finance & Accounting dashboards.
// Gated on Dashboard:create — AccountsManager + SystemManager get it.

export const financeAnalyticsRouter = Router();

financeAnalyticsRouter.post("/seed", perms("Dashboard").create, async (req, res) => {
  try {
    const result = await seedFinanceAnalytics(prisma, req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Seed failed" });
  }
});
