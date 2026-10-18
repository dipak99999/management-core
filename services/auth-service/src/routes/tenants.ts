import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "../middleware/require-auth";

export const tenantRouter = Router();

tenantRouter.get("/current", requireAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth!.tenantId } });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  res.json({ id: tenant.id, name: tenant.name, slug: tenant.slug });
});
