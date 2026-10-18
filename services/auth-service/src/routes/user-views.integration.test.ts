// Real-DB coverage for /user-views (per-user saved filter sets).
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-uv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { userViewRouter } = await import("./user-views");
  const app = express();
  app.use(express.json());
  app.use("/user-views", userViewRouter);
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
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prisma.$disconnect();
});

describe("user-views", () => {
  it("creates, lists, updates, removes views (round-trip)", async () => {
    const app = await buildApp();
    const create = await request(app)
      .post("/user-views")
      .set("authorization", `Bearer ${tokenA}`)
      .send({ listKey: "k1", name: "Overdue", filters: { status: "overdue" } });
    expect(create.status).toBe(201);
    const id = create.body.id as string;

    const list = await request(app)
      .get(`/user-views?listKey=k1`)
      .set("authorization", `Bearer ${tokenA}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].name).toBe("Overdue");

    const update = await request(app)
      .put(`/user-views/${id}`)
      .set("authorization", `Bearer ${tokenA}`)
      .send({ name: "Overdue (renamed)" });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe("Overdue (renamed)");

    const del = await request(app)
      .delete(`/user-views/${id}`)
      .set("authorization", `Bearer ${tokenA}`);
    expect(del.status).toBe(204);

    const empty = await request(app)
      .get(`/user-views?listKey=k1`)
      .set("authorization", `Bearer ${tokenA}`);
    expect(empty.body.length).toBe(0);
  });

  it("isDefault is exclusive within a listKey", async () => {
    const app = await buildApp();
    const a = await request(app)
      .post("/user-views").set("authorization", `Bearer ${tokenA}`)
      .send({ listKey: "k2", name: "A", filters: {}, isDefault: true });
    const b = await request(app)
      .post("/user-views").set("authorization", `Bearer ${tokenA}`)
      .send({ listKey: "k2", name: "B", filters: {}, isDefault: true });
    const list = await request(app)
      .get("/user-views?listKey=k2").set("authorization", `Bearer ${tokenA}`);
    const findById = (id: string) => (list.body as Array<{ id: string; isDefault: boolean }>).find((x) => x.id === id);
    expect(findById(a.body.id)?.isDefault).toBe(false);
    expect(findById(b.body.id)?.isDefault).toBe(true);
  });

  it("isolates per-tenant", async () => {
    const app = await buildApp();
    await request(app)
      .post("/user-views").set("authorization", `Bearer ${tokenA}`)
      .send({ listKey: "k3", name: "A", filters: {} });
    const otherTenant = await request(app)
      .get("/user-views?listKey=k3").set("authorization", `Bearer ${tokenB}`);
    expect(otherTenant.body.length).toBe(0);
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const r = await request(app).get("/user-views?listKey=k1");
    expect(r.status).toBe(401);
  });
});
