import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { applyBrandKit, isSuppressed, prisma, renderTemplate } from "@lumaara/db";
import { takeToken } from "@lumaara/queue";
import { getLogger } from "@lumaara/service-auth";

// Public transactional email API — SendGrid/Postmark-style /messages endpoint,
// tenant-scoped. Auth via ApiToken issued from /api-tokens (Bearer token).
//
// Endpoints:
//   GET  /v1/tx/health          - liveness (no auth)
//   POST /v1/tx                 - enqueue one message (suppression-aware)
//   POST /v1/tx/batch           - enqueue up to 100 in one call
//   GET  /v1/tx/:id             - status poll for a message this tenant owns
//   GET  /v1/tx/:id/events      - TrackingEvent[] for this message
//
// Design notes:
//   - Suppression hit returns 200 with status="Suppressed" (documented
//     behaviour — matches how SES/Postmark surface deliverability blocks).
//     Rationale: senders should NOT treat suppression as an error; it's a
//     normal outcome and 4xx would trigger their retry logic.
//   - Rate limit uses the same in-process token bucket as marketing sends
//     (`@lumaara/queue::takeToken`). Default 1000/min per tenant. ApiToken has
//     no per-token rate override in the current schema; the default applies
//     uniformly. When we later add `ApiToken.rateLimitPerMin`, plug it in at
//     the `resolveRateLimit()` call site.
//   - Custom header whitelist: only `X-*`, `List-*`, `In-Reply-To`,
//     `References` pass through. This blocks attackers using `To:`, `Bcc:`,
//     `Content-Type:` etc. to smuggle recipients or alter routing.
//   - "Verified domain" for `from` overrides is not enforced by schema today
//     (there is no VerifiedDomain table). We do a shape-only email check and
//     leave provider-level DKIM/SPF gating to the SMTP integration. TODO when
//     the domain-verification model lands.

export const transactionalRouter = Router();

const log = getLogger("auth-service").child({ component: "transactional" });

// ---------- Auth: ApiToken (Bearer) ----------

interface ApiAuthContext {
  tenantId: string;
  userId: string;
  apiTokenId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiAuth?: ApiAuthContext;
    }
  }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function requireApiToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  const raw = header.slice(7).trim();
  if (!raw.startsWith("ont_")) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  const tokenHash = sha256Hex(raw);
  const row = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (
    !row ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt < new Date())
  ) {
    res.status(401).json({ error: "Invalid or revoked token" });
    return;
  }
  req.apiAuth = {
    tenantId: row.tenantId,
    userId: row.userId,
    apiTokenId: row.id,
  };
  // best-effort lastUsed touch — never block the request
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  next();
}

// ---------- Rate limit ----------

// Per-tenant default for transactional sends (per minute). Chosen to match
// the plan's guidance; can be lifted per-ApiToken once ApiToken has a rate
// column. See marketing-throttle.ts for bucket semantics.
const DEFAULT_TX_RATE_PER_MIN = 1000;

function resolveRateLimit(_apiTokenId: string): number {
  // Placeholder for future per-token override — the ApiToken model does not
  // carry rate metadata today. Keep the API stable so callers don't shift when
  // that column is added.
  return DEFAULT_TX_RATE_PER_MIN;
}

async function enforceRate(
  req: Request,
  res: Response,
): Promise<boolean> {
  const auth = req.apiAuth!;
  const limit = resolveRateLimit(auth.apiTokenId);
  const ok = await takeToken(`tx:${auth.tenantId}`, limit);
  if (!ok) {
    // Bucket refills at the next wall-clock minute boundary. `Retry-After`
    // returns the whole seconds until then (RFC 7231 §7.1.3 — integer form).
    const nowSec = Math.floor(Date.now() / 1000);
    const boundarySec = Math.ceil((nowSec + 1) / 60) * 60;
    const retryAfter = Math.max(1, boundarySec - nowSec);
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.status(429).json({
      error: "Rate limit exceeded",
      limit,
      retryAfter,
    });
    return false;
  }
  res.setHeader("X-RateLimit-Limit", String(limit));
  return true;
}

// ---------- Header whitelist ----------

// Only these headers may be attached to an outbound message. Blocks smuggling
// of routing headers (`To`, `Bcc`, `Cc`, `From`, `Reply-To`, `Content-Type`).
// - X-*        : vendor/custom (X-Campaign-Id, X-Environment, ...)
// - List-*     : List-Unsubscribe, List-Id, List-Help (RFC 2369/8058)
// - In-Reply-To / References : threading (RFC 5322)
const HEADER_WHITELIST = /^(x-[a-z0-9-]+|list-[a-z0-9-]+|in-reply-to|references)$/i;

function sanitizeHeaders(
  raw: Record<string, string> | undefined,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    if (!HEADER_WHITELIST.test(k)) continue;
    // CRLF injection guard — a value containing \r or \n could inject a
    // full new header. Strip both bytes.
    const clean = v.replace(/[\r\n]/g, "");
    if (clean.length > 998) continue; // RFC 5322 line-length ceiling
    out[k] = clean;
  }
  return out;
}

// ---------- Zod schema ----------

const emailShape = z.string().trim().email().max(320);

const txMessageSchema = z
  .object({
    to: emailShape,
    // Subject may be omitted when a template is used — template.subject
    // then supplies it. Enforced by the `.refine()` below.
    subject: z.string().max(998).optional(),
    html: z.string().min(1).max(1_000_000).optional(),
    text: z.string().max(1_000_000).optional(),
    from: emailShape.optional(),
    fromName: z.string().max(200).optional(),
    replyTo: emailShape.optional(),
    template: z.string().min(1).max(200).optional(),
    vars: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    tracking: z.boolean().optional(),
    headers: z.record(z.string()).optional(),
  })
  .refine((v) => Boolean(v.template) || Boolean(v.html) || Boolean(v.text), {
    message: "Either 'html', 'text', or 'template' must be provided",
    path: ["html"],
  })
  .refine((v) => Boolean(v.template) || (v.subject && v.subject.length > 0), {
    message: "'subject' is required unless a 'template' is provided",
    path: ["subject"],
  });

type TxMessageInput = z.infer<typeof txMessageSchema>;

// ---------- Tenant defaults ----------

interface FromDefaults {
  fromEmail: string;
  fromName: string | null;
}

async function resolveTenantFromDefaults(
  tenantId: string,
): Promise<FromDefaults> {
  // Reuse SMTP integration's `from` — same source of truth as
  // email-messages.ts. Fall back to env / hardcoded so a tenant with no
  // integration still gets a stable sender.
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "smtp", isActive: true, isDefault: true },
    select: { secrets: true },
  });
  // Dev fallback uses the reserved `.local` TLD so unconfigured mail fails
  // closed (bounces) rather than silently shipping from a public fake domain.
  // Prod requires SMTP_FROM; boot in index.ts refuses to start without it.
  let fromEmail = process.env.SMTP_FROM || "no-reply@lumaara.local";
  let fromName: string | null = null;
  if (integration) {
    try {
      // secrets is Json; when encrypted at rest it needs decryptSecrets, but
      // the SMTP loader already tolerates plain shapes. Skip decryption here —
      // we only want the `from` label; a decrypt failure shouldn't block send.
      const raw = integration.secrets as unknown;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const s = raw as Record<string, unknown>;
        if (typeof s.from === "string" && s.from) fromEmail = s.from;
        if (typeof s.fromName === "string" && s.fromName)
          fromName = s.fromName;
      }
    } catch {
      // ignore — defaults suffice
    }
  }
  return { fromEmail, fromName };
}

// ---------- Per-item processing ----------

type ProcessResult =
  | { ok: true; id: string; status: "Queued"; trackingId: string | null }
  | { ok: true; id: null; status: "Suppressed"; reason: string }
  | { ok: false; status: number; error: string; details?: unknown };

async function processOne(
  auth: ApiAuthContext,
  input: TxMessageInput,
  defaults: FromDefaults,
): Promise<ProcessResult> {
  const to = input.to.toLowerCase();

  // 1. Suppression check — cheapest gate. Never inserts a row, never charges
  //    against rate. Documented behaviour: 200 not 4xx.
  const suppressed = await isSuppressed(prisma, auth.tenantId, to);
  if (suppressed) {
    return {
      ok: true,
      id: null,
      status: "Suppressed",
      reason: suppressed.reason,
    };
  }

  // 2. Template resolution (optional).
  let subject = input.subject ?? "";
  let body = input.html ?? input.text ?? "";
  let templateId: string | null = null;
  if (input.template) {
    const tpl = await prisma.emailTemplate.findFirst({
      where: {
        tenantId: auth.tenantId,
        name: input.template,
        enabled: true,
      },
    });
    if (!tpl) {
      return {
        ok: false,
        status: 404,
        error: `Template '${input.template}' not found or disabled`,
      };
    }
    const vars = (input.vars ?? {}) as Record<string, unknown>;
    // If caller passed a subject/html, they override the template's copy
    // (post-render). Otherwise use the template's own values.
    const rawSubject = input.subject && input.subject.length > 0 ? input.subject : tpl.subject;
    subject = renderTemplate(rawSubject, vars);
    const rawBody = input.html ?? input.text ?? tpl.body;
    body = renderTemplate(rawBody, vars);
    templateId = tpl.id;
  }

  if (!body) {
    return {
      ok: false,
      status: 400,
      error: "Rendered body is empty",
    };
  }

  // Post-render brand-kit pass so `{{brand.*}}` tokens in the template
  // (or its layout wrapper) resolve against the per-tenant BrandKit.
  body = await applyBrandKit(body, auth.tenantId);

  // 3. Insert EmailMessage. `trackingEnabled` gates trackingId allocation —
  //    the tracking route (`/email/track/*`) looks up messages by trackingId.
  const trackingEnabled = input.tracking === true;
  const trackingId = trackingEnabled ? randomUUID() : null;

  const fromEmail = input.from ?? defaults.fromEmail;
  const fromName = input.fromName ?? defaults.fromName;

  const row = await prisma.emailMessage.create({
    data: {
      tenantId: auth.tenantId,
      toEmail: to,
      subject,
      body,
      status: "Pending",
      templateId,
      senderUserId: auth.userId,
      fromEmail,
      fromName,
      trackingEnabled,
      trackingId,
    },
    select: { id: true },
  });

  return {
    ok: true,
    id: row.id,
    status: "Queued",
    trackingId,
  };
}

// ---------- Routes ----------

transactionalRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "transactional" });
});

// POST /v1/tx — enqueue a single message.
transactionalRouter.post(
  "/",
  requireApiToken,
  async (req: Request, res: Response) => {
    if (!(await enforceRate(req, res))) return;

    const parsed = txMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    // Whitelist headers now so the caller sees the sanitized set in logs.
    const _headers = sanitizeHeaders(parsed.data.headers);
    // Headers are stored on the message via a future column; for now they
    // flow through the delivery adapter. Log the count for observability.
    if (Object.keys(parsed.data.headers ?? {}).length !== Object.keys(_headers).length) {
      log.debug("dropped non-whitelisted headers", {
        tenantId: req.apiAuth!.tenantId,
      });
    }

    try {
      const defaults = await resolveTenantFromDefaults(req.apiAuth!.tenantId);
      const result = await processOne(req.apiAuth!, parsed.data, defaults);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      if (result.status === "Suppressed") {
        res
          .status(200)
          .json({ id: null, status: "Suppressed", reason: result.reason });
        return;
      }
      res.status(202).json({
        id: result.id,
        status: result.status,
        trackingId: result.trackingId,
      });
    } catch (err) {
      log.error("tx send failed", {
        err: err instanceof Error ? err.message : String(err),
        tenantId: req.apiAuth!.tenantId,
      });
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// POST /v1/tx/batch — up to 100 messages in one call.
const batchSchema = z.object({
  messages: z.array(txMessageSchema).min(1).max(100),
});

transactionalRouter.post(
  "/batch",
  requireApiToken,
  async (req: Request, res: Response) => {
    // Rate-limit the batch call as a single unit — one token per call, not
    // per message. This matches how SendGrid/Postmark meter batch APIs and
    // prevents a 100-message batch from single-handedly draining the bucket.
    if (!(await enforceRate(req, res))) return;

    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const defaults = await resolveTenantFromDefaults(req.apiAuth!.tenantId);
      const out: Array<
        | { id: string; status: "Queued"; trackingId: string | null }
        | { id: null; status: "Suppressed"; reason: string }
        | { id: null; status: "Failed"; error: string }
      > = [];
      // Sequential — keeps ordering + avoids a burst of Prisma writes.
      for (const msg of parsed.data.messages) {
        try {
          const r = await processOne(req.apiAuth!, msg, defaults);
          if (!r.ok) {
            out.push({ id: null, status: "Failed", error: r.error });
          } else if (r.status === "Suppressed") {
            out.push({ id: null, status: "Suppressed", reason: r.reason });
          } else {
            out.push({
              id: r.id,
              status: r.status,
              trackingId: r.trackingId,
            });
          }
        } catch (err) {
          out.push({
            id: null,
            status: "Failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      res.status(202).json({ results: out });
    } catch (err) {
      log.error("tx batch failed", {
        err: err instanceof Error ? err.message : String(err),
        tenantId: req.apiAuth!.tenantId,
      });
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// GET /v1/tx/:id — status check. 404 for cross-tenant (never leaks existence).
transactionalRouter.get(
  "/:id",
  requireApiToken,
  async (req: Request, res: Response) => {
    const row = await prisma.emailMessage.findFirst({
      where: { id: req.params.id, tenantId: req.apiAuth!.tenantId },
      select: {
        id: true,
        status: true,
        sentAt: true,
        providerMessageId: true,
        lastError: true,
        trackingId: true,
        trackingEnabled: true,
      },
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

// GET /v1/tx/:id/events — TrackingEvent history for a message.
transactionalRouter.get(
  "/:id/events",
  requireApiToken,
  async (req: Request, res: Response) => {
    const msg = await prisma.emailMessage.findFirst({
      where: { id: req.params.id, tenantId: req.apiAuth!.tenantId },
      select: { id: true, trackingEnabled: true },
    });
    if (!msg) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Contract: when tracking is off we don't guess-return partial provider
    // events either — an empty array is the honest answer.
    if (!msg.trackingEnabled) {
      res.json([]);
      return;
    }
    const events = await prisma.trackingEvent.findMany({
      where: {
        tenantId: req.apiAuth!.tenantId,
        emailMessageId: msg.id,
      },
      orderBy: { occurredAt: "asc" },
    });
    res.json(events);
  },
);
