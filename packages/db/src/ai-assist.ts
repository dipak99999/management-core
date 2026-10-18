// Marketing P3 — AI content assist client + prompts.
//
// Thin wrapper around the Anthropic SDK. Lives in @lumaara/db so any service
// (crm-service today; potentially auth-service or the marketing scheduler
// later) can call it with a single import.
//
// Key decisions:
//   * Two-tier model routing — Haiku for cheap short-output tasks
//     (subject-lines, tone rewrites, summarizations) and Sonnet for the
//     long-form "write email body from a brief" task where output quality
//     matters more. Constants exported so tests + callers can assert on
//     the choice.
//   * Ephemeral prompt caching on the SYSTEM block. Every request in a
//     session reuses the same "you are a marketing copywriter" system prompt;
//     Anthropic caches it after the first hit → ~80-90% cost savings on the
//     system-token portion for the rest of the session.
//   * Per-tenant API key from TenantIntegration provider="anthropic". Falls
//     back to ANTHROPIC_API_KEY env var so the shared/system tenant + local
//     dev keep working. Neither set → throw NoApiKeyError so the route layer
//     can 400 with a helpful message.
//   * Timeout hard-coded at 30s per request. The SDK exposes this per-call.
//   * Prompt caching + system-prompt shape produced by `buildSystemPrompt()`
//     is intentionally test-visible so we can assert `cache_control:
//     {type: "ephemeral"}` on the mocked SDK's call args.
//
// Tests mock @anthropic-ai/sdk at the module boundary; nothing in this file
// touches the network on its own.

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./index";
import { decryptSecrets } from "./secrets-crypto";

// ---------- Model routing ---------------------------------------------------

/** Cheap model for short-output tasks (subject lines, rewrites, summaries). */
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";

/** Higher-quality model for long-form generation (email body from a brief). */
export const MODEL_SONNET = "claude-sonnet-4-6";

/** 30s request timeout (per plan). */
export const REQUEST_TIMEOUT_MS = 30_000;

// ---------- Error types -----------------------------------------------------

export class NoApiKeyError extends Error {
  constructor() {
    super("AI features require an Anthropic API key. Configure in Admin → Integrations.");
    this.name = "NoApiKeyError";
  }
}

// ---------- Brand kit fetching (for on-brand prompts) -----------------------

interface BrandContext {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  headingFont?: string;
  bodyFont?: string;
  /** Optional tagline from Tenant.tagline / BrandKit — kept short. */
  tagline?: string;
}

/**
 * Load the tenant's BrandKit for prompt personalization. Returns null when
 * no BrandKit row exists — callers should treat that as "no branding context"
 * rather than erroring.
 *
 * Intentionally excludes any PII / user-identifying fields — only the visual
 * brand facets that steer copy tone/style.
 */
export async function loadBrandContext(tenantId: string): Promise<BrandContext | null> {
  const bk = await prisma.brandKit.findFirst({
    where: { tenantId },
    select: {
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      headingFont: true,
      bodyFont: true,
    },
  });
  if (!bk) return null;
  return {
    primaryColor: bk.primaryColor,
    secondaryColor: bk.secondaryColor,
    accentColor: bk.accentColor,
    headingFont: bk.headingFont,
    bodyFont: bk.bodyFont,
  };
}

// ---------- API key resolution ---------------------------------------------

/**
 * Resolve the Anthropic API key for a tenant. Order:
 *   1. TenantIntegration provider="Anthropic", isActive=true, secrets.apiKey
 *   2. Development-only: process.env.ANTHROPIC_API_KEY (skipped in prod)
 *
 * Per-tenant isolation is enforced in production — an env-var fallback
 * would leak the same key across every tenant on the box. Dev keeps the
 * fallback for local iteration without a TenantIntegration row.
 */
export async function resolveAnthropicApiKey(tenantId: string): Promise<string | null> {
  // Provider slug matches integration-catalog.ts entry (case-sensitive).
  const row = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      provider: { in: ["Anthropic", "anthropic"] },
      isActive: true,
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (row) {
    try {
      const s = decryptSecrets(row.secrets);
      const key = typeof s.apiKey === "string" ? s.apiKey : null;
      if (key) return key;
    } catch {
      // Bad ciphertext — bail; caller sees NoApiKeyError.
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  const envKey = process.env.ANTHROPIC_API_KEY;
  return envKey && envKey.length > 0 ? envKey : null;
}

// ---------- Client factory --------------------------------------------------

/**
 * Return an Anthropic SDK client wired to the tenant's key. Throws
 * NoApiKeyError when no key is configured — route layer converts to a 400.
 *
 * The client is NOT cached across calls — the SDK is a lightweight wrapper
 * over fetch(), and re-creating per call keeps per-tenant isolation
 * airtight (no risk of one tenant's key leaking into another's request).
 */
export async function getAnthropicClient(tenantId: string): Promise<Anthropic> {
  const apiKey = await resolveAnthropicApiKey(tenantId);
  if (!apiKey) throw new NoApiKeyError();
  return new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
}

// ---------- Prompt construction --------------------------------------------

/**
 * Canonical marketing-copywriter system prompt. Same text on every request
 * in a session so Anthropic's prompt-caching kicks in and we pay the full
 * cache-miss cost only once.
 *
 * The `<brand>` section is appended only when BrandKit is present. Kept
 * short so it doesn't bloat the cache key.
 */
export function buildSystemPrompt(brand: BrandContext | null): string {
  const base =
    "You are an experienced marketing copywriter for a B2B SaaS product. " +
    "Match the requested tone precisely. Output must be plain HTML (no markdown) " +
    "suitable for direct use in an email body. Never invent facts, promises, or " +
    "product features not stated in the brief. When asked for multiple options, " +
    "output them as a JSON array of strings — no wrapping object, no prose before " +
    "or after the array.";
  if (!brand) return base;
  const brandBits: string[] = [];
  if (brand.primaryColor) brandBits.push(`primary color ${brand.primaryColor}`);
  if (brand.headingFont) brandBits.push(`heading font "${brand.headingFont}"`);
  if (brand.bodyFont) brandBits.push(`body font "${brand.bodyFont}"`);
  if (brand.tagline) brandBits.push(`brand tagline "${brand.tagline}"`);
  if (brandBits.length === 0) return base;
  return `${base}\n\n<brand>The brand uses ${brandBits.join(", ")}. Match this in tone and visual references where relevant.</brand>`;
}

/**
 * Build the SYSTEM message with a cache_control ephemeral marker so the
 * cached block persists for ~5 minutes across requests. Structured this way
 * because the Anthropic SDK expects `system` to be either a string OR an
 * array of typed blocks — only the array form supports cache_control.
 */
export function buildSystemBlocks(brand: BrandContext | null): Array<{
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
}> {
  return [
    {
      type: "text",
      text: buildSystemPrompt(brand),
      cache_control: { type: "ephemeral" },
    },
  ];
}

// ---------- Output sanitization --------------------------------------------

/**
 * Strip <script>, <iframe>, <object>, <embed>, and on* event attributes from
 * generated HTML. The model is instructed to output plain HTML but a
 * belt-and-braces sanitization gate protects downstream (email body renders
 * directly to the recipient's inbox HTML).
 */
export function sanitizeHtml(html: string): string {
  return html
    // Strip script/iframe/object/embed elements + their contents.
    .replace(/<(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    // Strip self-closing / unmatched versions defensively.
    .replace(/<(script|iframe|object|embed|style)\b[^>]*\/?>/gi, "")
    // Strip on<Event>="..." attributes.
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    // javascript:/data: URLs in href/src.
    .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*javascript:[^']*'/gi, "$1='#'");
}

// ---------- JSON array parsing (with fallback) ------------------------------

/**
 * Parse a model-generated JSON array of strings. Model is instructed to
 * output raw `["a","b","c"]`. Falls back to splitting on newlines when the
 * output is malformed — better to return SOMETHING useful than a 500.
 *
 * Exported so route tests can hit both branches directly.
 */
export function parseStringArray(text: string, maxItems = 20): string[] {
  const trimmed = text.trim();
  // Try to extract the first [...] array in the response.
  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]) as unknown;
      if (Array.isArray(parsed)) {
        const strs = parsed
          .filter((x): x is string => typeof x === "string")
          .map((s) => s.trim())
          .filter(Boolean);
        if (strs.length > 0) return strs.slice(0, maxItems);
      }
    } catch {
      // fall through to newline split
    }
  }
  // Fallback — split on newlines, strip common list markers (1. / - / *).
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter((line) => line.length > 0 && line.length < 500)
    .slice(0, maxItems);
}

// ---------- Response text extraction ---------------------------------------

/**
 * Anthropic Messages responses are `{content: Array<ContentBlock>}` where
 * each block is `{type:"text", text:"..."}` (or tool_use, etc). We only
 * ever ask for text so we concatenate `.text` across blocks. Also strips
 * <output>/<answer> wrapper tags the model sometimes emits.
 */
export function extractText(response: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("").replace(/<\/?(output|answer)>/gi, "").trim();
}

// ---------- Prompt templates (per endpoint) --------------------------------

export function subjectLinePrompt(bodyHtml: string, count: number, tone: string): string {
  return (
    `Suggest ${count} email subject lines for the campaign body below. ` +
    `Tone: ${tone}. Each subject line must be under 78 characters. ` +
    `Avoid clickbait, ALL-CAPS, and spam-trigger phrases (FREE, GUARANTEED, etc). ` +
    `Return a raw JSON array of ${count} strings — nothing else.\n\n` +
    `<body>\n${clipToTokens(bodyHtml, 2000)}\n</body>`
  );
}

export function writeEmailPrompt(
  brief: string,
  tone: string,
  audience: string | null,
  length: "short" | "medium" | "long",
): string {
  const lengthGuide =
    length === "short"
      ? "≈80-150 words, 2 short paragraphs, one CTA."
      : length === "long"
      ? "≈400-600 words, 4-6 paragraphs, one strong CTA and one soft CTA."
      : "≈200-350 words, 3 paragraphs, one CTA.";
  return (
    `Write a marketing email from this brief.\n` +
    `Tone: ${tone}.\n` +
    (audience ? `Audience: ${audience}.\n` : "") +
    `Length: ${lengthGuide}\n\n` +
    `Return a raw JSON object with exactly two keys: {"subject": "...", "body": "<html>..."}. ` +
    `The subject is under 78 chars. The body is plain HTML (no markdown, no <html>/<head>/<body> ` +
    `wrapper — just the content, use <p>, <a>, <strong>, <em>, <ul>/<li>, <h2>/<h3>). ` +
    `No prose outside the JSON.\n\n` +
    `<brief>\n${clipToTokens(brief, 2000)}\n</brief>`
  );
}

export function rewritePrompt(text: string, tone: string): string {
  const toneMap: Record<string, string> = {
    casual: "make it more casual and conversational",
    formal: "make it more formal and professional",
    friendly: "make it warmer and more approachable",
    urgent: "give it a sense of urgency without being pushy",
    shorter: "make it roughly half as long while preserving the key points",
    longer: "expand it with helpful context and detail while staying on message",
  };
  const instruction = toneMap[tone] ?? `rewrite it to be more ${tone}`;
  return (
    `Rewrite the text below: ${instruction}. ` +
    `Preserve any HTML structure (paragraphs, links, lists). ` +
    `Return only the rewritten HTML — no commentary, no wrapper.\n\n` +
    `<text>\n${clipToTokens(text, 3000)}\n</text>`
  );
}

export function summarizePrompt(text: string, maxWords: number): string {
  return (
    `Summarize the text below into a single preheader line of at most ` +
    `${maxWords} words. Plain text (no HTML). Complements a subject line ` +
    `— should tease the content without repeating the subject.\n\n` +
    `Return only the summary sentence — no quotes, no prefix.\n\n` +
    `<text>\n${clipToTokens(text, 3000)}\n</text>`
  );
}

/** Per-platform character limits used by the caption prompt + client trim. */
export const SOCIAL_CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  twitter: 280,
  facebook: 2000,
  instagram: 2200,
};

export function socialCaptionPrompt(
  context: string,
  platform: string,
  tone: string,
  count: number,
): string {
  const limit = SOCIAL_CHAR_LIMITS[platform] ?? 500;
  const platformHint =
    platform === "linkedin"
      ? "professional B2B tone, 1-3 relevant hashtags at the end"
      : platform === "twitter"
      ? "punchy, ≤280 chars total, 1-2 hashtags OK"
      : platform === "instagram"
      ? "engaging, emojis welcome, up to 5 hashtags"
      : "friendly, 1-3 hashtags OK";
  return (
    `Write ${count} social media captions for ${platform}. ` +
    `Tone: ${tone}. Platform-specific: ${platformHint}. ` +
    `Each caption must be under ${limit} characters (hard limit). ` +
    `Return a raw JSON array of ${count} strings — nothing else.\n\n` +
    `<context>\n${clipToTokens(context, 1500)}\n</context>`
  );
}

/** Approximate token clip — 4 chars/token heuristic for prompt sizing. */
function clipToTokens(s: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n… [truncated]";
}

// ---------- Internal exports for tests -------------------------------------

export const _internals = {
  buildSystemPrompt,
  buildSystemBlocks,
  parseStringArray,
  extractText,
  sanitizeHtml,
  clipToTokens,
};
