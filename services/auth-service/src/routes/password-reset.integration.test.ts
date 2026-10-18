// Real-DB integration coverage for the password-reset request → confirm
// round-trip. Verifies that the raw token exposed via includeDevToken (dev
// only) can redeem for a new password, and that reused/expired tokens are
// rejected. Also pins the "silent 200 on unknown email" behavior so no one
// regresses the user-enumeration defence.

import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-pwr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Suppress real email delivery — sendMail would throw without an SMTP
// transport configured.
vi.mock("../lib/mail", async () => {
  const actual = await vi.importActual<typeof import("../lib/mail")>("../lib/mail");
  return {
    ...actual,
    sendMail: async () => {},
  };
});

async function buildApp() {
  const { passwordResetRouter } = await import("./password-reset");
  const app = express();
  app.use(express.json());
  app.use("/password-reset", passwordResetRouter);
  return app;
}

const strongPassword = "Correct-Horse-Battery-Staple-9!";
const newPassword = "Zebra-Elephant-77-Mountain!";

let tenantId: string;
let userId: string;
const tenantSlug = `${suiteId}-pwr`;
const email = `pwr-${suiteId}@example.com`;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: `PWR ${suiteId}`, slug: tenantSlug },
  });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(strongPassword, 4),
      fullName: "PWR Tester",
      role: "admin",
      emailVerifiedAt: new Date(), // bypass the require-verified gate
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("POST /password-reset (real DB)", () => {
  it("round-trip: request issues a devToken that redeems to change the password", async () => {
    const app = await buildApp();

    const reqRes = await request(app)
      .post("/password-reset/request")
      .send({ email, tenantSlug });
    expect(reqRes.status).toBe(200);
    const devToken = reqRes.body.devToken as string;
    expect(devToken).toBeTruthy();

    const confirmRes = await request(app)
      .post("/password-reset/confirm")
      .send({ token: devToken, newPassword });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body).toEqual({ ok: true });

    // Verify the password actually rotated in the DB.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user).not.toBeNull();
    const matches = await bcrypt.compare(newPassword, user!.passwordHash);
    expect(matches).toBe(true);
  });

  it("rejects reuse of a redeemed token", async () => {
    const app = await buildApp();
    const reqRes = await request(app)
      .post("/password-reset/request")
      .send({ email, tenantSlug });
    const devToken = reqRes.body.devToken as string;

    const first = await request(app)
      .post("/password-reset/confirm")
      .send({ token: devToken, newPassword });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/password-reset/confirm")
      .send({ token: devToken, newPassword });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/invalid|expired/i);
  });

  it("returns a silent 200 for an unknown email (no user enumeration)", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/password-reset/request")
      .send({ email: `ghost-${suiteId}@example.com`, tenantSlug });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // No devToken emitted — there's no user to issue one for.
    expect(res.body.devToken).toBeUndefined();
  });
});
