// Unit tests for webinars routes — Marketing P3.
//
// Prisma + service-auth + the Zoom adapter factory are mocked at the module
// boundary so this suite is hermetic (no live Postgres, no real Zoom calls).
// Follows the same pattern as campaigns.test.ts.
//
// Coverage:
//   * POST /   — no integration → saves Draft locally, no externalId
//   * POST /   — Zoom integration present → adapter.create called + fields
//     persisted (externalId, joinUrl, hostUrl)
//   * POST /:id/register — 401 when webinar has no registerFormId
//   * POST /:id/register — 201 + row created + Zoom adapter.addRegistrant
//     called with the per-registrant join URL echoed in the response
//   * POST /:id/register — duplicate (webinarId, email) → 200 alreadyRegistered
//   * PATCH /:id/registrations/:regId — Attended sets attendedAt + status
//   * POST /:id/mark-ended — computes actualAttendees from attendedAt count
//   * DELETE /:id — calls adapter.delete when externalId present
//   * POST /:id/registrations/import — bulk create; unique conflicts → skipped

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ---------------------------------------------------------------

const prismaMock = {
  webinarEvent: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  webinarRegistration: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  webForm: {
    findFirst: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
  },
  emailMessage: {
    create: vi.fn(),
  },
};

// Mocked factory + trigger helpers — swappable per-test.
const getWebinarAdapterMock = vi.fn();
const fireJourneyTriggerMock = vi.fn();
const recordTouchpointMock = vi.fn();

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
  getWebinarAdapter: getWebinarAdapterMock,
  fireJourneyTrigger: fireJourneyTriggerMock,
  recordTouchpoint: recordTouchpointMock,
  // withCrossTenant just returns its arg unchanged in tests — the tenant
  // guard doesn't run against our mock prisma anyway.
  withCrossTenant: <T,>(args: T) => args,
}));

// perms + requireAuth pass-through — stamp req.auth so downstream handlers
// see a valid tenant context.
vi.mock("@lumaara/service-auth", () => {
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
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
    requireAuth: pass,
    // Idempotency middleware — pass-through in tests. The real one would
    // short-circuit with a cached response on duplicate Idempotency-Key,
    // which the webinars suite doesn't exercise.
    idempotency: () => pass,
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  };
});

// ---- App factory + reset helper -----------------------------------------

async function buildApp() {
  const { webinarsRouter } = await import("./webinars");
  const app = express();
  app.use(express.json());
  app.use("/webinars", webinarsRouter);
  return app;
}

function resetMocks() {
  for (const [, group] of Object.entries(prismaMock)) {
    for (const fn of Object.values(group)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  getWebinarAdapterMock.mockReset();
  fireJourneyTriggerMock.mockReset();
  recordTouchpointMock.mockReset();

  // Default: no adapter available (tests override when they want provisioning).
  getWebinarAdapterMock.mockResolvedValue(null);
  fireJourneyTriggerMock.mockResolvedValue({ enrolled: 0 });
  recordTouchpointMock.mockResolvedValue({});
  // Default: capacity check + duplicate lookup both return "empty".
  prismaMock.webinarRegistration.count.mockResolvedValue(0);
  prismaMock.webinarRegistration.findFirst.mockResolvedValue(null);
  prismaMock.lead.findFirst.mockResolvedValue(null);
  prismaMock.customer.findFirst.mockResolvedValue(null);
}

function makeWebinar(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "web-1",
    tenantId: "tenant-A",
    name: "Q1 Launch",
    description: "Big product launch",
    status: "Draft",
    provider: "Zoom",
    externalId: null,
    joinUrl: null,
    hostUrl: null,
    startAt: new Date("2026-12-01T10:00:00.000Z"),
    endAt: new Date("2026-12-01T11:00:00.000Z"),
    timezone: "Asia/Kolkata",
    capacity: null,
    registerFormId: null,
    actualAttendees: 0,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

// ---- Create -------------------------------------------------------------

describe("POST /webinars", () => {
  beforeEach(resetMocks);

  it("saves Draft locally when no Zoom integration exists (adapter=null)", async () => {
    // getWebinarAdapter default = null (no integration).
    prismaMock.webinarEvent.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "web-1", ...args.data }),
    );

    const app = await buildApp();
    const res = await request(app)
      .post("/webinars")
      .send({
        name: "Q1 Launch",
        provider: "Zoom",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T11:00:00.000Z",
        timezone: "Asia/Kolkata",
      });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe("Zoom");
    expect(res.body.status).toBe("Draft");
    expect(res.body.externalId).toBeNull();
    expect(res.body.joinUrl).toBeNull();
    expect(res.body.hostUrl).toBeNull();
    expect(getWebinarAdapterMock).toHaveBeenCalledWith(prismaMock, "tenant-A", "Zoom");
  });

  it("provisions on Zoom when integration is present + persists externalId/joinUrl/hostUrl", async () => {
    const createMock = vi.fn().mockResolvedValue({
      externalId: "zoom-999",
      joinUrl: "https://zoom.us/j/999",
      hostUrl: "https://zoom.us/s/999",
    });
    getWebinarAdapterMock.mockResolvedValue({
      providerName: "Zoom",
      create: createMock,
      update: vi.fn(),
      delete: vi.fn(),
      addRegistrant: vi.fn(),
    });
    prismaMock.webinarEvent.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "web-1", ...args.data }),
    );

    const app = await buildApp();
    const res = await request(app)
      .post("/webinars")
      .send({
        name: "Q1 Launch",
        description: "Big launch",
        provider: "Zoom",
        startAt: "2026-12-01T10:00:00.000Z",
        endAt: "2026-12-01T11:00:00.000Z",
        timezone: "Asia/Kolkata",
      });

    expect(res.status).toBe(201);
    expect(res.body.externalId).toBe("zoom-999");
    expect(res.body.joinUrl).toBe("https://zoom.us/j/999");
    expect(res.body.hostUrl).toBe("https://zoom.us/s/999");
    expect(createMock).toHaveBeenCalledOnce();
    const arg = createMock.mock.calls[0][0];
    expect(arg.topic).toBe("Q1 Launch");
    expect(arg.timezone).toBe("Asia/Kolkata");
    expect(arg.agenda).toBe("Big launch");
    expect(arg.startAt).toBeInstanceOf(Date);
    expect(arg.endAt).toBeInstanceOf(Date);
  });

  it("400 when endAt <= startAt", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/webinars")
      .send({
        name: "Bad times",
        provider: "Manual",
        startAt: "2026-12-01T11:00:00.000Z",
        endAt: "2026-12-01T10:00:00.000Z",
        timezone: "UTC",
      });
    expect(res.status).toBe(400);
  });
});

// ---- Public register ----------------------------------------------------

describe("POST /webinars/:id/register (public)", () => {
  beforeEach(resetMocks);

  it("401 when webinar has no registerFormId (spam gate)", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({ registerFormId: null }),
    );
    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/register")
      .send({ email: "alice@example.com" });
    expect(res.status).toBe(401);
  });

  it("404 when the webinar id does not exist", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/nope/register")
      .send({ email: "alice@example.com" });
    expect(res.status).toBe(404);
  });

  it("201 + creates registration + calls Zoom addRegistrant + echoes per-registrant join_url", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({
        registerFormId: "form-1",
        externalId: "zoom-42",
        provider: "Zoom",
        status: "Scheduled",
        joinUrl: "https://zoom.us/j/shared",
      }),
    );
    const addRegistrantMock = vi.fn().mockResolvedValue({
      join_url: "https://zoom.us/j/personal-abc",
    });
    getWebinarAdapterMock.mockResolvedValue({
      providerName: "Zoom",
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      addRegistrant: addRegistrantMock,
    });
    prismaMock.webinarRegistration.create.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "reg-1", ...args.data }),
    );

    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/register")
      .send({ email: "alice@example.com", name: "Alice Kim" });

    expect(res.status).toBe(201);
    expect(res.body.joinUrl).toBe("https://zoom.us/j/personal-abc");
    expect(addRegistrantMock).toHaveBeenCalledOnce();
    const arg = addRegistrantMock.mock.calls[0][0];
    expect(arg).toBe("zoom-42");
    const reg = addRegistrantMock.mock.calls[0][1];
    expect(reg.email).toBe("alice@example.com");
    expect(reg.firstName).toBe("Alice");
    expect(reg.lastName).toBe("Kim");
    // The registration row was persisted with the per-registrant URL prefixed
    // in notes so the reminder path can reuse it.
    const createArg = prismaMock.webinarRegistration.create.mock.calls[0][0];
    expect(createArg.data.notes).toBe("join_url:https://zoom.us/j/personal-abc");
  });

  it("200 alreadyRegistered on duplicate email (idempotent public UX)", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({
        registerFormId: "form-1",
        status: "Scheduled",
        joinUrl: "https://zoom.us/j/shared",
      }),
    );
    prismaMock.webinarRegistration.findFirst.mockResolvedValue({
      id: "reg-1",
      email: "alice@example.com",
      status: "Registered",
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/register")
      .send({ email: "alice@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.alreadyRegistered).toBe(true);
    expect(res.body.joinUrl).toBe("https://zoom.us/j/shared");
    // No create call fires on the duplicate path.
    expect(prismaMock.webinarRegistration.create).not.toHaveBeenCalled();
  });

  it("409 when capacity is reached", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({
        registerFormId: "form-1",
        status: "Scheduled",
        capacity: 10,
      }),
    );
    prismaMock.webinarRegistration.count.mockResolvedValue(10);
    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/register")
      .send({ email: "alice@example.com" });
    expect(res.status).toBe(409);
    expect(prismaMock.webinarRegistration.create).not.toHaveBeenCalled();
  });
});

// ---- Registration status updates ---------------------------------------

describe("PATCH /webinars/:id/registrations/:regId", () => {
  beforeEach(resetMocks);

  it("Attended → sets attendedAt + status", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(makeWebinar({ id: "web-1" }));
    prismaMock.webinarRegistration.findFirst.mockResolvedValue({
      id: "reg-1",
      webinarId: "web-1",
      attendedAt: null,
      contactType: null,
      contactId: null,
      status: "Registered",
    });
    prismaMock.webinarRegistration.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "reg-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .patch("/webinars/web-1/registrations/reg-1")
      .send({ status: "Attended" });
    expect(res.status).toBe(200);
    const arg = prismaMock.webinarRegistration.update.mock.calls[0][0];
    expect(arg.data.status).toBe("Attended");
    expect(arg.data.attendedAt).toBeInstanceOf(Date);
  });

  it("NoShow → clears attendedAt", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(makeWebinar({ id: "web-1" }));
    prismaMock.webinarRegistration.findFirst.mockResolvedValue({
      id: "reg-1",
      webinarId: "web-1",
      attendedAt: new Date(),
      status: "Attended",
    });
    prismaMock.webinarRegistration.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "reg-1", ...args.data }),
    );
    const app = await buildApp();
    const res = await request(app)
      .patch("/webinars/web-1/registrations/reg-1")
      .send({ status: "NoShow" });
    expect(res.status).toBe(200);
    const arg = prismaMock.webinarRegistration.update.mock.calls[0][0];
    expect(arg.data.attendedAt).toBeNull();
  });
});

// ---- Mark-ended computes actualAttendees --------------------------------

describe("POST /webinars/:id/mark-ended", () => {
  beforeEach(resetMocks);

  it("counts attendedAt-set rows and stamps actualAttendees", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({ id: "web-1", status: "Live" }),
    );
    prismaMock.webinarRegistration.count.mockResolvedValue(37);
    prismaMock.webinarEvent.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      ({ id: "web-1", ...args.data }),
    );

    const app = await buildApp();
    const res = await request(app).post("/webinars/web-1/mark-ended");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Ended");
    expect(res.body.actualAttendees).toBe(37);
    // Prisma count was called with the attendedAt filter.
    const countArg = prismaMock.webinarRegistration.count.mock.calls[0][0];
    expect(countArg.where.attendedAt).toEqual({ not: null });
  });

  it("409 from Draft (not Live/Scheduled)", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({ status: "Draft" }),
    );
    const app = await buildApp();
    const res = await request(app).post("/webinars/web-1/mark-ended");
    expect(res.status).toBe(409);
  });
});

// ---- DELETE also removes the provider-side meeting ---------------------

describe("DELETE /webinars/:id", () => {
  beforeEach(resetMocks);

  it("calls adapter.delete when externalId + adapter present", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({ externalId: "zoom-999", provider: "Zoom" }),
    );
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    getWebinarAdapterMock.mockResolvedValue({
      providerName: "Zoom",
      create: vi.fn(),
      update: vi.fn(),
      delete: deleteMock,
      addRegistrant: vi.fn(),
    });
    prismaMock.webinarEvent.delete.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).delete("/webinars/web-1");
    expect(res.status).toBe(204);
    expect(deleteMock).toHaveBeenCalledWith("zoom-999");
    expect(prismaMock.webinarEvent.delete).toHaveBeenCalledOnce();
  });

  it("Manual webinars skip the adapter delete step", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(
      makeWebinar({ externalId: null, provider: "Manual" }),
    );
    prismaMock.webinarEvent.delete.mockResolvedValue({});

    const app = await buildApp();
    const res = await request(app).delete("/webinars/web-1");
    expect(res.status).toBe(204);
    expect(getWebinarAdapterMock).not.toHaveBeenCalled();
    expect(prismaMock.webinarEvent.delete).toHaveBeenCalledOnce();
  });
});

// ---- Bulk import --------------------------------------------------------

describe("POST /webinars/:id/registrations/import", () => {
  beforeEach(resetMocks);

  it("creates rows + counts duplicates as skipped", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(makeWebinar({ id: "web-1" }));
    // First two succeed, third throws a unique-constraint error.
    let call = 0;
    prismaMock.webinarRegistration.create.mockImplementation(async () => {
      call++;
      if (call === 3) {
        throw new Error("Unique constraint failed on webinar_registrations");
      }
      return { id: `reg-${call}` };
    });

    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/registrations/import")
      .send({
        rows: [
          { email: "a@example.com" },
          { email: "b@example.com", name: "Bob" },
          { email: "dup@example.com" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors).toEqual([]);
  });

  it("400 on empty rows", async () => {
    prismaMock.webinarEvent.findFirst.mockResolvedValue(makeWebinar({ id: "web-1" }));
    const app = await buildApp();
    const res = await request(app)
      .post("/webinars/web-1/registrations/import")
      .send({ rows: [] });
    expect(res.status).toBe(400);
  });
});
