// MASTER_SECRET_KEY rotation smoke. Proves the three guarantees the
// rotation docs claim:
//
//   1. A blob encrypted under key A does NOT decrypt under key B.
//      (The script's whole premise — if this breaks, you've got a
//      broken-crypto situation worse than a lost key.)
//   2. Decrypting with the OLD key + re-encrypting with the NEW key
//      produces a blob that decrypts under the NEW key.
//   3. A blob that's never been rotated still decrypts under the ORIGINAL
//      key after process-level MASTER_SECRET_KEY was swapped out and
//      back in — i.e. getKey() refreshes based on env, not module load.
//
// We rotate `process.env.MASTER_SECRET_KEY` between every encrypt/decrypt
// to simulate "service restarted with new key". encryptSecrets +
// decryptSecrets must honour the current env; a stale cache would mask
// bugs the rotation script would hit in prod.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecrets, decryptSecrets } from "./secrets-crypto";

// Two independent 32-byte keys, hex-encoded (what the script accepts).
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("MASTER_SECRET_KEY rotation (in-memory smoke)", () => {
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env.MASTER_SECRET_KEY;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.MASTER_SECRET_KEY;
    else process.env.MASTER_SECRET_KEY = prior;
  });

  it("blob encrypted under key A does not decrypt under key B", () => {
    process.env.MASTER_SECRET_KEY = KEY_A;
    const blob = encryptSecrets({ apiKey: "sk-redacted-stand-in-value" });
    // Flip the key before the decrypt attempt — this is what a prod
    // service sees after an operator swapped MASTER_SECRET_KEY out from
    // under them without running the rotation script.
    process.env.MASTER_SECRET_KEY = KEY_B;
    expect(() => decryptSecrets(blob)).toThrow();
  });

  it("rotate = decrypt-old + encrypt-new; result decrypts cleanly under new key", () => {
    // 1. Write a secret under key A.
    process.env.MASTER_SECRET_KEY = KEY_A;
    const original = { apiKey: "sk-abc", webhookSecret: "whsec_xyz" };
    const underA = encryptSecrets(original);

    // 2. Simulate the rotation script: still with key A, decrypt to plaintext.
    const plain = decryptSecrets(underA);
    expect(plain).toEqual(original);

    // 3. Swap to key B and re-encrypt.
    process.env.MASTER_SECRET_KEY = KEY_B;
    const underB = encryptSecrets(plain);

    // 4. Blob B should decrypt under key B, not under key A.
    expect(decryptSecrets(underB)).toEqual(original);
    process.env.MASTER_SECRET_KEY = KEY_A;
    expect(() => decryptSecrets(underB)).toThrow();
  });

  it("getKey refreshes when the env changes mid-process (no stale cache)", () => {
    process.env.MASTER_SECRET_KEY = KEY_A;
    const underA = encryptSecrets({ v: 1 });
    expect(decryptSecrets(underA)).toEqual({ v: 1 });

    // Rotate env, write + read under B.
    process.env.MASTER_SECRET_KEY = KEY_B;
    const underB = encryptSecrets({ v: 2 });
    expect(decryptSecrets(underB)).toEqual({ v: 2 });

    // Flip back to A — the A blob should decrypt again (cache was invalidated).
    process.env.MASTER_SECRET_KEY = KEY_A;
    expect(decryptSecrets(underA)).toEqual({ v: 1 });
  });

  it("passthrough mode (no key set) stores enc:false and round-trips", () => {
    delete process.env.MASTER_SECRET_KEY;
    const blob = encryptSecrets({ raw: true });
    expect(blob).toEqual({ enc: false, data: { raw: true } });
    expect(decryptSecrets(blob)).toEqual({ raw: true });
  });

  it("refuses to decrypt an encrypted blob when MASTER_SECRET_KEY is unset", () => {
    process.env.MASTER_SECRET_KEY = KEY_A;
    const blob = encryptSecrets({ apiKey: "sk-xyz" });

    delete process.env.MASTER_SECRET_KEY;
    expect(() => decryptSecrets(blob)).toThrow(/MASTER_SECRET_KEY/);
  });
});
