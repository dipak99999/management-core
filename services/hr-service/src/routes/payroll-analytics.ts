import { Router } from "express";
import { prisma, seedPayrollAnalytics } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const payrollAnalyticsRouter = Router();

payrollAnalyticsRouter.post("/seed", perms("Dashboard").create, async (req, res) => {
  try {
    const result = await seedPayrollAnalytics(prisma, req.auth!.tenantId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Seed failed" });
  }
});
