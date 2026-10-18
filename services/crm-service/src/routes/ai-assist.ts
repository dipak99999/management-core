import { Router } from "express";
import { z } from "zod";
import {
  MODEL_HAIKU,
  MODEL_SONNET,
  NoApiKeyError,
  SOCIAL_CHAR_LIMITS,
  buildSystemBlocks,
  extractText,
  getAnthropicClient,
  loadBrandContext,
  parseStringArray,
  rewritePrompt,
  sanitizeHtml,
  socialCaptionPrompt,
  subjectLinePrompt,
  summarizePrompt,
  writeEmailPrompt,
} from "@lumaara/db";
import { takeToken } from "@lumaara/queue";
import { getLogger, requireAuth } from "@lumaara/service-auth";

// Marketing P3 — AI content assist via Anthropic SDK.
//
// Five endpoints, all JWT'd (mounted with requireAuth in index.ts):
//   POST /subject-line     — 3-5 subject suggestions given a body
//   POST /write-email      — draft {subject, body} from a brief
//   POST /rewrite          — rewrite text for a tone (casual/formal/…)
//   POST /summarize        — compress into a preheader / preview line
//   POST /social-caption   — platform-specific social post copy
//
// Model routing:
//   * Haiku (fast + cheap) for subject-line, rewrite, summarize, captions.
//   * Sonnet (higher quality) for write-email where output length + polish
//     matter more.
//
// Prompt caching:
//   * The SYSTEM block is emitted as a typed block with cache_control
//     ephemeral so Anthropic reuses the cache across requests in a session
//     (~5-min TTL). Big win when the same operator hits multiple endpoints
//     in a row. See packages/db/src/ai-assist.ts.
//
// Rate limiting:
//   * Per-tenant, 30 calls/min. Uses the same in-process token-bucket as
//     the marketing send pipeline (`takeToken('ai:${tenantId}', 30)`). This
//     is a soft ceiling — it protects Anthropic's account quota + our
//     billing envelope from a runaway UI or a compromised token.

export const aiAssistRouter = Router();

const log = getLogger("crm-service").child({ component: "ai-assist" });

/** Per-tenant AI call ceiling (calls / minute). */
const AI_RATE_PER_MIN = Math.max(1, Number(process.env.AI_RATE_PER_MIN ?? 30));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

// ---------- Health ---------------------------------------------------------

aiAssistRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "ai-assist" });
});

// ---------- Shared middleware — rate limit + client bootstrap --------------

interface AiContext {
  tenantId: string;
  client: Awaited<ReturnType<typeof getAnthropicClient>>;
  systemBlocks: ReturnType<typeof buildSystemBlocks>;
}

/**
 * Reserve a token + build the per-request context: Anthropic client (per-
 * tenant) + cached system prompt with the tenant's brand hints baked in.
 * Returns null when a 4xx has already been sent — caller should bail.
 */
async function boot(
  req: import("express").Request,
  res: import("express").Response,
): Promise<AiContext | null> {
  const tenantId = req.auth!.tenantId;

  // Rate limit — 30/min per tenant across ALL /ai-assist/* endpoints.
  const allowed = await takeToken(`ai:${tenantId}`, AI_RATE_PER_MIN);
  if (!allowed) {
    res.status(429).json({
      error: `AI rate limit exceeded (${AI_RATE_PER_MIN}/min). Try again shortly.`,
    });
    return null;
  }

  let client;
  try {
    client = await getAnthropicClient(tenantId);
  } catch (e) {
    if (e instanceof NoApiKeyError) {
      res.status(400).json({ error: e.message });
      return null;
    }
    throw e;
  }

  // BrandKit lookup is best-effort — a missing row just means "no branding
  // context in the prompt", not an error.
  let brand = null;
  try {
    brand = await loadBrandContext(tenantId);
  } catch (e) {
    log.warn("brand kit lookup failed — continuing without", {
      tenantId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
  const systemBlocks = buildSystemBlocks(brand);

  return { tenantId, client, systemBlocks };
}

/**
 * Uniformly handle Anthropic SDK failures. Distinguishes auth errors (401/403
 * from Anthropic → 400 to the caller so they know to fix the key) from
 * upstream/rate errors (→ 502).
 */
function handleAnthropicError(
  e: unknown,
  res: import("express").Response,
): void {
  const msg = e instanceof Error ? e.message : String(e);
  // The SDK throws `APIError`-shaped errors with a numeric status.
  const status =
    (e as { status?: number })?.status ?? (e as { statusCode?: number })?.statusCode;
  if (status === 401 || status === 403) {
    res.status(400).json({
      error: "Anthropic rejected the API key. Update it in Admin → Integrations.",
    });
    return;
  }
  if (status === 429) {
    res.status(429).json({
      error: "Anthropic upstream rate limit. Try again in a minute.",
    });
    return;
  }
  log.warn("anthropic call failed", { msg, status });
  res.status(502).json({
    error: "AI request failed",
    detail: msg.slice(0, 500),
  });
}

// ---------- POST /subject-line --------------------------------------------

const subjectLineSchema = z.object({
  bodyHtml: z.string().min(1),
  count: z.number().int().min(1).max(10).default(3),
  tone: z.enum(["professional", "casual", "urgent"]).default("professional"),
});

aiAssistRouter.post("/subject-line", async (req, res) => {
  const parsed = subjectLineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ctx = await boot(req, res);
  if (!ctx) return;

  try {
    const response = await ctx.client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 200,
      system: ctx.systemBlocks,
      messages: [
        {
          role: "user",
          content: subjectLinePrompt(
            parsed.data.bodyHtml,
            parsed.data.count,
            parsed.data.tone,
          ),
        },
      ],
    });
    const text = extractText(response as AnyRecord as { content: Array<{ type: string; text?: string }> });
    const subjects = parseStringArray(text, parsed.data.count).slice(
      0,
      parsed.data.count,
    );
    if (subjects.length === 0) {
      return res.status(502).json({ error: "AI returned no usable subject lines" });
    }
    res.json({ subjects });
  } catch (e) {
    handleAnthropicError(e, res);
  }
});

// ---------- POST /write-email ---------------------------------------------

const writeEmailSchema = z.object({
  brief: z.string().min(1).max(4000),
  tone: z.string().min(1).max(40).default("professional"),
  audience: z.string().min(1).max(200).nullable().optional(),
  length: z.enum(["short", "medium", "long"]).default("medium"),
});

aiAssistRouter.post("/write-email", async (req, res) => {
  const parsed = writeEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ctx = await boot(req, res);
  if (!ctx) return;

  try {
    const response = await ctx.client.messages.create({
      model: MODEL_SONNET,
      max_tokens: 2000,
      system: ctx.systemBlocks,
      messages: [
        {
          role: "user",
          content: writeEmailPrompt(
            parsed.data.brief,
            parsed.data.tone,
            parsed.data.audience ?? null,
            parsed.data.length,
          ),
        },
      ],
    });
    const text = extractText(response as AnyRecord as { content: Array<{ type: string; text?: string }> });

    // Try to parse the strict {subject, body} JSON. Fall back gracefully:
    // treat the first non-empty line as subject and the rest as body.
    let subject = "";
    let body = "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const obj = JSON.parse(jsonMatch[0]) as {
          subject?: unknown;
          body?: unknown;
        };
        if (typeof obj.subject === "string") subject = obj.subject.trim();
        if (typeof obj.body === "string") body = obj.body.trim();
      } catch {
        /* fall through */
      }
    }
    if (!subject || !body) {
      // Fallback — split first line as subject, rest as body.
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (!subject && lines.length > 0) subject = lines[0]!.trim().slice(0, 200);
      if (!body) body = lines.slice(1).join("\n").trim() || text.trim();
    }

    res.json({
      subject: subject.slice(0, 200),
      body: sanitizeHtml(body),
    });
  } catch (e) {
    handleAnthropicError(e, res);
  }
});

// ---------- POST /rewrite -------------------------------------------------

const rewriteSchema = z.object({
  text: z.string().min(1).max(6000),
  tone: z.enum(["casual", "formal", "friendly", "urgent", "shorter", "longer"]),
});

aiAssistRouter.post("/rewrite", async (req, res) => {
  const parsed = rewriteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ctx = await boot(req, res);
  if (!ctx) return;

  try {
    const response = await ctx.client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 1500,
      system: ctx.systemBlocks,
      messages: [
        {
          role: "user",
          content: rewritePrompt(parsed.data.text, parsed.data.tone),
        },
      ],
    });
    const text = extractText(response as AnyRecord as { content: Array<{ type: string; text?: string }> });
    if (!text) {
      return res.status(502).json({ error: "AI returned empty rewrite" });
    }
    res.json({ rewritten: sanitizeHtml(text) });
  } catch (e) {
    handleAnthropicError(e, res);
  }
});

// ---------- POST /summarize -----------------------------------------------

const summarizeSchema = z.object({
  text: z.string().min(1).max(6000),
  maxWords: z.number().int().min(1).max(120).default(30),
});

aiAssistRouter.post("/summarize", async (req, res) => {
  const parsed = summarizeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ctx = await boot(req, res);
  if (!ctx) return;

  try {
    const response = await ctx.client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 300,
      system: ctx.systemBlocks,
      messages: [
        {
          role: "user",
          content: summarizePrompt(parsed.data.text, parsed.data.maxWords),
        },
      ],
    });
    const raw = extractText(response as AnyRecord as { content: Array<{ type: string; text?: string }> });
    // Strip any HTML the model slipped in, then trim to the requested word cap.
    const plain = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const words = plain.split(" ").slice(0, parsed.data.maxWords);
    const summary = words.join(" ");
    if (!summary) {
      return res.status(502).json({ error: "AI returned empty summary" });
    }
    res.json({ summary });
  } catch (e) {
    handleAnthropicError(e, res);
  }
});

// ---------- POST /social-caption ------------------------------------------

const socialCaptionSchema = z.object({
  context: z.string().min(1).max(3000),
  platform: z.enum(["linkedin", "twitter", "facebook", "instagram"]),
  tone: z.string().min(1).max(40).default("engaging"),
  count: z.number().int().min(1).max(10).default(3),
});

aiAssistRouter.post("/social-caption", async (req, res) => {
  const parsed = socialCaptionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const ctx = await boot(req, res);
  if (!ctx) return;

  const limit = SOCIAL_CHAR_LIMITS[parsed.data.platform] ?? 500;

  try {
    const response = await ctx.client.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 600,
      system: ctx.systemBlocks,
      messages: [
        {
          role: "user",
          content: socialCaptionPrompt(
            parsed.data.context,
            parsed.data.platform,
            parsed.data.tone,
            parsed.data.count,
          ),
        },
      ],
    });
    const text = extractText(response as AnyRecord as { content: Array<{ type: string; text?: string }> });
    const captions = parseStringArray(text, parsed.data.count)
      // Enforce the platform char limit even if the model overshot.
      .map((c) => (c.length > limit ? c.slice(0, limit - 1) + "…" : c))
      .slice(0, parsed.data.count);
    if (captions.length === 0) {
      return res.status(502).json({ error: "AI returned no usable captions" });
    }
    res.json({ captions });
  } catch (e) {
    handleAnthropicError(e, res);
  }
});

// Exposed for tests — the internals are otherwise closed over.
export const _internals = { boot, handleAnthropicError };

// Silence unused-import warning when tsx compiles this in dev.
void requireAuth;
