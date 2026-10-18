// Thin HTTP client that hits Lumaara's existing REST services.
//
// One MCP server process fronts every module — auth-service handles login +
// tenant lookups, and each business service (accounting, crm, hr, stock,
// projects) exposes its own resource routes. We keep per-service base URLs
// so a deployment can route through per-service ingress if desired.
//
// The JWT is passed via the constructor rather than kept in module state,
// so each Session in http-server.ts can own its own client (per-connection
// auth). For stdio (single-user local Claude Desktop), main() constructs a
// single client at startup.

export interface LumaaraConfig {
  authUrl: string;
  accountingUrl: string;
  stockUrl: string;
  crmUrl: string;
  hrUrl: string;
  projectsUrl: string;
}

export function loadConfigFromEnv(): LumaaraConfig {
  return {
    authUrl:       process.env.LUMAARA_AUTH_URL       ?? "http://localhost:4101",
    accountingUrl: process.env.LUMAARA_ACCOUNTING_URL ?? "http://localhost:4102",
    stockUrl:      process.env.LUMAARA_STOCK_URL      ?? "http://localhost:4103",
    crmUrl:        process.env.LUMAARA_CRM_URL        ?? "http://localhost:4104",
    hrUrl:         process.env.LUMAARA_HR_URL         ?? "http://localhost:4105",
    projectsUrl:   process.env.LUMAARA_PROJECTS_URL   ?? "http://localhost:4106",
  };
}

// Every business resource lives in exactly one service. This map keeps that
// mapping in one place so tools.ts can just declare `service: "accounting"`
// and doesn't need to know URLs.
export type ServiceName =
  | "auth" | "accounting" | "stock" | "crm" | "hr" | "projects";

export class LumaaraClient {
  constructor(
    private readonly config: LumaaraConfig,
    private jwt: string | null = null,
  ) {}

  setJwt(jwt: string | null) { this.jwt = jwt; }
  getJwt(): string | null { return this.jwt; }
  hasJwt(): boolean { return !!this.jwt; }

  private baseFor(service: ServiceName): string {
    switch (service) {
      case "auth":       return this.config.authUrl;
      case "accounting": return this.config.accountingUrl;
      case "stock":      return this.config.stockUrl;
      case "crm":        return this.config.crmUrl;
      case "hr":         return this.config.hrUrl;
      case "projects":   return this.config.projectsUrl;
    }
  }

  async request<T = unknown>(
    service: ServiceName,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> {
    const url = new URL(this.baseFor(service) + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.jwt) headers.authorization = `Bearer ${this.jwt}`;

    const res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      // MCP tool calls can be long (report generation, batch queries), so
      // 60s. Without this a hung downstream would starve MCP sessions.
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    const data = text ? tryJson(text) : null;

    if (!res.ok) {
      const err =
        (data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : null) ??
        `${res.status} ${res.statusText}: ${text.slice(0, 200)}`;
      throw new LumaaraApiError(err, res.status);
    }
    return data as T;
  }
}

function tryJson(t: string): unknown {
  try { return JSON.parse(t); } catch { return t; }
}

export class LumaaraApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "LumaaraApiError";
  }
}
