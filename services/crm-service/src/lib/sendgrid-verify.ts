import { createPublicKey, createVerify } from "node:crypto";

// SendGrid Event Webhook signature verification.
//
// SendGrid signs `timestamp + raw_body` with an ECDSA (P-256, SHA-256) key
// pair. The public key is copied out of the SendGrid dashboard when the
// operator enables Signed Event Webhook, and stored in TenantIntegration.
//
// Docs: <https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features>
//
// Public key wire format: base64-encoded uncompressed P-256 point
// (65 bytes: 0x04 || X || Y). We wrap it in SPKI so node:crypto.createPublicKey
// accepts it — SendGrid didn't PEM it.
//
// Signature wire format: base64 ASN.1 DER-encoded (r, s) pair. Node's verify
// accepts this natively.
//
// The signed data is bytes: `<timestamp><raw JSON body>` — no separator.

export type SendGridVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

// SPKI DER prefix for id-ecPublicKey + prime256v1 (P-256), constructed once.
// Concatenating this prefix with the 65-byte uncompressed point produces a
// valid SubjectPublicKeyInfo that createPublicKey accepts as spki/der.
const SPKI_PREFIX_P256 = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

function publicKeyFromSendgridBase64(b64: string) {
  const raw = Buffer.from(b64.trim(), "base64");
  if (raw.length === 91) {
    // Already SPKI-wrapped — pass through.
    return createPublicKey({ key: raw, format: "der", type: "spki" });
  }
  if (raw.length === 65 && raw[0] === 0x04) {
    // Uncompressed P-256 point — wrap in SPKI.
    const spki = Buffer.concat([SPKI_PREFIX_P256, raw]);
    return createPublicKey({ key: spki, format: "der", type: "spki" });
  }
  throw new Error(`unexpected SendGrid public key length: ${raw.length}`);
}

export function verifySendGridSignature(
  publicKeyBase64: string,
  timestamp: string,
  signatureBase64: string,
  rawBody: Buffer,
): SendGridVerifyResult {
  if (!publicKeyBase64) return { ok: false, reason: "no public key" };
  if (!timestamp) return { ok: false, reason: "no timestamp" };
  if (!signatureBase64) return { ok: false, reason: "no signature" };

  // Optional freshness window — reject signatures older than 10 minutes to
  // limit replay. SendGrid timestamps are Unix seconds as a string.
  const tsSec = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsSec)) return { ok: false, reason: "bad timestamp" };
  const skew = Math.abs(Date.now() / 1000 - tsSec);
  if (skew > 600) return { ok: false, reason: `timestamp skew ${Math.round(skew)}s` };

  let pubKey;
  try {
    pubKey = publicKeyFromSendgridBase64(publicKeyBase64);
  } catch (e) {
    return { ok: false, reason: `bad public key: ${e instanceof Error ? e.message : String(e)}` };
  }

  const sig = Buffer.from(signatureBase64, "base64");
  // Signed data = timestamp (utf8) + raw body bytes, with no separator.
  // Use createVerify() (defaults to DER signature encoding for EC keys,
  // matching what SendGrid emits) rather than crypto.verify() which
  // requires a dsaEncoding hint.
  const verifier = createVerify("SHA256");
  verifier.update(Buffer.from(timestamp, "utf8"));
  verifier.update(rawBody);
  verifier.end();
  const ok = verifier.verify(pubKey, sig);
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}
