// Real-DB coverage for /ai-rules (save-as-rule flow).
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-ar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { aiRuleRouter } = await import("./ai-rules");
  const app = express();
  app.use(express.json());
  app.use("/ai-rules", aiRuleRouter);
  return app;
}

let tenantId: string;
let token: string;

beforeAll(async () => {
  const past = new Date(Date.now() - 60_000);
  const tenant = await prisma.tenant.create({ data: { name: `AR ${suiteId}`, slug: suiteId } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `ar-${suiteId}@x.com`,
      passwordHash: await bcrypt.hash("x", 4),
      fullName: "AR",
      role: "admin",
      emailVerifiedAt: new Date(),
      tokenEpoch: past,
    },
  });
  token = jwt.sign({ userId: user.id, tenantId, email: user.email, role: "admin", roles: [] }, JWT_SECRET, { expiresIn: "1h" });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("ai-rules", () => {
  it("creates, lists, bumps, removes rules", async () => {
    const app = await buildApp();
    const create = await request(app)
      .post("/ai-rules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scope: "invoice-draft",
        name: "Add shipping fee",
        before: { items: 2 },
        after: { items: 3, shipping: 10 },
      });
    expect(create.status).toBe(201);
    const id = create.body.id as string;
    expect(create.body.usageCount).toBe(0);

    const list = await request(app)
      .get("/ai-rules?scope=invoice-draft")
      .set("authorization", `Bearer ${token}`);
    expect(list.body.length).toBe(1);
    expect(list.body[0].name).toBe("Add shipping fee");

    const bump = await request(app)
      .post(`/ai-rules/${id}/bump`)
      .set("authorization", `Bearer ${token}`);
    expect(bump.status).toBe(204);
    const relisted = await request(app)
      .get("/ai-rules?scope=invoice-draft")
      .set("authorization", `Bearer ${token}`);
    expect(relisted.body[0].usageCount).toBe(1);

    const del = await request(app)
      .delete(`/ai-rules/${id}`)
      .set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
    const empty = await request(app)
      .get("/ai-rules?scope=invoice-draft")
      .set("authorization", `Bearer ${token}`);
    expect(empty.body.length).toBe(0);
  });

  it("filters by scope", async () => {
    const app = await buildApp();
    await request(app).post("/ai-rules").set("authorization", `Bearer ${token}`)
      .send({ scope: "a", name: "r1", before: {}, after: {} });
    await request(app).post("/ai-rules").set("authorization", `Bearer ${token}`)
      .send({ scope: "b", name: "r2", before: {}, after: {} });
    const onlyA = await request(app)
      .get("/ai-rules?scope=a")
      .set("authorization", `Bearer ${token}`);
    expect(onlyA.body.length).toBe(1);
    expect(onlyA.body[0].name).toBe("r1");
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    expect((await request(app).get("/ai-rules?scope=x")).status).toBe(401);
  });
});
