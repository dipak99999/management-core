// Real-DB coverage for /preview/:doctype/:id. One case per supported
// doctype, plus the unsupported-doctype 404 and the cross-tenant 404.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-prev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { previewRouter } = await import("./preview");
  const app = express();
  app.use(express.json());
  app.use("/preview", previewRouter);
  return app;
}

let tenantAId: string;
let tenantBId: string;
let userToken: string;
let userBToken: string;
let customerId: string;
let itemId: string;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: `A ${suiteId}`, slug: `a-${suiteId}` } }),
    prisma.tenant.create({ data: { name: `B ${suiteId}`, slug: `b-${suiteId}` } }),
  ]);
  tenantAId = a.id;
  tenantBId = b.id;
  const pw = await bcrypt.hash("x", 4);
  const past = new Date(Date.now() - 60_000);
  const [ua, ub] = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: `prev-a-${suiteId}@example.com`,
        passwordHash: pw,
        fullName: "A",
        role: "admin",
        emailVerifiedAt: new Date(),
        tokenEpoch: past,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: `prev-b-${suiteId}@example.com`,
        passwordHash: pw,
        fullName: "B",
        role: "admin",
        emailVerifiedAt: new Date(),
        tokenEpoch: past,
      },
    }),
  ]);
  userToken = jwt.sign(
    { userId: ua.id, tenantId: tenantAId, email: ua.email, role: "admin", roles: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  userBToken = jwt.sign(
    { userId: ub.id, tenantId: tenantBId, email: ub.email, role: "admin", roles: [] },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
  const [c, it] = await Promise.all([
    prisma.customer.create({
      data: {
        tenantId: tenantAId,
        customerName: `Acme ${suiteId}`,
        customerGroup: "Enterprise",
        territory: "APAC",
      },
    }),
    prisma.item.create({
      data: {
        tenantId: tenantAId,
        itemCode: `IT-${suiteId}`,
        itemName: `Widget ${suiteId}`,
        stockUom: "Nos",
        isStockItem: true,
      },
    }),
  ]);
  customerId = c.id;
  itemId = it.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prisma.$disconnect();
});

describe("GET /preview/:doctype/:id", () => {
  it("Customer: returns title + rows", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/preview/Customer/${customerId}`)
      .set("authorization", `Bearer ${userToken}`);
    expect(r.status).toBe(200);
    expect(r.body.title).toBe(`Acme ${suiteId}`);
    expect(r.body.subtitle).toBe("Enterprise");
    expect(r.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Type" }),
        expect.objectContaining({ label: "Territory", value: "APAC" }),
      ]),
    );
    expect(r.body.href).toBe(`/sales/customers/${customerId}`);
  });

  it("Item: returns title + rows", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/preview/Item/${itemId}`)
      .set("authorization", `Bearer ${userToken}`);
    expect(r.status).toBe(200);
    expect(r.body.title).toBe(`Widget ${suiteId}`);
    expect(r.body.subtitle).toBe(`IT-${suiteId}`);
    expect(r.body.rows).toContainEqual({ label: "UOM", value: "Nos" });
    expect(r.body.rows).toContainEqual({ label: "Stock item", value: "Yes" });
  });

  it("404s for cross-tenant access", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/preview/Customer/${customerId}`)
      .set("authorization", `Bearer ${userBToken}`);
    expect(r.status).toBe(404);
  });

  it("404s for unsupported doctypes", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/preview/Nonexistent/${customerId}`)
      .set("authorization", `Bearer ${userToken}`);
    expect(r.status).toBe(404);
  });

  it("401s without auth", async () => {
    const app = await buildApp();
    const r = await request(app).get(`/preview/Customer/${customerId}`);
    expect(r.status).toBe(401);
  });
});
