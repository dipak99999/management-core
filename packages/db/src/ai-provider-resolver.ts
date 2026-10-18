// Unified AI-provider resolution.
//
// Both AI surfaces — the Q&A chat endpoint (ai-chat.ts) AND the agent
// planner (agents.ts) — now resolve their LLM from the SAME chain:
//
//   1. Tenant's own TenantIntegration (anthropic / openai / brew)
//   2. PlatformAiProvider isDefault=true + isActive=true
//   3. PlatformAiProvider isActive=true (first by priority)
//   4. process.env fallback (dev only)
//   5. Stub (last resort — safe degradation)
//
// Operators configure ONE provider at /admin/super/ai-providers and both
// surfaces light up. Swapping between Claude / OpenAI / Brew / Azure /
// Ollama is a one-click flip in the UI; no code change, no restart.
//
// This file sits BETWEEN the already-shipped resolveChatProvider (which
// returns a free-form chat surface) and the agent planner (which needs
// structured output). Both are now backed by the same configuration row.

import type { LLMRouter } from "./llm-router";
import { LLMRouter as LLMRouterClass } from "./llm-router";
import type { ProviderSecrets } from "./llm-providers";
import { prisma } from "./index";
import { decryptSecrets } from "./secrets-crypto";

// Pick the single best configured provider for this tenant + build an
// LLMRouter around it. The router's job is to call .call() with a JSON
// response schema and get back parsed structured output; that's what the
// agent planner (planTask) expects.
//
// Returns a router that falls back to the `stub` provider when nothing
// is configured, so the agent system remains functional (just dumber)
// in a fresh install.
export async function resolveAgentRouter(tenantId: string): Promise<LLMRouter> {
  // ── 1. Tenant's own LLM config (older LLMRouter integration pattern) ──
  const tenantRouter = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "LLMRouter", isActive: true },
  });
  if (tenantRouter) {
    try {
      const secrets = decryptSecrets(tenantRouter.secrets as never);
      return new LLMRouterClass(
        {
          defaultProvider: (secrets.defaultProvider as ProviderSecrets["provider"]) ?? "stub",
          providers: secrets.providers as never,
          routes: secrets.routes as never,
          fallback: (secrets.fallback as ProviderSecrets["provider"][]) ?? ["stub"],
        },
        undefined,
        tenantId,
      );
    } catch {
      // bad ciphertext — fall through
    }
  }

  // ── 2. Tenant's own single-provider integration (anthropic/openai/brew) ──
  const singleTenant = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      isActive: true,
      provider: { in: ["Anthropic", "anthropic", "OpenAI", "openai", "Brew", "brew", "brewai", "BrewAI"] },
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (singleTenant) {
    const built = buildRouterFromIntegration(singleTenant, tenantId);
    if (built) return built;
  }

  // ── 3. PlatformAiProvider (super-admin configured) ──
  const platform = await prisma.platformAiProvider.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { priority: "asc" }, { updatedAt: "desc" }],
  });
  if (platform) {
    const built = buildRouterFromPlatform(platform, tenantId);
    if (built) return built;
  }

  // ── 4. Env fallback (dev only) ──
  if (process.env.NODE_ENV !== "production") {
    if (process.env.ANTHROPIC_API_KEY) {
      return new LLMRouterClass(
        {
          defaultProvider: "anthropic",
          providers: {
            anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
          },
          fallback: ["stub"],
        },
        undefined,
        tenantId,
      );
    }
    if (process.env.OPENAI_API_KEY) {
      return new LLMRouterClass(
        {
          defaultProvider: "openai",
          providers: {
            openai: { apiKey: process.env.OPENAI_API_KEY },
          },
          fallback: ["stub"],
        },
        undefined,
        tenantId,
      );
    }
  }

  // ── 5. Last resort — stub. Agent still works (picks tools by keyword
  //        match), just without LLM-driven planning. ──
  return new LLMRouterClass(
    { defaultProvider: "stub", fallback: [] },
    undefined,
    tenantId,
  );
}

function canonicalProvider(raw: string): ProviderSecrets["provider"] | null {
  const s = raw.trim().toLowerCase();
  if (s === "anthropic" || s === "claude") return "anthropic";
  if (s === "openai") return "openai";
  if (s === "brew" || s === "brewai") return "brew";
  if (s === "azure-openai" || s === "azure") return "azure-openai";
  if (s === "ollama") return "ollama";
  return null;
}

interface IntegrationLike {
  provider: string;
  config?: unknown;
  secrets: unknown;
}

function buildRouterFromIntegration(
  row: IntegrationLike,
  tenantId: string,
): LLMRouter | null {
  const kind = canonicalProvider(row.provider);
  if (!kind) return null;
  try {
    const secrets = decryptSecrets(row.secrets as never);
    const config = (row.config ?? {}) as Record<string, unknown>;
    const apiKey = typeof secrets.apiKey === "string" ? secrets.apiKey : undefined;
    const baseUrl =
      typeof secrets.baseUrl === "string" ? secrets.baseUrl :
      typeof config.baseUrl === "string" ? config.baseUrl : undefined;
    const defaultModel =
      typeof secrets.defaultModel === "string" ? secrets.defaultModel :
      typeof config.defaultModel === "string" ? config.defaultModel : undefined;
    if (!apiKey && kind !== "ollama") return null;
    return new LLMRouterClass(
      {
        defaultProvider: kind,
        providers: { [kind]: { apiKey, baseUrl, defaultModel } } as never,
        fallback: ["stub"],
      },
      undefined,
      tenantId,
    );
  } catch {
    return null;
  }
}

interface PlatformRow {
  provider: string;
  defaultModel: string | null;
  baseUrl: string | null;
  secrets: unknown;
}

function buildRouterFromPlatform(
  row: PlatformRow,
  tenantId: string,
): LLMRouter | null {
  const kind = canonicalProvider(row.provider);
  if (!kind) return null;
  try {
    const secrets = decryptSecrets(row.secrets as never);
    const apiKey = typeof secrets.apiKey === "string" ? secrets.apiKey : undefined;
    if (!apiKey && kind !== "ollama") return null;
    return new LLMRouterClass(
      {
        defaultProvider: kind,
        providers: {
          [kind]: {
            apiKey,
            baseUrl: row.baseUrl ?? undefined,
            defaultModel: row.defaultModel ?? undefined,
          },
        } as never,
        fallback: ["stub"],
      },
      undefined,
      tenantId,
    );
  } catch {
    return null;
  }
}
