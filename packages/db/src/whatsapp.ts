// Meta WhatsApp Business Cloud API adapter. Two-piece surface:
//   * WhatsappClient — thin fetch wrapper around Meta Graph API v21.0 for
//     template CRUD + outbound send. All credentials live on a
//     TenantIntegration row (provider="whatsapp") and are decrypted at load
//     time — the client itself is stateless and does not read env vars.
//   * verifyWebhookSignature — static helper that HMAC-SHA256s the raw
//     request body against the tenant's app secret and constant-time
//     compares against the `X-Hub-Signature-256` header Meta sends.
//
// Note on the base URL:
//   Templates live under /{businessAccountId}/message_templates while sends
//   live under /{phoneNumberId}/messages. Both share the same host + version.
//   We keep them as two properties on the client so callers never have to
//   remember which one to hit.
//
// Note on delete:
//   Meta only supports "delete template by name" (there's no id-scoped
//   delete). We keep the local row's `wabaTemplateId` for audit but always
//   send `?name=` on delete.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decryptSecrets } from "./secrets-crypto";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export interface WhatsappCredentials {
  accessToken: string;       // permanent access token issued via Meta App
  phoneNumberId: string;     // WABA phone_number_id (used for /messages)
  businessAccountId: string; // WABA id (used for /message_templates)
  webhookVerifyToken: string; // custom token echoed on hub.mode=subscribe
  appSecret: string;         // Meta App Secret — used for X-Hub-Signature-256
}

export interface WhatsappSendResult {
  wamid: string;
}

export interface WhatsappTemplateComponent {
  type: string;                                          // BODY | HEADER | FOOTER | BUTTONS
  format?: string;                                       // TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
  buttons?: Array<Record<string, unknown>>;
}

export interface WhatsappTemplateCreateResult {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED";
  category?: string;
}

export interface WhatsappTemplateSummary {
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED";
  category: string;
  language?: string;
  components?: WhatsappTemplateComponent[];
  id?: string;
}

// Small structured error class so route handlers can distinguish "bad token"
// (401 → surface to user, needs re-auth) from generic "5xx" (retryable).
export class WhatsappApiError extends Error {
  status: number;
  responseText: string;
  constructor(status: number, message: string, responseText: string) {
    super(message);
    this.status = status;
    this.responseText = responseText;
  }
}

/**
 * Meta Cloud API client. One instance per (tenant, integration).
 *
 * All methods `throw WhatsappApiError` on non-2xx responses — callers should
 * catch and stash `err.message` on the WhatsappMessage.lastError column.
 */
export class WhatsappClient {
  constructor(private creds: WhatsappCredentials) {}

  private async request(
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.creds.accessToken}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!r.ok) {
      throw new WhatsappApiError(
        r.status,
        `Meta Graph ${method} ${url} failed (${r.status}): ${text.slice(0, 400)}`,
        text,
      );
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      // Meta occasionally returns "true" for delete. Return raw text so we
      // don't crash — routes discard the value anyway.
      return { raw: text };
    }
  }

  // ---- Send: template ---------------------------------------------------
  //
  // Positional parameters — Meta expects `{type: "text", text: "..."}` for
  // each {{1}}, {{2}}, ... slot in the approved template's body component.

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: string[],
  ): Promise<WhatsappSendResult> {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: bodyParams.length
          ? [{
              type: "body",
              parameters: bodyParams.map((t) => ({ type: "text", text: t })),
            }]
          : [],
      },
    };
    const url = `${GRAPH_BASE}/${encodeURIComponent(this.creds.phoneNumberId)}/messages`;
    const resp = (await this.request("POST", url, payload)) as {
      messages?: Array<{ id?: string }>;
    };
    const wamid = resp.messages?.[0]?.id;
    if (!wamid) {
      throw new WhatsappApiError(
        200,
        `Meta send returned no wamid: ${JSON.stringify(resp).slice(0, 300)}`,
        JSON.stringify(resp),
      );
    }
    return { wamid };
  }

  // ---- Send: session text (24h user-initiated window) ------------------
  //
  // Only valid when the destination has messaged the WABA in the last 24h.
  // Meta returns a specific error code (131047) otherwise; we let it
  // bubble up as-is inside WhatsappApiError.responseText for surface.

  async sendText(to: string, body: string): Promise<WhatsappSendResult> {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    };
    const url = `${GRAPH_BASE}/${encodeURIComponent(this.creds.phoneNumberId)}/messages`;
    const resp = (await this.request("POST", url, payload)) as {
      messages?: Array<{ id?: string }>;
    };
    const wamid = resp.messages?.[0]?.id;
    if (!wamid) {
      throw new WhatsappApiError(
        200,
        `Meta send returned no wamid: ${JSON.stringify(resp).slice(0, 300)}`,
        JSON.stringify(resp),
      );
    }
    return { wamid };
  }

  // ---- Templates --------------------------------------------------------

  async createTemplate(
    name: string,
    language: string,
    category: string,
    components: WhatsappTemplateComponent[],
  ): Promise<WhatsappTemplateCreateResult> {
    const url = `${GRAPH_BASE}/${encodeURIComponent(this.creds.businessAccountId)}/message_templates`;
    const resp = (await this.request("POST", url, {
      name,
      language,
      category,
      components,
    })) as WhatsappTemplateCreateResult;
    return resp;
  }

  async listTemplates(): Promise<WhatsappTemplateSummary[]> {
    const url = `${GRAPH_BASE}/${encodeURIComponent(this.creds.businessAccountId)}/message_templates?fields=name,status,category,language,components&limit=200`;
    const resp = (await this.request("GET", url)) as {
      data?: WhatsappTemplateSummary[];
    };
    return resp.data ?? [];
  }

  async deleteTemplate(name: string): Promise<void> {
    const url = `${GRAPH_BASE}/${encodeURIComponent(this.creds.businessAccountId)}/message_templates?name=${encodeURIComponent(name)}`;
    await this.request("DELETE", url);
  }

  // ---- Webhook signature verification -----------------------------------
  //
  // Meta sends `X-Hub-Signature-256: sha256=<hex>` where <hex> is
  // HMAC-SHA256(appSecret, rawBody). Compare timing-safe.

  static verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | null | undefined,
    appSecret: string,
  ): boolean {
    if (!signatureHeader || !appSecret) return false;
    const [scheme, provided] = signatureHeader.split("=", 2);
    if (scheme !== "sha256" || !provided) return false;
    let providedBuf: Buffer;
    try {
      providedBuf = Buffer.from(provided, "hex");
    } catch {
      return false;
    }
    const expected = createHmac("sha256", appSecret).update(rawBody).digest();
    if (providedBuf.length !== expected.length) return false;
    return timingSafeEqual(providedBuf, expected);
  }
}

// ---------------------------------------------------------------------------
// Factory: load creds from TenantIntegration and construct a client. Returns
// null when no active `whatsapp` integration exists — callers surface this as
// "message Failed with lastError=No WhatsApp integration".
// ---------------------------------------------------------------------------

interface CredsFromSecrets {
  accessToken?: unknown;
  phoneNumberId?: unknown;
  businessAccountId?: unknown;
  webhookVerifyToken?: unknown;
  appSecret?: unknown;
}

function coerceCreds(secrets: Record<string, unknown>): WhatsappCredentials | null {
  const s = secrets as CredsFromSecrets;
  const accessToken = typeof s.accessToken === "string" ? s.accessToken : null;
  const phoneNumberId = typeof s.phoneNumberId === "string" ? s.phoneNumberId : null;
  const businessAccountId = typeof s.businessAccountId === "string" ? s.businessAccountId : null;
  const webhookVerifyToken = typeof s.webhookVerifyToken === "string" ? s.webhookVerifyToken : "";
  const appSecret = typeof s.appSecret === "string" ? s.appSecret : "";
  if (!accessToken || !phoneNumberId || !businessAccountId) return null;
  return { accessToken, phoneNumberId, businessAccountId, webhookVerifyToken, appSecret };
}

export async function getWhatsappClient(
  prismaClient: PrismaClient,
  tenantId: string,
): Promise<WhatsappClient | null> {
  const row = await prismaClient.tenantIntegration.findFirst({
    where: { tenantId, provider: "whatsapp", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (!row) return null;
  let secrets: Record<string, unknown>;
  try {
    secrets = decryptSecrets(row.secrets);
  } catch {
    return null;
  }
  const creds = coerceCreds(secrets);
  if (!creds) return null;
  return new WhatsappClient(creds);
}

// Exposed for tests that need to construct a client from raw secrets without
// hitting Prisma.
export function _coerceCreds(secrets: Record<string, unknown>): WhatsappCredentials | null {
  return coerceCreds(secrets);
}
