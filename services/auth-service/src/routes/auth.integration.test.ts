// Real-DB integration coverage for the critical signup/login paths. This is
// the thinnest viable safety net on the auth router — just enough to catch
// a regression that breaks tenant provisioning, password hashing, or the
// 401-on-wrong-password branch. Mocked-DB tests on this router proved too
// brittle given its $transaction + seedTenantChartOfAccounts fan-out.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// The real email-verification sender tries to resolve an SMTP integration;
// in tests we stub it to a no-op so signup doesn't block on background mail.
vi.mock("./email-verification", () => ({
  sendInitialVerification: async () => {},
  emailVerificationRouter: express.Router(),
}));

async function buildApp() {
  // Dynamic import because the mock above must be set up first.
  const { authRouter } = await import("./auth");
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  return app;
}

const strongPassword = "Correct-Horse-Battery-Staple-9!";

// Track created slugs for teardown. Signup creates tenant + CoA accounts +
// warehouses + roles; a single tenant delete cascades it all.
const createdSlugs = new Set<string>();

afterAll(async () => {
  if (createdSlugs.size > 0) {
    await prisma.tenant.deleteMany({
      where: { slug: { in: [...createdSlugs] } },
    });
  }
  await prisma.$disconnect();
});

describe("POST /auth/signup (real DB)", () => {
  it("creates a tenant + admin user and returns a JWT", async () => {
    const slug = `${suiteId}-signup-ok`;
    createdSlugs.add(slug);

    const app = await buildApp();
    const res = await request(app).post("/auth/signup").send({
      tenantName: "Signup OK Inc",
      tenantSlug: slug,
      fullName: "Alice Admin",
      email: `alice-${slug}@example.com`,
      password: strongPassword,
    });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^eyJ/); // JWT
    expect(res.body.tenant.slug).toBe(slug);
    expect(res.body.user.email).toBe(`alice-${slug}@example.com`);
    expect(res.body.user.role).toBe("admin");

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    expect(tenant).not.toBeNull();
  });

  it("rejects a weak password", async () => {
    const slug = `${suiteId}-signup-weak`;
    const app = await buildApp();
    const res = await request(app).post("/auth/signup").send({
      tenantName: "Weak Pwd",
      tenantSlug: slug,
      fullName: "Bob Weak",
      email: `bob-${slug}@example.com`,
      password: "password", // obviously weak
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weak|too short|digit|upper|lower/i);
    // Sanity: no tenant should have been created.
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    expect(tenant).toBeNull();
  });

  it("rejects a duplicate tenant slug with 409", async () => {
    const slug = `${suiteId}-signup-dup`;
    createdSlugs.add(slug);

    const app = await buildApp();
    const first = await request(app).post("/auth/signup").send({
      tenantName: "First",
      tenantSlug: slug,
      fullName: "Carol First",
      email: `carol-${slug}@example.com`,
      password: strongPassword,
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/auth/signup").send({
      tenantName: "Second",
      tenantSlug: slug,
      fullName: "Carol Second",
      email: `carol2-${slug}@example.com`,
      password: strongPassword,
    });
    expect(second.status).toBe(409);
  });
});

describe("POST /auth/login (real DB)", () => {
  it("returns a JWT on correct credentials", async () => {
    const slug = `${suiteId}-login-ok`;
    createdSlugs.add(slug);
    const email = `login-${slug}@example.com`;

    const app = await buildApp();
    await request(app).post("/auth/signup").send({
      tenantName: "Login OK",
      tenantSlug: slug,
      fullName: "Login User",
      email,
      password: strongPassword,
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ email, password: strongPassword, tenantSlug: slug });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
  });

  it("returns 401 on wrong password without leaking account existence", async () => {
    const slug = `${suiteId}-login-wrong`;
    createdSlugs.add(slug);
    const email = `wrong-${slug}@example.com`;

    const app = await buildApp();
    await request(app).post("/auth/signup").send({
      tenantName: "Login Wrong",
      tenantSlug: slug,
      fullName: "Wrong User",
      email,
      password: strongPassword,
    });

    const res = await request(app)
      .post("/auth/login")
      .send({ email, password: "wrong-password-9!", tenantSlug: slug });
    expect(res.status).toBe(401);
    // Same shape for every 401 path — the message must not reveal whether
    // the user exists, the tenant exists, or the password is wrong. If this
    // breaks, we're leaking account state through the error channel.
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });

  it("returns 401 for a nonexistent tenant", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/auth/login")
      .send({
        email: "ghost@example.com",
        password: strongPassword,
        tenantSlug: `${suiteId}-does-not-exist`,
      });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });
});
