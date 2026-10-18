// Unit tests for whatsapp routes — template CRUD + send + webhook.
//
// The @lumaara/db surface is mocked entirely at the module boundary so this
// suite is hermetic (no Postgres, no Meta calls). We also mock
// @lumaara/queue.takeToken (always returns true) so the /process loop is
// exercised without hitting the real bucket.
//
// A minimal in-memory store tracks WhatsappTemplate + WhatsappMessage +
// TenantIntegration rows so each test can assert side-effects.
//
// Coverage (per plan):
//   • Templates list DB path
//   • Send POST creates Pending row
//   • /process with no integration: row Failed + lastError="No WhatsApp integration"
//   • webhook challenge: matching verify token → 200 + challenge
//   • webhook challenge: mismatched token → 401
//   • webhook POST: invalid signature → 401
//   • webhook POST: status "delivered" → deliveredAt + status update
//   • webhook POST: status "read" → readAt + status="Read"
//   • webhook POST: inbound message → new row with direction=inbound
//   • webhook POST: unknown tenantSlug → 404
//   • WhatsappClient.verifyWebhookSignature: valid / invalid

import express from "express";
import request from "supertest";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Types + state --------------------------------------------------

interface WhatsappTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  category: string;
  language: string;
  status: string;
  headerType: string | null;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  variables: unknown;
  wabaTemplateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WhatsappMessageRow {
  id: string;
  tenantId: string;
  direction: string;
  toMobile: string;
  fromMobile: string | null;
  templateId: string | null;
  body: string;
  mediaUrl: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  senderUserId: string | null;
  linkedDoctype: string | null;
  linkedId: string | null;
  scheduledFor: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  providerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TenantIntegrationRow {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  config: unknown;
  secrets: Record<string, unknown>;
}

const state: {
  tenants: Map<string, string>; // slug → id
  templates: WhatsappTemplateRow[];
  messages: WhatsappMessageRow[];
  integrations: TenantIntegrationRow[];
} = {
  tenants: new Map(),
  templates: [],
  messages: [],
  integrations: [],
};

let idSeq = 0;
const nextId = (prefix = "id") => `${prefix}_${++idSeq}`;

// ---------- Fake client instance the router can pick up --------------------
//
// getWhatsappClient() is mocked to return `mockClient` (or null in the
// no-integration test). Each per-test scenario overwrites the mock impl
// before hitting the router.

const mockClient: {
  sendTemplate: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  createTemplate: ReturnType<typeof vi.fn>;
  listTemplates: ReturnType<typeof vi.fn>;
  deleteTemplate: ReturnType<typeof vi.fn>;
} = {
  sendTemplate: vi.fn(),
  sendText: vi.fn(),
  createTemplate: vi.fn(),
  listTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
};

let getWhatsappClientImpl: () => Promise<typeof mockClient | null> = async () => mockClient;

// ---------- @lumaara/db mock ----------------------------------------------

vi.mock("@lumaara/db", async () => {
  // Import the real whatsapp module so we can re-export WhatsappClient +
  // its verify helper (which is a pure static function and DOES need to be
  // real — it's the very thing the webhook signature test asserts).
  const realWhatsapp = await vi.importActual<
    typeof import("../../../../packages/db/src/whatsapp")
  >("../../../../packages/db/src/whatsapp");

  const prismaStub = {
    tenant: {
      findFirst: async ({ where }: { where: { slug: string } }) => {
        const id = state.tenants.get(where.slug);
        return id ? { id } : null;
      },
    },
    tenantIntegration: {
      findFirst: async ({
        where,
      }: {
        where: { tenantId: string; provider: string; isActive?: boolean };
      }) => {
        return (
          state.integrations.find(
            (r) =>
              r.tenantId === where.tenantId &&
              r.provider === where.provider &&
              (where.isActive === undefined || r.isActive === where.isActive),
          ) ?? null
        );
      },
    },
    whatsappTemplate: {
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        state.templates.filter((t) => t.tenantId === where.tenantId),
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          tenantId?: string;
          name?: string;
          language?: string;
        };
      }) =>
        state.templates.find(
          (t) =>
            (where.id === undefined || t.id === where.id) &&
            (where.tenantId === undefined || t.tenantId === where.tenantId) &&
            (where.name === undefined || t.name === where.name) &&
            (where.language === undefined || t.language === where.language),
        ) ?? null,
      create: async ({ data }: { data: Partial<WhatsappTemplateRow> }) => {
        // Enforce (tenantId, name, language) unique to mirror the real schema.
        const dup = state.templates.find(
          (t) =>
            t.tenantId === data.tenantId &&
            t.name === data.name &&
            t.language === data.language,
        );
        if (dup) throw new Error("Unique constraint failed on the fields: (tenantId,name,language)");
        const row: WhatsappTemplateRow = {
          id: nextId("tpl"),
          tenantId: String(data.tenantId),
          name: String(data.name),
          category: String(data.category ?? "UTILITY"),
          language: String(data.language ?? "en_US"),
          status: String(data.status ?? "PENDING"),
          headerType: data.headerType ?? null,
          headerText: data.headerText ?? null,
          bodyText: String(data.bodyText ?? ""),
          footerText: data.footerText ?? null,
          variables: data.variables ?? null,
          wabaTemplateId: data.wabaTemplateId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.templates.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<WhatsappTemplateRow>;
      }) => {
        const idx = state.templates.findIndex((t) => t.id === where.id);
        if (idx < 0) throw new Error("not found");
        state.templates[idx] = { ...state.templates[idx]!, ...data, updatedAt: new Date() };
        return state.templates[idx];
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = state.templates.findIndex((t) => t.id === where.id);
        if (idx >= 0) state.templates.splice(idx, 1);
        return { id: where.id };
      },
    },
    whatsappMessage: {
      findMany: async ({
        where,
        take,
      }: {
        where: {
          tenantId?: string;
          direction?: string;
          status?: string;
        };
        take?: number;
      }) => {
        let rows = state.messages.filter(
          (m) =>
            (where.tenantId === undefined || m.tenantId === where.tenantId) &&
            (where.direction === undefined || m.direction === where.direction) &&
            (where.status === undefined || m.status === where.status),
        );
        if (take) rows = rows.slice(0, take);
        return rows;
      },
      findFirst: async ({
        where,
      }: {
        where: {
          tenantId?: string;
          providerMessageId?: string;
          direction?: string;
          id?: string;
        };
      }) =>
        state.messages.find(
          (m) =>
            (where.id === undefined || m.id === where.id) &&
            (where.tenantId === undefined || m.tenantId === where.tenantId) &&
            (where.direction === undefined || m.direction === where.direction) &&
            (where.providerMessageId === undefined ||
              m.providerMessageId === where.providerMessageId),
        ) ?? null,
      create: async ({ data }: { data: Partial<WhatsappMessageRow> }) => {
        const row: WhatsappMessageRow = {
          id: nextId("msg"),
          tenantId: String(data.tenantId),
          direction: String(data.direction ?? "outbound"),
          toMobile: String(data.toMobile ?? ""),
          fromMobile: data.fromMobile ?? null,
          templateId: data.templateId ?? null,
          body: String(data.body ?? ""),
          mediaUrl: data.mediaUrl ?? null,
          status: String(data.status ?? "Pending"),
          attempts: Number(data.attempts ?? 0),
          lastError: data.lastError ?? null,
          senderUserId: data.senderUserId ?? null,
          linkedDoctype: data.linkedDoctype ?? null,
          linkedId: data.linkedId ?? null,
          scheduledFor: (data.scheduledFor as Date | null | undefined) ?? null,
          sentAt: (data.sentAt as Date | null | undefined) ?? null,
          deliveredAt: (data.deliveredAt as Date | null | undefined) ?? null,
          readAt: (data.readAt as Date | null | undefined) ?? null,
          providerMessageId: data.providerMessageId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.messages.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const idx = state.messages.findIndex((m) => m.id === where.id);
        if (idx < 0) throw new Error("not found");
        const cur = state.messages[idx]!;
        // Handle attempts:{increment: 1} shape
        const attemptDelta = (data.attempts as { increment?: number } | undefined)?.increment;
        const flat: Record<string, unknown> = { ...data };
        delete flat.attempts;
        if (attemptDelta) flat.attempts = cur.attempts + attemptDelta;
        state.messages[idx] = { ...cur, ...(flat as Partial<WhatsappMessageRow>), updatedAt: new Date() };
        return state.messages[idx];
      },
    },
  };

  return {
    prisma: prismaStub,
    decryptSecrets: (v: unknown) =>
      v && typeof v === "object" ? (v as Record<string, unknown>) : {},
    withCrossTenant: <T extends object>(a: T) => a,
    // Real class + verifyWebhookSignature is required by the router's
    // signature-check code path.
    WhatsappClient: realWhatsapp.WhatsappClient,
    WhatsappApiError: realWhatsapp.WhatsappApiError,
    // Return the per-test-scoped mock client (or null).
    getWhatsappClient: async () => getWhatsappClientImpl(),
  };
});

vi.mock("@lumaara/queue", () => ({
  takeToken: async () => true,
}));

vi.mock("@lumaara/service-auth", () => {
  const pass = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: TENANT_ID,
      userId: "user-U",
    };
    next();
  };
  return {
    requireAuth: pass,
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
    getLogger: () => ({
      child: () => ({
        info: () => {},
        warn: () => {},
        debug: () => {},
        error: () => {},
      }),
      info: () => {},
      warn: () => {},
      debug: () => {},
      error: () => {},
    }),
  };
});

// ---------- Constants + app factory ---------------------------------------

const TENANT_ID = "tenant_abc";
const TENANT_SLUG = "acme";
const APP_SECRET = "meta-app-secret-xyz";
const VERIFY_TOKEN = "verify-token-123";

async function makeApp() {
  const app = express();
  // Mirror the pattern the real crm-service ships: express.json() at the app
  // level for CRUD routes, but the whatsapp router installs its own
  // express.raw() at /webhook so signature verification can see the exact
  // bytes Meta sent. json() must not have swallowed those bytes first — we
  // gate it by content-type so JSON bodies going anywhere OTHER than the
  // webhook path still get parsed normally, while raw content for /webhook
  // passes through untouched.
  app.use((req, res, next) => {
    if (req.path.startsWith("/whatsapp/webhook/")) return next();
    return express.json({ limit: "1mb" })(req, res, next);
  });
  const { whatsappRouter } = await import("./whatsapp");
  app.use("/whatsapp", whatsappRouter);
  return app;
}

function sign(rawBody: string, secret = APP_SECRET): string {
  const h = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${h}`;
}

function seedIntegration(overrides: Partial<Record<string, unknown>> = {}) {
  state.integrations.push({
    id: nextId("int"),
    tenantId: TENANT_ID,
    provider: "whatsapp",
    name: "default",
    isActive: true,
    isDefault: true,
    config: {},
    secrets: {
      accessToken: "meta-token-abc",
      phoneNumberId: "PHONE_1",
      businessAccountId: "WABA_1",
      webhookVerifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
      ...overrides,
    },
  });
}

beforeEach(() => {
  state.tenants.clear();
  state.templates.length = 0;
  state.messages.length = 0;
  state.integrations.length = 0;
  state.tenants.set(TENANT_SLUG, TENANT_ID);
  idSeq = 0;
  getWhatsappClientImpl = async () => mockClient;
  Object.values(mockClient).forEach((fn) => fn.mockReset?.());
});

// ==========================================================================
// Templates
// ==========================================================================

describe("GET /whatsapp/templates", () => {
  it("returns DB rows, no Meta call", async () => {
    state.templates.push({
      id: "tpl_1",
      tenantId: TENANT_ID,
      name: "welcome",
      category: "UTILITY",
      language: "en_US",
      status: "APPROVED",
      headerType: null,
      headerText: null,
      bodyText: "Hi {{1}}",
      footerText: null,
      variables: [],
      wabaTemplateId: "meta_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(await makeApp()).get("/whatsapp/templates");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ name: "welcome", status: "APPROVED" });
    expect(mockClient.listTemplates).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// Send: creates Pending row
// ==========================================================================

describe("POST /whatsapp/send", () => {
  it("creates a Pending WhatsappMessage row referencing the template", async () => {
    state.templates.push({
      id: "tpl_1",
      tenantId: TENANT_ID,
      name: "welcome",
      category: "UTILITY",
      language: "en_US",
      status: "APPROVED",
      headerType: null,
      headerText: null,
      bodyText: "Hello {{1}}, code {{2}}",
      footerText: null,
      variables: ["name", "code"],
      wabaTemplateId: "meta_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(await makeApp())
      .post("/whatsapp/send")
      .send({ to: "+919876543210", templateId: "tpl_1", vars: ["Alex", "42"] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("Pending");
    expect(res.body.templateId).toBe("tpl_1");
    // Body pre-rendered locally for audit — Meta re-renders on their side.
    expect(res.body.body).toBe("Hello Alex, code 42");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ status: "Pending", direction: "outbound" });
  });
});

describe("POST /whatsapp/send/text", () => {
  it("creates a Pending text WhatsappMessage row", async () => {
    const res = await request(await makeApp())
      .post("/whatsapp/send/text")
      .send({ to: "+919876543210", body: "Hey there!" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "Pending",
      direction: "outbound",
      body: "Hey there!",
      templateId: null,
    });
  });
});

// ==========================================================================
// /process — no integration → Failed with correct error
// ==========================================================================

describe("POST /whatsapp/process", () => {
  it("marks Pending rows Failed with 'No WhatsApp integration' when adapter is null", async () => {
    // Adapter factory returns null (no integration configured).
    getWhatsappClientImpl = async () => null;
    state.messages.push({
      id: "msg_1",
      tenantId: TENANT_ID,
      direction: "outbound",
      toMobile: "+919876543210",
      fromMobile: null,
      templateId: null,
      body: "hello",
      mediaUrl: null,
      status: "Pending",
      attempts: 0,
      lastError: null,
      senderUserId: "u",
      linkedDoctype: null,
      linkedId: null,
      scheduledFor: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      providerMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(await makeApp()).post("/whatsapp/process");
    expect(res.status).toBe(200);
    expect(res.body.failed).toBe(1);
    expect(res.body.sent).toBe(0);
    const row = state.messages[0]!;
    expect(row.status).toBe("Failed");
    expect(row.lastError).toBe("No WhatsApp integration");
    expect(row.attempts).toBe(1);
  });

  it("with adapter present: sends text row, updates status Sent + providerMessageId", async () => {
    seedIntegration();
    mockClient.sendText.mockResolvedValue({ wamid: "wamid.ABC" });
    state.messages.push({
      id: "msg_2",
      tenantId: TENANT_ID,
      direction: "outbound",
      toMobile: "+919876543210",
      fromMobile: null,
      templateId: null,
      body: "hi",
      mediaUrl: null,
      status: "Pending",
      attempts: 0,
      lastError: null,
      senderUserId: "u",
      linkedDoctype: null,
      linkedId: null,
      scheduledFor: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      providerMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await request(await makeApp()).post("/whatsapp/process");
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(mockClient.sendText).toHaveBeenCalledWith("+919876543210", "hi");
    const row = state.messages[0]!;
    expect(row.status).toBe("Sent");
    expect(row.providerMessageId).toBe("wamid.ABC");
    expect(row.sentAt).toBeInstanceOf(Date);
  });
});

// ==========================================================================
// Webhook challenge (GET)
// ==========================================================================

describe("GET /whatsapp/webhook/:tenantSlug (challenge)", () => {
  it("echoes hub.challenge when verify_token matches", async () => {
    seedIntegration();
    const res = await request(await makeApp())
      .get(`/whatsapp/webhook/${TENANT_SLUG}`)
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "12345",
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe("12345");
  });

  it("returns 401 on token mismatch", async () => {
    seedIntegration();
    const res = await request(await makeApp())
      .get(`/whatsapp/webhook/${TENANT_SLUG}`)
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "WRONG",
        "hub.challenge": "12345",
      });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown tenantSlug", async () => {
    seedIntegration();
    const res = await request(await makeApp())
      .get(`/whatsapp/webhook/nope`)
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "1",
      });
    expect(res.status).toBe(404);
  });
});

// ==========================================================================
// Webhook POST — signatures + statuses + inbound + unknown tenant
// ==========================================================================

describe("POST /whatsapp/webhook/:tenantSlug", () => {
  it("returns 401 on invalid X-Hub-Signature-256", async () => {
    seedIntegration();
    const body = JSON.stringify({ entry: [] });
    const res = await request(await makeApp())
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .send(body);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown tenantSlug (short-circuits signature check)", async () => {
    seedIntegration();
    const body = JSON.stringify({ entry: [] });
    const res = await request(await makeApp())
      .post(`/whatsapp/webhook/unknown-slug`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    expect(res.status).toBe(404);
  });

  it("status 'delivered' updates matching message row (deliveredAt + status)", async () => {
    seedIntegration();
    state.messages.push({
      id: "msg_1",
      tenantId: TENANT_ID,
      direction: "outbound",
      toMobile: "+919876543210",
      fromMobile: null,
      templateId: null,
      body: "hi",
      mediaUrl: null,
      status: "Sent",
      attempts: 1,
      lastError: null,
      senderUserId: "u",
      linkedDoctype: null,
      linkedId: null,
      scheduledFor: null,
      sentAt: new Date(),
      deliveredAt: null,
      readAt: null,
      providerMessageId: "wamid.XYZ",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.XYZ", status: "delivered", timestamp: "1730000000" },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload);
    const res = await request(await makeApp())
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.statuses).toBe(1);
    const row = state.messages[0]!;
    expect(row.status).toBe("Delivered");
    expect(row.deliveredAt).toBeInstanceOf(Date);
  });

  it("status 'read' sets status=Read + readAt", async () => {
    seedIntegration();
    state.messages.push({
      id: "msg_2",
      tenantId: TENANT_ID,
      direction: "outbound",
      toMobile: "+919876543210",
      fromMobile: null,
      templateId: null,
      body: "hi",
      mediaUrl: null,
      status: "Delivered",
      attempts: 1,
      lastError: null,
      senderUserId: "u",
      linkedDoctype: null,
      linkedId: null,
      scheduledFor: null,
      sentAt: new Date(),
      deliveredAt: new Date(),
      readAt: null,
      providerMessageId: "wamid.READ",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            { value: { statuses: [{ id: "wamid.READ", status: "read" }] } },
          ],
        },
      ],
    });
    const res = await request(await makeApp())
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    const row = state.messages[0]!;
    expect(row.status).toBe("Read");
    expect(row.readAt).toBeInstanceOf(Date);
  });

  it("inbound message creates a new WhatsappMessage row with direction=inbound", async () => {
    seedIntegration();
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "919999999999",
                    id: "wamid.INBOUND1",
                    type: "text",
                    text: { body: "Hello back!" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const res = await request(await makeApp())
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.inbound).toBe(1);
    expect(state.messages).toHaveLength(1);
    const row = state.messages[0]!;
    expect(row.direction).toBe("inbound");
    expect(row.fromMobile).toBe("919999999999");
    expect(row.body).toBe("Hello back!");
    expect(row.providerMessageId).toBe("wamid.INBOUND1");
  });

  it("inbound message dedupes by wamid on retry", async () => {
    seedIntegration();
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "919999999999", id: "wamid.DUPE", type: "text", text: { body: "hi" } },
                ],
              },
            },
          ],
        },
      ],
    });
    const app = await makeApp();
    // First delivery.
    await request(app)
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    // Retry — Meta re-sends the same wamid.
    await request(app)
      .post(`/whatsapp/webhook/${TENANT_SLUG}`)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", sign(body))
      .send(body);
    // De-dup: only one inbound row persisted.
    const inbound = state.messages.filter((m) => m.direction === "inbound");
    expect(inbound).toHaveLength(1);
  });
});

// ==========================================================================
// WhatsappClient.verifyWebhookSignature — pure static helper
// ==========================================================================

describe("WhatsappClient.verifyWebhookSignature", () => {
  it("returns true for a valid sha256=<hex>(secret,body)", async () => {
    const { WhatsappClient } = await import("@lumaara/db");
    const body = Buffer.from(`{"hello":"world"}`);
    const secret = "s3cr3t";
    const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    expect(WhatsappClient.verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false when the signature is truncated / wrong hex", async () => {
    const { WhatsappClient } = await import("@lumaara/db");
    const body = Buffer.from(`{"hello":"world"}`);
    expect(
      WhatsappClient.verifyWebhookSignature(body, "sha256=deadbeef", "s3cr3t"),
    ).toBe(false);
  });

  it("returns false on missing / malformed header", async () => {
    const { WhatsappClient } = await import("@lumaara/db");
    const body = Buffer.from("x");
    expect(WhatsappClient.verifyWebhookSignature(body, null, "s")).toBe(false);
    expect(WhatsappClient.verifyWebhookSignature(body, "", "s")).toBe(false);
    expect(WhatsappClient.verifyWebhookSignature(body, "sha1=xxx", "s")).toBe(false);
  });
});
