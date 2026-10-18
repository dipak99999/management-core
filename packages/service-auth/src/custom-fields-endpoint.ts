import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "./index";

// Read-through helper mounted at `/custom-fields-for/:doctype` in every service
// that supports customData. Lets each web app fetch its own doctype's meta
// from its own service (no cross-origin dance to auth-service at runtime).
// Writes still go through auth-service /custom-fields.

export function customFieldsReadRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get("/:doctype", async (req, res) => {
    const rows = await prisma.customField.findMany({
      where: { tenantId: req.auth!.tenantId, doctype: req.params.doctype },
      orderBy: { sortOrder: "asc" },
    });
    res.json(rows);
  });
  return router;
}
