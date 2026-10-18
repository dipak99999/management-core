// Unit tests for campaigns routes — state machine + action endpoints.
//
// Prisma + service-auth are mocked at the module boundary so this suite is
// hermetic (no live Postgres). Follows the same pattern as
// services/auth-service/src/routes/email-tracking.test.ts.
//
// Coverage:
//   • canTransition matrix — every documented arrow + a handful of illegal ones
//   • normalizeStatus — legacy Planned/Active/Completed → new vocabulary
//   • Action endpoints — valid transitions return 200, invalid 409
//   • archive-publish — slug validation, uniqueness violation → 409
//   • test-send — ≤5 emails OK, 6th rejected 400; testSentAt bumped
//   • preview — renders sample merge vars, Content-Type text/html

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ---------------------------------------------------------------

const prismaMock = {
  campaign: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  emailMessage: {
    create: vi.fn(),
  },
  // P3: checkApprovalRequired reads Tenant.requireMarketingApproval + the
  // latest MarketingApproval on every schedule/start/send. Default both to
  // "no gate" so existing tests that don't care about approvals keep passing.
  tenant: {
    findUnique: vi.fn().mockResolvedValue({ requireMarketingApproval: false }),
  },
  marketingApproval: {
    findFirst: vi.fn().mockResolvedValue(null),
  },
  // P2: CampaignVariant surface. All the methods used by the variant routes.
  campaignVariant: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  // Transaction glue — runs either a callback (async function) with a fresh
  // "tx" that reuses the same prisma mocks, or plays back an array of
  // pre-baked promises (matching Prisma's overloaded signature).
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg;
  }),
};

class FakePrismaKnownError extends Error {
  code: string;
  constructor(code: string) {
    super("mock prisma known error");
    this.code = code;
  }
}

vi.mock("@lumaara/db", () => ({
  Prisma: {
    // Decimal is used by the upsert code path — not touched in these tests
    // but the module still imports it, so a passthrough constructor is
    // sufficient.
    Decimal: class {
      value: unknown;
      constructor(v: unknown) { this.value = v; }
    },
    PrismaClientKnownRequestError: FakePrismaKnownError,
  },
  prisma: prismaMock,
  renderTemplate: (tpl: string, vars: Record<string, unknown>) =>
    tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? "")),
  // Brand-kit is applied after the primary render in the send loop.
  // Tested end-to-end in packages/db/src/brand-kit.test.ts; here a
  // pass-through keeps the campaign tests focused on their own logic.
  applyBrandKit: async (html: string) => html,
  // P2 helpers used by the /materialize-recipients + /variants routes.
  // pickVariantForRecipient always returns the first variant here — the
  // full weighted logic has its own dedicated tests in packages/db.
  pickVariantForRecipient: (variants: Array<{ id: string; isWinner?: boolean }>) =>
    variants[0] ?? null,
  twoProportionZTest: (x1: number, n1: number, x2: number, n2: number) => {
    const p1 = n1 > 0 ? x1 / n1 : 0;
    const p2 = n2 > 0 ? x2 / n2 : 0;
    // Deterministic pseudo-z: (p1 - p2) * 10 — big enough to trip
    // significance in the tests that expect it.
    const z = (p1 - p2) * 10;
    return { z, pValue: Math.abs(z) >= 1.96 ? 0.01 : 0.5, isSignificant: Math.abs(z) >= 1.96 };
  },
}));

// perms() returns middleware-shaped no-ops. Every route stamps req.auth so
// downstream handlers see a valid tenant context.
vi.mock("@lumaara/service-auth", () => {
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Simulate JWT-derived auth. All tests use tenant-A / user-U by default.
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: "tenant-A",
      userId: "user-U",
    };
    next();
  };
  return {
    perms: () => ({
      read: pass, write: pass, create: pass, delete: pass,
      submit: pass, cancel: pass,
    }),
    // Idempotency middleware — pass-through for tests.
    idempotency: () => pass,
  };
});

// ---- App factory ---------------------------------------------------------

async function buildApp() {
  // Import AFTER mocks are wired up.
  const { campaignRouter } = await import("./campaigns");
  const app = express();
  app.use(express.json());
  app.use("/campaigns", campaignRouter);
  return app;
}

function resetPrismaMocks() {
  Object.entries(prismaMock).forEach(([, m]) => {
    if (typeof m === "function") {
      (m as ReturnType<typeof vi.fn>).mockReset();
      // Restore $transaction default behaviour after reset.
      return;
    }
    Object.values(m).forEach((fn) =>
      (fn as ReturnType<typeof vi.fn>).mockReset(),
    );
  });
  // Re-arm $transaction with the default (callback- or array-) unwrap.
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg;
  });
  // P3: default the approval gate to OFF so state-machine tests keep passing
  // regardless of the tenant flag. Individual approval tests can override
  // per-test by re-mocking these two.
  prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: false });
  prismaMock.marketingApproval.findFirst.mockResolvedValue(null);
}

// A canned campaign row shape — tests override status per case.
function makeCampaign(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "camp-1",
    tenantId: "tenant-A",
    name: "Camp",
    status: "Draft",
    subject: "Hello {{first_name}}",
    bodyHtml: "<p>Hi {{first_name}} {{last_name}}, mail: {{email}}. <a href='{{unsubscribe_url}}'>unsub</a></p>",
    fromEmail: null,
    fromName: null,
    replyTo: null,
    scheduledFor: null,
    sentAt: null,
    archiveEnabled: false,
    archiveSlug: null,
    testSentAt: null,
    ...overrides,
  };
}

// ---- Pure-function tests: canTransition + normalizeStatus ---------------

describe("canTransition", () => {
  it("allows every documented arrow", async () => {
    const { canTransition } = await import("./campaigns");
    // Draft →
    expect(canTransition("Draft", "Scheduled")).toBe(true);
    expect(canTransition("Draft", "Sending")).toBe(true);
    expect(canTransition("Draft", "Cancelled")).toBe(true);
    // Scheduled →
    expect(canTransition("Scheduled", "Sending")).toBe(true);
    expect(canTransition("Scheduled", "Draft")).toBe(true);
    expect(canTransition("Scheduled", "Cancelled")).toBe(true);
    // Sending →
    expect(canTransition("Sending", "Paused")).toBe(true);
    expect(canTransition("Sending", "Sent")).toBe(true);
    expect(canTransition("Sending", "Cancelled")).toBe(true);
    // Paused →
    expect(canTransition("Paused", "Sending")).toBe(true);
    expect(canTransition("Paused", "Cancelled")).toBe(true);
    // Sent →
    expect(canTransition("Sent", "Archived")).toBe(true);
    expect(canTransition("Sent", "Cancelled")).toBe(true);
    // Archived →
    expect(canTransition("Archived", "Sent")).toBe(true);
  });

  it("blocks illegal arrows", async () => {
    const { canTransition } = await import("./campaigns");
    expect(canTransition("Draft", "Paused")).toBe(false);
    expect(canTransition("Draft", "Sent")).toBe(false);
    expect(canTransition("Draft", "Archived")).toBe(false);
    expect(canTransition("Scheduled", "Paused")).toBe(false);
    expect(canTransition("Scheduled", "Sent")).toBe(false);
    expect(canTransition("Paused", "Draft")).toBe(false);
    expect(canTransition("Sent", "Draft")).toBe(false);
    expect(canTransition("Sent", "Sending")).toBe(false);
    // Cancelled is terminal.
    expect(canTransition("Cancelled", "Sending")).toBe(false);
    expect(canTransition("Cancelled", "Draft")).toBe(false);
    expect(canTransition("Cancelled", "Sent")).toBe(false);
    // Self-transitions are always false.
    expect(canTransition("Draft", "Draft")).toBe(false);
    expect(canTransition("Sending", "Sending")).toBe(false);
  });

  it("normalises legacy status vocabulary", async () => {
    const { canTransition, normalizeStatus } = await import("./campaigns");
    expect(normalizeStatus("Planned")).toBe("Draft");
    expect(normalizeStatus("Active")).toBe("Sending");
    expect(normalizeStatus("Completed")).toBe("Sent");
    expect(normalizeStatus(null)).toBe("Draft");
    expect(normalizeStatus(undefined)).toBe("Draft");
    // Legacy "Planned" behaves like Draft for transition purposes.
    expect(canTransition("Planned", "Scheduled")).toBe(true);
    expect(canTransition("Planned", "Sending")).toBe(true);
    // Legacy "Active" behaves like Sending.
    expect(canTransition("Active", "Paused")).toBe(true);
    expect(canTransition("Active", "Sent")).toBe(true);
    // Legacy "Completed" behaves like Sent.
    expect(canTransition("Completed", "Archived")).toBe(true);
  });
});

// ---- Route tests: /schedule, /start, /pause, /resume, /cancel, /unschedule

describe("state-machine action endpoints", () => {
  beforeEach(resetPrismaMocks);

  it("POST /schedule Draft → Scheduled: 200 + sets scheduledFor", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/schedule")
      .send({ scheduledFor: "2026-12-01T10:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Scheduled");
    const arg = prismaMock.campaign.update.mock.calls[0][0];
    expect(arg.data.scheduledFor).toBeDefined();
  });

  it("POST /schedule from Sending: 409 (illegal transition)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sending" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/schedule")
      .send({ scheduledFor: "2026-12-01T10:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ from: "Sending", to: "Scheduled" });
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("POST /schedule requires valid ISO scheduledFor: 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/schedule")
      .send({ scheduledFor: "not-a-date" });
    expect(res.status).toBe(400);
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("POST /unschedule Scheduled → Draft: 200 + clears scheduledFor", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Scheduled" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/unschedule");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Draft");
    expect(prismaMock.campaign.update.mock.calls[0][0].data.scheduledFor).toBeNull();
  });

  it("POST /start Draft → Sending: 200 + sets sentAt on first send", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft", sentAt: null }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/start");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Sending");
    const arg = prismaMock.campaign.update.mock.calls[0][0];
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });

  it("POST /start Scheduled → Sending: 200", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Scheduled" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/start");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Sending");
  });

  it("POST /start Paused → Sending: 200 (does NOT overwrite sentAt)", async () => {
    const originalSentAt = new Date("2026-01-01T00:00:00.000Z");
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Paused", sentAt: originalSentAt }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/start");
    expect(res.status).toBe(200);
    const arg = prismaMock.campaign.update.mock.calls[0][0];
    expect(arg.data.sentAt).toBe(originalSentAt);
  });

  it("POST /start Sent → Sending: 409 (illegal)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sent" }));
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/start");
    expect(res.status).toBe(409);
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("POST /pause Sending → Paused: 200", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sending" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/pause");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Paused");
  });

  it("POST /pause Draft → Paused: 409", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/pause");
    expect(res.status).toBe(409);
  });

  it("POST /resume Paused → Sending: 200", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Paused" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/resume");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Sending");
  });

  it("POST /cancel from any live status: 200 (multiple sources)", async () => {
    for (const src of ["Draft", "Scheduled", "Sending", "Paused", "Sent", "Archived"]) {
      resetPrismaMocks();
      prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: src }));
      prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        ({ id: "camp-1", ...args.data }),
      );
      const app = await buildApp();
      const res = await request(app).post("/campaigns/camp-1/cancel");
      expect(res.status, `from ${src}`).toBe(200);
      expect(res.body.status).toBe("Cancelled");
    }
  });

  it("POST /cancel from Cancelled: 409 (terminal)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Cancelled" }));
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/cancel");
    expect(res.status).toBe(409);
  });

  it("legacy Active status accepted for /pause (Active ≡ Sending)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Active" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/pause");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Paused");
  });

  it("legacy Planned status accepted for /start (Planned ≡ Draft)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Planned" }));
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/start");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Sending");
  });

  it("legacy Completed status accepted for /archive-publish (Completed ≡ Sent)", async () => {
    prismaMock.campaign.findFirst
      .mockResolvedValueOnce(makeCampaign({ status: "Completed" }))
      .mockResolvedValueOnce(null); // no slug clash
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "legacy-completed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Archived");
  });

  it("404 when campaign not found (tenant scoping)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).post("/campaigns/nope/start");
    expect(res.status).toBe(404);
  });
});

// ---- archive-publish / archive-unpublish --------------------------------

describe("archive-publish + archive-unpublish", () => {
  beforeEach(resetPrismaMocks);

  it("Sent → Archived: 200 + returns archiveUrl", async () => {
    prismaMock.campaign.findFirst
      .mockResolvedValueOnce(makeCampaign({ status: "Sent" }))
      .mockResolvedValueOnce(null); // uniqueness check: no clash
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "my-newsletter-jan" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Archived");
    expect(res.body.archiveEnabled).toBe(true);
    expect(res.body.archiveSlug).toBe("my-newsletter-jan");
    expect(res.body.archiveUrl).toContain("/a/my-newsletter-jan");
  });

  it("rejects invalid slug (uppercase / spaces): 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sent" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "Bad Slug!" });
    expect(res.status).toBe(400);
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("uniqueness clash with another campaign: 409", async () => {
    prismaMock.campaign.findFirst
      .mockResolvedValueOnce(makeCampaign({ status: "Sent" }))
      .mockResolvedValueOnce({ id: "another-camp" }); // clash
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "taken" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in use/);
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("race-condition P2002 from Prisma → 409", async () => {
    prismaMock.campaign.findFirst
      .mockResolvedValueOnce(makeCampaign({ status: "Sent" }))
      .mockResolvedValueOnce(null); // pre-check clean
    prismaMock.campaign.update.mockRejectedValue(new FakePrismaKnownError("P2002"));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "race-loser" });
    expect(res.status).toBe(409);
  });

  it("from Draft: 409 (must be Sent first)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/archive-publish")
      .send({ slug: "too-early" });
    expect(res.status).toBe(409);
  });

  it("Archived → Sent via unpublish: 200 + keeps archiveSlug", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(
      makeCampaign({ status: "Archived", archiveEnabled: true, archiveSlug: "keep-me" }),
    );
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", archiveSlug: "keep-me", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/archive-unpublish");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Sent");
    expect(res.body.archiveEnabled).toBe(false);
    // Slug retained so re-publish is idempotent
    expect(res.body.archiveSlug).toBe("keep-me");
    // Verify update didn't touch archiveSlug
    const arg = prismaMock.campaign.update.mock.calls[0][0];
    expect(arg.data.archiveSlug).toBeUndefined();
  });

  it("unpublish from Sent: 409 (already not archived)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sent" }));
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/archive-unpublish");
    expect(res.status).toBe(409);
  });
});

// ---- test-send ----------------------------------------------------------

describe("POST /:id/test", () => {
  beforeEach(resetPrismaMocks);

  it("queues one EmailMessage per address (≤5) and marks testSentAt", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    prismaMock.emailMessage.create.mockResolvedValue({});
    prismaMock.campaign.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "camp-1", testSentAt: args.data.testSentAt }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/test")
      .send({ emails: ["a@x.com", "b@x.com", "c@x.com"] });
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(3);
    expect(prismaMock.emailMessage.create).toHaveBeenCalledTimes(3);
    // Subject was TEST-prefixed and rendered with sample vars
    const firstCall = prismaMock.emailMessage.create.mock.calls[0][0];
    expect(firstCall.data.subject).toMatch(/^\[TEST\] /);
    expect(firstCall.data.subject).toContain("Test"); // {{first_name}} → "Test"
    expect(firstCall.data.linkedDoctype).toBe("Campaign");
    expect(firstCall.data.linkedId).toBe("camp-1");
    // Campaign status unchanged; only testSentAt bumped
    const updateArg = prismaMock.campaign.update.mock.calls[0][0];
    expect(updateArg.data).toEqual({ testSentAt: expect.any(Date) });
  });

  it("rejects 6 emails: 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/test")
      .send({ emails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"] });
    expect(res.status).toBe(400);
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("rejects when subject/bodyHtml missing: 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(
      makeCampaign({ status: "Draft", subject: null, bodyHtml: null }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/test")
      .send({ emails: ["a@x.com"] });
    expect(res.status).toBe(400);
    expect(prismaMock.emailMessage.create).not.toHaveBeenCalled();
  });

  it("does NOT change campaign status (even from Sending)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Sending" }));
    prismaMock.emailMessage.create.mockResolvedValue({});
    prismaMock.campaign.update.mockResolvedValue({ id: "camp-1" });
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/test")
      .send({ emails: ["a@x.com"] });
    expect(res.status).toBe(200);
    const arg = prismaMock.campaign.update.mock.calls[0][0];
    expect(arg.data.status).toBeUndefined();
  });
});

// ---- preview ------------------------------------------------------------

describe("GET /:id/preview", () => {
  beforeEach(resetPrismaMocks);

  it("returns HTML with sample merge vars filled", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    const res = await request(app).get("/campaigns/camp-1/preview");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    // Sample vars from the plan: first_name=John, last_name=Doe, email=sample@…
    expect(res.text).toContain("John");
    expect(res.text).toContain("Doe");
    expect(res.text).toContain("sample@example.com");
    expect(res.text).toContain("#preview"); // unsubscribe_url placeholder
    // Should NOT still contain raw {{...}} tokens for these keys
    expect(res.text).not.toContain("{{first_name}}");
    expect(res.text).not.toContain("{{last_name}}");
  });

  it("does NOT mutate the campaign (read-only)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ status: "Draft" }));
    const app = await buildApp();
    await request(app).get("/campaigns/camp-1/preview");
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });

  it("404 when campaign not found", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).get("/campaigns/nope/preview");
    expect(res.status).toBe(404);
  });

  it("handles null bodyHtml (returns empty body, still 200)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign({ bodyHtml: null }));
    const app = await buildApp();
    const res = await request(app).get("/campaigns/camp-1/preview");
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
  });
});

// ---- P2: A/B variant CRUD ------------------------------------------------

function makeVariant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "var-A",
    tenantId: "tenant-A",
    campaignId: "camp-1",
    variantKey: "A",
    weightPercent: 50,
    subject: null,
    bodyHtml: null,
    fromEmail: null,
    fromName: null,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalBounced: 0,
    isWinner: false,
    ...overrides,
  };
}

describe("POST /:id/variants", () => {
  beforeEach(resetPrismaMocks);

  it("creates a variant with valid weight → 201", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    // Inside transaction: no existing variants → empty array.
    prismaMock.campaignVariant.findMany.mockResolvedValue([]);
    prismaMock.campaignVariant.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "var-new", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants")
      .send({ variantKey: "A", weightPercent: 50, subject: "Alt subject" });
    expect(res.status).toBe(201);
    expect(res.body.variantKey).toBe("A");
    expect(res.body.weightPercent).toBe(50);
    expect(res.body.subject).toBe("Alt subject");
  });

  it("4th variant → 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ variantKey: "A", weightPercent: 33 }),
      makeVariant({ variantKey: "B", weightPercent: 33 }),
      makeVariant({ variantKey: "C", weightPercent: 34 }),
    ]);
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants")
      .send({ variantKey: "A", weightPercent: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 3 variants/);
    expect(prismaMock.campaignVariant.create).not.toHaveBeenCalled();
  });

  it("weight sum > 100 → 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ variantKey: "A", weightPercent: 60 }),
    ]);
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants")
      .send({ variantKey: "B", weightPercent: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 100/);
    expect(prismaMock.campaignVariant.create).not.toHaveBeenCalled();
  });

  it("duplicate variantKey → 409", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ variantKey: "A", weightPercent: 50 }),
    ]);
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants")
      .send({ variantKey: "A", weightPercent: 30 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("invalid variantKey (lowercase / multi-char) → 400", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants")
      .send({ variantKey: "aa", weightPercent: 50 });
    expect(res.status).toBe(400);
  });

  it("404 when campaign missing", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/nope/variants")
      .send({ variantKey: "A", weightPercent: 50 });
    expect(res.status).toBe(404);
  });
});

describe("GET /:id/variants + GET /:id/variants/stats", () => {
  beforeEach(resetPrismaMocks);

  it("returns per-variant totals + rates", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ variantKey: "A", totalSent: 100, totalOpened: 40, totalClicked: 10 }),
      makeVariant({ id: "var-B", variantKey: "B", totalSent: 100, totalOpened: 20, totalClicked: 5 }),
    ]);
    const app = await buildApp();
    const res = await request(app).get("/campaigns/camp-1/variants/stats");
    expect(res.status).toBe(200);
    expect(res.body.variants).toHaveLength(2);
    expect(res.body.variants[0].openRate).toBeCloseTo(0.4);
    expect(res.body.variants[1].openRate).toBeCloseTo(0.2);
    // Significance computed for 2+ variants
    expect(res.body.significance).not.toBeNull();
    expect(res.body.significance.metric).toBe("open");
    expect(res.body.significance.leaderKey).toBe("A");
  });
});

describe("POST /:id/variants/pick-winner", () => {
  beforeEach(resetPrismaMocks);

  it("promotes the highest open-rate variant", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValueOnce([
      makeVariant({ id: "var-A", variantKey: "A", totalSent: 100, totalOpened: 15 }),
      makeVariant({ id: "var-B", variantKey: "B", totalSent: 100, totalOpened: 40 }),
    ]);
    prismaMock.campaignVariant.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.campaignVariant.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "var-B", ...args.data }),
    );
    // Second findMany (refreshed variants for response) — return the same but with B as winner
    prismaMock.campaignVariant.findMany.mockResolvedValueOnce([
      makeVariant({ id: "var-A", variantKey: "A", totalSent: 100, totalOpened: 15, isWinner: false }),
      makeVariant({ id: "var-B", variantKey: "B", totalSent: 100, totalOpened: 40, isWinner: true }),
    ]);
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/variants/pick-winner").send({});
    expect(res.status).toBe(200);
    expect(res.body.winnerKey).toBe("B");
    expect(prismaMock.campaignVariant.update).toHaveBeenCalledWith({
      where: { id: "var-B" },
      data: { isWinner: true },
    });
  });

  it("400 when only 1 variant", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ variantKey: "A" }),
    ]);
    const app = await buildApp();
    const res = await request(app).post("/campaigns/camp-1/variants/pick-winner").send({});
    expect(res.status).toBe(400);
  });

  it("forces winner via body {variantId}", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(makeCampaign());
    prismaMock.campaignVariant.findMany.mockResolvedValueOnce([
      makeVariant({ id: "var-A", variantKey: "A", totalSent: 100, totalOpened: 40 }),
      makeVariant({ id: "var-B", variantKey: "B", totalSent: 100, totalOpened: 30 }),
    ]);
    prismaMock.campaignVariant.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.campaignVariant.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "var-A", ...args.data }),
    );
    prismaMock.campaignVariant.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    const res = await request(app)
      .post("/campaigns/camp-1/variants/pick-winner")
      .send({ variantId: "var-A" }); // force A even though B has higher rate
    expect(res.status).toBe(200);
    expect(res.body.winnerKey).toBe("A");
  });
});

describe("PATCH /variants/:variantId + DELETE /variants/:variantId", () => {
  beforeEach(resetPrismaMocks);

  it("PATCH updates a variant's subject", async () => {
    prismaMock.campaignVariant.findFirst.mockResolvedValue(makeVariant({ id: "var-A" }));
    prismaMock.campaignVariant.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "var-A", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .patch("/campaigns/variants/var-A")
      .send({ subject: "New subject" });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("New subject");
  });

  it("PATCH weight change > 100 → 400", async () => {
    prismaMock.campaignVariant.findFirst.mockResolvedValue(
      makeVariant({ id: "var-A", weightPercent: 50 }),
    );
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      { weightPercent: 60 }, // sibling — new (80) + 60 = 140 > 100
    ]);
    const app = await buildApp();
    const res = await request(app)
      .patch("/campaigns/variants/var-A")
      .send({ weightPercent: 80 });
    expect(res.status).toBe(400);
  });

  it("DELETE removes the variant (SetNull cascade handled by schema)", async () => {
    prismaMock.campaignVariant.findFirst.mockResolvedValue(makeVariant({ id: "var-A" }));
    prismaMock.campaignVariant.delete.mockResolvedValue({ id: "var-A" });
    const app = await buildApp();
    const res = await request(app).delete("/campaigns/variants/var-A");
    expect(res.status).toBe(204);
    expect(prismaMock.campaignVariant.delete).toHaveBeenCalledWith({
      where: { id: "var-A" },
    });
  });
});
