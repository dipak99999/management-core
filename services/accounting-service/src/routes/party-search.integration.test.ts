// Real-DB integration test for the party-search router. Unlike the standard
// list-endpoint tests, this one is a search endpoint: `?q=<name>` is required
// (min 2 chars) and returns an envelope `{ customers, suppliers, leads }`.
// Different shape, but the tenant-isolation guarantee is the same — a search
// authed as tenant A must never see tenant B's parties even if the query
// string matches theirs.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-psa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: currentTenantId,
      userId: "user-test",
    };
    next();
  };
  return {
    ...actual,
    perms: () => ({
      read: pass, write: pass, create: pass, delete: pass, submit: pass, cancel: pass,
    }),
  };
});

async function buildApp() {
  const { partySearchRouter } = await import("./party-search");
  const app = express();
  app.use(express.json());
  app.use("/party-search", partySearchRouter);
  return app;
}

// Both tenants have a customer whose name contains "PartyProbe" — the search
// must return the caller's tenant's row and never the other's.
const PROBE = `PartyProbe-${suiteId}`;

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  await prisma.customer.createMany({
    data: [
      { tenantId: tenantA.id, customerName: `${PROBE}-A` },
      { tenantId: tenantB.id, customerName: `${PROBE}-B` },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

// Response is a flat array of `{ partyType, id, label, ... }`; the router
// merges customer/supplier/lead hits into one list.
interface PartyHit {
  partyType: "Customer" | "Supplier" | "Lead";
  id: string;
  label: string;
}

describe("GET /party-search (real DB, query-scoped)", () => {
  it("returns only tenant A's matches for the shared probe query", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get(`/party-search?q=${encodeURIComponent(PROBE)}`);
    expect(res.status).toBe(200);
    const labels = (res.body as PartyHit[]).map((p) => p.label);
    expect(labels).toContain(`${PROBE}-A`);
    expect(labels).not.toContain(`${PROBE}-B`);
  });

  it("returns only tenant B's matches for the shared probe query", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get(`/party-search?q=${encodeURIComponent(PROBE)}`);
    expect(res.status).toBe(200);
    const labels = (res.body as PartyHit[]).map((p) => p.label);
    expect(labels).toContain(`${PROBE}-B`);
    expect(labels).not.toContain(`${PROBE}-A`);
  });

  it("returns empty for queries under 2 chars (validation guard)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/party-search?q=a");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
