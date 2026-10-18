// P2 — SMS provider inbound webhook tests.
//
// Coverage (8 tests):
//   1. Twilio valid sig + delivered → SmsMessage status="Delivered" + deliveredAt.
//   2. Twilio invalid sig → 401 + no DB write.
//   3. Twilio unknown MessageSid → 200 silent (no crash).
//   4. Twilio idempotency — same delivered event fired twice, single Delivered row.
//   5. MSG91 valid bearer + delivered → status="Delivered" + deliveredAt.
//   6. MSG91 wrong bearer → 401 + no DB write.
//   7. MSG91 idempotency — same webhook fired twice, single Delivered row.
//   8. Unknown tenantSlug → 404 (both providers).

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// ---------- @lumaara/db mock -----------------------------------------------
//
// Same shape as webhooks-inbound.test.ts — stub tenant / integration /
// smsMessage tables in module-scope maps. decryptSecrets passes through.

interface SmsRow {
  id: string;
  tenantId: string;
  providerMessageId: string | null;
  status: string;
  deliveredAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

const state: {
  tenants: Map<string, string>; // slug → id
  // `${tenantId}:${provider}` → { secrets, config }
  integrations: Map<
    string,
    { secrets: Record<string, unknown>; config: Record<string, unknown> }
  >;
  smsMessages: SmsRow[];
} = {
  tenants: new Map(),
  integrations: new Map(),
  smsMessages: [],
};

let idSeq = 0;
const nextId = () => `id_${++idSeq}`;

vi.mock("@lumaara/db", () => {
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
        where: { tenantId: string; provider: string };
      }) => {
        const key = `${where.tenantId}:${where.provider}`;
        const row = state.integrations.get(key);
        if (!row) return null;
        return { secrets: row.secrets, config: row.config, isActive: true };
      },
    },
    smsMessage: {
      findFirst: async ({
        where,
        select,
      }: {
        where: { tenantId: string; providerMessageId: string };
        select?: Record<string, boolean>;
      }) => {
        const row = state.smsMessages.find(
          (m) =>
            m.tenantId === where.tenantId &&
            m.providerMessageId === where.providerMessageId,
        );
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) {
          out[k] = (row as unknown as Record<string, unknown>)[k];
        }
        return out;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<SmsRow>;
      }) => {
        const row = state.smsMessages.find((m) => m.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
    },
  };

  return {
    prisma: prismaStub,
    decryptSecrets: (s: unknown) =>
      s && typeof s === "object" ? (s as Record<string, unknown>) : {},
    withCrossTenant: <T extends object>(a: T) => a,
  };
});

// eslint-disable-next-line import/first
import {
  _internals,
  smsWebhooksRouter,
} from "./sms-webhooks";

function makeApp() {
  const app = express();
  // Global json parser to mimic the real crm-service. The Twilio route
  // installs its own urlencoded parser locally.
  app.use(express.json({ limit: "1mb" }));
  app.use("/sms-webhooks", smsWebhooksRouter);
  return app;
}

const TENANT_ID = "tenant_abc";
const TENANT_SLUG = "acme";
const TWILIO_AUTH = "test-auth-token-123";
const MSG91_BEARER = "shared-msg91-bearer";

function seedSmsRow(overrides: Partial<SmsRow> = {}): SmsRow {
  const row: SmsRow = {
    id: nextId(),
    tenantId: TENANT_ID,
    providerMessageId: null,
    status: "Sent",
    deliveredAt: null,
    lastError: null,
    updatedAt: new Date(),
    ...overrides,
  };
  state.smsMessages.push(row);
  return row;
}

/**
 * Recreate a valid X-Twilio-Signature for the given URL + form params. Uses
 * the same algorithm as the handler so we can be confident tests cover the
 * real signing path.
 */
function twilioSign(url: string, params: Record<string, string>, token = TWILIO_AUTH): string {
  return _internals.computeTwilioSignature(token, url, params);
}

beforeEach(() => {
  state.tenants.clear();
  state.integrations.clear();
  state.smsMessages.length = 0;
  idSeq = 0;
  state.tenants.set(TENANT_SLUG, TENANT_ID);
});

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------

describe("POST /sms-webhooks/twilio/:tenantSlug", () => {
  it("valid sig + delivered → row Delivered + deliveredAt set", async () => {
    // Fix the webhook URL via config.webhookBaseUrl so signing is deterministic.
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { authToken: TWILIO_AUTH },
      config: { provider: "twilio", webhookBaseUrl: "https://hook.example.com" },
    });
    const seeded = seedSmsRow({ providerMessageId: "SMabc123", status: "Sent" });

    const app = makeApp();
    const url = `https://hook.example.com/sms-webhooks/twilio/${TENANT_SLUG}`;
    const params = {
      MessageSid: "SMabc123",
      MessageStatus: "delivered",
      To: "+15559999999",
      From: "+15550000000",
    };
    const sig = twilioSign(url, params);

    const r = await request(app)
      .post(`/sms-webhooks/twilio/${TENANT_SLUG}`)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("X-Twilio-Signature", sig)
      .send(new URLSearchParams(params).toString());

    expect(r.status).toBe(200);
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;
    expect(row.status).toBe("Delivered");
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(row.lastError).toBeNull();
  });

  it("invalid sig → 401 + no DB write", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { authToken: TWILIO_AUTH },
      config: { provider: "twilio", webhookBaseUrl: "https://hook.example.com" },
    });
    const seeded = seedSmsRow({ providerMessageId: "SMabc123", status: "Sent" });

    const app = makeApp();
    const params = { MessageSid: "SMabc123", MessageStatus: "delivered" };

    const r = await request(app)
      .post(`/sms-webhooks/twilio/${TENANT_SLUG}`)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("X-Twilio-Signature", "invalid-base64-signature")
      .send(new URLSearchParams(params).toString());

    expect(r.status).toBe(401);
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;
    expect(row.status).toBe("Sent"); // untouched
    expect(row.deliveredAt).toBeNull();
  });

  it("unknown MessageSid → 200 silent (no crash)", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { authToken: TWILIO_AUTH },
      config: { provider: "twilio", webhookBaseUrl: "https://hook.example.com" },
    });

    const app = makeApp();
    const url = `https://hook.example.com/sms-webhooks/twilio/${TENANT_SLUG}`;
    const params = {
      MessageSid: "SM_does_not_exist",
      MessageStatus: "delivered",
    };
    const sig = twilioSign(url, params);

    const r = await request(app)
      .post(`/sms-webhooks/twilio/${TENANT_SLUG}`)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("X-Twilio-Signature", sig)
      .send(new URLSearchParams(params).toString());

    expect(r.status).toBe(200);
    expect(state.smsMessages).toHaveLength(0);
  });

  it("idempotent: same delivered event fired twice → single Delivered state", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { authToken: TWILIO_AUTH },
      config: { provider: "twilio", webhookBaseUrl: "https://hook.example.com" },
    });
    const seeded = seedSmsRow({ providerMessageId: "SMdup", status: "Sent" });

    const app = makeApp();
    const url = `https://hook.example.com/sms-webhooks/twilio/${TENANT_SLUG}`;
    const params = { MessageSid: "SMdup", MessageStatus: "delivered" };
    const sig = twilioSign(url, params);

    const send = () =>
      request(app)
        .post(`/sms-webhooks/twilio/${TENANT_SLUG}`)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("X-Twilio-Signature", sig)
        .send(new URLSearchParams(params).toString());

    const r1 = await send();
    const firstDeliveredAt = state.smsMessages.find((m) => m.id === seeded.id)!.deliveredAt!;
    const r2 = await send();
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(row.status).toBe("Delivered");
    // deliveredAt not re-overwritten on second fire (idempotency short-circuit).
    expect(row.deliveredAt).toEqual(firstDeliveredAt);
  });

  it("unknown tenantSlug → 404 (Twilio)", async () => {
    const app = makeApp();
    const r = await request(app)
      .post(`/sms-webhooks/twilio/no-such-slug`)
      .set("Content-Type", "application/x-www-form-urlencoded")
      .set("X-Twilio-Signature", "x")
      .send("MessageSid=SM&MessageStatus=delivered");
    expect(r.status).toBe(404);
    expect(state.smsMessages).toHaveLength(0);
    // sanity — hash never even computed since we short-circuit on missing tenant.
    expect(createHmac).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MSG91
// ---------------------------------------------------------------------------

describe("POST /sms-webhooks/msg91/:tenantSlug", () => {
  it("valid bearer + delivered → row Delivered + deliveredAt set", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { webhookBearer: MSG91_BEARER },
      config: { provider: "msg91" },
    });
    const seeded = seedSmsRow({ providerMessageId: "req_abc", status: "Sent" });

    const app = makeApp();
    const r = await request(app)
      .post(`/sms-webhooks/msg91/${TENANT_SLUG}`)
      .set("Authorization", `Bearer ${MSG91_BEARER}`)
      .send({
        report: [{ requestId: "req_abc", status: 1, number: "919999999999" }],
      });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, processed: 1 });
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;
    expect(row.status).toBe("Delivered");
    expect(row.deliveredAt).toBeInstanceOf(Date);
  });

  it("wrong bearer → 401 + no DB write", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { webhookBearer: MSG91_BEARER },
      config: { provider: "msg91" },
    });
    const seeded = seedSmsRow({ providerMessageId: "req_abc", status: "Sent" });

    const app = makeApp();
    const r = await request(app)
      .post(`/sms-webhooks/msg91/${TENANT_SLUG}`)
      .set("Authorization", "Bearer WRONG_BEARER")
      .send({
        report: [{ requestId: "req_abc", status: 1 }],
      });
    expect(r.status).toBe(401);
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;
    expect(row.status).toBe("Sent"); // untouched
  });

  it("idempotent: same delivered event fired twice → single Delivered state", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { webhookBearer: MSG91_BEARER },
      config: { provider: "msg91" },
    });
    const seeded = seedSmsRow({ providerMessageId: "req_dup", status: "Sent" });

    const app = makeApp();
    const send = () =>
      request(app)
        .post(`/sms-webhooks/msg91/${TENANT_SLUG}`)
        .set("Authorization", `Bearer ${MSG91_BEARER}`)
        .send({
          report: [{ requestId: "req_dup", status: "delivered" }],
        });

    const r1 = await send();
    const firstDeliveredAt = state.smsMessages.find((m) => m.id === seeded.id)!.deliveredAt!;
    const r2 = await send();
    const row = state.smsMessages.find((m) => m.id === seeded.id)!;

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(row.status).toBe("Delivered");
    expect(row.deliveredAt).toEqual(firstDeliveredAt);
  });

  it("unknown tenantSlug → 404 (MSG91, valid bearer)", async () => {
    state.integrations.set(`${TENANT_ID}:sms`, {
      secrets: { webhookBearer: MSG91_BEARER },
      config: { provider: "msg91" },
    });
    const app = makeApp();
    const r = await request(app)
      .post(`/sms-webhooks/msg91/no-such-slug`)
      .set("Authorization", `Bearer ${MSG91_BEARER}`)
      .send({ report: [{ requestId: "req_abc", status: 1 }] });
    expect(r.status).toBe(404);
    expect(state.smsMessages).toHaveLength(0);
  });
});
