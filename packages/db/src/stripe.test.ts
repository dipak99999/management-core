import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyStripeWebhookSignature } from "./stripe";

function signStripePayload(secret: string, payload: string, ts: number): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("verifyStripeWebhookSignature", () => {
  it("accepts a correctly-signed recent payload", () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
    const ts = Math.floor(Date.now() / 1000);
    const header = signStripePayload(secret, payload, ts);
    expect(verifyStripeWebhookSignature(secret, payload, header)).toBe(true);
  });

  it("rejects a payload signed by a different secret", () => {
    const payload = "hello";
    const ts = Math.floor(Date.now() / 1000);
    const header = signStripePayload("other_secret", payload, ts);
    expect(verifyStripeWebhookSignature("whsec_test", payload, header)).toBe(false);
  });

  it("rejects a payload outside the timestamp tolerance window", () => {
    const secret = "whsec_test";
    const payload = "hello";
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    const header = signStripePayload(secret, payload, oldTs);
    expect(verifyStripeWebhookSignature(secret, payload, header, 300)).toBe(false);
  });

  it("rejects a header missing the v1 signature", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyStripeWebhookSignature("s", "body", `t=${ts}`)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const secret = "whsec_test";
    const payload = "hello";
    const ts = Math.floor(Date.now() / 1000);
    const header = signStripePayload(secret, payload, ts);
    expect(verifyStripeWebhookSignature(secret, "hello-tampered", header)).toBe(false);
  });
});
