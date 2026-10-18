// S3 attachment adapter. Implements AWS SigV4 query-string (presigned URL)
// signing directly against fetch — no aws-sdk dep. Used for:
//   presignPutObject(cfg, key, contentType, expiresSec) → PUT URL the client
//     uploads directly to (browser can PUT bytes without sending them through
//     our API).
//   presignGetObject(cfg, key, expiresSec) → GET URL the client fetches to
//     download.
//   putObject(cfg, key, bytes, contentType) → server-side single-part upload
//     for cases where the API already has the bytes (e.g. generated PDF).
//   deleteObject(cfg, key) → DELETE.
//
// The S3 provider config is stored in TenantIntegration.secrets under the
// "s3" provider: {accessKeyId, secretAccessKey, region, bucket, endpoint?}.
// endpoint is optional and defaults to `https://s3.<region>.amazonaws.com`;
// override for S3-compatible stores (MinIO, R2, Wasabi).

import { createHash, createHmac } from "node:crypto";

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint?: string; // For S3-compatible; defaults to AWS.
  pathStyle?: boolean; // MinIO/local. Default false → virtual-host style.
}

function endpointHost(cfg: S3Config): string {
  if (cfg.endpoint) return cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `s3.${cfg.region}.amazonaws.com`;
}

function buildUrl(cfg: S3Config, key: string): { host: string; path: string; url: string } {
  const host = endpointHost(cfg);
  const encodedKey = encodeS3Key(key);
  if (cfg.pathStyle || cfg.endpoint) {
    const path = `/${cfg.bucket}/${encodedKey}`;
    return { host, path, url: `https://${host}${path}` };
  }
  const bucketHost = `${cfg.bucket}.${host}`;
  const path = `/${encodedKey}`;
  return { host: bucketHost, path, url: `https://${bucketHost}${path}` };
}

function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) =>
      "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function amzDate(d: Date): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

// Presigned URL — uses UNSIGNED-PAYLOAD so the client can send arbitrary bytes.
function presign(
  cfg: S3Config,
  method: "GET" | "PUT" | "DELETE",
  key: string,
  expiresSec: number,
  extraHeaders: Record<string, string> = {},
  extraQuery: Record<string, string> = {},
): string {
  const { host, path, url } = buildUrl(cfg, key);
  const now = new Date();
  const { amz, date } = amzDate(now);
  const credentialScope = `${date}/${cfg.region}/s3/aws4_request`;
  const credential = `${cfg.accessKeyId}/${credentialScope}`;

  const headerNames = ["host", ...Object.keys(extraHeaders).map((h) => h.toLowerCase())].sort();
  const canonicalHeaders =
    headerNames
      .map((n) => {
        const v = n === "host" ? host : extraHeaders[n] ?? extraHeaders[Object.keys(extraHeaders).find((k) => k.toLowerCase() === n) ?? ""];
        return `${n}:${String(v ?? "").trim()}\n`;
      })
      .join("");
  const signedHeaders = headerNames.join(";");

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.floor(expiresSec)))),
    "X-Amz-SignedHeaders": signedHeaders,
    ...extraQuery,
  };
  const sortedKeys = Object.keys(query).sort();
  const canonicalQuery = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kSigning = signingKey(cfg.secretAccessKey, date, cfg.region);
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `${url}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function presignPutObject(
  cfg: S3Config,
  key: string,
  contentType?: string,
  expiresSec = 900,
): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = contentType
    ? { "content-type": contentType }
    : {};
  const url = presign(cfg, "PUT", key, expiresSec, headers);
  return { url, headers };
}

export function presignGetObject(
  cfg: S3Config,
  key: string,
  expiresSec = 900,
  responseContentDisposition?: string,
): string {
  const extraQuery: Record<string, string> = {};
  if (responseContentDisposition) {
    extraQuery["response-content-disposition"] = responseContentDisposition;
  }
  return presign(cfg, "GET", key, expiresSec, {}, extraQuery);
}

// Server-side upload with signed request (SigV4 in the auth header, not query).
// For the moderate sizes an ERP produces (PDFs, images), single-part is fine.
export async function putObject(
  cfg: S3Config,
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { host, path, url } = buildUrl(cfg, key);
  const now = new Date();
  const { amz, date } = amzDate(now);
  const credentialScope = `${date}/${cfg.region}/s3/aws4_request`;
  const payloadHash = sha256Hex(bytes);
  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };

  const headerNames = Object.keys(headers).sort();
  const canonicalHeaders = headerNames.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = headerNames.join(";");

  const canonicalRequest = [
    "PUT",
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kSigning = signingKey(cfg.secretAccessKey, date, cfg.region);
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amz,
      authorization,
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`S3 PUT failed (${r.status}): ${text.slice(0, 300)}`);
  }
}

export async function deleteObject(cfg: S3Config, key: string): Promise<void> {
  const url = presign(cfg, "DELETE", key, 60);
  const r = await fetch(url, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
  if (!r.ok && r.status !== 204 && r.status !== 404) {
    const text = await r.text();
    throw new Error(`S3 DELETE failed (${r.status}): ${text.slice(0, 300)}`);
  }
}

// Load + validate the S3 provider config from a TenantIntegration.secrets blob.
export function loadS3Config(secrets: Record<string, unknown>): S3Config {
  const cfg = secrets as Record<string, string>;
  if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.region || !cfg.bucket) {
    throw new Error("S3 integration missing accessKeyId/secretAccessKey/region/bucket");
  }
  return {
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    bucket: cfg.bucket,
    endpoint: cfg.endpoint || undefined,
    pathStyle: cfg.pathStyle === "true" || cfg.pathStyle === "1",
  };
}
