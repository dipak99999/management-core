import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { generateSigningSecret, verifyHmac } from "./events";

describe("generateSigningSecret", () => {
  it("returns a base64url string of reasonable length", () => {
    const s = generateSigningSecret();
    // 24 bytes → 32-char base64url (no padding)
    expect(s).toMatch(/^[A-Za-z0-9_-]{30,}$/);
  });

  it("yields distinct values per call", () => {
    expect(generateSigningSecret()).not.toBe(generateSigningSecret());
  });
});

describe("verifyHmac", () => {
  it("returns true for a matching signature", () => {
    const secret = "test-secret";
    const body = '{"hello":"world"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmac(secret, body, sig)).toBe(true);
  });

  it("returns false for a wrong signature", () => {
    expect(verifyHmac("secret", "body", "0".repeat(64))).toBe(false);
  });

  it("returns false for a different length signature", () => {
    expect(verifyHmac("secret", "body", "abc")).toBe(false);
  });

  it("returns false if the body was tampered", () => {
    const secret = "test-secret";
    const sig = createHmac("sha256", secret).update("original").digest("hex");
    expect(verifyHmac(secret, "tampered", sig)).toBe(false);
  });
});
