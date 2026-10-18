import { Router } from "express";
import { getOrGenerateInsight, INSIGHT_DOCTYPES, type InsightDoctype } from "@lumaara/db";

// AI Insights HTTP surface — one GET to retrieve/cache, one POST to force
// regeneration (shows the user we're thinking + bypasses the 24h cache).
// Doctype is validated against the shipped allowlist.
export const aiInsightsRouter = Router();

function isDoctype(x: string): x is InsightDoctype {
  return (INSIGHT_DOCTYPES as readonly string[]).includes(x);
}

aiInsightsRouter.get("/insights/:doctype/:id", async (req, res) => {
  const { doctype, id } = req.params;
  if (!isDoctype(doctype)) {
    return res.status(400).json({ error: `Unsupported doctype: ${doctype}` });
  }
  try {
    const insight = await getOrGenerateInsight(doctype, id, req.auth!.tenantId);
    res.json(insight);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /not found/i.test(msg) ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

aiInsightsRouter.post("/insights/:doctype/:id/refresh", async (req, res) => {
  const { doctype, id } = req.params;
  if (!isDoctype(doctype)) {
    return res.status(400).json({ error: `Unsupported doctype: ${doctype}` });
  }
  try {
    const insight = await getOrGenerateInsight(doctype, id, req.auth!.tenantId, { refresh: true });
    res.json(insight);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /not found/i.test(msg) ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});
