// Marketing P3 — WebinarEvent + WebinarRegistration.
//
// Two auth surfaces on one router (mounted in index.ts WITHOUT a blanket
// requireAuth so the public registration endpoint can be reached without a
// JWT — every other route stamps `requireAuth` in-line):
//   * Operator CRUD + lifecycle + registrations viewer — requireAuth + perms().
//   * POST /:id/register — public. Requires webinar.registerFormId to be set
//     (prevents spam registrations to non-form-linked webinars).
//
// Providers: Zoom (real), Webex + GoogleMeet (stubbed — same shape). When a
// live TenantIntegration exists for the chosen provider, POST /webinars will
// provision the meeting; otherwise the row is saved as Draft with no
// externalId and the operator can transition to Scheduled manually only if
// provider=Manual.

import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  fireJourneyTrigger,
  getWebinarAdapter,
  recordTouchpoint,
  withCrossTenant,
  type WebinarAdapter,
  type WebinarProviderKey,
} from "@lumaara/db";
import { getLogger, idempotency, perms, requireAuth } from "@lumaara/service-auth";

const log = getLogger("crm-service");

export const webinarsRouter = Router();

const pE = perms("WebinarEvent");
const pR = perms("WebinarRegistration");

// ── Schemas ──────────────────────────────────────────────────────────

const PROVIDERS = ["Zoom", "Webex", "GoogleMeet", "Manual"] as const;
const STATUSES = ["Draft", "Scheduled", "Live", "Ended", "Cancelled"] as const;
const REG_STATUSES = ["Registered", "Reminded", "Attended", "NoShow", "Cancelled"] as const;

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid ISO date");

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  provider: z.enum(PROVIDERS),
  startAt: isoDate,
  endAt: isoDate,
  timezone: z.string().min(1).max(64).default("Asia/Kolkata"),
  capacity: z.number().int().positive().nullable().optional(),
  registerFormId: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
  provider: z.enum(PROVIDERS).optional(),
  startAt: isoDate.optional(),
  endAt: isoDate.optional(),
  timezone: z.string().min(1).max(64).optional(),
  capacity: z.number().int().positive().nullable().optional(),
  registerFormId: z.string().nullable().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
});

const regPatchSchema = z.object({
  status: z.enum(REG_STATUSES).optional(),
  notes: z.string().nullable().optional(),
});

const importSchema = z.object({
  rows: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(2000),
});

// ── Helpers ──────────────────────────────────────────────────────────

async function loadWebinar(req: Parameters<Parameters<typeof webinarsRouter.get>[1]>[0]) {
  return prisma.webinarEvent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
}

/** Try to resolve an adapter; returns null on any failure so callers can
 *  gracefully fall back to Draft (no provisioning). Logs the underlying
 *  error so ops can find missing / mis-shaped integrations. */
async function tryAdapter(
  tenantId: string,
  provider: WebinarProviderKey,
): Promise<WebinarAdapter | null> {
  try {
    return await getWebinarAdapter(prisma, tenantId, provider);
  } catch (e) {
    log.warn("getWebinarAdapter failed", {
      tenantId,
      provider,
      err: e instanceof Error ? e : new Error(String(e)),
    });
    return null;
  }
}

// Split a display name into (firstName, lastName). Zoom requires first_name
// separately. When there's no space or no name, fall back to email localpart.
function splitName(name: string | null | undefined, email: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const idx = trimmed.indexOf(" ");
    if (idx < 0) return { firstName: trimmed, lastName: "" };
    return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
  }
  const localpart = email.split("@")[0] ?? "Guest";
  return { firstName: localpart, lastName: "" };
}

// ── Public health ────────────────────────────────────────────────────

webinarsRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "webinars" });
});

// ── Public — POST /:id/register (no JWT; requires registerFormId) ────
//
// This endpoint intentionally sits before requireAuth so it's reachable
// without a token. The webinar itself must have a linked WebForm — that
// ensures a tenant has explicitly opted this webinar into public
// registration flow (spam gate).
webinarsRouter.post("/:id/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Cross-tenant read is deliberate here: this is a PUBLIC endpoint keyed by
  // the webinar id (opaque cuid, essentially unguessable). We look the row up
  // globally and rely on registerFormId being set as the spam gate. The
  // row's tenantId is discovered from the record and used for the
  // subsequent registration write.
  const webinar = await prisma.webinarEvent.findFirst(
    withCrossTenant({ where: { id: req.params.id } }),
  );
  if (!webinar) return res.status(404).json({ error: "Webinar not found" });

  // Spam gate: no registerFormId = the tenant hasn't opted this webinar into
  // public registration. Match the behavior the plan specifies (401).
  if (!webinar.registerFormId) {
    return res
      .status(401)
      .json({ error: "This webinar is not open for public registration" });
  }

  if (webinar.status === "Cancelled" || webinar.status === "Ended") {
    return res.status(409).json({ error: `Registration closed (status=${webinar.status})` });
  }

  // Capacity check — count existing non-cancelled registrations. Tenant-guard
  // bypass because this is the public register endpoint (webinar.tenantId is
  // trusted, discovered from the row above).
  if (webinar.capacity != null) {
    const taken = await prisma.webinarRegistration.count(
      withCrossTenant({
        where: {
          webinarId: webinar.id,
          tenantId: webinar.tenantId,
          status: { not: "Cancelled" },
        },
      }),
    );
    if (taken >= webinar.capacity) {
      return res.status(409).json({ error: "Webinar full" });
    }
  }

  // Idempotency: (webinarId, email) has a unique constraint. Return the
  // existing row on duplicate to keep public-form UX friendly (409 turns
  // "already registered" into a scary error otherwise).
  const existing = await prisma.webinarRegistration.findFirst(
    withCrossTenant({
      where: {
        webinarId: webinar.id,
        tenantId: webinar.tenantId,
        email: parsed.data.email,
      },
    }),
  );
  if (existing) {
    return res.status(200).json({
      ok: true,
      alreadyRegistered: true,
      registration: existing,
      // We do NOT persist the per-registrant Zoom join_url on duplicates;
      // reuse whatever we already stored (in `notes` if we captured it).
      joinUrl: webinar.joinUrl,
    });
  }

  // Provision on the provider if we have an integration + externalId already.
  // For Zoom this returns a per-registrant join URL that we store in `notes`
  // (schema doesn't yet have a dedicated column) and echo back in the
  // response so the form can display it.
  let perRegistrantJoinUrl: string | null = null;
  if (webinar.provider !== "Manual" && webinar.externalId) {
    const adapter = await tryAdapter(webinar.tenantId, webinar.provider as WebinarProviderKey);
    if (adapter) {
      try {
        const { firstName, lastName } = splitName(parsed.data.name, parsed.data.email);
        const r = await adapter.addRegistrant(webinar.externalId, {
          email: parsed.data.email,
          firstName,
          lastName,
        });
        perRegistrantJoinUrl = r.join_url;
      } catch (e) {
        // Non-fatal — save the local row anyway. Ops can retry via a
        // reconciliation job if the provider errored transiently. Surface the
        // failure via lastError-style logging.
        log.warn("adapter.addRegistrant failed", {
          webinarId: webinar.id,
          provider: webinar.provider,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }
  }

  // Persist the registration. Prefixed the provider join URL into `notes` so
  // it's queryable — a Registration schema addition (perRegistrantJoinUrl
  // column) is cleaner long-term; deferred for the next migration cycle.
  const registration = await prisma.webinarRegistration.create({
    data: {
      tenantId: webinar.tenantId,
      webinarId: webinar.id,
      email: parsed.data.email,
      name: parsed.data.name ?? null,
      mobile: parsed.data.mobile ?? null,
      status: "Registered",
      notes: perRegistrantJoinUrl ? `join_url:${perRegistrantJoinUrl}` : null,
    },
  });

  // Best-effort: fire the WebinarRegistered journey trigger. If the contact
  // exists as a Lead in this tenant, pass its id so journey nodes can address
  // it correctly; otherwise pass no contactId and journeys keyed to email
  // still enroll via emailTo. Also resolve to Customer if the email matches an
  // existing Customer — attribution is meaningful for Customer-side revenue
  // events, so we prefer the Customer id for the touchpoint when both exist.
  let resolvedContactType: "Customer" | "Lead" | null = null;
  let resolvedContactId: string | null = null;
  try {
    const customer = await prisma.customer.findFirst({
      where: { tenantId: webinar.tenantId, email: parsed.data.email },
      select: { id: true },
    });
    if (customer) {
      resolvedContactType = "Customer";
      resolvedContactId = customer.id;
    } else {
      const lead = await prisma.lead.findFirst({
        where: { tenantId: webinar.tenantId, email: parsed.data.email },
        select: { id: true, email: true, mobile: true },
      });
      if (lead) {
        resolvedContactType = "Lead";
        resolvedContactId = lead.id;
        await fireJourneyTrigger(prisma, {
          tenantId: webinar.tenantId,
          triggerType: "WebinarRegistered",
          match: { webinarId: webinar.id },
          contactType: "Lead",
          contactId: lead.id,
          emailTo: lead.email ?? parsed.data.email,
          mobileTo: lead.mobile,
        });
      }
    }
  } catch (e) {
    log.warn("fireJourneyTrigger(WebinarRegistered) failed", {
      webinarId: webinar.id,
      err: e instanceof Error ? e : new Error(String(e)),
    });
  }

  // Marketing P3 — attribution touchpoint on registration. Best-effort;
  // requires a resolvable Customer/Lead (skip anonymous registrations, which
  // don't tie to any downstream revenue). Use the WebinarRegistration id as
  // a fallback contactId (as a Lead) so the touchpoint still counts for
  // rollup even without a matching Lead row.
  try {
    await recordTouchpoint(prisma, {
      tenantId: webinar.tenantId,
      contactType: resolvedContactType ?? "Lead",
      contactId: resolvedContactId ?? registration.id,
      sourceType: "Webinar",
      sourceId: webinar.id,
      event: "Registered",
    });
  } catch (e) {
    log.warn("recordTouchpoint(Webinar/Registered) failed", {
      webinarId: webinar.id,
      registrationId: registration.id,
      err: e instanceof Error ? e : new Error(String(e)),
    });
  }

  res.status(201).json({
    ok: true,
    registration,
    joinUrl: perRegistrantJoinUrl ?? webinar.joinUrl,
  });
});

// ── Auth wall — everything below this line requires a JWT ───────────
webinarsRouter.use(requireAuth);

// ── List / detail ────────────────────────────────────────────────────

webinarsRouter.get("/", pE.read, async (req, res) => {
  const upcoming = req.query.upcoming === "1" || req.query.upcoming === "true";
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (statusFilter && statusFilter !== "all") where.status = statusFilter;
  if (upcoming) where.startAt = { gte: new Date() };

  const rows = await prisma.webinarEvent.findMany({
    where,
    orderBy: [{ startAt: upcoming ? "asc" : "desc" }],
    include: {
      _count: {
        select: { registrations: true },
      },
    },
  });
  // Flatten the count to a top-level field the UI can read easily.
  res.json(
    rows.map((r) => {
      const { _count, ...rest } = r as typeof r & { _count: { registrations: number } };
      return { ...rest, registrationsCount: _count.registrations };
    }),
  );
});

webinarsRouter.get("/:id", pE.read, async (req, res) => {
  const row = await loadWebinar(req);
  if (!row) return res.status(404).json({ error: "Not found" });
  // Registration breakdown per status (nice for the KPI cards on detail).
  const grouped = await prisma.webinarRegistration.groupBy({
    by: ["status"],
    where: { webinarId: row.id },
    _count: { _all: true },
  });
  const registrationBreakdown: Record<string, number> = {};
  for (const g of grouped) {
    registrationBreakdown[g.status] = g._count._all;
  }
  const total = grouped.reduce((s, g) => s + g._count._all, 0);
  const attended = registrationBreakdown["Attended"] ?? 0;
  res.json({
    webinar: row,
    registrationBreakdown,
    totals: {
      registered: total,
      attended,
      attendanceRate: total > 0 ? attended / total : 0,
    },
  });
});

// ── Create ───────────────────────────────────────────────────────────

webinarsRouter.post("/", pE.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, description, provider, startAt, endAt, timezone, capacity, registerFormId } = parsed.data;

  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  if (endDate <= startDate) {
    return res.status(400).json({ error: "endAt must be after startAt" });
  }

  // Validate the linked registration form belongs to the tenant if provided.
  if (registerFormId) {
    const form = await prisma.webForm.findFirst({
      where: { id: registerFormId, tenantId: req.auth!.tenantId },
      select: { id: true },
    });
    if (!form) return res.status(400).json({ error: "registerFormId not found" });
  }

  // Provision on the provider (best-effort; falls back to Draft if adapter is
  // absent or throws).
  let externalId: string | null = null;
  let joinUrl: string | null = null;
  let hostUrl: string | null = null;

  if (provider !== "Manual") {
    const adapter = await tryAdapter(req.auth!.tenantId, provider);
    if (adapter) {
      try {
        const r = await adapter.create({
          topic: name,
          startAt: startDate,
          endAt: endDate,
          timezone,
          agenda: description ?? null,
          capacity: capacity ?? null,
        });
        externalId = r.externalId;
        joinUrl = r.joinUrl;
        hostUrl = r.hostUrl;
      } catch (e) {
        log.warn("adapter.create failed — saving as Draft", {
          provider,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }
  }

  try {
    const row = await prisma.webinarEvent.create({
      data: {
        tenantId: req.auth!.tenantId,
        name,
        description: description ?? null,
        provider,
        status: "Draft",
        externalId,
        joinUrl,
        hostUrl,
        startAt: startDate,
        endAt: endDate,
        timezone,
        capacity: capacity ?? null,
        registerFormId: registerFormId ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res
        .status(409)
        .json({ error: "A webinar with this name + start time already exists" });
    }
    throw e;
  }
});

// ── Update ───────────────────────────────────────────────────────────

webinarsRouter.patch("/:id", pE.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await loadWebinar(req);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : existing.startAt;
  const endAt = parsed.data.endAt ? new Date(parsed.data.endAt) : existing.endAt;
  if (endAt <= startAt) return res.status(400).json({ error: "endAt must be after startAt" });

  // Mirror to the provider if we have an externalId + adapter.
  if (existing.externalId && existing.provider !== "Manual") {
    const adapter = await tryAdapter(existing.tenantId, existing.provider as WebinarProviderKey);
    if (adapter) {
      try {
        await adapter.update(existing.externalId, {
          topic: parsed.data.name ?? existing.name,
          agenda: parsed.data.description ?? existing.description,
          startAt,
          endAt,
          timezone: parsed.data.timezone ?? existing.timezone,
          capacity: parsed.data.capacity ?? existing.capacity,
        });
      } catch (e) {
        log.warn("adapter.update failed — local update proceeded", {
          webinarId: existing.id,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }
  }

  const row = await prisma.webinarEvent.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name ?? existing.name,
      description: parsed.data.description ?? existing.description,
      provider: parsed.data.provider ?? existing.provider,
      startAt,
      endAt,
      timezone: parsed.data.timezone ?? existing.timezone,
      capacity: parsed.data.capacity ?? existing.capacity,
      registerFormId: parsed.data.registerFormId ?? existing.registerFormId,
    },
  });
  res.json(row);
});

// ── Delete ───────────────────────────────────────────────────────────

webinarsRouter.delete("/:id", pE.delete, async (req, res) => {
  const existing = await loadWebinar(req);
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (existing.externalId && existing.provider !== "Manual") {
    const adapter = await tryAdapter(existing.tenantId, existing.provider as WebinarProviderKey);
    if (adapter) {
      try {
        await adapter.delete(existing.externalId);
      } catch (e) {
        log.warn("adapter.delete failed — local delete proceeded", {
          webinarId: existing.id,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }
    }
  }

  await prisma.webinarEvent.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ── Lifecycle transitions ────────────────────────────────────────────

webinarsRouter.post("/:id/publish", pE.submit, async (req, res) => {
  const row = await loadWebinar(req);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Draft") {
    return res.status(409).json({ error: `Cannot publish from status=${row.status}` });
  }
  // Manual webinars don't need an externalId; every other provider must have
  // been provisioned first.
  if (row.provider !== "Manual" && !row.externalId) {
    return res
      .status(400)
      .json({ error: "Cannot publish — provider integration failed at create time" });
  }
  const updated = await prisma.webinarEvent.update({
    where: { id: row.id },
    data: { status: "Scheduled" },
  });
  res.json(updated);
});

webinarsRouter.post("/:id/cancel", pE.cancel, idempotency("POST /webinars/:id/cancel"), async (req, res) => {
  const row = await loadWebinar(req);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status === "Ended" || row.status === "Cancelled") {
    return res.status(409).json({ error: `Cannot cancel from status=${row.status}` });
  }
  const updated = await prisma.webinarEvent.update({
    where: { id: row.id },
    data: { status: "Cancelled" },
  });
  res.json(updated);
});

webinarsRouter.post("/:id/mark-live", pE.submit, async (req, res) => {
  const row = await loadWebinar(req);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Scheduled") {
    return res.status(409).json({ error: `Cannot mark-live from status=${row.status}` });
  }
  const updated = await prisma.webinarEvent.update({
    where: { id: row.id },
    data: { status: "Live" },
  });
  res.json(updated);
});

webinarsRouter.post("/:id/mark-ended", pE.submit, async (req, res) => {
  const row = await loadWebinar(req);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Live" && row.status !== "Scheduled") {
    return res.status(409).json({ error: `Cannot mark-ended from status=${row.status}` });
  }
  // Count "actual attendees" = registrations with attendedAt set. This is the
  // best signal we have locally without polling the provider; a future
  // reconciliation job could pull Zoom's participant report for more precision.
  const attended = await prisma.webinarRegistration.count({
    where: { webinarId: row.id, attendedAt: { not: null } },
  });
  const updated = await prisma.webinarEvent.update({
    where: { id: row.id },
    data: { status: "Ended", actualAttendees: attended },
  });
  res.json(updated);
});

// ── Registrations ────────────────────────────────────────────────────

webinarsRouter.get("/:id/registrations", pR.read, async (req, res) => {
  const webinar = await loadWebinar(req);
  if (!webinar) return res.status(404).json({ error: "Not found" });
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const where: Record<string, unknown> = { webinarId: webinar.id };
  if (statusFilter && statusFilter !== "all") where.status = statusFilter;
  const rows = await prisma.webinarRegistration.findMany({
    where,
    orderBy: { registeredAt: "desc" },
    take: 500,
  });
  res.json(rows);
});

webinarsRouter.patch("/:id/registrations/:regId", pR.write, async (req, res) => {
  const parsed = regPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const webinar = await loadWebinar(req);
  if (!webinar) return res.status(404).json({ error: "Not found" });
  const reg = await prisma.webinarRegistration.findFirst({
    where: { id: req.params.regId, webinarId: webinar.id },
  });
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const data: Record<string, unknown> = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
    // Auto-stamp attendedAt on the first Attended transition. NoShow clears it.
    if (parsed.data.status === "Attended" && !reg.attendedAt) {
      data.attendedAt = new Date();
    } else if (parsed.data.status === "NoShow") {
      data.attendedAt = null;
    }
  }
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;

  const updated = await prisma.webinarRegistration.update({
    where: { id: reg.id },
    data,
  });

  // Marketing P3 — attribution touchpoint on Attended transition. Only fires
  // when the row went from a non-Attended status → Attended (idempotent by
  // the reg.attendedAt guard above; we only stamp attendedAt on first
  // Attended so the touchpoint is written exactly once).
  if (parsed.data.status === "Attended" && !reg.attendedAt) {
    try {
      await recordTouchpoint(prisma, {
        tenantId: webinar.tenantId,
        contactType: reg.contactType ?? "Lead",
        contactId: reg.contactId ?? reg.id,
        sourceType: "Webinar",
        sourceId: webinar.id,
        event: "Attended",
      });
    } catch (e) {
      log.warn("recordTouchpoint(Webinar/Attended) failed", {
        webinarId: webinar.id,
        registrationId: reg.id,
        err: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }

  res.json(updated);
});

webinarsRouter.post("/:id/registrations/import", pR.create, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const webinar = await loadWebinar(req);
  if (!webinar) return res.status(404).json({ error: "Not found" });

  let created = 0;
  let skipped = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const row of parsed.data.rows) {
    try {
      // Idempotent: skip on unique-constraint violation for (webinarId, email).
      await prisma.webinarRegistration.create({
        data: {
          tenantId: webinar.tenantId,
          webinarId: webinar.id,
          email: row.email,
          name: row.name ?? null,
          status: "Registered",
        },
      });
      created++;
    } catch (e) {
      if (e instanceof Error && e.message.includes("Unique constraint")) {
        skipped++;
      } else {
        errors.push({
          email: row.email,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  res.json({ ok: true, created, skipped, errors });
});

// ── Reminders ────────────────────────────────────────────────────────

webinarsRouter.post("/:id/send-reminder", pE.write, async (req, res) => {
  const webinar = await loadWebinar(req);
  if (!webinar) return res.status(404).json({ error: "Not found" });
  if (webinar.status === "Ended" || webinar.status === "Cancelled") {
    return res.status(409).json({ error: `Cannot remind — webinar ${webinar.status}` });
  }

  const regs = await prisma.webinarRegistration.findMany({
    where: { webinarId: webinar.id, status: "Registered" },
  });
  if (regs.length === 0) {
    return res.json({ ok: true, queued: 0, message: "No Registered rows" });
  }

  const startDisplay = webinar.startAt.toISOString().replace("T", " ").slice(0, 16);
  const subject = `Reminder: ${webinar.name} — starts ${startDisplay} ${webinar.timezone}`;

  let queued = 0;
  for (const r of regs) {
    // Per-registrant join URL is stashed in `notes` prefixed "join_url:" when
    // Zoom returned one at register-time; fall back to the shared webinar URL.
    const perRegUrl = r.notes && r.notes.startsWith("join_url:")
      ? r.notes.slice("join_url:".length)
      : null;
    const joinUrl = perRegUrl ?? webinar.joinUrl ?? "";
    const body = [
      `<p>Hi ${r.name ?? "there"},</p>`,
      `<p>This is a reminder that <strong>${webinar.name}</strong> starts on <strong>${startDisplay} ${webinar.timezone}</strong>.</p>`,
      webinar.description ? `<p>${webinar.description}</p>` : "",
      joinUrl
        ? `<p><a href="${joinUrl}">Join the session</a></p>`
        : "<p>Details will be shared closer to the time.</p>",
    ].join("");

    await prisma.emailMessage.create({
      data: {
        tenantId: webinar.tenantId,
        senderUserId: req.auth!.userId,
        toEmail: r.email,
        subject,
        body,
        linkedDoctype: "WebinarEvent",
        linkedId: webinar.id,
      },
    });
    queued++;
  }

  // Bump each registered row's status to Reminded so we don't double-send if
  // the operator clicks twice. Bulk update in a single query.
  await prisma.webinarRegistration.updateMany({
    where: { webinarId: webinar.id, status: "Registered" },
    data: { status: "Reminded" },
  });

  res.json({ ok: true, queued });
});
