// Pluggable AI surface discovery.
//
// `GET /ai/manifest` returns a single JSON describing every entrypoint
// an AI client (ChatGPT plugin, Claude Desktop, Brew, a custom bot) needs
// to drive the Lumaara AI stack:
//
//   - Chat Q&A endpoint (RAG-backed, streaming)
//   - Agent task endpoint (tool-calling MCP coworker, streaming via SSE)
//   - MCP tool catalog
//   - Currently-resolved provider (so clients see WHICH LLM is live)
//
// Also exposes an unauthed `GET /.well-known/mcp.json` for the de-facto
// MCP server discovery convention — clients hit the root to find out
// where tools + chat live without reading docs.
//
// The point: swap OpenAI → Claude → Brew at /admin/super/ai-providers
// and this manifest's `resolvedProvider` + the behaviour of every
// endpoint change. No code touches, no client re-config.

import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const aiManifestRouter = Router();

async function resolvedProvider(tenantId: string): Promise<{
  source: "tenant" | "platform" | "env" | "stub";
  kind: string;
  model: string | null;
}> {
  // Mirror the resolution chain in resolveChatProvider / resolveAgentRouter
  // just for reporting — never dereferences a secret.
  const tenantRow = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      isActive: true,
      provider: { in: ["Anthropic", "anthropic", "OpenAI", "openai", "Brew", "brew", "BrewAI", "brewai", "LLMRouter"] },
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { provider: true, config: true },
  });
  if (tenantRow) {
    const config = (tenantRow.config ?? {}) as Record<string, unknown>;
    return {
      source: "tenant",
      kind: tenantRow.provider.toLowerCase(),
      model: typeof config.defaultModel === "string" ? config.defaultModel : null,
    };
  }
  const platform = await prisma.platformAiProvider.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { priority: "asc" }],
    select: { provider: true, defaultModel: true },
  });
  if (platform) {
    return { source: "platform", kind: platform.provider, model: platform.defaultModel };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { source: "env", kind: "anthropic", model: null };
  }
  if (process.env.OPENAI_API_KEY) {
    return { source: "env", kind: "openai", model: null };
  }
  return { source: "stub", kind: "stub", model: null };
}

// Authed per-tenant manifest. Carries live provider state + the exact
// endpoints to call.
aiManifestRouter.get("/manifest", requireAuth, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const provider = await resolvedProvider(tenantId);
  const base = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  res.json({
    name: "Lumaara AI",
    version: "1",
    tenantId,
    resolvedProvider: provider,
    endpoints: {
      // Q&A — short-form answers grounded in tenant data via RAG.
      // Supports streaming SSE when the client prefers progressive output.
      chat: { path: "/ai/chat", method: "POST", streaming: false },
      chatStream: { path: "/ai/chat/stream", method: "POST", streaming: "sse" },
      // Agent coworker — long-running task that picks + executes MCP tools.
      // The create → run → events trio drives the full lifecycle.
      agentCreate: { path: "/agents/tasks", method: "POST", description: "Create a goal-driven task" },
      agentRun: { path: "/agents/tasks/:id/run", method: "POST" },
      agentEvents: {
        path: "/agents/tasks/:id/events",
        method: "GET",
        streaming: "sse",
        authQueryParam: "access_token",
      },
      // Tool discovery.
      toolCatalog: { path: "/agents/tool-catalog", method: "GET" },
    },
    publicBaseUrl: base || null,
    // Which authentication the client uses. Bearer-JWT for programmatic
    // callers; EventSource endpoints also accept `?access_token=`.
    auth: { type: "bearer", bearerFormat: "JWT" },
  });
});

// Unauthed well-known discovery doc. Convention-compliant minimal MCP
// server descriptor. Does NOT leak tenant state — just tells clients
// where to go.
export const wellKnownMcpRouter = Router();
wellKnownMcpRouter.get("/mcp.json", (_req, res) => {
  const base = (process.env.PUBLIC_API_URL ?? "").replace(/\/$/, "");
  res.json({
    name: "Lumaara",
    version: "1",
    // Protocol hints — Lumaara MCP uses HTTP+JSON for discovery and SSE
    // for the agent event stream. Clients that prefer stdio can run
    // `mcp-server --stdio` from services/mcp-server for a Claude Desktop
    // / editor integration.
    protocols: ["http+json", "sse"],
    // Where to find each surface. These URLs are relative so the client
    // picks up whatever host it discovered the manifest on.
    endpoints: {
      manifest: "/ai/manifest",
      chat: "/ai/chat",
      chatStream: "/ai/chat/stream",
      agent: {
        create: "/agents/tasks",
        run: "/agents/tasks/:id/run",
        events: "/agents/tasks/:id/events",
        toolCatalog: "/agents/tool-catalog",
      },
    },
    // AI providers the operator CAN configure for this installation.
    // Clients can show "powered by X" or expose provider choice to end
    // users where appropriate.
    supportedProviders: ["anthropic", "openai", "brew", "azure-openai", "ollama"],
    docs: base ? `${base}/openapi.json` : null,
  });
});
