// Real-DB coverage for /search global doc search.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-srch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { searchRouter } = await import("./search");
  const app = express();
  app.use(express.json());
  app.use("/search", searchRouter);
  return app;
}

let tenantAId: string;
let tenantBId: string;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  const past = new Date(Date.now() - 60_000);
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: `A ${suiteId}`, slug: `a-${suiteId}` } }),
    prisma.tenant.create({ data: { name: `B ${suiteId}`, slug: `b-${suiteId}` } }),
  ]);
  tenantAId = a.id;
  tenantBId = b.id;
  const pw = await bcrypt.hash("x", 4);
  const [ua, ub] = await Promise.all([
    prisma.user.create({
      data: { tenantId: a.id, email: `a-${suiteId}@x.com`, passwordHash: pw, fullName: "A", role: "admin", emailVerifiedAt: new Date(), tokenEpoch: past },
    }),
    prisma.user.create({
      data: { tenantId: b.id, email: `b-${suiteId}@x.com`, passwordHash: pw, fullName: "B", role: "admin", emailVerifiedAt: new Date(), tokenEpoch: past },
    }),
  ]);
  tokenA = jwt.sign({ userId: ua.id, tenantId: a.id, email: ua.email, role: "admin", roles: [] }, JWT_SECRET, { expiresIn: "1h" });
  tokenB = jwt.sign({ userId: ub.id, tenantId: b.id, email: ub.email, role: "admin", roles: [] }, JWT_SECRET, { expiresIn: "1h" });

  // Tenant A has a customer, supplier, item. Tenant B has one customer
  // with the same searchable prefix — must NOT appear in A's results.
  await prisma.customer.create({
    data: { tenantId: a.id, customerName: `Acme-${suiteId} Industries`, customerGroup: "Enterprise" },
  });
  await prisma.supplier.create({
    data: { tenantId: a.id, supplierName: `Acme-${suiteId} Vendor`, supplierGroup: "Preferred" },
  });
  await prisma.item.create({
    data: { tenantId: a.id, itemCode: `ACME-${suiteId}`, itemName: `Acme ${suiteId} Widget`, stockUom: "Nos", isStockItem: true },
  });
  await prisma.customer.create({
    data: { tenantId: b.id, customerName: `Acme-${suiteId} CrossTenant`, customerGroup: "Enterprise" },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prisma.$disconnect();
});

describe("search", () => {
  it("returns an empty array for empty q", async () => {
    const app = await buildApp();
    const r = await request(app).get("/search?q=").set("authorization", `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("returns matching customers + suppliers + items", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/search?q=${encodeURIComponent(suiteId)}`)
      .set("authorization", `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    const types = new Set((r.body as Array<{ doctype: string }>).map((h) => h.doctype));
    expect(types.has("Customer")).toBe(true);
    expect(types.has("Supplier")).toBe(true);
    expect(types.has("Item")).toBe(true);
  });

  it("isolates per-tenant: tenant A does not see tenant B's customer", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/search?q=${encodeURIComponent(suiteId)}`)
      .set("authorization", `Bearer ${tokenA}`);
    const customerTitles = (r.body as Array<{ doctype: string; title: string }>)
      .filter((h) => h.doctype === "Customer")
      .map((h) => h.title);
    expect(customerTitles).not.toContain(`Acme-${suiteId} CrossTenant`);
    // Tenant B gets only their own match.
    const rb = await request(app)
      .get(`/search?q=${encodeURIComponent(suiteId)}`)
      .set("authorization", `Bearer ${tokenB}`);
    const customerTitlesB = (rb.body as Array<{ doctype: string; title: string }>)
      .filter((h) => h.doctype === "Customer")
      .map((h) => h.title);
    expect(customerTitlesB).toContain(`Acme-${suiteId} CrossTenant`);
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const r = await request(app).get("/search?q=anything");
    expect(r.status).toBe(401);
  });
});
