// Face-recognition adapter interface + AWS Rekognition + Azure Face
// implementations. All secrets live on TenantIntegration.secrets:
//
//   AWS Rekognition:
//     { provider: "aws", awsRegion, awsAccessKeyId, awsSecretAccessKey }
//   Azure Face:
//     { provider: "azure", azureEndpoint, azureKey }
//   Stub (no external call, always confidence=1):
//     { provider: "stub" }
//
// The employee-checkins route enrolls a face (POST /:id/face/enroll
// with a JPEG buffer) — we store the returned embedding (base64) on
// Employee.faceEmbedding. On check-in, the mobile uploads a fresh
// photo, we call `compareFaces(newBuf, storedEmbedding)` and record
// confidence on the EmployeeCheckin row.

export interface FaceProvider {
  // Extract a face descriptor from an image buffer. Returned as
  // base64-encoded provider-specific bytes.
  enroll(imageBuffer: Buffer): Promise<string>;
  // Compare a fresh photo against a stored embedding. Returns confidence
  // in [0..1]; caller decides a threshold (typically 0.85).
  compare(imageBuffer: Buffer, storedEmbeddingBase64: string): Promise<number>;
}

// ── Stub (deterministic; useful for dev + tests) ─────────────────────

export class StubFaceProvider implements FaceProvider {
  async enroll(imageBuffer: Buffer): Promise<string> {
    // A trivial "embedding" — just hash the first 32 bytes. Real
    // providers return a 128-dim float vector.
    const first = imageBuffer.subarray(0, 32);
    return Buffer.from(first).toString("base64");
  }
  async compare(imageBuffer: Buffer, storedEmbeddingBase64: string): Promise<number> {
    const fresh = imageBuffer.subarray(0, 32).toString("base64");
    return fresh === storedEmbeddingBase64 ? 1 : 0;
  }
}

// ── AWS Rekognition ──────────────────────────────────────────────────
//
// Uses the /IndexFaces + /CompareFaces REST endpoints directly (no SDK
// dep). Requests are SigV4-signed; we do a minimal implementation
// inline rather than pull in @aws-crypto/sha256-js just for signing.

interface AwsCreds {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(input: string | Uint8Array): Promise<string> {
  const src = typeof input === "string" ? new TextEncoder().encode(input) : input;
  // Copy into a fresh ArrayBuffer to satisfy TS's strict BufferSource type.
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return toHex(new Uint8Array(buf));
}

async function hmacSha256(key: Uint8Array, msg: string): Promise<Uint8Array> {
  // Copy key into a fresh ArrayBuffer so TS is happy about ArrayBufferLike unions.
  const keyBuf = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuf).set(key);
  const k = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

async function signAwsRequest(
  creds: AwsCreds,
  method: string,
  host: string,
  path: string,
  body: string,
  amzTarget: string,
): Promise<Record<string, string>> {
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const amzDate = now;
  const dateStamp = now.slice(0, 8);
  const bodyHash = await sha256(body);
  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${amzTarget}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalReq =
    `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;
  const canonicalReqHash = await sha256(canonicalReq);
  const credentialScope = `${dateStamp}/${creds.region}/rekognition/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalReqHash}`;
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + creds.secretAccessKey), dateStamp);
  const kRegion = await hmacSha256(kDate, creds.region);
  const kService = await hmacSha256(kRegion, "rekognition");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host,
    "x-amz-date": amzDate,
    "x-amz-target": amzTarget,
    authorization,
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
  return headers;
}

export class AwsRekognitionProvider implements FaceProvider {
  constructor(private creds: AwsCreds, private fetchImpl: typeof fetch = fetch) {}

  private host(): string {
    return `rekognition.${this.creds.region}.amazonaws.com`;
  }

  async enroll(imageBuffer: Buffer): Promise<string> {
    const body = JSON.stringify({ Image: { Bytes: imageBuffer.toString("base64") } });
    const target = "RekognitionService.DetectFaces";
    const headers = await signAwsRequest(this.creds, "POST", this.host(), "/", body, target);
    const res = await this.fetchImpl(`https://${this.host()}/`, { method: "POST", headers, body });
    if (!res.ok) throw new Error(`AWS Rekognition DetectFaces failed: ${res.status}`);
    // We store the source image itself (base64) as the "embedding" for
    // this provider — Rekognition CompareFaces takes source+target
    // images directly (no separate embedding step). Simpler + matches
    // the enrollment UX.
    return imageBuffer.toString("base64");
  }

  async compare(imageBuffer: Buffer, storedEmbeddingBase64: string): Promise<number> {
    const body = JSON.stringify({
      SourceImage: { Bytes: storedEmbeddingBase64 },
      TargetImage: { Bytes: imageBuffer.toString("base64") },
      SimilarityThreshold: 70,
    });
    const target = "RekognitionService.CompareFaces";
    const headers = await signAwsRequest(this.creds, "POST", this.host(), "/", body, target);
    const res = await this.fetchImpl(`https://${this.host()}/`, { method: "POST", headers, body });
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      FaceMatches?: Array<{ Similarity?: number }>;
    };
    const best = data.FaceMatches?.[0]?.Similarity ?? 0;
    return best / 100;
  }
}

// ── Azure Face API ───────────────────────────────────────────────────

export class AzureFaceProvider implements FaceProvider {
  constructor(
    private endpoint: string,
    private key: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async enroll(imageBuffer: Buffer): Promise<string> {
    const res = await this.fetchImpl(
      `${this.endpoint.replace(/\/$/, "")}/face/v1.0/detect?returnFaceId=true`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "ocp-apim-subscription-key": this.key },
        body: new Uint8Array(imageBuffer),
      },
    );
    if (!res.ok) throw new Error(`Azure Face detect failed: ${res.status}`);
    const arr = (await res.json()) as Array<{ faceId?: string }>;
    if (arr.length === 0 || !arr[0].faceId) throw new Error("No face detected in enrollment image");
    return arr[0].faceId;
  }

  async compare(imageBuffer: Buffer, storedFaceId: string): Promise<number> {
    // Detect the fresh face first to get a faceId.
    const detect = await this.fetchImpl(
      `${this.endpoint.replace(/\/$/, "")}/face/v1.0/detect?returnFaceId=true`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "ocp-apim-subscription-key": this.key },
        body: new Uint8Array(imageBuffer),
      },
    );
    if (!detect.ok) return 0;
    const arr = (await detect.json()) as Array<{ faceId?: string }>;
    if (arr.length === 0 || !arr[0].faceId) return 0;
    const verify = await this.fetchImpl(
      `${this.endpoint.replace(/\/$/, "")}/face/v1.0/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "ocp-apim-subscription-key": this.key },
        body: JSON.stringify({ faceId1: storedFaceId, faceId2: arr[0].faceId }),
      },
    );
    if (!verify.ok) return 0;
    const data = (await verify.json()) as { confidence?: number; isIdentical?: boolean };
    return data.confidence ?? 0;
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function faceProviderFromSecrets(
  secrets: Record<string, unknown>,
): FaceProvider {
  const provider = typeof secrets.provider === "string" ? secrets.provider : "stub";
  if (provider === "aws") {
    return new AwsRekognitionProvider({
      region: String(secrets.awsRegion ?? "us-east-1"),
      accessKeyId: String(secrets.awsAccessKeyId ?? ""),
      secretAccessKey: String(secrets.awsSecretAccessKey ?? ""),
      sessionToken:
        typeof secrets.awsSessionToken === "string" ? secrets.awsSessionToken : undefined,
    });
  }
  if (provider === "azure") {
    return new AzureFaceProvider(
      String(secrets.azureEndpoint ?? ""),
      String(secrets.azureKey ?? ""),
    );
  }
  return new StubFaceProvider();
}

// Default threshold for accepting a check-in match. Configurable per
// tenant via TenantIntegration.secrets.faceMatchThreshold — the route
// layer reads that override or falls back to this default.
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.85;
