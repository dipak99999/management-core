// Real HTTP integration test for the MCP tools layer.
//
// mcp-server doesn't touch the DB — it proxies MCP tool calls over HTTP to
// the other services. So "real integration" here is a real HTTP round-trip
// (not a mocked fetch): boot a fake accounting-service on an ephemeral port,
// point a LumaaraClient at it, invoke the `list_customers` tool, verify:
//
//   1. The tool call actually issues an HTTP request (not a mock).
//   2. The JWT is forwarded on the Authorization header — mcp-server's whole
//      job is per-session auth propagation; a regression here would silently
//      drop credentials.
//   3. The dispatched request lands at the right method + path.
//   4. Tenant isolation is preserved end-to-end: a client with tenant-A's
//      JWT never sees tenant-B's rows returned by the fake backend.

import { AddressInfo } from "node:net";
import express, { type Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LumaaraClient, type LumaaraConfig } from "./lumaara-client";
import { buildTools } from "./tools";

// Fake accounting-service: returns tenant-scoped rows based on the JWT string.
// Real production would decode a signed JWT; here we treat the token literal
// as the tenant identifier since the test's only concern is the transport
// layer forwarding the header correctly.
const FIXTURES = {
  "tenant-A-jwt": [
    { id: "c1", customerName: "Acme (A)", tenantId: "tenant-A" },
    { id: "c2", customerName: "Globex (A)", tenantId: "tenant-A" },
  ],
  "tenant-B-jwt": [{ id: "c3", customerName: "Initech (B)", tenantId: "tenant-B" }],
} as const;

const receivedRequests: { method: string; path: string; auth: string | undefined }[] = [];

let server: import("http").Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.get("/customers", (req: Request, res) => {
    const auth = req.header("authorization");
    receivedRequests.push({ method: req.method, path: req.path, auth });
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    const rows = FIXTURES[token as keyof typeof FIXTURES] ?? [];
    res.json(rows);
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makeClient(jwt: string): LumaaraClient {
  const cfg: LumaaraConfig = {
    authUrl: baseUrl,
    accountingUrl: baseUrl,
    stockUrl: baseUrl,
    crmUrl: baseUrl,
    hrUrl: baseUrl,
    projectsUrl: baseUrl,
  };
  return new LumaaraClient(cfg, jwt);
}

function findTool(name: string) {
  const tool = buildTools().find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

describe("MCP list_customers (real HTTP)", () => {
  it("dispatches GET /customers with the client's JWT (tenant A view)", async () => {
    const before = receivedRequests.length;
    const client = makeClient("tenant-A-jwt");
    const tool = findTool("list_customers");
    const result = (await tool.handler({}, client)) as { customerName: string }[];

    // Request landed on the fake backend with the right shape + auth.
    expect(receivedRequests.length).toBe(before + 1);
    const last = receivedRequests[receivedRequests.length - 1];
    expect(last.method).toBe("GET");
    expect(last.path).toBe("/customers");
    expect(last.auth).toBe("Bearer tenant-A-jwt");

    // Response came back through LumaaraClient unmodified.
    const names = result.map((r) => r.customerName).sort();
    expect(names).toEqual(["Acme (A)", "Globex (A)"]);
    expect(names).not.toContain("Initech (B)");
  });

  it("returns tenant B's rows when authed as tenant B — no cross-tenant leak", async () => {
    const client = makeClient("tenant-B-jwt");
    const tool = findTool("list_customers");
    const result = (await tool.handler({}, client)) as { customerName: string }[];
    const names = result.map((r) => r.customerName);
    expect(names).toEqual(["Initech (B)"]);
    expect(names).not.toContain("Acme (A)");
    expect(names).not.toContain("Globex (A)");
  });

  it("propagates upstream 401 as LumaaraApiError with the status preserved", async () => {
    // Extra route that always 401s — the client should surface the status so
    // the LLM knows to prompt for re-login rather than pretending it worked.
    const app2 = express();
    app2.get("/customers", (_req, res) => res.status(401).json({ error: "expired" }));
    const s2 = app2.listen(0);
    const port = (s2.address() as AddressInfo).port;
    try {
      const cfg: LumaaraConfig = {
        authUrl: "http://x",
        accountingUrl: `http://127.0.0.1:${port}`,
        stockUrl: "http://x",
        crmUrl: "http://x",
        hrUrl: "http://x",
        projectsUrl: "http://x",
      };
      const client = new LumaaraClient(cfg, "any-jwt");
      const tool = findTool("list_customers");
      await expect(tool.handler({}, client)).rejects.toMatchObject({
        status: 401,
        message: "expired",
      });
    } finally {
      await new Promise<void>((resolve) => s2.close(() => resolve()));
    }
  });
});
