// Set master key BEFORE importing anything that reads it on load.
process.env.MASTER_SECRET_KEY = "a".repeat(64);

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveRazorpayCreds,
  verifyWebhookSignature,
  NoBillingGatewayError,
} from "./razorpay";
import { encryptSecrets } from "./secrets-crypto";
import { prisma } from "./index";

async function wipe(): Promise<void> {
  await prisma.platformBillingGateway.deleteMany({}).catch(() => void 0);
}

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test_secret";
  it("accepts a signature produced with the right secret + raw bytes", () => {
    const body = '{"event":"payment.captured","payload":{"foo":"bar"}}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    const body = '{"event":"x"}';
    const sig = createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(verifyWebhookSignature(secret, body, sig)).toBe(false);
  });

  it("rejects when the body was mutated after signing", () => {
    const body = '{"event":"payment.captured"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const tamperedBody = body.replace("captured", "failed");
    expect(verifyWebhookSignature(secret, tamperedBody, sig)).toBe(false);
  });

  it("rejects malformed hex signatures without throwing", () => {
    expect(verifyWebhookSignature(secret, "x", "not-hex")).toBe(false);
    expect(verifyWebhookSignature(secret, "x", "")).toBe(false);
    expect(verifyWebhookSignature(secret, "x", "ab")).toBe(false); // length mismatch
  });

  it("handles Buffer input identically to string", () => {
    const body = "exact-bytes";
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(secret, Buffer.from(body), sig)).toBe(true);
  });
});

describe("resolveRazorpayCreds", () => {
  beforeEach(wipe);
  afterEach(wipe);

  it("throws NoBillingGatewayError when no gateway is configured", async () => {
    await expect(resolveRazorpayCreds()).rejects.toThrow(NoBillingGatewayError);
  });

  it("throws NoBillingGatewayError when the only gateway is inactive", async () => {
    await prisma.platformBillingGateway.create({
      data: {
        provider: "razorpay",
        mode: "test",
        isActive: false,
        config: { keyId: "rzp_test_x" } as never,
        secrets: encryptSecrets({ keySecret: "s" }) as never,
      },
    });
    await expect(resolveRazorpayCreds()).rejects.toThrow(NoBillingGatewayError);
  });

  it("returns active gateway creds + decrypts the secret", async () => {
    await prisma.platformBillingGateway.create({
      data: {
        provider: "razorpay",
        mode: "test",
        isActive: true,
        config: { keyId: "rzp_test_123" } as never,
        secrets: encryptSecrets({
          keySecret: "the-secret",
          webhookSecret: "whsec",
        }) as never,
      },
    });
    const creds = await resolveRazorpayCreds();
    expect(creds).toEqual({
      keyId: "rzp_test_123",
      keySecret: "the-secret",
      webhookSecret: "whsec",
      mode: "test",
    });
  });

  it("flips to the live gateway when both exist and only live is active", async () => {
    await prisma.platformBillingGateway.create({
      data: {
        provider: "razorpay",
        mode: "test",
        isActive: false,
        config: { keyId: "rzp_test_x" } as never,
        secrets: encryptSecrets({ keySecret: "test-secret" }) as never,
      },
    });
    await prisma.platformBillingGateway.create({
      data: {
        provider: "razorpay",
        mode: "live",
        isActive: true,
        config: { keyId: "rzp_live_x" } as never,
        secrets: encryptSecrets({ keySecret: "live-secret" }) as never,
      },
    });
    const creds = await resolveRazorpayCreds();
    expect(creds.mode).toBe("live");
    expect(creds.keyId).toBe("rzp_live_x");
    expect(creds.keySecret).toBe("live-secret");
  });
});
