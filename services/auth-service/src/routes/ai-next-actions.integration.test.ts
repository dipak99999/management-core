// Real-DB coverage for /ai/next-actions. Rule-based endpoint — asserts
// each doctype branch returns the expected chip set given a known doc
// state, and that cross-tenant lookups return empty.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-nxa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { aiNextActionsRouter } = await import("./ai-next-actions");
  const app = express();
  app.use(express.json());
  app.use("/ai/next-actions", aiNextActionsRouter);
  return app;
}

let tenantAId: string;
let tenantBId: string;
let tokenA: string;
let tokenB: string;
let draftInvoiceId: string;
let openLeadId: string;

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

  const customer = await prisma.customer.create({
    data: { tenantId: a.id, customerName: `Cust ${suiteId}` },
  });
  const inv = await prisma.salesInvoice.create({
    data: {
      tenantId: a.id,
      name: `INV-${suiteId}`,
      customerId: customer.id,
      status: "Draft",
      postingDate: new Date(),
      grandTotal: 100,
      netTotal: 100,
      currency: "INR",
      outstandingAmt: 100,
    },
  });
  draftInvoiceId = inv.id;

  const lead = await prisma.lead.create({
    data: {
      tenantId: a.id,
      name: `LEAD-${suiteId}`,
      leadName: `Lead ${suiteId}`,
      status: "Open",
    },
  });
  openLeadId = lead.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prisma.$disconnect();
});

describe("ai-next-actions", () => {
  it("SalesInvoice (Draft) → surfaces Submit", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .set("authorization", `Bearer ${tokenA}`)
      .send({ doctype: "SalesInvoice", docId: draftInvoiceId });
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("submit");
  });

  it("Lead (Open) → surfaces Convert", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .set("authorization", `Bearer ${tokenA}`)
      .send({ doctype: "Lead", docId: openLeadId });
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("convert");
  });

  it("cross-tenant lookup returns empty", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .set("authorization", `Bearer ${tokenB}`)
      .send({ doctype: "SalesInvoice", docId: draftInvoiceId });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("400 on missing params", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .set("authorization", `Bearer ${tokenA}`)
      .send({});
    expect(r.status).toBe(400);
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .send({ doctype: "SalesInvoice", docId: draftInvoiceId });
    expect(r.status).toBe(401);
  });

  it("unknown doctype returns empty array", async () => {
    const app = await buildApp();
    const r = await request(app)
      .post("/ai/next-actions")
      .set("authorization", `Bearer ${tokenA}`)
      .send({ doctype: "Unknown", docId: "x" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});
