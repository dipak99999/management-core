import { Router } from "express";
import { prisma, seedMfgAnalytics } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const mfgAnalyticsRouter = Router();

mfgAnalyticsRouter.post("/seed", perms("Dashboard").create, async (req, res) => {
  try {
    const result = await seedMfgAnalytics(prisma, req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Seed failed" });
  }
});
