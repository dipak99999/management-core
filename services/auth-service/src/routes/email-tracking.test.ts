// Unit tests for email-tracking routes. prisma is mocked at the module
// boundary so these are hermetic (no DB). If you're looking for live
// service HTTP tests, see packages/db/src/integration.test.ts.

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ---------------------------------------------------------------

// A hand-rolled prisma stub. Only the fields the router touches exist.
// Each test resets these via vi.mocked(...).mockReset() in beforeEach.
const prismaMock = {
  campaignRecipient: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  campaign: {
    update: vi.fn(),
  },
  emailMessage: {
    findUnique: vi.fn(),
  },
  trackingEvent: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  // Prisma is only used as a namespace for WhereInput typings — an empty
  // object satisfies the router's type-only use.
  Prisma: {},
  prisma: prismaMock,
}));

// requireAuth in this router comes from ../middleware/require-auth which
// uses JWT_SECRET from @lumaara/service-auth. Mock service-auth so we don't
// need any env setup.
vi.mock("@lumaara/service-auth", () => ({
  JWT_SECRET: "test-secret",
}));

// ---- App factory ---------------------------------------------------------

async function buildApp() {
  // Import AFTER mocks are in place.
  const { emailTrackingRouter } = await import("./email-tracking");
  const app = express();
  app.use(express.json());
  app.use("/email/track", emailTrackingRouter);
  return app;
}

function tokenFor(tenantId: string) {
  return jwt.sign(
    { userId: "u1", tenantId, roles: [] },
    "test-secret",
  );
}

// ---- Tests ---------------------------------------------------------------

describe("email-tracking: open pixel", () => {
  beforeEach(() => {
    Object.values(prismaMock).forEach((m) =>
      Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()),
    );
  });

  it("CampaignRecipient path: 200 + counter bump + TrackingEvent(Open)", async () => {
    prismaMock.campaignRecipient.findUnique.mockResolvedValue({
      id: "rec1",
      tenantId: "t1",
      campaignId: "c1",
      trackingId: "tid-c",
      openedAt: null,
      clickedAt: null,
    });
    prismaMock.campaignRecipient.update.mockResolvedValue({});
    prismaMock.campaign.update.mockResolvedValue({});
    prismaMock.trackingEvent.create.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).get("/email/track/open/tid-c.png");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/gif");
    // Recipient row updated
    expect(prismaMock.campaignRecipient.update).toHaveBeenCalledOnce();
    // First-open: campaign totalOpened bumped
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { totalOpened: { increment: 1 } },
    });
    // TrackingEvent row inserted
    expect(prismaMock.trackingEvent.create).toHaveBeenCalledOnce();
    const arg = prismaMock.trackingEvent.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      tenantId: "t1",
      type: "Open",
      campaignId: "c1",
      recipientId: "rec1",
      emailMessageId: null,
    });
    // No EmailMessage lookup on the campaign path
    expect(prismaMock.emailMessage.findUnique).not.toHaveBeenCalled();
  });

  it("EmailMessage path: 200 + TrackingEvent(Open) + no campaign bump", async () => {
    prismaMock.campaignRecipient.findUnique.mockResolvedValue(null);
    prismaMock.emailMessage.findUnique.mockResolvedValue({
      id: "msg1",
      tenantId: "t2",
      trackingId: "tid-m",
      trackingEnabled: true,
    });
    prismaMock.trackingEvent.create.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).get("/email/track/open/tid-m.png");

    expect(res.status).toBe(200);
    expect(prismaMock.emailMessage.findUnique).toHaveBeenCalledWith({
      where: { trackingId: "tid-m" },
    });
    // NO campaign or recipient update on transactional path
    expect(prismaMock.campaignRecipient.update).not.toHaveBeenCalled();
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
    // TrackingEvent recorded
    expect(prismaMock.trackingEvent.create).toHaveBeenCalledOnce();
    const arg = prismaMock.trackingEvent.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      tenantId: "t2",
      type: "Open",
      campaignId: null,
      recipientId: null,
      emailMessageId: "msg1",
    });
  });

  it("Unknown trackingId: 200 GIF, no TrackingEvent write (soft-fail)", async () => {
    prismaMock.campaignRecipient.findUnique.mockResolvedValue(null);
    prismaMock.emailMessage.findUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app).get("/email/track/open/bogus.png");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/gif");
    expect(prismaMock.trackingEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.campaignRecipient.update).not.toHaveBeenCalled();
    expect(prismaMock.campaign.update).not.toHaveBeenCalled();
  });
});

describe("email-tracking: click redirect", () => {
  beforeEach(() => {
    Object.values(prismaMock).forEach((m) =>
      Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()),
    );
  });

  it("CampaignRecipient path: 302 + click bump + TrackingEvent(Click) with targetUrl", async () => {
    prismaMock.campaignRecipient.findUnique.mockResolvedValue({
      id: "rec9",
      tenantId: "tX",
      campaignId: "cX",
      trackingId: "tid-c",
      openedAt: null,
      clickedAt: null,
    });
    prismaMock.campaignRecipient.update.mockResolvedValue({});
    prismaMock.campaign.update.mockResolvedValue({});
    prismaMock.trackingEvent.create.mockResolvedValue({});

    const target = "https://example.com/product?ref=email";
    const app = await buildApp();
    const res = await request(app).get(
      `/email/track/click/tid-c?url=${encodeURIComponent(target)}`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(target);
    expect(prismaMock.campaignRecipient.update).toHaveBeenCalledOnce();
    expect(prismaMock.campaign.update).toHaveBeenCalledWith({
      where: { id: "cX" },
      data: { totalClicked: { increment: 1 } },
    });
    expect(prismaMock.trackingEvent.create).toHaveBeenCalledOnce();
    const arg = prismaMock.trackingEvent.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      tenantId: "tX",
      type: "Click",
      campaignId: "cX",
      recipientId: "rec9",
      targetUrl: target,
    });
  });

  it("Missing url query: 302 to /", async () => {
    prismaMock.campaignRecipient.findUnique.mockResolvedValue(null);
    prismaMock.emailMessage.findUnique.mockResolvedValue(null);

    const app = await buildApp();
    const res = await request(app).get("/email/track/click/tid-none");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(prismaMock.trackingEvent.create).not.toHaveBeenCalled();
  });
});

describe("email-tracking: GET /events (admin)", () => {
  beforeEach(() => {
    Object.values(prismaMock).forEach((m) =>
      Object.values(m).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset()),
    );
  });

  it("requires auth", async () => {
    const app = await buildApp();
    const res = await request(app).get("/email/track/events");
    expect(res.status).toBe(401);
    expect(prismaMock.trackingEvent.findMany).not.toHaveBeenCalled();
  });

  it("tenant-scopes the query and applies filters + limit cap", async () => {
    prismaMock.trackingEvent.findMany.mockResolvedValue([
      { id: "ev1", tenantId: "tenant-A", type: "Open" },
    ]);

    const app = await buildApp();
    const token = tokenFor("tenant-A");
    const res = await request(app)
      .get("/email/track/events?campaignId=c1&type=Open&limit=9999")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "ev1", tenantId: "tenant-A", type: "Open" },
    ]);
    expect(prismaMock.trackingEvent.findMany).toHaveBeenCalledOnce();
    const arg = prismaMock.trackingEvent.findMany.mock.calls[0][0];
    // Tenant scope enforced — never leaks across tenants.
    expect(arg.where).toMatchObject({
      tenantId: "tenant-A",
      campaignId: "c1",
      type: "Open",
    });
    // Limit capped at 500.
    expect(arg.take).toBe(500);
    expect(arg.orderBy).toEqual({ occurredAt: "desc" });
  });

  it("defaults limit to 100 when unspecified", async () => {
    prismaMock.trackingEvent.findMany.mockResolvedValue([]);
    const app = await buildApp();
    const token = tokenFor("tenant-B");
    const res = await request(app)
      .get("/email/track/events")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const arg = prismaMock.trackingEvent.findMany.mock.calls[0][0];
    expect(arg.take).toBe(100);
    expect(arg.where).toEqual({ tenantId: "tenant-B" });
  });
});
