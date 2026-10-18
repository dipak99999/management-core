import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Envelope encryption for TenantIntegration.secrets. Every secret blob is
// AES-256-GCM encrypted with a per-blob random IV. The key is derived from
// MASTER_SECRET_KEY env (32 raw bytes, hex or base64 encoded). Ciphertext is
// stored as `{alg: "aes-256-gcm", iv, tag, ct}` — a JSON object Prisma
// serializes verbatim into the Json column.
//
// Rotation: change MASTER_SECRET_KEY, then re-save every integration.
// Simplest MVP path — no key-derivation-per-integration, no KMS. For a real
// deployment swap this out for a KMS-backed envelope (AWS KMS, GCP KMS,
// Vault). Keeping the interface small (encrypt/decrypt) makes that swap
// mechanical.
//
// If MASTER_SECRET_KEY is unset, encryption is disabled and secrets pass
// through as-is with an `enc: false` marker so we can detect unencrypted
// legacy rows. In production the marker paired with a set MASTER_SECRET_KEY
// triggers a lazy-migrate on next write.

const ALG = "aes-256-gcm" as const;
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let cachedFor: string | undefined;

// Lazy: read env on first call. Cached per unique env value so tests / hot
// reloads that change the env at runtime pick it up on next call without
// re-running scrypt every time. Returns null when unset.
function getKey(): Buffer | null {
  const raw = process.env.MASTER_SECRET_KEY;
  if (!raw) {
    cachedKey = null;
    cachedFor = undefined;
    return null;
  }
  if (cachedKey && cachedFor === raw) return cachedKey;
  // Accept hex (64 chars), base64url (43 chars), or a passphrase we
  // stretch with scrypt. Scrypt lets a small operator use a memorable
  // phrase and still get a strong key.
  if (/^[a-f0-9]{64}$/i.test(raw)) cachedKey = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9_-]{43}={0,2}$/.test(raw))
    cachedKey = Buffer.from(raw, "base64url");
  else cachedKey = scryptSync(raw, "lumaara-secrets-salt", KEY_LEN);
  cachedFor = raw;
  return cachedKey;
}

export interface EncryptedBlob {
  enc: true;
  alg: typeof ALG;
  iv: string;
  tag: string;
  ct: string;
}
export interface UnencryptedBlob {
  enc: false;
  data: Record<string, unknown>;
}
export type StoredSecrets = EncryptedBlob | UnencryptedBlob | Record<string, unknown>;

// Encrypt a plaintext record. Returns the same record shape when no key is
// configured (dev / initial setup) so callers don't have to branch.
export function encryptSecrets(plain: Record<string, unknown>): StoredSecrets {
  const KEY = getKey();
  if (!KEY) return { enc: false, data: plain };
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, KEY, iv);
  const json = JSON.stringify(plain);
  const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: true,
    alg: ALG,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

// Decrypt back to the plaintext record. Handles legacy raw records
// (pre-encryption, no `enc` marker) and the `enc:false` wrapper.
export function decryptSecrets(stored: unknown): Record<string, unknown> {
  if (!stored || typeof stored !== "object") return {};
  const s = stored as StoredSecrets;
  if (!("enc" in s)) return s as Record<string, unknown>; // pre-encryption legacy
  if (s.enc === false) return (s as UnencryptedBlob).data;
  const KEY = getKey();
  if (!KEY) {
    throw new Error(
      "Refusing to decrypt: stored value is encrypted but MASTER_SECRET_KEY is not configured",
    );
  }
  const iv = Buffer.from((s as EncryptedBlob).iv, "base64");
  const tag = Buffer.from((s as EncryptedBlob).tag, "base64");
  const ct = Buffer.from((s as EncryptedBlob).ct, "base64");
  if (tag.length !== TAG_LEN)
    throw new Error(`Invalid auth tag length ${tag.length}`);
  const decipher = createDecipheriv(ALG, KEY, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
  return JSON.parse(plain) as Record<string, unknown>;
}
