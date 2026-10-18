// E-signature adapter interface + DocuSign + Zoho Sign + Stub
// implementations. Secrets live on TenantIntegration.secrets:
//
//   DocuSign:
//     { provider: "DocuSign", accessToken, accountId, baseUri? }
//   Zoho Sign:
//     { provider: "ZohoSign", accessToken, dataCenter? }
//   Stub (self-hosted signing via the built-in public sign URL):
//     { provider: "Stub" }
//
// The route calls `sendEnvelope()` when the operator hits "Send", which
// dispatches to the configured adapter (or Stub) and stores the
// provider's envelopeId back on SignatureEnvelope.externalId. Callback
// webhooks land on /webhooks/incoming/:integrationId (existing pipe)
// and flip SignatureRequest.status → Signed / Declined.

export interface ESignSigner {
  name: string;
  email: string;
  order?: number;
  role?: string;
}

export interface ESignEnvelopeInput {
  subject: string;
  message?: string | null;
  documentUrl: string; // publicly-reachable PDF URL, OR base64 in v2
  documentBase64?: string | null;
  signers: ESignSigner[];
  sequential: boolean;
  callbackUrl?: string; // where the provider POSTs completion events
}

export interface ESignEnvelopeResult {
  externalId: string;
  status: "Sent" | "Completed";
  // Per-signer sign URLs when the provider returns embedded links;
  // else null and the provider emails the signer directly.
  signerLinks?: Array<{ email: string; url: string }>;
}

export interface ESignProvider {
  send(input: ESignEnvelopeInput): Promise<ESignEnvelopeResult>;
  void(externalId: string, reason?: string): Promise<void>;
  status(externalId: string): Promise<"Sent" | "Completed" | "Declined" | "Voided" | "Expired">;
}

// ── Stub (self-hosted) ──────────────────────────────────────────────
//
// The route creates SignatureRequest rows with unique accessTokens; the
// public sign UI at /public/sign/:token records signedAt + signedIp
// when the invitee clicks "I agree". No external provider needed.
export class StubESignProvider implements ESignProvider {
  async send(_input: ESignEnvelopeInput): Promise<ESignEnvelopeResult> {
    return { externalId: `stub-${Date.now()}`, status: "Sent" };
  }
  async void(_externalId: string): Promise<void> {
    // no-op — the route flips status locally.
  }
  async status(_externalId: string): Promise<"Sent"> {
    return "Sent";
  }
}

// ── DocuSign ────────────────────────────────────────────────────────

export class DocuSignProvider implements ESignProvider {
  private readonly baseUri: string;
  private readonly accessToken: string;
  private readonly accountId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    secrets: Record<string, unknown>,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.accessToken = String(secrets.accessToken ?? "");
    this.accountId = String(secrets.accountId ?? "");
    this.baseUri = String(secrets.baseUri ?? "https://demo.docusign.net/restapi");
    if (!this.accessToken || !this.accountId) {
      throw new Error(
        "DocuSign not configured — set accessToken + accountId on TenantIntegration.secrets",
      );
    }
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.accessToken}`,
      "content-type": "application/json",
    };
  }

  async send(input: ESignEnvelopeInput): Promise<ESignEnvelopeResult> {
    const signers = input.signers.map((s, i) => ({
      email: s.email,
      name: s.name,
      recipientId: String(i + 1),
      routingOrder: String(input.sequential ? s.order ?? i + 1 : 1),
    }));
    const body = {
      emailSubject: input.subject,
      emailBlurb: input.message ?? undefined,
      documents: [
        {
          documentId: "1",
          name: "Document",
          fileExtension: "pdf",
          documentBase64:
            input.documentBase64 ??
            // Fetch the URL, base64 the bytes — DocuSign requires inline docs.
            (await this.fetchUrlAsBase64(input.documentUrl)),
        },
      ],
      recipients: { signers },
      status: "sent",
      eventNotification: input.callbackUrl
        ? {
            url: input.callbackUrl,
            requireAcknowledgment: "true",
            envelopeEvents: [
              { envelopeEventStatusCode: "completed" },
              { envelopeEventStatusCode: "declined" },
              { envelopeEventStatusCode: "voided" },
            ],
          }
        : undefined,
    };
    const url = `${this.baseUri}/v2.1/accounts/${encodeURIComponent(this.accountId)}/envelopes`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`DocuSign send failed: ${res.status} ${t}`);
    }
    const data = (await res.json()) as { envelopeId?: string; status?: string };
    if (!data.envelopeId) throw new Error("DocuSign returned no envelopeId");
    return { externalId: data.envelopeId, status: "Sent" };
  }

  async void(externalId: string, reason?: string): Promise<void> {
    const url = `${this.baseUri}/v2.1/accounts/${encodeURIComponent(this.accountId)}/envelopes/${encodeURIComponent(externalId)}`;
    const body = { status: "voided", voidedReason: reason ?? "Voided by operator" };
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DocuSign void failed: ${res.status}`);
  }

  async status(externalId: string): Promise<"Sent" | "Completed" | "Declined" | "Voided" | "Expired"> {
    const url = `${this.baseUri}/v2.1/accounts/${encodeURIComponent(this.accountId)}/envelopes/${encodeURIComponent(externalId)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`DocuSign status failed: ${res.status}`);
    const data = (await res.json()) as { status?: string };
    const map: Record<string, "Sent" | "Completed" | "Declined" | "Voided" | "Expired"> = {
      sent: "Sent",
      delivered: "Sent",
      completed: "Completed",
      declined: "Declined",
      voided: "Voided",
      expired: "Expired",
    };
    return map[(data.status ?? "sent").toLowerCase()] ?? "Sent";
  }

  private async fetchUrlAsBase64(url: string): Promise<string> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Fetch document failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
}

// ── Zoho Sign ───────────────────────────────────────────────────────

export class ZohoSignProvider implements ESignProvider {
  private readonly accessToken: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(secrets: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
    this.accessToken = String(secrets.accessToken ?? "");
    const dc = String(secrets.dataCenter ?? "com"); // com | eu | in | com.au
    this.base = `https://sign.zoho.${dc}/api/v1`;
    if (!this.accessToken) {
      throw new Error(
        "Zoho Sign not configured — set accessToken on TenantIntegration.secrets",
      );
    }
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Zoho-oauthtoken ${this.accessToken}`,
    };
  }

  async send(input: ESignEnvelopeInput): Promise<ESignEnvelopeResult> {
    const request = {
      request_name: input.subject,
      description: input.message ?? "",
      is_sequential: input.sequential,
      actions: input.signers.map((s, i) => ({
        recipient_name: s.name,
        recipient_email: s.email,
        action_type: "SIGN",
        signing_order: input.sequential ? s.order ?? i + 1 : 0,
      })),
    };
    // Zoho Sign uses multipart/form-data with { data: JSON, file: PDF }.
    const form = new FormData();
    form.append("data", JSON.stringify({ requests: request }));
    // Fetch the document bytes.
    const docRes = await this.fetchImpl(input.documentUrl);
    if (!docRes.ok) throw new Error(`Fetch document failed: ${docRes.status}`);
    form.append("file", new Blob([await docRes.arrayBuffer()], { type: "application/pdf" }), "document.pdf");

    const res = await this.fetchImpl(`${this.base}/requests`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) throw new Error(`Zoho Sign send failed: ${res.status}`);
    const data = (await res.json()) as { requests?: { request_id?: string } };
    const id = data.requests?.request_id ?? "";
    if (!id) throw new Error("Zoho Sign returned no request_id");
    // Submit for signing (Zoho requires an explicit submit call after upload).
    await this.fetchImpl(`${this.base}/requests/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      headers: this.headers(),
    });
    return { externalId: id, status: "Sent" };
  }

  async void(externalId: string, reason?: string): Promise<void> {
    const form = new FormData();
    form.append("data", JSON.stringify({ reason: reason ?? "Voided" }));
    const res = await this.fetchImpl(
      `${this.base}/requests/${encodeURIComponent(externalId)}/recall`,
      { method: "POST", headers: this.headers(), body: form },
    );
    if (!res.ok) throw new Error(`Zoho Sign void failed: ${res.status}`);
  }

  async status(externalId: string): Promise<"Sent" | "Completed" | "Declined" | "Voided" | "Expired"> {
    const res = await this.fetchImpl(
      `${this.base}/requests/${encodeURIComponent(externalId)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Zoho Sign status failed: ${res.status}`);
    const data = (await res.json()) as { requests?: { request_status?: string } };
    const raw = (data.requests?.request_status ?? "sent").toLowerCase();
    const map: Record<string, "Sent" | "Completed" | "Declined" | "Voided" | "Expired"> = {
      "inprogress": "Sent",
      "completed": "Completed",
      "declined": "Declined",
      "recalled": "Voided",
      "expired": "Expired",
    };
    return map[raw] ?? "Sent";
  }
}

// Factory: pick the adapter from a TenantIntegration.secrets bag. The
// "Stub" fallback keeps the flow working in dev without external creds
// — the platform's own /public/sign/:token page acts as the signing UI.
export function esignProviderFromSecrets(
  secrets: Record<string, unknown>,
): ESignProvider {
  const provider = String(secrets.provider ?? "Stub");
  if (provider === "DocuSign") return new DocuSignProvider(secrets);
  if (provider === "ZohoSign") return new ZohoSignProvider(secrets);
  return new StubESignProvider();
}
