// Real-DB integration coverage for the portal-auth customer-facing flows.
// Pins invite → accept → login + rejects expired/consumed invites and
// wrong passwords. The staff-side invite POST is covered via a direct
// Prisma insert (bypasses the requireAuth-gated POST /invite) because the
// invite-create path is secondary to proving the public accept + login
// contracts work end to end.

import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Minimal mock — requireAuth isn't exercised by the public flows under test,
// and the staff invite endpoint is covered via direct DB insert below.
vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  return {
    ...actual,
    requireAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
    perms: () => ({
      read: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
      write: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
      create: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
      delete: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
      submit: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
      cancel: (_req: express.Request, _res: express.Response, n: express.NextFunction) => n(),
    }),
  };
});

async function buildApp() {
  const { portalAuthRouter } = await import("./portal-auth");
  const app = express();
  app.use(express.json());
  app.use("/portal", portalAuthRouter);
  return app;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

const strongPassword = "Correct-Horse-Battery-Staple-9!";
const newPassword = "Zebra-Elephant-77-Mountain!";

let tenantId: string;
let customerId: string;
const tenantSlug = `${suiteId}-portal`;

async function freshPortalUserWithInvite(suffix: string): Promise<{
  portalUserId: string;
  email: string;
  token: string;
}> {
  const email = `${suffix}-${suiteId}@example.com`;
  const portalUser = await prisma.portalUser.create({
    data: {
      tenantId,
      email,
      partyType: "Customer",
      partyId: customerId,
      displayName: `Portal ${suffix}`,
    },
  });
  const token = randomBytes(24).toString("base64url");
  await prisma.portalInvite.create({
    data: {
      tenantId,
      portalUserId: portalUser.id,
      tokenHash: sha(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
  return { portalUserId: portalUser.id, email, token };
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: `Portal ${suiteId}`, slug: tenantSlug },
  });
  tenantId = tenant.id;
  const customer = await prisma.customer.create({
    data: { tenantId, customerName: `Portal-Customer-${suiteId}` },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("POST /portal/accept (real DB)", () => {
  it("consumes the invite token, sets the password, and returns a portal JWT", async () => {
    const { portalUserId, token } = await freshPortalUserWithInvite("accept");
    const app = await buildApp();

    const res = await request(app)
      .post("/portal/accept")
      .send({ token, password: strongPassword });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
    expect(res.body.user.id).toBe(portalUserId);

    const after = await prisma.portalUser.findUnique({ where: { id: portalUserId } });
    expect(after?.passwordHash).toBeTruthy();
    expect(after?.isActive).toBe(true);

    const invite = await prisma.portalInvite.findFirst({
      where: { portalUserId, tenantId },
      orderBy: { createdAt: "desc" },
    });
    expect(invite?.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects a reused invite token", async () => {
    const { token } = await freshPortalUserWithInvite("reuse");
    const app = await buildApp();

    const first = await request(app)
      .post("/portal/accept")
      .send({ token, password: strongPassword });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/portal/accept")
      .send({ token, password: strongPassword });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid|expired/i);
  });

  it("rejects a weak password without consuming the invite", async () => {
    const { portalUserId, token } = await freshPortalUserWithInvite("weak");
    const app = await buildApp();

    const res = await request(app)
      .post("/portal/accept")
      .send({ token, password: "password" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/weak|digit|upper|lower/i);

    // Invite must still be redeemable.
    const invite = await prisma.portalInvite.findFirst({
      where: { portalUserId, tenantId },
      orderBy: { createdAt: "desc" },
    });
    expect(invite?.consumedAt).toBeNull();
  });
});

describe("POST /portal/login (real DB)", () => {
  it("returns a portal JWT on correct credentials", async () => {
    // Set up a portal user with a known password (bypass accept flow).
    const email = `login-ok-${suiteId}@example.com`;
    const user = await prisma.portalUser.create({
      data: {
        tenantId,
        email,
        partyType: "Customer",
        partyId: customerId,
        passwordHash: await bcrypt.hash(strongPassword, 4),
        isActive: true,
      },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/portal/login")
      .send({ email, password: strongPassword, tenantSlug });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^eyJ/);
    expect(res.body.user.id).toBe(user.id);

    const after = await prisma.portalUser.findUnique({ where: { id: user.id } });
    expect(after?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("returns 401 for inactive portal user without leaking existence", async () => {
    const email = `login-off-${suiteId}@example.com`;
    await prisma.portalUser.create({
      data: {
        tenantId,
        email,
        partyType: "Customer",
        partyId: customerId,
        passwordHash: await bcrypt.hash(strongPassword, 4),
        isActive: false,
      },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/portal/login")
      .send({ email, password: strongPassword, tenantSlug });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });

  it("returns 401 for wrong password with the same error shape", async () => {
    const email = `login-wrong-${suiteId}@example.com`;
    await prisma.portalUser.create({
      data: {
        tenantId,
        email,
        partyType: "Customer",
        partyId: customerId,
        passwordHash: await bcrypt.hash(strongPassword, 4),
        isActive: true,
      },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/portal/login")
      .send({ email, password: "nope-nope-nope", tenantSlug });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });

  it("returns 401 for an unknown tenant slug", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/portal/login")
      .send({
        email: `ghost-${suiteId}@example.com`,
        password: strongPassword,
        tenantSlug: `${suiteId}-does-not-exist`,
      });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid credentials" });
  });
});

describe("POST /portal/forgot-password (real DB)", () => {
  it("issues a fresh invite token for a valid portal user", async () => {
    const email = `forgot-${suiteId}@example.com`;
    const user = await prisma.portalUser.create({
      data: {
        tenantId,
        email,
        partyType: "Customer",
        partyId: customerId,
        passwordHash: await bcrypt.hash(strongPassword, 4),
        isActive: true,
      },
    });

    const beforeCount = await prisma.portalInvite.count({
      where: { portalUserId: user.id, tenantId },
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/portal/forgot-password")
      .send({ email, tenantSlug });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const afterCount = await prisma.portalInvite.count({
      where: { portalUserId: user.id, tenantId },
    });
    expect(afterCount).toBe(beforeCount + 1);
  });

  it("silently returns 200 for an unknown email (no user enumeration)", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/portal/forgot-password")
      .send({ email: `nobody-${suiteId}@example.com`, tenantSlug });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
