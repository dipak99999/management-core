import { Router, type Request, type Response, type NextFunction } from "express";
import { isFeatureEnabled } from "./ops";

// Reusable `/features/:key` endpoint. Mount this on any service so the
// web apps have a single, authed endpoint to check feature-flag state
// without each app re-implementing the FeatureFlag query.
//
// Mount:
//
//   import { requireAuth, featureFlagsEndpoint } from "@lumaara/service-auth";
//   app.use("/features", requireAuth, featureFlagsEndpoint());
//
// Call from the web app:
//
//   const { enabled } = await api.get<{ enabled: boolean }>(`/features/new-ui`);
//
// The key is URL-safe lower-kebab (e.g. `new-ui`, `two-step-checkout`).
// Rollout + enabled columns on FeatureFlag drive the response.

export function featureFlagsEndpoint(): import("express").Router {
  const router = Router();

  router.get(
    "/:key",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const tenantId = req.auth?.tenantId;
        if (!tenantId) return res.status(401).json({ error: "Unauthenticated" });
        const key = req.params.key;
        if (!key || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
          return res.status(400).json({ error: "Invalid feature key" });
        }
        const enabled = await isFeatureEnabled(tenantId, key);
        res.json({ key, enabled });
      } catch (e) {
        next(e);
      }
    },
  );

  return router;
}
