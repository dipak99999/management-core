// Lumaara MCP server entry point.
//
// Two transports:
//   --stdio    Bind stdin/stdout for Claude Desktop / editor integrations.
//              Reads the JWT from LUMAARA_JWT env if present; otherwise the
//              LLM must call the `login` tool first.
//
//   (default)  HTTP + SSE mode for remote LLMs / chatbots. Every session
//              gets its own MCP server + LumaaraClient so JWTs don't leak
//              across users. Endpoints:
//                GET  /sse           → server-sent-events stream (per session)
//                POST /message?sessionId=…
//                                    → client → server messages for that session
//                GET  /health        → liveness
//                GET  /health/ready  → readiness (no downstream deps)
//                GET  /metrics       → Prometheus text exposition
//              Optional `Authorization: Bearer <jwt>` on /sse pre-authenticates
//              the session so tools work immediately.
//
// The HTTP server listens on PORT env (default 4110). In production the
// process expects the standard Lumaara service-auth hardening bundle
// (env validation → crash handlers → basic-ops → graceful shutdown).

// OTel must init before HTTP/express are loaded so auto-instrumentation can
// patch them at require-time. Skipped in --stdio mode: stdout is the MCP
// JSON-RPC transport there, and initOtel writes a startup line to it.
import { initOtel } from "@lumaara/service-auth";
if (!process.argv.includes("--stdio")) initOtel("mcp-server");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("mcp-server");

import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  buildCorsMiddleware,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  mountBasicOps,
  requestLogger,
  securityHeaders,
  validateEnv,
} from "@lumaara/service-auth";
import { LumaaraClient, loadConfigFromEnv } from "./lumaara-client";
import { createLumaaraMcpServer } from "./server";

const SERVICE = "mcp-server";
const log = getLogger(SERVICE);

// Fail fast on missing config. mcp-server has no DB; its only hard
// requirement is knowing how to reach the other services + a signing
// secret it can use to verify Bearer JWTs it forwards to them.
validateEnv({
  required: ["JWT_SECRET"],
  optional: {
    PORT: "4110",
    AUTH_SERVICE_URL: "http://localhost:4001",
    ACCOUNTING_SERVICE_URL: "http://localhost:4002",
    STOCK_SERVICE_URL: "http://localhost:4003",
    CRM_SERVICE_URL: "http://localhost:4004",
    HR_SERVICE_URL: "http://localhost:4005",
    PROJECTS_SERVICE_URL: "http://localhost:4006",
  },
});

installCrashHandlers(SERVICE);

const config = loadConfigFromEnv();

async function runStdio() {
  const client = new LumaaraClient(config, process.env.LUMAARA_JWT ?? null);
  const server = createLumaaraMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr — stdout is the MCP transport channel.
  console.error(
    `[lumaara-mcp] stdio ready ${client.hasJwt() ? "(JWT preloaded)" : "(no JWT — call `login` tool first)"}`,
  );
}

async function runHttp() {
  const app = express();
  app.use(buildCorsMiddleware({ exposedHeaders: ["mcp-session-id"] }));
  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLogger(SERVICE));

  // Track one MCP server + transport per session id. SSEServerTransport
  // generates the session id itself on connect.
  const sessions = new Map<string, { transport: SSEServerTransport }>();

  // Rate-limit /sse session creation and /message posts — a rogue client
  // opening thousands of SSE connections would eat FDs + memory.
  const sseLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many MCP sessions from this IP — try again shortly." },
  });
  const msgLimiter = rateLimit({
    windowMs: 60_000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Standard ops endpoints (/health, /health/ready, /metrics) shared with
  // the rest of the services. Readiness has no downstream deps for the MCP
  // server since it proxies auth/data lookups to other services on demand.
  mountBasicOps(app, SERVICE);

  app.get("/sse", sseLimiter, async (req: Request, res: Response) => {
    // Grab JWT off the SSE handshake so subsequent tool calls are pre-authed.
    const auth = req.header("authorization");
    const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

    const client = new LumaaraClient(config, jwt);
    const server = createLumaaraMcpServer(client);

    const transport = new SSEServerTransport("/message", res);
    sessions.set(transport.sessionId, { transport });

    res.on("close", () => {
      sessions.delete(transport.sessionId);
    });

    await server.connect(transport);
    log.info("mcp session open", {
      sessionId: transport.sessionId,
      authed: Boolean(jwt),
    });
  });

  app.post("/message", msgLimiter, async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "Unknown session id" });
      return;
    }
    // The MCP SDK types its req parameter as IncomingMessage + an MCP-
    // specific `auth?: AuthInfo` field. Our Express Request carries our
    // own `auth?: AuthContext`, which shape-conflicts. The SDK only reads
    // Node's IncomingMessage surface — the `auth` field is ignored here
    // (we JWT-check on /sse instead), so the cast is safe at runtime.
    await session.transport.handlePostMessage(
      req as unknown as Parameters<typeof session.transport.handlePostMessage>[0],
      res,
      req.body,
    );
  });

  const port = Number(process.env.PORT) || 4110;
  const server = app.listen(port, () => {
    log.info("service listening", { port });
    log.info("upstream base URLs", {
      auth: config.authUrl,
      accounting: config.accountingUrl,
      crm: config.crmUrl,
      hr: config.hrUrl,
      stock: config.stockUrl,
      projects: config.projectsUrl,
    });
  });

  // Drain in-flight requests on SIGTERM/SIGINT. installGracefulShutdown
  // closes the HTTP server; also close SSE sessions explicitly since
  // long-poll connections would otherwise hold the port open.
  const closeSessions = async () => {
    for (const [, s] of sessions) {
      try {
        await s.transport.close();
      } catch {
        // best-effort
      }
    }
  };
  process.once("SIGTERM", closeSessions);
  process.once("SIGINT", closeSessions);
  installGracefulShutdown(server, SERVICE, { drainMs: 15_000 });
}

const isStdio = process.argv.includes("--stdio");
(isStdio ? runStdio() : runHttp()).catch((e) => {
  log.error("fatal boot error", { message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
