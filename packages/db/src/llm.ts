// Module 54 — LLM helper.
//
// Provider-agnostic thin wrapper. Callers supply a prompt + expected
// response shape; we return the parsed JSON + usage metadata. The
// real HTTP call is behind an injectable `LLMProvider` interface so:
//   * Unit tests stub the provider and assert prompt shape / parse
//     handling.
//   * Multiple providers (OpenAI / Anthropic / Google) plug in through
//     the same shape.
//   * A local Ollama or self-hosted provider can be swapped in for
//     tenants who need to keep data on-prem.
//
// Cost + audit: every call returns usage metrics that routes persist
// to AIExtractionJob / AITicketSuggestion rows for the tenant. Nothing
// is logged inside this helper — callers own persistence so they can
// batch writes and link to the right doctype.

export interface LLMCallInput {
  // System prompt establishing the extraction / triage task.
  system: string;
  // User prompt with the source content. For vision extraction, this
  // is either a URL, a base64 data URL, or descriptive text ("here's
  // the OCR of the invoice: <text>"). We don't do OCR ourselves in
  // v1 — the caller can either use a vision-capable model or run OCR
  // beforehand and pass text.
  user: string;
  // Optional base64-encoded image / PDF content to attach to a vision
  // call. Providers that don't support vision throw at call time; the
  // caller should have picked a model accordingly.
  attachments?: Array<{ mimeType: string; base64Data: string }>;
  // JSON schema (JSON-Schema draft-07 shape) the model should conform
  // to. Providers use their native structured-output mode when
  // available (OpenAI `response_format`, Anthropic tool-use, etc.).
  responseSchema: Record<string, unknown>;
  // Optional model override; defaults picked per-provider.
  model?: string;
  // Hard cap on model output tokens. Defaults to 2000.
  maxOutputTokens?: number;
}

export interface LLMCallResult<T> {
  parsed: T;
  raw: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LLMProvider {
  name: string; // "openai" | "anthropic" | "google" | "stub"
  call<T>(input: LLMCallInput): Promise<LLMCallResult<T>>;
}

// Stub provider — deterministic responses driven by the system prompt.
// Ships as the DEFAULT so the routes work without external creds; a
// real provider is swapped in by TenantIntegration lookup in the
// route handler (see stubProvider vs realProviders in route code).
//
// The stub uses simple pattern matching to fake structured extraction:
// callers pass a "hint" via input.user starting with "STUB_INVOICE:" or
// "STUB_TRIAGE:" to force a specific canned response. Real prompts
// return an empty object so the route can gracefully show "no
// suggestions available; configure an AI provider".
export const stubProvider: LLMProvider = {
  name: "stub",
  async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
    const started = Date.now();
    let parsed: unknown = {};
    if (input.user.startsWith("STUB_INVOICE:")) {
      parsed = {
        supplierName: "Acme Widgets Ltd",
        supplierInvoiceNo: "AW-2026-042",
        invoiceDate: "2026-03-01",
        currency: "INR",
        lines: [
          { description: "Widget Type A", qty: 10, rate: 250.0, amount: 2500.0 },
          { description: "Widget Type B", qty: 5, rate: 500.0, amount: 2500.0 },
        ],
        subtotal: 5000.0,
        taxAmount: 900.0,
        grandTotal: 5900.0,
      };
    } else if (input.user.startsWith("STUB_TRIAGE:")) {
      parsed = {
        priority: "Medium",
        category: "Billing",
        matchingArticleSlugs: [],
        suggestedResponse: "Thanks for reaching out — a billing specialist will review shortly.",
        confidence: 65,
      };
    }
    return {
      parsed: parsed as T,
      raw: JSON.stringify(parsed),
      provider: "stub",
      model: "stub-v1",
      inputTokens: input.user.length / 4, // rough char→token estimate
      outputTokens: JSON.stringify(parsed).length / 4,
      latencyMs: Date.now() - started,
    };
  },
};

// Registry lookup — the route inspects the tenant's TenantIntegration
// rows for provider="openai"|"anthropic"|"google" with isActive=true.
// If none configured, falls back to the stub so the UX degrades to
// "AI features returned no suggestions" rather than crashing.
//
// Real provider adapters live in a follow-up file (llm-providers.ts)
// so the base LLM helper stays dependency-free (no fetch/OpenAI SDK
// import). The route wires them explicitly.

export function pickProvider(available: Record<string, LLMProvider>, preferred?: string): LLMProvider {
  if (preferred && available[preferred]) return available[preferred];
  // Priority: router (wraps tenant's configured LLMRouter which already
  // falls through openai → anthropic → ollama → stub itself) → direct
  // provider keys → stub.
  for (const key of ["router", "openai", "anthropic", "google"]) {
    if (available[key]) return available[key];
  }
  return available.stub ?? stubProvider;
}
