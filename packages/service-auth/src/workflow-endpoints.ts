import { Router } from "express";
import { z } from "zod";
import {
  applyWorkflowTransition,
  availableActions,
  prisma,
} from "@lumaara/db";
import { requireAuth } from "./index";

// Factory that returns a router exposing the two runtime workflow endpoints:
//   GET  /workflow-actions/:doctype/:docId
//   POST /workflow-actions/apply
//
// Mounted in every service so each web app can talk to its own service instead
// of cross-calling auth-service. The workflow definitions themselves live in
// auth-service (Workflow admin routes there); the engine reads them from the
// shared DB either way.

const applySchema = z.object({
  doctype: z.string(),
  docId: z.string(),
  action: z.string(),
});

export function workflowEndpoints(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/:doctype/:docId", async (req, res) => {
    try {
      const result = await availableActions(prisma, {
        tenantId: req.auth!.tenantId,
        doctype: req.params.doctype,
        docId: req.params.docId,
        userRoles: req.auth!.roles,
        isSystemManager:
          req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin",
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  });

  router.post("/apply", async (req, res) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const result = await applyWorkflowTransition(prisma, {
        tenantId: req.auth!.tenantId,
        doctype: parsed.data.doctype,
        docId: parsed.data.docId,
        action: parsed.data.action,
        userRoles: req.auth!.roles,
        isSystemManager:
          req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin",
      });
      res.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      res.status(msg === "Document not found" ? 404 : 400).json({ error: msg });
    }
  });

  return router;
}
