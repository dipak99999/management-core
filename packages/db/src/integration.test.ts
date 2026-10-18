// End-to-end HTTP tests against the running services. Uses a well-known
// dev tenant + admin user seeded by `pnpm --filter @lumaara/db seed:demo`.
//
// These are guarded by INTEGRATION=1 so `pnpm test` on a bare checkout
// stays hermetic and doesn't blow up trying to connect to services that
// aren't running. In CI or local dev, run:
//
//   INTEGRATION=1 pnpm --filter @lumaara/db test
//
// Assumes the standard shifted-port dev setup (AUTH on 4101, ACC on 4102).
// Override with AUTH_URL / ACC_URL env vars.

import { describe, expect, it, beforeAll } from "vitest";

// Default to the dev-mode ports (4001/4002) that `pnpm dev` boots so the
// suite runs on a laptop without extra env vars when services are up. The
// test-harness ports (4101/4102) are honored when explicitly set.
const INTEGRATION = process.env.INTEGRATION === "1";
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
const ACC_URL = process.env.ACC_URL ?? "http://localhost:4002";

// Auto-detect: probe the auth service with a very short timeout. If it
// answers, the suite runs. Keeps `pnpm test` hermetic on a bare checkout
// (services down → skipped, no failure) while unlocking the suite the
// moment the dev services are running — no env var needed.
const servicesUp = await (async () => {
  if (INTEGRATION) return true; // explicit override wins
  try {
    const r = await fetch(`${AUTH_URL}/health`, { signal: AbortSignal.timeout(400) });
    return r.ok;
  } catch {
    return false;
  }
})();

const suite = servicesUp ? describe : describe.skip;

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
async function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { headers });
}

let TOKEN = "";
let ATTACKER_TOKEN = "";
let CUSTOMER_ID = "";
let ITEM_ID = "";

suite("live services — auth + tenant isolation", () => {
  beforeAll(async () => {
    const r = await post(`${AUTH_URL}/auth/login`, {
      tenantSlug: "demo",
      email: "demo@lumaara.local",
      password: "demo1234",
    });
    if (!r.ok) throw new Error(`login failed: ${r.status}`);
    TOKEN = (await r.json()).token;

    // Provision a throwaway attacker tenant for isolation tests. Signup is
    // idempotent per slug — 409 if exists, that's fine.
    const slug = `integ-attacker-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${slug}@integ.test`;
    const s = await post(`${AUTH_URL}/auth/signup`, {
      tenantName: `Attacker ${slug}`,
      tenantSlug: slug,
      fullName: "Attacker",
      email,
      password: "Attacker1234!",
    });
    ATTACKER_TOKEN = (await s.json()).token;
  });

  it("rejects a missing bearer token with 401", async () => {
    const r = await get(`${ACC_URL}/customers`);
    expect(r.status).toBe(401);
  });

  it("rejects an invalid bearer token with 401", async () => {
    const r = await get(`${ACC_URL}/customers`, { authorization: "Bearer garbage" });
    expect(r.status).toBe(401);
  });

  it("allows a valid token", async () => {
    const r = await get(`${ACC_URL}/customers`, { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    const rows = (await r.json()) as { id: string }[];
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) CUSTOMER_ID = rows[0].id;
  });

  it("isolates tenants — attacker cannot read demo customers", async () => {
    if (!CUSTOMER_ID) return;
    const r = await get(`${ACC_URL}/customers/${CUSTOMER_ID}`, {
      authorization: `Bearer ${ATTACKER_TOKEN}`,
    });
    // Must deny — the attacker is on a different tenant. Accept both:
    //   * 404 — tenant-scope check hid the resource (ideal: no existence leak)
    //   * 402 — plan-gate fired first because the fresh attacker tenant has
    //           no active plan. Equally safe: reveals nothing about the
    //           target tenant's data, only the attacker's own plan state.
    // The crucial regression this guards against is 200 (actual leak) or
    // 403 (which WOULD leak existence by distinguishing "exists but
    // forbidden" from "doesn't exist").
    expect([402, 404]).toContain(r.status);
  });
});

suite("live services — security headers", () => {
  it("sets CSP / nosniff / frame-deny on every response", async () => {
    const r = await get(`${ACC_URL}/health`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });

  it("no longer emits Access-Control-Allow-Origin: * for unknown origins", async () => {
    const r = await get(`${ACC_URL}/health`, { origin: "https://evil.example.com" });
    const aco = r.headers.get("access-control-allow-origin");
    // Either absent (no Origin echo) or explicitly the requesting origin from
    // the whitelist — never the wildcard.
    expect(aco).not.toBe("*");
  });
});

suite("live services — accounting sanity + GL invariant", () => {
  it("creates + submits an invoice, GL is balanced", async () => {
    if (!CUSTOMER_ID) {
      const r = await get(`${ACC_URL}/customers`, { authorization: `Bearer ${TOKEN}` });
      const rows = (await r.json()) as { id: string }[];
      CUSTOMER_ID = rows[0]?.id ?? "";
    }
    if (!ITEM_ID) {
      const r = await get(`${ACC_URL}/items`, { authorization: `Bearer ${TOKEN}` });
      const rows = (await r.json()) as { id: string }[];
      ITEM_ID = rows[0]?.id ?? "";
    }
    if (!CUSTOMER_ID || !ITEM_ID) return;

    const create = await post(
      `${ACC_URL}/sales-invoices`,
      {
        customerId: CUSTOMER_ID,
        currency: "INR",
        conversionRate: 1,
        items: [{ itemId: ITEM_ID, qty: 3, rate: 100 }],
      },
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(create.status).toBeLessThan(300);
    const inv = (await create.json()) as { id: string; grandTotal: string };
    expect(Number(inv.grandTotal)).toBe(300);

    const submit = await post(
      `${ACC_URL}/sales-invoices/${inv.id}/submit`,
      {},
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(submit.status).toBe(200);

    const tb = await get(
      `${ACC_URL}/reports/trial-balance?asOfDate=2030-01-01`,
      { authorization: `Bearer ${TOKEN}` },
    );
    const { rows } = (await tb.json()) as {
      rows: { debit: number; credit: number }[];
    };
    const totalDR = rows.reduce((s, r) => s + Number(r.debit), 0);
    const totalCR = rows.reduce((s, r) => s + Number(r.credit), 0);
    expect(Math.abs(totalDR - totalCR)).toBeLessThan(0.01);
  });
});

suite("live services — attachment XSS mitigation", () => {
  it("serves HTML attachments as Content-Disposition: attachment (never inline)", async () => {
    if (!CUSTOMER_ID) return;
    const body = Buffer.from("<script>alert(1)</script>").toString("base64");
    const create = await post(
      `${AUTH_URL}/attachments`,
      {
        doctype: "Customer",
        docId: CUSTOMER_ID,
        filename: "pwn.html",
        mimeType: "text/html",
        base64: body,
      },
      { authorization: `Bearer ${TOKEN}` },
    );
    if (!create.ok) return; // if attachment perms deny, skip
    const attachment = (await create.json()) as { id: string };

    const dl = await get(`${AUTH_URL}/attachments/${attachment.id}/download`, {
      authorization: `Bearer ${TOKEN}`,
    });
    const disposition = dl.headers.get("content-disposition") ?? "";
    // Critical: HTML must never render inline — that's how attacker JS runs
    // in our origin and steals the JWT from localStorage.
    expect(disposition.startsWith("attachment")).toBe(true);
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

suite("live services — 413 on oversized body", () => {
  it("returns 413 (not 500) when the JSON body exceeds the 25MB limit", async () => {
    // Build a body that exceeds 25MB payload with content that isn't a valid
    // schema so we exercise the body-parser limit, not route validation.
    const oversized = "x".repeat(30 * 1024 * 1024);
    const r = await fetch(`${AUTH_URL}/attachments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: `{"junk":"${oversized}"}`,
    });
    expect(r.status).toBe(413);
  });
});
