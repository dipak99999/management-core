import { Router } from "express";
import { z } from "zod";
import {
  attributeInvoice,
  getRoiBySource,
  prisma,
  recordTouchpoint,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Marketing P3 — AttributionTouchpoint write path + ROI dashboard reads.
//
// Endpoints (all JWT'd — mounted with requireAuth in index.ts):
//   POST /attribution/touchpoints          — manual write (tests, ad-hoc events)
//   GET  /attribution/roi                  — per-source revenue rollup
//   GET  /attribution/customer/:customerId — full touchpoint timeline for a customer
//   POST /attribution/recompute            — admin re-attribute a specific invoice
//
// The engine lives in `packages/db/src/attribution.ts`. Routes here are thin
// glue that enforce tenant scope + validate input.

const log = getLogger("crm-service");

export const attributionRouter = Router();

attributionRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "attribution" });
});

// ── POST /attribution/touchpoints ──────────────────────────────────────
//
// Manual touchpoint write. Used by e2e tests and by any surface that needs to
// record an attribution event we don't already wire from the source. Body:
//   { contactType, contactId, sourceType, sourceId, event, occurredAt? }

const touchpointSchema = z.object({
  contactType: z.enum(["Customer", "Lead"]),
  contactId: z.string().min(1),
  sourceType: z.enum(["Campaign", "Journey", "WebForm", "Webinar", "SocialPost"]),
  sourceId: z.string().min(1),
  event: z.enum([
    "Open",
    "Click",
    "Enrolled",
    "Completed",
    "Submitted",
    "Registered",
    "Attended",
  ]),
  occurredAt: z.string().datetime().optional(),
});

attributionRouter.post("/touchpoints", async (req, res) => {
  const parsed = touchpointSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const row = await recordTouchpoint(prisma, {
      tenantId: req.auth!.tenantId,
      contactType: parsed.data.contactType,
      contactId: parsed.data.contactId,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      event: parsed.data.event,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
    });
    res.status(201).json(row);
  } catch (e) {
    log.error("recordTouchpoint failed", { err: e instanceof Error ? e : new Error(String(e)) });
    res.status(500).json({ error: "Failed to record touchpoint" });
  }
});

// ── GET /attribution/roi ───────────────────────────────────────────────
//
// Query:
//   from       ISO date (required)
//   to         ISO date (required)
//   model      LastTouch | FirstTouch | Linear (default LastTouch)
//   sourceType optional filter (Campaign|Journey|WebForm|Webinar|SocialPost)
//
// Returns [{ sourceType, sourceId, sourceName, touchpointCount,
//            uniqueContacts, attributedRevenue }] sorted by revenue DESC.

const MODELS = ["LastTouch", "FirstTouch", "Linear"] as const;

attributionRouter.get("/roi", async (req, res) => {
  const q = req.query;
  const fromStr = typeof q.from === "string" ? q.from : "";
  const toStr = typeof q.to === "string" ? q.to : "";
  if (!fromStr || !toStr) {
    return res.status(400).json({ error: "from + to are required (ISO dates)" });
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: "Invalid from/to date" });
  }
  const modelRaw = typeof q.model === "string" ? q.model : "LastTouch";
  const model = (MODELS as readonly string[]).includes(modelRaw)
    ? (modelRaw as (typeof MODELS)[number])
    : "LastTouch";
  const sourceType = typeof q.sourceType === "string" && q.sourceType ? q.sourceType : undefined;

  try {
    const rows = await getRoiBySource(prisma, req.auth!.tenantId, {
      from,
      to,
      model,
      sourceType,
    });
    // Numeric fields land as JS numbers from Prisma when we select via
    // findMany with numeric aggregation done in-memory (see attribution.ts).
    res.json(rows);
  } catch (e) {
    log.error("getRoiBySource failed", { err: e instanceof Error ? e : new Error(String(e)) });
    res.status(500).json({ error: "Failed to load ROI report" });
  }
});

// ── GET /attribution/customer/:customerId ──────────────────────────────
//
// Full touchpoint timeline for a customer. Optional ?windowDays=90 caps how
// far back we look. Newest first.

attributionRouter.get("/customer/:customerId", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const customerId = req.params.customerId;
  const windowDaysRaw = Number.parseInt(
    typeof req.query.windowDays === "string" ? req.query.windowDays : "",
    10,
  );
  const windowDays =
    Number.isFinite(windowDaysRaw) && windowDaysRaw > 0 ? windowDaysRaw : 90;
  const since = new Date(Date.now() - windowDays * 86_400_000);

  // Cast to any — Prisma's generated types for AttributionTouchpoint aren't
  // in scope here without an explicit import; a permissive shape is fine
  // (we already validated tenant scope via requireAuth).
  const p = prisma as unknown as {
    attributionTouchpoint: {
      findMany: (a: unknown) => Promise<unknown[]>;
    };
  };
  const rows = await p.attributionTouchpoint.findMany({
    where: {
      tenantId,
      contactType: "Customer",
      contactId: customerId,
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  res.json({ customerId, windowDays, touchpoints: rows });
});

// ── POST /attribution/recompute?invoiceId= ─────────────────────────────
//
// Re-run the attribution engine for a specific invoice. Admin-only —
// intended for backfills after a model change or a data fix. Reads the
// invoice from the accounting side, picks netTotal as the attributable
// amount, and re-runs `attributeInvoice`.

function isAdmin(req: Parameters<Parameters<typeof attributionRouter.post>[1]>[0]): boolean {
  const auth = (req as unknown as { auth?: { roles?: string[]; role?: string } }).auth;
  if (!auth) return false;
  return (auth.roles ?? []).includes("SystemManager") || auth.role === "admin";
}

attributionRouter.post("/recompute", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
  const invoiceId =
    typeof req.query.invoiceId === "string" && req.query.invoiceId
      ? req.query.invoiceId
      : typeof req.body?.invoiceId === "string"
        ? req.body.invoiceId
        : "";
  if (!invoiceId) return res.status(400).json({ error: "invoiceId is required" });

  const modelRaw =
    (typeof req.query.model === "string" && req.query.model) ||
    (typeof req.body?.model === "string" && req.body.model) ||
    "LastTouch";
  const model = (MODELS as readonly string[]).includes(modelRaw)
    ? (modelRaw as (typeof MODELS)[number])
    : "LastTouch";
  const windowDaysRaw = Number.parseInt(
    typeof req.query.windowDays === "string"
      ? req.query.windowDays
      : typeof req.body?.windowDays === "string"
        ? req.body.windowDays
        : "",
    10,
  );
  const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw > 0
    ? windowDaysRaw
    : undefined;

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: invoiceId, tenantId: req.auth!.tenantId },
    select: {
      id: true,
      customerId: true,
      netTotal: true,
      postingDate: true,
      status: true,
    },
  });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  if (inv.status !== "Submitted" && inv.status !== "Paid") {
    return res.status(400).json({
      error: `Invoice status ${inv.status} — attribution only meaningful for Submitted/Paid`,
    });
  }

  try {
    const result = await attributeInvoice(prisma, {
      tenantId: req.auth!.tenantId,
      invoiceId: inv.id,
      customerId: inv.customerId,
      amount: Number(inv.netTotal),
      postingDate: inv.postingDate,
      windowDays,
      model,
    });
    res.json({
      ok: true,
      invoiceId: inv.id,
      model,
      touchpoints: result.touchpoints.length,
      splits: result.splits,
    });
  } catch (e) {
    log.error("attributeInvoice failed", { err: e instanceof Error ? e : new Error(String(e)) });
    res.status(500).json({ error: "Failed to recompute attribution" });
  }
});
