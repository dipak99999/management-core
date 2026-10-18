// Real-DB integration coverage for the 2FA router + the verifyTotpOrBackup
// helper that the login challenge path consumes. Covers the full enroll →
// verify → challenge → disable flow and the one-shot backup-code semantics.
//
// Mocks requireAuth to inject a fixed userId/tenantId (so these tests don't
// have to go through signup + token issuance). The 2FA logic under test is
// pure Prisma + otplib, which is what we want to exercise.

import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-2fa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let tenantId: string;
let userId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  return {
    ...actual,
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { auth: { userId: string; tenantId: string; role: string } }).auth = {
        userId,
        tenantId,
        role: "admin",
      };
      next();
    },
  };
});

async function buildApp() {
  const { twoFactorRouter } = await import("./two-factor");
  const app = express();
  app.use(express.json());
  app.use("/2fa", twoFactorRouter);
  return app;
}

const strongPassword = "Correct-Horse-Battery-Staple-9!";

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: `2FA ${suiteId}`, slug: `${suiteId}-2fa` },
  });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `twofa-${suiteId}@example.com`,
      passwordHash: await bcrypt.hash(strongPassword, 4),
      fullName: "TwoFA Tester",
      role: "admin",
      emailVerifiedAt: new Date(),
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("2FA enroll → verify → disable (real DB)", () => {
  it("enroll returns a TOTP secret and otpauth URL", async () => {
    const app = await buildApp();
    const res = await request(app).post("/2fa/enroll").send({});
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const updated = await prisma.user.findUnique({ where: { id: userId } });
    expect(updated?.totpSecret).toBe(res.body.secret);
    expect(updated?.totpEnabledAt).toBeNull();
  });

  it("verify with a current TOTP flips totpEnabledAt and mints 10 backup codes", async () => {
    const app = await buildApp();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const secret = user!.totpSecret!;
    const token = authenticator.generate(secret);

    const res = await request(app).post("/2fa/verify").send({ token });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.backupCodes).toHaveLength(10);
    expect(res.body.backupCodes[0]).toMatch(/^[A-Z0-9_-]{8}$/);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.totpEnabledAt).toBeInstanceOf(Date);
    const codeCount = await prisma.totpBackupCode.count({ where: { userId } });
    expect(codeCount).toBe(10);
  });

  it("verify rejects a wrong code", async () => {
    const app = await buildApp();
    // Disable first so the enroll-then-verify path is retested.
    await prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: null },
    });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.totpSecret).toBeTruthy();

    const res = await request(app).post("/2fa/verify").send({ token: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("disable requires the correct password and zeros out the secret + backup codes", async () => {
    const app = await buildApp();
    // Re-enable first so disable has something to tear down.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const token = authenticator.generate(user!.totpSecret!);
    await request(app).post("/2fa/verify").send({ token });

    const wrong = await request(app).post("/2fa/disable").send({ password: "nope" });
    expect(wrong.status).toBe(400);

    const right = await request(app).post("/2fa/disable").send({ password: strongPassword });
    expect(right.status).toBe(200);
    expect(right.body.disabled).toBe(true);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.totpEnabledAt).toBeNull();
    expect(after?.totpSecret).toBeNull();
    const codeCount = await prisma.totpBackupCode.count({ where: { userId } });
    expect(codeCount).toBe(0);
  });
});

describe("verifyTotpOrBackup helper (real DB)", () => {
  it("accepts a current TOTP and burns a backup code exactly once", async () => {
    // Fresh enroll+verify to produce a known secret + backup codes.
    const app = await buildApp();
    await request(app).post("/2fa/enroll").send({});
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const token = authenticator.generate(user!.totpSecret!);
    const enroll = await request(app).post("/2fa/verify").send({ token });
    const codes = enroll.body.backupCodes as string[];

    const { verifyTotpOrBackup } = await import("./two-factor");

    // TOTP: current code valid.
    const totp = authenticator.generate(user!.totpSecret!);
    await expect(verifyTotpOrBackup(userId, totp)).resolves.toBe(true);

    // Backup code: first use succeeds.
    const first = codes[0];
    await expect(verifyTotpOrBackup(userId, first)).resolves.toBe(true);

    // Second use of same backup code fails (one-shot).
    await expect(verifyTotpOrBackup(userId, first)).resolves.toBe(false);

    // Totally invalid token fails.
    await expect(verifyTotpOrBackup(userId, "NOTACODE")).resolves.toBe(false);
  });
});
