import { Router } from "express";
import { prisma, seedCrmAnalytics } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const crmAnalyticsRouter = Router();

crmAnalyticsRouter.post("/seed", perms("Dashboard").create, async (req, res) => {
  try {
    const result = await seedCrmAnalytics(prisma, req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Seed failed" });
  }
});
