// Real-DB coverage for /activity/:doctype/:docId. Verifies that AuditLog
// rows + Comment rows for the same doc merge into a reverse-chronological
// feed, that the actor name resolves from the related User, and that
// cross-tenant leakage is impossible.
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@lumaara/db";
import { JWT_SECRET } from "@lumaara/service-auth";

const suiteId = `it-act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function buildApp() {
  const { activityRouter } = await import("./activity");
  const app = express();
  app.use(express.json());
  app.use("/activity", activityRouter);
  return app;
}

function signToken(userId: string, tenantId: string, email: string): string {
  return jwt.sign({ userId, tenantId, email, role: "admin", roles: [] }, JWT_SECRET, {
    expiresIn: "1h",
  });
}

let tenantAId: string;
let tenantBId: string;
let userAId: string;
let userBId: string;
let userAToken: string;
let userBToken: string;

const DOCTYPE = "PickList";
const DOC_ID = `pl-${suiteId}`;

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.tenant.create({ data: { name: `A ${suiteId}`, slug: `a-${suiteId}` } }),
    prisma.tenant.create({ data: { name: `B ${suiteId}`, slug: `b-${suiteId}` } }),
  ]);
  tenantAId = a.id;
  tenantBId = b.id;
  const pw = await bcrypt.hash("x", 4);
  // tokenEpoch set in the past: JWT iat is floored to seconds, so freshly-
  // created users with a sub-second tokenEpoch would reject their own token.
  const past = new Date(Date.now() - 60_000);
  const [ua, ub] = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: tenantAId,
        email: `act-a-${suiteId}@example.com`,
        passwordHash: pw,
        fullName: "Alice Picker",
        role: "admin",
        emailVerifiedAt: new Date(),
        tokenEpoch: past,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenantBId,
        email: `act-b-${suiteId}@example.com`,
        passwordHash: pw,
        fullName: "Bob Picker",
        role: "admin",
        emailVerifiedAt: new Date(),
        tokenEpoch: past,
      },
    }),
  ]);
  userAId = ua.id;
  userBId = ub.id;
  userAToken = signToken(ua.id, tenantAId, ua.email);
  userBToken = signToken(ub.id, tenantBId, ub.email);

  await prisma.auditLog.createMany({
    data: [
      {
        tenantId: tenantAId,
        userId: userAId,
        method: "POST",
        path: `/pick-lists`,
        doctype: DOCTYPE,
        docId: DOC_ID,
        statusCode: 201,
      },
      {
        tenantId: tenantAId,
        userId: userAId,
        method: "POST-SUBMIT",
        path: `/pick-lists/${DOC_ID}/submit`,
        doctype: DOCTYPE,
        docId: DOC_ID,
        statusCode: 200,
      },
      // Cross-tenant row — should NOT appear in tenant A's feed.
      {
        tenantId: tenantBId,
        userId: userBId,
        method: "POST",
        path: `/pick-lists`,
        doctype: DOCTYPE,
        docId: DOC_ID,
        statusCode: 201,
      },
    ],
  });
  await prisma.comment.create({
    data: {
      tenantId: tenantAId,
      doctype: DOCTYPE,
      docId: DOC_ID,
      body: "Pulled from aisle 3",
      authorUserId: userAId,
    },
  });
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { doctype: DOCTYPE, docId: DOC_ID } });
  await prisma.auditLog.deleteMany({ where: { doctype: DOCTYPE, docId: DOC_ID } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prisma.$disconnect();
});

describe("GET /activity/:doctype/:docId", () => {
  it("merges audit + comments reverse-chronologically for tenant A", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/activity/${DOCTYPE}/${DOC_ID}`)
      .set("authorization", `Bearer ${userAToken}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const entries = r.body as Array<{
      id: string;
      verb: string;
      actor: { name: string };
      kind: string;
      summary?: string;
    }>;
    // Expect 2 audit entries + 1 comment = 3 for tenant A.
    expect(entries.length).toBe(3);
    // Reverse chronological: comment (most recent) first.
    expect(entries[0].kind).toBe("comment");
    expect(entries[0].summary).toBe("Pulled from aisle 3");
    expect(entries[0].actor.name).toBe("Alice Picker");
    // Submit verb mapped correctly.
    const submit = entries.find((e) => e.verb === "submitted");
    expect(submit).toBeDefined();
    expect(submit?.kind).toBe("status");
  });

  it("isolates per-tenant: tenant B sees only its own entries", async () => {
    const app = await buildApp();
    const r = await request(app)
      .get(`/activity/${DOCTYPE}/${DOC_ID}`)
      .set("authorization", `Bearer ${userBToken}`);
    expect(r.status).toBe(200);
    const entries = r.body as Array<{ actor: { name: string } }>;
    expect(entries.length).toBe(1);
    expect(entries[0].actor.name).toBe("Bob Picker");
  });

  it("401s without a token", async () => {
    const app = await buildApp();
    const r = await request(app).get(`/activity/${DOCTYPE}/${DOC_ID}`);
    expect(r.status).toBe(401);
  });
});
