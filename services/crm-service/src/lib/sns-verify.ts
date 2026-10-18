import { createVerify } from "node:crypto";

// AWS SNS message signature verification.
//
// The full protocol: <https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html>
//
// Every SNS delivery carries a `Signature` (base64) computed over a canonical
// string of envelope fields, signed with the private key whose public cert
// lives at `SigningCertURL`. We:
//   1. Assert the cert URL is an AWS-owned SNS host (prevents attacker-hosted
//      cert). Accepts sns.<region>.amazonaws.com, sns-fips.<region>...com,
//      and the .com.cn China variant.
//   2. Fetch + PEM-cache the cert (per-URL, in-memory; certs are stable for
//      months).
//   3. Rebuild the canonical string per SignatureVersion (v1 = SHA-1, v2 =
//      SHA-256; both are RSA).
//   4. crypto.verify() against the cert.
//
// Returns { ok: true } on pass, { ok: false, reason } on any mismatch. No
// throws — caller decides to 401 vs 400.

const CERT_CACHE = new Map<string, string>();

const AWS_CERT_HOST = /^sns(-fips)?\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Token?: string;
  SubscribeURL?: string;
}

export type SnsVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

function isValidCertUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") return false;
    if (!AWS_CERT_HOST.test(u.hostname)) return false;
    if (!u.pathname.endsWith(".pem")) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchCert(url: string): Promise<string> {
  const cached = CERT_CACHE.get(url);
  if (cached) return cached;
  const res = await fetch(url, { headers: { accept: "text/plain" } });
  if (!res.ok) throw new Error(`SNS cert fetch failed: ${res.status}`);
  const pem = await res.text();
  if (!pem.includes("-----BEGIN CERTIFICATE-----"))
    throw new Error("SNS cert not PEM");
  CERT_CACHE.set(url, pem);
  return pem;
}

// Per SNS docs: canonical string is name+"\n"+value+"\n" for each field in
// the field list, in the order the docs specify. Fields must appear even if
// empty (skip only when the field is defined as "if present" — Subject only
// for Notification).
function canonicalString(envelope: SnsEnvelope): string {
  const t = envelope.Type;
  const parts: string[] = [];
  if (t === "Notification") {
    parts.push("Message", envelope.Message);
    parts.push("MessageId", envelope.MessageId);
    if (envelope.Subject !== undefined) parts.push("Subject", envelope.Subject);
    parts.push("Timestamp", envelope.Timestamp);
    parts.push("TopicArn", envelope.TopicArn);
    parts.push("Type", envelope.Type);
  } else if (t === "SubscriptionConfirmation" || t === "UnsubscribeConfirmation") {
    parts.push("Message", envelope.Message);
    parts.push("MessageId", envelope.MessageId);
    parts.push("SubscribeURL", envelope.SubscribeURL ?? "");
    parts.push("Timestamp", envelope.Timestamp);
    parts.push("Token", envelope.Token ?? "");
    parts.push("TopicArn", envelope.TopicArn);
    parts.push("Type", envelope.Type);
  } else {
    throw new Error(`unsupported SNS Type: ${t}`);
  }
  let out = "";
  for (let i = 0; i < parts.length; i += 2) out += `${parts[i]}\n${parts[i + 1]}\n`;
  return out;
}

export async function verifySnsSignature(
  envelope: SnsEnvelope,
): Promise<SnsVerifyResult> {
  if (!envelope || typeof envelope !== "object")
    return { ok: false, reason: "not an envelope" };
  const required = ["Type", "MessageId", "TopicArn", "Message", "Timestamp", "Signature", "SigningCertURL", "SignatureVersion"] as const;
  for (const k of required) {
    if (typeof (envelope as unknown as Record<string, unknown>)[k] !== "string")
      return { ok: false, reason: `missing field: ${k}` };
  }
  if (!isValidCertUrl(envelope.SigningCertURL))
    return { ok: false, reason: "cert URL not an AWS SNS endpoint" };

  const algo =
    envelope.SignatureVersion === "1"
      ? "RSA-SHA1"
      : envelope.SignatureVersion === "2"
      ? "RSA-SHA256"
      : null;
  if (!algo) return { ok: false, reason: `unsupported SignatureVersion: ${envelope.SignatureVersion}` };

  let pem: string;
  try {
    pem = await fetchCert(envelope.SigningCertURL);
  } catch (e) {
    return { ok: false, reason: `cert fetch: ${e instanceof Error ? e.message : String(e)}` };
  }

  let canonical: string;
  try {
    canonical = canonicalString(envelope);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const verifier = createVerify(algo);
  verifier.update(canonical, "utf8");
  verifier.end();

  const sigBuf = Buffer.from(envelope.Signature, "base64");
  const ok = verifier.verify(pem, sigBuf);
  return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

// Test-only cache reset so unit tests can inject fixture certs.
export function _resetSnsCertCache(): void {
  CERT_CACHE.clear();
}

// Test-only cache warm so tests can inject a fixture cert without a
// network fetch.
export function _seedSnsCert(url: string, pem: string): void {
  CERT_CACHE.set(url, pem);
}
