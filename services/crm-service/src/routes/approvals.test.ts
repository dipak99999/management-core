// Unit tests for approvals routes — request/approve/reject/withdraw workflow
// plus the checkApprovalRequired helper.
//
// Follows the same hermetic-mock pattern as campaigns.test.ts: prisma +
// service-auth are stubbed so the suite runs without a live Postgres.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────

const prismaMock = {
  tenant: {
    findUnique: vi.fn(),
  },
  marketingApproval: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  campaign: {
    findFirst: vi.fn(),
  },
  broadcast: {
    findFirst: vi.fn(),
  },
  socialPost: {
    findFirst: vi.fn(),
  },
  userRole: {
    findMany: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
  },
  notification: {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  emailMessage: {
    create: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
}));

// The auth-context stamped on every request. Individual tests override via
// setAuth() to simulate a non-approver requester, an approver, or a
// SystemManager admin.
let currentAuth: {
  tenantId: string;
  userId: string;
  email: string;
  role: string;
  roles: string[];
} = {
  tenantId: "tenant-A",
  userId: "user-requester",
  email: "requester@example.com",
  role: "user",
  roles: ["SalesManager"],
};

function setAuth(overrides: Partial<typeof currentAuth>) {
  currentAuth = { ...currentAuth, ...overrides };
}

vi.mock("@lumaara/service-auth", () => {
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: typeof currentAuth }).auth = currentAuth;
    next();
  };
  return {
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
  };
});

// ─── App factory ──────────────────────────────────────────────────────

async function buildApp() {
  const { approvalsRouter } = await import("./approvals");
  const app = express();
  app.use(express.json());
  app.use("/approvals", approvalsRouter);
  return app;
}

function resetMocks() {
  Object.values(prismaMock).forEach((m) => {
    Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  });
  // Restore default no-op for notification/email fan-out.
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
  prismaMock.emailMessage.create.mockResolvedValue({ id: "e-1" });
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.userRole.findMany.mockResolvedValue([]);
  setAuth({
    tenantId: "tenant-A",
    userId: "user-requester",
    email: "requester@example.com",
    role: "user",
    roles: ["SalesManager"],
  });
}

function makeApproval(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "appr-1",
    tenantId: "tenant-A",
    doctype: "Campaign",
    docId: "camp-1",
    status: "Pending",
    requestedBy: "user-requester",
    requestedAt: new Date("2026-08-30T00:00:00Z"),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    notes: null,
    ...overrides,
  };
}

// ─── /approvals/request ──────────────────────────────────────────────

describe("POST /approvals/request", () => {
  beforeEach(resetMocks);

  it("creates a Pending row + fans notifications to approver users", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      id: "camp-1",
      name: "Summer sale",
      subject: "Big news",
      status: "Draft",
    });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(null); // no existing open
    prismaMock.marketingApproval.create.mockResolvedValue(makeApproval());
    prismaMock.userRole.findMany.mockResolvedValue([
      { userId: "approver-1" },
      { userId: "approver-2" },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: "approver-1", email: "a1@example.com" },
      { id: "approver-2", email: "a2@example.com" },
    ]);

    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/request")
      .send({ doctype: "Campaign", docId: "camp-1", notes: "please review" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Pending");
    expect(prismaMock.marketingApproval.create).toHaveBeenCalledTimes(1);
    // Notification fan-out: one createMany with both approvers.
    const notifCall = prismaMock.notification.createMany.mock.calls[0][0];
    expect(notifCall.data).toHaveLength(2);
    // Emails were enqueued per approver.
    expect(prismaMock.emailMessage.create).toHaveBeenCalledTimes(2);
  });

  it("refuses when the underlying doc does not exist (404)", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/request")
      .send({ doctype: "Campaign", docId: "camp-nope" });
    expect(res.status).toBe(404);
    expect(prismaMock.marketingApproval.create).not.toHaveBeenCalled();
  });

  it("refuses a cross-tenant docId (findFirst is tenant-scoped → null → 404)", async () => {
    // findFirst is called with tenantId in the where clause; if the doc
    // belongs to another tenant it returns null exactly like a nonexistent
    // one — that's the cross-tenant defence.
    prismaMock.campaign.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/request")
      .send({ doctype: "Campaign", docId: "camp-otherTenant" });
    expect(res.status).toBe(404);
    // Confirm the query was tenant-scoped.
    const call = prismaMock.campaign.findFirst.mock.calls[0][0];
    expect(call.where.tenantId).toBe("tenant-A");
  });

  it("returns 409 when a Pending approval already exists for the doc", async () => {
    prismaMock.campaign.findFirst.mockResolvedValue({
      id: "camp-1",
      name: "Summer sale",
      subject: null,
      status: "Draft",
    });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/request")
      .send({ doctype: "Campaign", docId: "camp-1" });
    expect(res.status).toBe(409);
    expect(prismaMock.marketingApproval.create).not.toHaveBeenCalled();
  });
});

// ─── /approvals/:id/approve ──────────────────────────────────────────

describe("POST /approvals/:id/approve", () => {
  beforeEach(resetMocks);

  it("as MarketingApprover: sets status=Approved + approvedBy + approvedAt", async () => {
    setAuth({ userId: "user-approver", email: "reviewer@example.com", roles: ["MarketingApprover"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    prismaMock.marketingApproval.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({
      ...makeApproval(),
      ...a.data,
    }));
    // Downstream summary + notify
    prismaMock.campaign.findFirst.mockResolvedValue({
      id: "camp-1",
      name: "Summer sale",
      subject: null,
      status: "Draft",
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/appr-1/approve")
      .send({ notes: "LGTM" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Approved");
    const arg = prismaMock.marketingApproval.update.mock.calls[0][0];
    expect(arg.data.status).toBe("Approved");
    expect(arg.data.approvedBy).toBe("user-approver");
    expect(arg.data.approvedAt).toBeInstanceOf(Date);
  });

  it("without an approver role: 403", async () => {
    setAuth({ userId: "user-x", roles: ["SalesUser"] });
    // Simulate loading the row so we can prove no update happened.
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/approve").send({});
    expect(res.status).toBe(403);
    expect(prismaMock.marketingApproval.update).not.toHaveBeenCalled();
  });

  it("refuses to re-approve a non-Pending row (409)", async () => {
    setAuth({ roles: ["MarketingApprover"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({ status: "Approved" }),
    );
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/approve").send({});
    expect(res.status).toBe(409);
    expect(prismaMock.marketingApproval.update).not.toHaveBeenCalled();
  });
});

// ─── /approvals/:id/reject ───────────────────────────────────────────

describe("POST /approvals/:id/reject", () => {
  beforeEach(resetMocks);

  it("stores reason + notifies the requester", async () => {
    setAuth({ userId: "user-approver", email: "reviewer@example.com", roles: ["MarketingApprover"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    prismaMock.marketingApproval.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({
      ...makeApproval(),
      ...a.data,
    }));
    prismaMock.campaign.findFirst.mockResolvedValue({
      id: "camp-1",
      name: "Summer sale",
      subject: null,
      status: "Draft",
    });
    prismaMock.user.findMany.mockResolvedValue([
      { id: "user-requester", email: "requester@example.com" },
    ]);

    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/appr-1/reject")
      .send({ reason: "Subject has unresolved merge var", notes: "please fix and resubmit" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Rejected");
    expect(res.body.rejectionReason).toBe("Subject has unresolved merge var");
    // Notification and email fan-out went to the requester only.
    const notifCall = prismaMock.notification.createMany.mock.calls[0][0];
    expect(notifCall.data).toHaveLength(1);
    expect(notifCall.data[0].userId).toBe("user-requester");
    expect(prismaMock.emailMessage.create).toHaveBeenCalledTimes(1);
  });

  it("missing reason: 400", async () => {
    setAuth({ roles: ["MarketingApprover"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    const app = await buildApp();
    const res = await request(app)
      .post("/approvals/appr-1/reject")
      .send({ notes: "no reason" });
    expect(res.status).toBe(400);
    expect(prismaMock.marketingApproval.update).not.toHaveBeenCalled();
  });
});

// ─── /approvals/:id/withdraw ─────────────────────────────────────────

describe("POST /approvals/:id/withdraw", () => {
  beforeEach(resetMocks);

  it("owner can withdraw a Pending row", async () => {
    setAuth({ userId: "user-requester" });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    prismaMock.marketingApproval.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({
      ...makeApproval(),
      ...a.data,
    }));
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/withdraw");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Withdrawn");
  });

  it("non-owner without SystemManager: 403", async () => {
    setAuth({ userId: "user-other", roles: ["SalesUser"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/withdraw");
    expect(res.status).toBe(403);
    expect(prismaMock.marketingApproval.update).not.toHaveBeenCalled();
  });

  it("SystemManager can withdraw someone else's request", async () => {
    setAuth({ userId: "admin-1", roles: ["SystemManager"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(makeApproval());
    prismaMock.marketingApproval.update.mockResolvedValue(makeApproval({ status: "Withdrawn" }));
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/withdraw");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Withdrawn");
  });

  it("non-Pending row: 409", async () => {
    setAuth({ userId: "user-requester" });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({ status: "Approved" }),
    );
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-1/withdraw");
    expect(res.status).toBe(409);
  });
});

// ─── /approvals/for/:doctype/:docId ─────────────────────────────────

describe("GET /approvals/for/:doctype/:docId", () => {
  beforeEach(resetMocks);

  it("returns 204 when no approval exists", async () => {
    prismaMock.marketingApproval.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).get("/approvals/for/Campaign/camp-1");
    expect(res.status).toBe(204);
  });

  it("returns the latest row when one exists", async () => {
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({ status: "Approved" }),
    );
    const app = await buildApp();
    const res = await request(app).get("/approvals/for/Campaign/camp-1");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Approved");
  });

  it("rejects unsupported doctype", async () => {
    const app = await buildApp();
    const res = await request(app).get("/approvals/for/BogusDoctype/x-1");
    expect(res.status).toBe(400);
  });
});

// ─── checkApprovalRequired (exported helper) ─────────────────────────

describe("checkApprovalRequired", () => {
  beforeEach(resetMocks);

  it("returns ok:true when tenant.requireMarketingApproval=false", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: false });
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(true);
    // Shouldn't have even queried the approval table.
    expect(prismaMock.marketingApproval.findFirst).not.toHaveBeenCalled();
  });

  it("ok:false when tenant flag is true but no approval on file", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: true });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(null);
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no approval on file/i);
  });

  it("ok:false when latest approval is Rejected", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: true });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({ status: "Rejected", rejectionReason: "typo" }),
    );
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Rejected");
  });

  it("ok:false when latest approval is Withdrawn", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: true });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({ status: "Withdrawn" }),
    );
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Withdrawn");
  });

  it("ok:true when the approval is fresh (<30 days)", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: true });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({
        status: "Approved",
        approvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      }),
    );
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(true);
  });

  it("ok:false when the approval is older than 30 days (expiry)", async () => {
    prismaMock.tenant.findUnique.mockResolvedValue({ requireMarketingApproval: true });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(
      makeApproval({
        status: "Approved",
        approvedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
      }),
    );
    const { checkApprovalRequired } = await import("./approvals");
    const r = await checkApprovalRequired(
      prismaMock as unknown as Parameters<typeof checkApprovalRequired>[0],
      "tenant-A",
      "Campaign",
      "camp-1",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/>30d/);
  });
});

// ─── Cross-tenant approval attempt ───────────────────────────────────

describe("cross-tenant access", () => {
  beforeEach(resetMocks);

  it("GET /approvals/:id returns 404 when the row belongs to another tenant", async () => {
    // findFirst is called with tenantId=req.auth.tenantId; a row in tenant-B
    // returns null under that where clause — same as nonexistent.
    prismaMock.marketingApproval.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).get("/approvals/appr-cross-tenant");
    expect(res.status).toBe(404);
  });

  it("POST /approvals/:id/approve on a cross-tenant row: 404", async () => {
    setAuth({ roles: ["MarketingApprover"] });
    prismaMock.marketingApproval.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app).post("/approvals/appr-cross-tenant/approve").send({});
    expect(res.status).toBe(404);
  });
});
