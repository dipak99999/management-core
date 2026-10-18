// P2 — SMS provider adapters + processor tests.
//
// Coverage (6 tests):
//   1. TwilioAdapter success — 201 with sid → providerMessageId returned.
//   2. TwilioAdapter 400 error → surfaces as SmsMessage.Failed + lastError.
//   3. Msg91Adapter success   — {type:"success", request_id} → id returned.
//   4. TestAdapter fallback   — returns a stable "test-…" id.
//   5. Rate-limit throttle    — throttled row stays Pending, attempts not bumped.
//   6. getSmsAdapter          — returns TestAdapter when no TenantIntegration.
//
// The adapter tests use an in-process fetch stub; the processor tests hit
// the actual Express router with prisma + @lumaara/queue mocked at module
// boundary (same pattern as transactional.test.ts).

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Direct adapter tests — no HTTP, no router
// ---------------------------------------------------------------------------

// Import adapter classes directly from the source file (not via the barrel).
// The @lumaara/db barrel triggers Prisma client init + tenant-guard attach,
// which is unnecessary weight for pure-fn adapter tests. The processor tests
// below use vi.mock("@lumaara/db") to intercept the barrel entirely.
import {
  Msg91Adapter,
  TestAdapter,
  TwilioAdapter,
  getSmsAdapter,
} from "../../../../packages/db/src/sms-providers";

describe("TwilioAdapter", () => {
  it("returns providerMessageId on 201", async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ sid: "SMabc123", status: "queued" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const a = new TwilioAdapter("AC_sid", "auth-tok", "+15550000000", "https://api.twilio.com", fetchStub as unknown as typeof fetch);
    const r = await a.send({ to: "+919999999999", body: "hi" });
    expect(r.providerMessageId).toBe("SMabc123");

    // Verify Basic auth + form body were shaped correctly.
    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/2010-04-01/Accounts/AC_sid/Messages.json");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      "Basic " + Buffer.from("AC_sid:auth-tok").toString("base64"),
    );
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("To=%2B919999999999");
    expect(String(init.body)).toContain("From=%2B15550000000");
    expect(String(init.body)).toContain("Body=hi");
  });

  it("throws with Twilio error message on 400", async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ code: 21211, message: "Invalid 'To'" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const a = new TwilioAdapter("AC_sid", "auth-tok", "+15550000000", "https://api.twilio.com", fetchStub as unknown as typeof fetch);
    await expect(a.send({ to: "garbage", body: "hi" })).rejects.toThrow(/Invalid 'To'/);
  });
});

describe("Msg91Adapter", () => {
  it("returns providerMessageId (request_id) on success", async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ type: "success", request_id: "req_abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const a = new Msg91Adapter(
      "authkey-123",
      "SNDRID",
      "4",
      "91",
      "https://control.msg91.com",
      fetchStub as unknown as typeof fetch,
    );
    const r = await a.send({ to: "+919888777666", body: "hello" });
    expect(r.providerMessageId).toBe("req_abc");

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://control.msg91.com/api/v5/flow");
    const headers = init.headers as Record<string, string>;
    expect(headers.authkey).toBe("authkey-123");
    const body = JSON.parse(String(init.body)) as {
      sender: string;
      route: string;
      country: string;
      sms: Array<{ message: string; to: string[] }>;
    };
    expect(body.sender).toBe("SNDRID");
    expect(body.route).toBe("4");
    expect(body.country).toBe("91");
    // '+' stripped so MSG91 accepts it.
    expect(body.sms[0].to).toEqual(["919888777666"]);
    expect(body.sms[0].message).toBe("hello");
  });
});

describe("TestAdapter", () => {
  it("returns a stable test-<...> providerMessageId", async () => {
    const a = new TestAdapter();
    const r = await a.send({ to: "+15551234567", body: "test" });
    expect(r.providerMessageId).toMatch(/^test-\d+-[a-z0-9]+$/);
    expect(a.providerName).toBe("test");
  });
});

describe("getSmsAdapter", () => {
  it("returns TestAdapter when no TenantIntegration exists", async () => {
    const prismaStub = {
      tenantIntegration: {
        findFirst: vi.fn(async () => null),
      },
    } as unknown as Parameters<typeof getSmsAdapter>[0];
    const a = await getSmsAdapter(prismaStub, "tenant-X");
    expect(a.providerName).toBe("test");
    expect(a).toBeInstanceOf(TestAdapter);
  });
});

// ---------------------------------------------------------------------------
// Processor tests — POST /sms/process with adapter + throttle mocked
// ---------------------------------------------------------------------------

// Rate-limit toggle — controlled per test.
let rateLimitAllow = true;
vi.mock("@lumaara/queue", () => ({
  takeToken: vi.fn(async () => rateLimitAllow),
  peekBucket: () => null,
}));

// Adapter injected into the processor. Toggle behavior per test.
let adapterMode: "success" | "fail" = "success";
let capturedSends: Array<{ to: string; body: string }> = [];

vi.mock("@lumaara/db", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/db")>("@lumaara/db");
  return {
    ...actual,
    prisma: makePrismaStub(),
    renderTemplate: (tpl: string, vars: Record<string, unknown>) =>
      tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(vars[k] ?? "")),
    getSmsAdapter: vi.fn(async () => ({
      providerName: "twilio" as const,
      send: async (input: { to: string; body: string }) => {
        capturedSends.push({ to: input.to, body: input.body });
        if (adapterMode === "fail") throw new Error("boom: bad number");
        return { providerMessageId: `sid_${capturedSends.length}` };
      },
    })),
  };
});

vi.mock("@lumaara/service-auth", () => {
  const pass = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: "tenant-A",
      userId: "user-U",
    };
    next();
  };
  return {
    getLogger: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      }),
    }),
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
    requireAuth: pass,
  };
});

// ---- In-memory Prisma stub ----

interface SmsRow {
  id: string;
  tenantId: string;
  toMobile: string;
  body: string;
  status: string;
  attempts: number;
  templateId: string | null;
  senderUserId: string | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  providerMessageId: string | null;
  providerName: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const messages = new Map<string, SmsRow>();
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `sms_${idCounter}`;
}

function makePrismaStub() {
  return {
    smsMessage: {
      findMany: async ({
        where,
        take,
      }: {
        where: { tenantId: string; status: string };
        take?: number;
      }) => {
        const now = Date.now();
        const rows = Array.from(messages.values())
          .filter(
            (m) =>
              m.tenantId === where.tenantId &&
              m.status === where.status &&
              (m.scheduledFor == null || m.scheduledFor.getTime() <= now),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        // Deliberately widen `attempts` — Partial<SmsRow>.attempts is number,
        // but Prisma also accepts a {increment} atomic op object at runtime.
        data: Omit<Partial<SmsRow>, "attempts"> & {
          attempts?: { increment: number } | number;
        };
      }) => {
        const row = messages.get(where.id);
        if (!row) throw new Error("not found: " + where.id);
        const applied: Partial<SmsRow> = { ...data } as Partial<SmsRow>;
        const attempts = data.attempts;
        if (attempts && typeof attempts === "object" && "increment" in attempts) {
          applied.attempts = row.attempts + attempts.increment;
        }
        Object.assign(row, applied);
        return row;
      },
    },
  };
}

async function makeApp() {
  const { smsMessageRouter } = await import("./sms");
  const app = express();
  app.use(express.json());
  app.use("/sms", smsMessageRouter);
  return app;
}

function seedMessage(overrides: Partial<SmsRow> = {}): SmsRow {
  const now = new Date();
  const row: SmsRow = {
    id: nextId(),
    tenantId: "tenant-A",
    toMobile: "+15550000001",
    body: "hello",
    status: "Pending",
    attempts: 0,
    templateId: null,
    senderUserId: "user-U",
    scheduledFor: null,
    sentAt: null,
    deliveredAt: null,
    providerMessageId: null,
    providerName: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  messages.set(row.id, row);
  return row;
}

beforeEach(() => {
  messages.clear();
  idCounter = 0;
  capturedSends = [];
  rateLimitAllow = true;
  adapterMode = "success";
});

// First integration hit into `./sms` pulls in the @lumaara/db barrel, which
// attaches tenant-guard middleware across 193 Prisma models on module init.
// On cold cache the eager init can burn 10-15s before the router even
// responds. Give the whole describe block a generous timeout so this file
// doesn't flake in CI on slow runners.
describe("POST /sms/process", { timeout: 30000 }, () => {
  it("marks row Sent + persists providerMessageId + providerName on success", async () => {
    const app = await makeApp();
    const seeded = seedMessage();
    const res = await request(app).post("/sms/process").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 1, failed: 0, throttled: 0, provider: "twilio" });
    const row = messages.get(seeded.id)!;
    expect(row.status).toBe("Sent");
    expect(row.providerMessageId).toBe("sid_1");
    expect(row.providerName).toBe("twilio");
    expect(row.attempts).toBe(1);
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it("marks row Failed + records lastError when adapter throws", async () => {
    adapterMode = "fail";
    const app = await makeApp();
    const seeded = seedMessage();
    const res = await request(app).post("/sms/process").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, failed: 1 });
    const row = messages.get(seeded.id)!;
    expect(row.status).toBe("Failed");
    expect(row.lastError).toContain("boom: bad number");
    expect(row.attempts).toBe(1); // attempt bumped even on failure
    expect(row.providerName).toBe("twilio");
  });

  it("throttled batch: row stays Pending, attempts NOT bumped, throttled=1", async () => {
    rateLimitAllow = false;
    const app = await makeApp();
    const seeded = seedMessage();
    const res = await request(app).post("/sms/process").send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 0, failed: 0, throttled: 1 });
    const row = messages.get(seeded.id)!;
    expect(row.status).toBe("Pending");
    expect(row.attempts).toBe(0);
    expect(capturedSends).toHaveLength(0);
  });
});
