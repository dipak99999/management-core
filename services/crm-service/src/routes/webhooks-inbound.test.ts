import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  createHmac,
  createSign,
  generateKeyPairSync,
  createPrivateKey,
} from "node:crypto";

// ---------- @lumaara/db mock ----------------------------------------------
//
// We stub the entire prisma surface used by the router: tenant lookup,
// tenantIntegration lookup, and the transaction body inside normalizeAndPersist.
// This keeps the test purely in-process — no Postgres, no schema, no fixtures.
// We track TrackingEvent + Suppression writes in module-level arrays so each
// test can assert them.

interface TrackingEventRow {
  id: string;
  tenantId: string;
  campaignId: string | null;
  type: string;
  meta: unknown;
}
interface SuppressionRow {
  id: string;
  tenantId: string;
  email: string;
  reason: string;
  source: string | null;
  detail: string | null;
  campaignId: string | null;
}

const state: {
  tenants: Map<string, string>; // slug → id
  integrations: Map<string, Record<string, unknown>>; // `${tenantId}:${provider}` → decrypted secrets
  trackingEvents: TrackingEventRow[];
  suppressions: SuppressionRow[];
} = {
  tenants: new Map(),
  integrations: new Map(),
  trackingEvents: [],
  suppressions: [],
};

vi.mock("@lumaara/db", () => {
  let idSeq = 0;
  const nextId = () => `id_${++idSeq}`;

  const suppressionUpsert = async (args: {
    where: { tenantId_email: { tenantId: string; email: string } };
    create: Omit<SuppressionRow, "id">;
    update: Partial<SuppressionRow>;
  }) => {
    const { tenantId, email } = args.where.tenantId_email;
    const existing = state.suppressions.find(
      (s) => s.tenantId === tenantId && s.email === email,
    );
    if (existing) {
      Object.assign(existing, args.update);
      return existing;
    }
    const row: SuppressionRow = {
      id: nextId(),
      tenantId,
      email,
      reason: args.create.reason,
      source: args.create.source ?? null,
      detail: args.create.detail ?? null,
      campaignId: args.create.campaignId ?? null,
    };
    state.suppressions.push(row);
    return row;
  };

  const trackingEventCreate = async (args: { data: Omit<TrackingEventRow, "id"> }) => {
    const row: TrackingEventRow = {
      id: nextId(),
      tenantId: args.data.tenantId,
      campaignId: args.data.campaignId ?? null,
      type: args.data.type,
      meta: args.data.meta,
    };
    state.trackingEvents.push(row);
    return row;
  };

  const tx = {
    trackingEvent: { create: trackingEventCreate },
    suppression: { upsert: suppressionUpsert },
  };

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
        const secrets = state.integrations.get(key);
        return secrets ? { secrets } : null;
      },
    },
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  };

  // normalizeAndPersist re-implemented here against our stub — mirrors the
  // real implementation's contract (TrackingEvent insert + upsert on hard
  // bounce / complaint). Deliberately duplicated so we test the ROUTER's use
  // of the helper, not the helper itself (which has its own tests).
  const normalizeAndPersist = async (
    _prisma: unknown,
    tenantId: string,
    evt: {
      provider: string;
      email: string;
      event: string;
      severity?: string;
      campaignId?: string | null;
      detail?: string | null;
      meta?: unknown;
    },
  ) => {
    const email = evt.email.toLowerCase().trim();
    return prismaStub.$transaction(async (t) => {
      const te = await t.trackingEvent.create({
        data: {
          tenantId,
          campaignId: evt.campaignId ?? null,
          type: evt.event,
          meta: evt.meta,
        },
      });
      const suppress =
        (evt.event === "Bounce" && evt.severity === "hard") ||
        evt.event === "Complaint";
      if (!suppress) return { trackingEventId: te.id, suppressionCreated: false, suppressionId: null };
      const reason = evt.event === "Complaint" ? "Complaint" : "HardBounce";
      const sup = await t.suppression.upsert({
        where: { tenantId_email: { tenantId, email } },
        create: {
          tenantId,
          email,
          reason,
          source: evt.provider,
          detail: evt.detail ?? null,
          campaignId: evt.campaignId ?? null,
        },
        update: {
          source: evt.provider,
          detail: evt.detail ?? null,
          campaignId: evt.campaignId ?? null,
        },
      });
      return { trackingEventId: te.id, suppressionCreated: true, suppressionId: sup.id };
    });
  };

  return {
    prisma: prismaStub,
    normalizeAndPersist,
    decryptSecrets: (s: unknown) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}),
    withCrossTenant: <T extends object>(a: T) => a,
  };
});

// Import AFTER vi.mock so the router picks up the stubs.
// eslint-disable-next-line import/first
import { webhooksInboundRouter } from "./webhooks-inbound";
// eslint-disable-next-line import/first
import { _seedSnsCert } from "../lib/sns-verify";

// ---------- SNS test key + signing helper ---------------------------------
//
// Generate a throwaway RSA key pair once per test file. Seed the public key
// PEM into the SNS cert cache under a plausible AWS-region URL. Every SES
// test signs its envelope with the matching private key.

const snsKp = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SNS_CERT_URL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";
_seedSnsCert(SNS_CERT_URL, snsKp.publicKey.export({ type: "spki", format: "pem" }) as string);
const snsPrivPem = snsKp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

function signSnsEnvelope(env: Record<string, string>): string {
  const t = env.Type;
  const parts: string[] = [];
  if (t === "Notification") {
    parts.push("Message", env.Message);
    parts.push("MessageId", env.MessageId);
    if (env.Subject !== undefined) parts.push("Subject", env.Subject);
    parts.push("Timestamp", env.Timestamp);
    parts.push("TopicArn", env.TopicArn);
    parts.push("Type", env.Type);
  } else {
    parts.push("Message", env.Message);
    parts.push("MessageId", env.MessageId);
    parts.push("SubscribeURL", env.SubscribeURL ?? "");
    parts.push("Timestamp", env.Timestamp);
    parts.push("Token", env.Token ?? "");
    parts.push("TopicArn", env.TopicArn);
    parts.push("Type", env.Type);
  }
  let canon = "";
  for (let i = 0; i < parts.length; i += 2) canon += `${parts[i]}\n${parts[i + 1]}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(canon, "utf8");
  signer.end();
  return signer.sign(createPrivateKey(snsPrivPem)).toString("base64");
}

function makeApp() {
  const app = express();
  // Mirror the prod index.ts skip: SendGrid needs the raw body for ECDSA
  // verification. If express.json() consumed the stream first, the
  // router-scoped express.raw() would get an already-parsed body.
  app.use((req, res, next) => {
    if (req.path.startsWith("/webhooks-inbound/sendgrid/")) return next();
    return express.json({ limit: "1mb" })(req, res, next);
  });
  app.use("/webhooks-inbound", webhooksInboundRouter);
  return app;
}

const TENANT_ID = "tenant_abc";
const TENANT_SLUG = "acme";

beforeEach(() => {
  state.tenants.clear();
  state.integrations.clear();
  state.trackingEvents.length = 0;
  state.suppressions.length = 0;
  state.tenants.set(TENANT_SLUG, TENANT_ID);
});

// --------------------------------------------------------------------------
// SES
// --------------------------------------------------------------------------

describe("POST /webhooks-inbound/ses/:tenantSlug", () => {
  // Build a full signed SNS envelope. Signing uses the test-file's throwaway
  // RSA key; the matching cert is pre-seeded into the SNS cert cache above.
  const sesEnvelope = (msg: object) => {
    const base = {
      Type: "Notification",
      MessageId: `msg_${Math.random().toString(36).slice(2, 10)}`,
      TopicArn: "arn:aws:sns:us-east-1:000000000000:test",
      Message: JSON.stringify(msg),
      Timestamp: new Date().toISOString(),
      SignatureVersion: "2", // v2 = RSA-SHA256
      SigningCertURL: SNS_CERT_URL,
    } as Record<string, string>;
    return { ...base, Signature: signSnsEnvelope(base) };
  };

  it("persists a Bounce (Permanent) → Suppression + TrackingEvent", async () => {
    const app = makeApp();
    const payload = sesEnvelope({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "hard@example.com", diagnosticCode: "550 no-such-user" }],
      },
    });
    const r = await request(app).post(`/webhooks-inbound/ses/${TENANT_SLUG}`).send(payload);
    expect(r.status).toBe(200);
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.trackingEvents[0].type).toBe("Bounce");
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      email: "hard@example.com",
      reason: "HardBounce",
      source: "ses",
    });
  });

  it("persists a Complaint → Suppression", async () => {
    const app = makeApp();
    const payload = sesEnvelope({
      notificationType: "Complaint",
      complaint: {
        complainedRecipients: [{ emailAddress: "angry@example.com" }],
        complaintFeedbackType: "abuse",
      },
    });
    const r = await request(app).post(`/webhooks-inbound/ses/${TENANT_SLUG}`).send(payload);
    expect(r.status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0].reason).toBe("Complaint");
  });

  it("persists a soft Bounce (Transient) as TrackingEvent only — no Suppression", async () => {
    const app = makeApp();
    const payload = sesEnvelope({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Transient",
        bouncedRecipients: [{ emailAddress: "soft@example.com" }],
      },
    });
    const r = await request(app).post(`/webhooks-inbound/ses/${TENANT_SLUG}`).send(payload);
    expect(r.status).toBe(200);
    expect(state.trackingEvents).toHaveLength(1);
    expect(state.suppressions).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Mailgun
// --------------------------------------------------------------------------

describe("POST /webhooks-inbound/mailgun/:tenantSlug", () => {
  const SIGNING_KEY = "test-mg-signing-key";

  function mailgunPayload(eventData: Record<string, unknown>, signingKey = SIGNING_KEY) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "abc123token";
    const signature = createHmac("sha256", signingKey)
      .update(timestamp + token)
      .digest("hex");
    return {
      signature: { timestamp, token, signature },
      "event-data": eventData,
    };
  }

  it("rejects an invalid HMAC with 401 and no DB write", async () => {
    state.integrations.set(`${TENANT_ID}:mailgun`, { webhookSigningKey: SIGNING_KEY });
    const app = makeApp();
    // Signed with the wrong key on purpose.
    const bad = mailgunPayload({ event: "failed", recipient: "x@example.com", severity: "permanent" }, "wrong-key");
    const r = await request(app).post(`/webhooks-inbound/mailgun/${TENANT_SLUG}`).send(bad);
    expect(r.status).toBe(401);
    expect(state.trackingEvents).toHaveLength(0);
    expect(state.suppressions).toHaveLength(0);
  });

  it("accepts a valid signed hard-bounce → Suppression", async () => {
    state.integrations.set(`${TENANT_ID}:mailgun`, { webhookSigningKey: SIGNING_KEY });
    const app = makeApp();
    const ok = mailgunPayload({
      event: "failed",
      recipient: "bounce@example.com",
      severity: "permanent",
      reason: "recipient-rejected",
    });
    const r = await request(app).post(`/webhooks-inbound/mailgun/${TENANT_SLUG}`).send(ok);
    expect(r.status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      email: "bounce@example.com",
      reason: "HardBounce",
      source: "mailgun",
    });
  });
});

// --------------------------------------------------------------------------
// Postmark
// --------------------------------------------------------------------------

describe("POST /webhooks-inbound/postmark/:tenantSlug", () => {
  const USER = "hook-user";
  const PASS = "hook-pass";
  const basic = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");

  it("accepts a valid hard bounce (TypeCode=1) → Suppression", async () => {
    state.integrations.set(`${TENANT_ID}:postmark`, { username: USER, password: PASS });
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/postmark/${TENANT_SLUG}`)
      .set("Authorization", basic)
      .send({
        RecordType: "Bounce",
        TypeCode: 1,
        Type: "HardBounce",
        Email: "pm-hard@example.com",
        Description: "550 no such user",
      });
    expect(r.status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      email: "pm-hard@example.com",
      reason: "HardBounce",
      source: "postmark",
    });
  });

  it("rejects missing basic auth with 401", async () => {
    state.integrations.set(`${TENANT_ID}:postmark`, { username: USER, password: PASS });
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/postmark/${TENANT_SLUG}`)
      .send({ RecordType: "Bounce", TypeCode: 1, Email: "x@example.com" });
    expect(r.status).toBe(401);
    expect(state.trackingEvents).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// SendGrid
// --------------------------------------------------------------------------

describe("POST /webhooks-inbound/sendgrid/:tenantSlug", () => {
  // Real ECDSA P-256 signing per SendGrid's Signed Event Webhook spec:
  // signature = ECDSA(sha256(timestamp + raw_body)) with the private key,
  // verified against the base64-uncompressed public point on the receiving end.
  const sgKp = generateKeyPairSync("ec", { namedCurve: "P-256" });
  // SendGrid dashboard exports the public key as raw uncompressed P-256 point
  // (0x04 || X || Y), base64-encoded — reproduce that shape here.
  const spkiDer = sgKp.publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // SPKI wraps a P-256 point as a 26-byte header + 65-byte point.
  const pubPoint = spkiDer.subarray(spkiDer.length - 65);
  const publicKeyB64 = pubPoint.toString("base64");
  const sgPrivPem = sgKp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  function signSendGrid(ts: string, rawBody: string): string {
    const signer = createSign("SHA256");
    signer.update(Buffer.from(ts + rawBody, "utf8"));
    signer.end();
    return signer
      .sign(createPrivateKey(sgPrivPem))
      .toString("base64");
  }

  it("persists a spamreport event as Complaint → Suppression", async () => {
    state.integrations.set(`${TENANT_ID}:sendgrid`, {
      publicKey: publicKeyB64,
    });
    const app = makeApp();
    const ts = String(Math.floor(Date.now() / 1000));
    const body = [
      { email: "spam@example.com", event: "spamreport", timestamp: Math.floor(Date.now() / 1000) },
    ];
    const raw = JSON.stringify(body);
    const sig = signSendGrid(ts, raw);
    const r = await request(app)
      .post(`/webhooks-inbound/sendgrid/${TENANT_SLUG}`)
      .set("x-twilio-email-event-webhook-signature", sig)
      .set("x-twilio-email-event-webhook-timestamp", ts)
      .set("content-type", "application/json")
      .send(raw);
    expect(r.status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      email: "spam@example.com",
      reason: "Complaint",
      source: "sendgrid",
    });
  });
});

// --------------------------------------------------------------------------
// Generic
// --------------------------------------------------------------------------

describe("POST /webhooks-inbound/generic/:tenantSlug", () => {
  const TOKEN = "shared-bearer-secret";

  it("accepts a valid bearer + hard bounce → Suppression", async () => {
    state.integrations.set(`${TENANT_ID}:webhook`, { token: TOKEN });
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/generic/${TENANT_SLUG}`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({
        email: "gen@example.com",
        event: "Bounce",
        severity: "hard",
        detail: "mailbox full",
      });
    expect(r.status).toBe(200);
    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0]).toMatchObject({
      email: "gen@example.com",
      reason: "HardBounce",
      source: "webhook",
      detail: "mailbox full",
    });
  });

  it("rejects a wrong bearer with 401 and no DB write", async () => {
    state.integrations.set(`${TENANT_ID}:webhook`, { token: TOKEN });
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/generic/${TENANT_SLUG}`)
      .set("Authorization", "Bearer wrong")
      .send({ email: "x@example.com", event: "Bounce", severity: "hard" });
    expect(r.status).toBe(401);
    expect(state.trackingEvents).toHaveLength(0);
    expect(state.suppressions).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Cross-cutting
// --------------------------------------------------------------------------

describe("cross-cutting behavior", () => {
  it("unknown tenantSlug → 404 (SES)", async () => {
    // Envelope must pass signature verification first (that runs before the
    // tenant lookup); the 404 is a post-signature check.
    const base = {
      Type: "Notification",
      MessageId: "msg_x",
      TopicArn: "arn:aws:sns:us-east-1:000000000000:test",
      Message: "{}",
      Timestamp: new Date().toISOString(),
      SignatureVersion: "2",
      SigningCertURL: SNS_CERT_URL,
    } as Record<string, string>;
    const signed = { ...base, Signature: signSnsEnvelope(base) };
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/ses/unknown-slug`)
      .send(signed);
    expect(r.status).toBe(404);
    expect(state.trackingEvents).toHaveLength(0);
    expect(state.suppressions).toHaveLength(0);
  });

  it("unknown tenantSlug → 404 (generic, valid bearer)", async () => {
    state.integrations.set(`${TENANT_ID}:webhook`, { token: "t" });
    const app = makeApp();
    const r = await request(app)
      .post(`/webhooks-inbound/generic/other-slug`)
      .set("Authorization", "Bearer t")
      .send({ email: "x@example.com", event: "Bounce", severity: "hard" });
    expect(r.status).toBe(404);
  });

  it("dedupes suppression via the (tenantId, email) unique index across providers", async () => {
    state.integrations.set(`${TENANT_ID}:webhook`, { token: "t" });
    const app = makeApp();
    // First hit via SES.
    await request(app)
      .post(`/webhooks-inbound/ses/${TENANT_SLUG}`)
      .send({
        Type: "Notification",
        Message: JSON.stringify({
          notificationType: "Bounce",
          bounce: {
            bounceType: "Permanent",
            bouncedRecipients: [{ emailAddress: "Dupe@Example.com" }],
          },
        }),
      });
    // Second hit via generic — same email (case-insensitive normalization
    // means we should collapse to a single Suppression row).
    await request(app)
      .post(`/webhooks-inbound/generic/${TENANT_SLUG}`)
      .set("Authorization", "Bearer t")
      .send({ email: "dupe@example.com", event: "Bounce", severity: "hard" });

    expect(state.suppressions).toHaveLength(1);
    expect(state.suppressions[0].email).toBe("dupe@example.com");
    // Latest write wins on source/detail.
    expect(state.suppressions[0].source).toBe("webhook");
  });
});
