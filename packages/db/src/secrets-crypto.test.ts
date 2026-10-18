// Set the master key BEFORE any import that reads it at module load. The
// crypto module snapshots process.env.MASTER_SECRET_KEY once on load, so
// setting it inside beforeAll is too late.
process.env.MASTER_SECRET_KEY = "a".repeat(64); // 32 bytes hex

import { describe, expect, it } from "vitest";
import {
  decryptSecrets,
  encryptSecrets,
  type EncryptedBlob,
} from "./secrets-crypto";

describe("secrets-crypto envelope", () => {
  it("round-trips a plain record", () => {
    const plain = { keyId: "rzp_test", keySecret: "s3cr3t!", extra: 42 };
    const enc = encryptSecrets(plain);
    expect((enc as { enc: boolean }).enc).toBe(true);
    const back = decryptSecrets(enc);
    expect(back).toEqual(plain);
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    const plain = { x: 1 };
    const a = encryptSecrets(plain) as EncryptedBlob;
    const b = encryptSecrets(plain) as EncryptedBlob;
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("rejects a tampered ciphertext (GCM auth-tag mismatch)", () => {
    const enc = encryptSecrets({ ok: "yes" }) as EncryptedBlob;
    const badCt = Buffer.from(enc.ct, "base64");
    badCt[0] ^= 0xff;
    const tampered = { ...enc, ct: badCt.toString("base64") };
    expect(() => decryptSecrets(tampered)).toThrow();
  });

  it("passes legacy raw records through decrypt unchanged", () => {
    const legacy = { keyId: "old", keySecret: "unencrypted-legacy" };
    const back = decryptSecrets(legacy);
    expect(back).toEqual(legacy);
  });

  it("passes enc:false blobs through decrypt", () => {
    const wrapper = { enc: false, data: { keyId: "abc" } };
    const back = decryptSecrets(wrapper);
    expect(back).toEqual({ keyId: "abc" });
  });
});
