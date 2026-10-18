// Real-DB coverage for /form-defaults (per-user remembered form values).
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-fd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { formDefaultRouter } = await import("./form-defaults");
  const app = express();
  app.use(express.json());
  app.use("/form-defaults", formDefaultRouter);
  return app;
}

let tenantId: string;
let token: string;

beforeAll(async () => {
  const past = new Date(Date.now() - 60_000);
  const tenant = await prisma.tenant.create({ data: { name: `FD ${suiteId}`, slug: suiteId } });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `fd-${suiteId}@x.com`,
      passwordHash: await bcrypt.hash("x", 4),
      fullName: "FD",
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

describe("form-defaults", () => {
  it("GET returns null before any set", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get("/form-defaults/invoice-form")
      .set("authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  it("PUT upserts and GET returns the value", async () => {
    const app = await buildApp();
    const put1 = await request(app)
      .put("/form-defaults")
      .set("authorization", `Bearer ${token}`)
      .send({ formKey: "invoice-form", value: { customerId: "cust-1", currency: "INR" } });
    expect(put1.status).toBe(200);
    const get1 = await request(app)
      .get("/form-defaults/invoice-form")
      .set("authorization", `Bearer ${token}`);
    expect(get1.body.value).toEqual({ customerId: "cust-1", currency: "INR" });

    // Second PUT overwrites, not duplicates.
    await request(app)
      .put("/form-defaults")
      .set("authorization", `Bearer ${token}`)
      .send({ formKey: "invoice-form", value: { customerId: "cust-2" } });
    const get2 = await request(app)
      .get("/form-defaults/invoice-form")
      .set("authorization", `Bearer ${token}`);
    expect(get2.body.value).toEqual({ customerId: "cust-2" });
  });

  it("DELETE clears the value", async () => {
    const app = await buildApp();
    await request(app)
      .put("/form-defaults")
      .set("authorization", `Bearer ${token}`)
      .send({ formKey: "to-clear", value: { x: 1 } });
    const del = await request(app)
      .delete("/form-defaults/to-clear")
      .set("authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
    const after = await request(app)
      .get("/form-defaults/to-clear")
      .set("authorization", `Bearer ${token}`);
    expect(after.body).toBeNull();
  });

  it("401 without auth", async () => {
    const app = await buildApp();
    const r = await request(app).get("/form-defaults/invoice-form");
    expect(r.status).toBe(401);
  });
});
