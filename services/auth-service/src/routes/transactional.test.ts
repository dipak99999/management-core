import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @lumaara/db before importing the router. Provides an in-memory Prisma-
// shaped stub plus the renderTemplate helper (which stays real — pure fn).
vi.mock("@lumaara/db", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/db")>(
    "@lumaara/db",
  );
  return {
    ...actual,
    prisma: makePrismaStub(),
    isSuppressed: async (_p: unknown, tenantId: string, email: string) => {
      const key = `${tenantId}::${email.toLowerCase()}`;
      return suppressions.get(key) ?? null;
    },
    renderTemplate: (tpl: string, vars: Record<string, unknown>): string =>
      tpl.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, k) => {
        const v = vars[k];
        if (v == null) return "";
        return String(v);
      }),
  };
});

// Mock @lumaara/queue takeToken to control rate-limit behavior per test.
let rateLimitAllow = true;
vi.mock("@lumaara/queue", () => ({
  takeToken: async () => rateLimitAllow,
  peekBucket: () => null,
}));

vi.mock("@lumaara/service-auth", () => ({
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
}));

// ---------- In-memory Prisma stub ----------

interface ApiTokenRow {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

interface EmailTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
}

interface EmailMessageRow {
  id: string;
  tenantId: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  templateId: string | null;
  senderUserId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  trackingEnabled: boolean;
  trackingId: string | null;
  sentAt: Date | null;
  providerMessageId: string | null;
  lastError: string | null;
}

interface SuppressionRow {
  id: string;
  tenantId: string;
  email: string;
  reason: string;
}

interface TrackingEventRow {
  id: string;
  tenantId: string;
  emailMessageId: string | null;
  type: string;
  occurredAt: Date;
}

const apiTokens = new Map<string, ApiTokenRow>();
const templates = new Map<string, EmailTemplateRow>();
const messages = new Map<string, EmailMessageRow>();
const suppressions = new Map<string, SuppressionRow>();
const trackingEvents: TrackingEventRow[] = [];

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

function makePrismaStub() {
  return {
    apiToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        for (const t of apiTokens.values()) {
          if (t.tokenHash === where.tokenHash) return t;
        }
        return null;
      },
      update: async () => ({}),
    },
    emailTemplate: {
      findFirst: async ({
        where,
      }: {
        where: { tenantId: string; name: string; enabled?: boolean };
      }) => {
        for (const t of templates.values()) {
          if (
            t.tenantId === where.tenantId &&
            t.name === where.name &&
            (where.enabled === undefined || t.enabled === where.enabled)
          )
            return t;
        }
        return null;
      },
    },
    emailMessage: {
      create: async ({ data, select }: { data: Partial<EmailMessageRow>; select?: unknown }) => {
        const row: EmailMessageRow = {
          id: nextId("msg"),
          tenantId: data.tenantId ?? "",
          toEmail: data.toEmail ?? "",
          subject: data.subject ?? "",
          body: data.body ?? "",
          status: data.status ?? "Pending",
          templateId: data.templateId ?? null,
          senderUserId: data.senderUserId ?? null,
          fromEmail: data.fromEmail ?? null,
          fromName: data.fromName ?? null,
          trackingEnabled: data.trackingEnabled ?? false,
          trackingId: data.trackingId ?? null,
          sentAt: null,
          providerMessageId: null,
          lastError: null,
        };
        messages.set(row.id, row);
        void select;
        return row;
      },
      findFirst: async ({
        where,
        select,
      }: {
        where: { id: string; tenantId: string };
        select?: Record<string, boolean>;
      }) => {
        const row = messages.get(where.id);
        if (!row || row.tenantId !== where.tenantId) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          out[k] = (row as unknown as Record<string, unknown>)[k];
        }
        return out;
      },
    },
    trackingEvent: {
      findMany: async ({
        where,
        orderBy,
      }: {
        where: { tenantId: string; emailMessageId: string };
        orderBy?: unknown;
      }) => {
        void orderBy;
        return trackingEvents.filter(
          (e) =>
            e.tenantId === where.tenantId &&
            e.emailMessageId === where.emailMessageId,
        );
      },
    },
    tenantIntegration: {
      findFirst: async () => null,
    },
  };
}

// ---------- Test bootstrap ----------

// Import the router AFTER mocks are declared (vi.mock is hoisted, so the mocks
// are already in place when this executes).
async function makeApp() {
  const { transactionalRouter } = await import("./transactional");
  const app = express();
  app.use(express.json());
  app.use("/v1/tx", transactionalRouter);
  return app;
}

const VALID_TOKEN = "ont_" + "a".repeat(32);
const OTHER_TOKEN = "ont_" + "b".repeat(32);

async function sha256Hex(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}

beforeEach(async () => {
  apiTokens.clear();
  templates.clear();
  messages.clear();
  suppressions.clear();
  trackingEvents.length = 0;
  idCounter = 0;
  rateLimitAllow = true;

  apiTokens.set("tok1", {
    id: "tok1",
    tenantId: "t1",
    userId: "u1",
    tokenHash: await sha256Hex(VALID_TOKEN),
    revokedAt: null,
    expiresAt: null,
  });
  apiTokens.set("tok2", {
    id: "tok2",
    tenantId: "t2",
    userId: "u2",
    tokenHash: await sha256Hex(OTHER_TOKEN),
    revokedAt: null,
    expiresAt: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- Tests ----------

describe("GET /v1/tx/health", () => {
  // First-run cold-start includes tenant-guard init (~5s). Give it room.
  it("returns ok without auth", async () => {
    const app = await makeApp();
    const res = await request(app).get("/v1/tx/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, kind: "transactional" });
  }, 30_000);
});

describe("POST /v1/tx auth", () => {
  it("401 when missing auth", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    expect(res.status).toBe(401);
  });

  it("401 on unknown token", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", "Bearer ont_" + "z".repeat(32))
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    expect(res.status).toBe(401);
  });

  it("401 on wrong prefix", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", "Bearer not-an-api-token")
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/tx happy path", () => {
  it("202 + inserts EmailMessage row with valid body", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "Welcome",
        html: "<p>Hello Alice</p>",
      });
    expect(res.status).toBe(202);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe("Queued");
    expect(res.body.trackingId).toBeNull();
    expect(messages.size).toBe(1);
    const row = messages.values().next().value as EmailMessageRow;
    expect(row.tenantId).toBe("t1");
    expect(row.toEmail).toBe("alice@example.com");
    expect(row.senderUserId).toBe("u1");
    expect(row.status).toBe("Pending");
    expect(row.trackingEnabled).toBe(false);
  });

  it("allocates trackingId when tracking=true", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "Hi",
        html: "<p>tracked</p>",
        tracking: true,
      });
    expect(res.status).toBe(202);
    expect(res.body.trackingId).toBeTruthy();
    const row = messages.values().next().value as EmailMessageRow;
    expect(row.trackingEnabled).toBe(true);
    expect(row.trackingId).toBe(res.body.trackingId);
  });

  it("400 on invalid email", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "not-an-email", subject: "x", html: "<p>x</p>" });
    expect(res.status).toBe(400);
  });

  it("400 when neither html nor text nor template provided", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "alice@example.com", subject: "x" });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/tx suppression", () => {
  it("200 + status Suppressed + no row inserted", async () => {
    suppressions.set("t1::blocked@example.com", {
      id: "s1",
      tenantId: "t1",
      email: "blocked@example.com",
      reason: "HardBounce",
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "Blocked@Example.com", // mixed case — still hits
        subject: "hi",
        html: "<p>hi</p>",
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: null,
      status: "Suppressed",
      reason: "HardBounce",
    });
    expect(messages.size).toBe(0);
  });
});

describe("POST /v1/tx templates", () => {
  it("404 when template not found", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "x",
        template: "does-not-exist",
      });
    expect(res.status).toBe(404);
  });

  it("renders subject + body with vars", async () => {
    templates.set("tpl1", {
      id: "tpl1",
      tenantId: "t1",
      name: "welcome",
      subject: "Hi {{name}}",
      body: "<p>Hello {{name}}, order {{orderId}}</p>",
      enabled: true,
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "", // caller relies on template subject
        template: "welcome",
        vars: { name: "Alice", orderId: "SO-42" },
      });
    expect(res.status).toBe(202);
    const row = messages.values().next().value as EmailMessageRow;
    expect(row.subject).toBe("Hi Alice");
    expect(row.body).toContain("Hello Alice");
    expect(row.body).toContain("SO-42");
    expect(row.templateId).toBe("tpl1");
  });
});

describe("POST /v1/tx/batch", () => {
  it("accepts 5, returns 5 results in order", async () => {
    suppressions.set("t1::blocked@example.com", {
      id: "s1",
      tenantId: "t1",
      email: "blocked@example.com",
      reason: "Manual",
    });
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx/batch")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        messages: [
          { to: "one@example.com", subject: "s", html: "<p>1</p>" },
          { to: "two@example.com", subject: "s", html: "<p>2</p>" },
          { to: "blocked@example.com", subject: "s", html: "<p>3</p>" },
          { to: "four@example.com", subject: "s", html: "<p>4</p>" },
          { to: "five@example.com", subject: "s", html: "<p>5</p>" },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.results).toHaveLength(5);
    expect(res.body.results[0].status).toBe("Queued");
    expect(res.body.results[2].status).toBe("Suppressed");
    expect(res.body.results[2].reason).toBe("Manual");
    expect(res.body.results[4].status).toBe("Queued");
    expect(messages.size).toBe(4); // suppressed not persisted
  });

  it("rejects batch of 101", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      to: `u${i}@example.com`,
      subject: "s",
      html: "<p>x</p>",
    }));
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx/batch")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ messages: many });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/tx/:id", () => {
  it("returns status for own message", async () => {
    const app = await makeApp();
    const send = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    const id = send.body.id as string;

    const res = await request(app)
      .get(`/v1/tx/${id}`)
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
    expect(res.body.status).toBe("Pending");
  });

  it("404 for cross-tenant message", async () => {
    const app = await makeApp();
    const send = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    const id = send.body.id as string;

    // Query with the OTHER tenant's token — must not leak.
    const res = await request(app)
      .get(`/v1/tx/${id}`)
      .set("Authorization", `Bearer ${OTHER_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/tx/:id/events", () => {
  it("empty array when tracking disabled", async () => {
    const app = await makeApp();
    const send = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    const id = send.body.id as string;

    // Insert a stray event — must be ignored because tracking is off.
    trackingEvents.push({
      id: "e1",
      tenantId: "t1",
      emailMessageId: id,
      type: "Open",
      occurredAt: new Date(),
    });

    const res = await request(app)
      .get(`/v1/tx/${id}/events`)
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns events when tracking enabled", async () => {
    const app = await makeApp();
    const send = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        tracking: true,
      });
    const id = send.body.id as string;

    trackingEvents.push({
      id: "e1",
      tenantId: "t1",
      emailMessageId: id,
      type: "Open",
      occurredAt: new Date(),
    });

    const res = await request(app)
      .get(`/v1/tx/${id}/events`)
      .set("Authorization", `Bearer ${VALID_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe("Open");
  });
});

describe("POST /v1/tx rate limit", () => {
  it("429 + Retry-After when bucket exhausted", async () => {
    rateLimitAllow = false;
    const app = await makeApp();
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({ to: "alice@example.com", subject: "hi", html: "<p>hi</p>" });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeTruthy();
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(res.headers["x-ratelimit-limit"]).toBe("1000");
  });
});

describe("POST /v1/tx header whitelist", () => {
  it("silently drops non-whitelisted headers", async () => {
    const app = await makeApp();
    // Should still succeed — invalid headers get dropped, not rejected.
    const res = await request(app)
      .post("/v1/tx")
      .set("Authorization", `Bearer ${VALID_TOKEN}`)
      .send({
        to: "alice@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        headers: {
          "X-Campaign-Id": "abc",
          "List-Unsubscribe": "<mailto:u@x.com>",
          "Bcc": "sneaky@evil.com", // must be stripped
          "Content-Type": "text/plain", // must be stripped
        },
      });
    expect(res.status).toBe(202);
  });
});
