// Multi-provider chat resolver.
//
// Routes an incoming (tenantId, chat) call through the first configured
// provider found in this order:
//   1. TenantIntegration (tenant's own key for anthropic/openai/brew)
//   2. PlatformAiProvider isDefault=true + isActive=true
//   3. PlatformAiProvider isActive=true ordered by priority asc
//   4. process.env fallback (ANTHROPIC_API_KEY / OPENAI_API_KEY) — dev only
//
// Returns a thin ChatProvider that exposes `.chat(system, messages)` →
// `{ text, model, provider, inputTokens, outputTokens }`. Callers never
// need to know which upstream API they're hitting.
//
// Why not reuse LLMRouter?  LLMRouter is for structured-output extraction
// (JSON schema + tool-use). Chat/RAG wants free-form text, which needs a
// different call shape per provider — AnthropicProvider.call() forces a
// synthetic "emit" tool; OpenAI's chat is plain messages. Keeping them
// separate here avoids squeezing a chat path through a schema-oriented
// surface.

import { prisma } from "./index";
import { decryptSecrets } from "./secrets-crypto";

export type ChatProviderKind =
  | "anthropic"
  | "openai"
  | "brew"
  | "azure-openai"
  | "ollama";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  provider: ChatProviderKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ChatProvider {
  readonly kind: ChatProviderKind;
  readonly model: string;
  chat(system: string, messages: ChatMessage[]): Promise<ChatResult>;
  /**
   * Streaming variant. Yields text chunks as they arrive from upstream.
   * Returns final usage counts via the resolve of the generator.
   */
  stream(
    system: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string, { model: string; inputTokens: number; outputTokens: number }, void>;
}

export class NoChatProviderError extends Error {
  constructor() {
    super(
      "No AI provider configured. Add one in Super Admin → AI Providers " +
        "or set an environment fallback (ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    );
    this.name = "NoChatProviderError";
  }
}

interface ResolvedSecrets {
  provider: ChatProviderKind;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  source: "tenant" | "platform" | "env";
}

// Normalize the various case/slug variants (Anthropic / anthropic / brew / BrewAI)
// into the canonical lowercase provider key.
function canonicalProvider(raw: string): ChatProviderKind | null {
  const s = raw.trim().toLowerCase();
  if (s === "anthropic" || s === "claude") return "anthropic";
  if (s === "openai") return "openai";
  if (s === "brew" || s === "brewai") return "brew";
  if (s === "azure-openai" || s === "azure" || s === "azureopenai") return "azure-openai";
  if (s === "ollama") return "ollama";
  return null;
}

async function fromTenantIntegration(tenantId: string): Promise<ResolvedSecrets | null> {
  // Any active LLM-capable integration owned by this tenant.
  const rows = await prisma.tenantIntegration.findMany({
    where: {
      tenantId,
      isActive: true,
      provider: { in: ["Anthropic", "anthropic", "OpenAI", "openai", "Brew", "brew", "brewai", "BrewAI"] },
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  for (const row of rows) {
    const kind = canonicalProvider(row.provider);
    if (!kind) continue;
    try {
      const s = decryptSecrets(row.secrets);
      const apiKey = typeof s.apiKey === "string" ? s.apiKey : undefined;
      if (!apiKey) continue;
      const config = (row.config ?? {}) as Record<string, unknown>;
      return {
        provider: kind,
        apiKey,
        baseUrl: typeof s.baseUrl === "string" ? s.baseUrl : (typeof config.baseUrl === "string" ? config.baseUrl : undefined),
        defaultModel: typeof s.defaultModel === "string" ? s.defaultModel : (typeof config.defaultModel === "string" ? config.defaultModel : undefined),
        source: "tenant",
      };
    } catch {
      // bad ciphertext, try next
    }
  }
  return null;
}

async function fromPlatform(): Promise<ResolvedSecrets | null> {
  const row = await prisma.platformAiProvider.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { priority: "asc" }, { updatedAt: "desc" }],
  });
  if (!row) return null;
  const kind = canonicalProvider(row.provider);
  if (!kind) return null;
  try {
    const s = decryptSecrets(row.secrets);
    const apiKey = typeof s.apiKey === "string" ? s.apiKey : undefined;
    return {
      provider: kind,
      apiKey,
      baseUrl: row.baseUrl ?? undefined,
      defaultModel: row.defaultModel ?? undefined,
      source: "platform",
    };
  } catch {
    return null;
  }
}

function fromEnv(): ResolvedSecrets | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, source: "env" };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, source: "env" };
  }
  return null;
}

// ── Concrete chat providers (free-form text) ──────────────────────────

const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

class AnthropicChatProvider implements ChatProvider {
  readonly kind: ChatProviderKind = "anthropic";
  constructor(
    private readonly apiKey: string,
    public readonly model: string = "claude-3-5-haiku-20241022",
    private readonly baseUrl: string = "https://api.anthropic.com",
  ) {}
  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    const r = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system,
        messages,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Anthropic ${r.status}: ${t.slice(0, 400)}`);
    }
    const body = (await r.json()) as {
      content?: Array<{ type: string; text?: string }>;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      provider: this.kind,
      model: body.model ?? this.model,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
  }
  async *stream(system: string, messages: ChatMessage[]) {
    const r = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      // No AbortSignal.timeout — streams run for the full generation
      // duration (can be minutes for long replies). The caller controls
      // cancellation via request abort when the client disconnects.
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system,
        messages,
        stream: true,
      }),
    });
    if (!r.ok || !r.body) {
      const t = r.body ? await r.text().catch(() => "") : "";
      throw new Error(`Anthropic stream ${r.status}: ${t.slice(0, 400)}`);
    }
    let inputTokens = 0;
    let outputTokens = 0;
    let modelOut = this.model;
    for await (const evt of parseSseStream(r.body)) {
      if (!evt.data || evt.data === "[DONE]") continue;
      try {
        const obj = JSON.parse(evt.data) as {
          type?: string;
          delta?: { text?: string };
          message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (obj.type === "message_start" && obj.message) {
          if (obj.message.model) modelOut = obj.message.model;
          if (obj.message.usage?.input_tokens) inputTokens = obj.message.usage.input_tokens;
        }
        if (obj.type === "content_block_delta" && obj.delta?.text) {
          yield obj.delta.text;
        }
        if (obj.type === "message_delta" && obj.usage?.output_tokens) {
          outputTokens = obj.usage.output_tokens;
        }
      } catch {
        // tolerate the occasional keep-alive comment / malformed line
      }
    }
    return { model: modelOut, inputTokens, outputTokens };
  }
}

// OpenAI (and Brew / Azure which use the same wire format with different
// base URLs).
class OpenAIChatProvider implements ChatProvider {
  constructor(
    public readonly kind: Extract<ChatProviderKind, "openai" | "brew" | "azure-openai">,
    private readonly apiKey: string,
    public readonly model: string,
    private readonly baseUrl: string,
  ) {}
  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`${this.kind} ${r.status}: ${t.slice(0, 400)}`);
    }
    const body = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    return {
      text,
      provider: this.kind,
      model: body.model ?? this.model,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }
  async *stream(system: string, messages: ChatMessage[]) {
    const r = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: DEFAULT_MAX_TOKENS,
        messages: [{ role: "system", content: system }, ...messages],
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!r.ok || !r.body) {
      const t = r.body ? await r.text().catch(() => "") : "";
      throw new Error(`${this.kind} stream ${r.status}: ${t.slice(0, 400)}`);
    }
    let modelOut = this.model;
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const evt of parseSseStream(r.body)) {
      if (!evt.data || evt.data === "[DONE]") continue;
      try {
        const obj = JSON.parse(evt.data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        if (obj.model) modelOut = obj.model;
        const chunk = obj.choices?.[0]?.delta?.content;
        if (chunk) yield chunk;
        if (obj.usage) {
          inputTokens = obj.usage.prompt_tokens ?? inputTokens;
          outputTokens = obj.usage.completion_tokens ?? outputTokens;
        }
      } catch {
        // ignore malformed line
      }
    }
    return { model: modelOut, inputTokens, outputTokens };
  }
}

class OllamaChatProvider implements ChatProvider {
  readonly kind: ChatProviderKind = "ollama";
  constructor(
    public readonly model: string = "llama3.1",
    private readonly baseUrl: string = "http://localhost:11434",
  ) {}
  async chat(system: string, messages: ChatMessage[]): Promise<ChatResult> {
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Ollama ${r.status}: ${t.slice(0, 400)}`);
    }
    const body = (await r.json()) as {
      message?: { content?: string };
      model?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      text: body.message?.content ?? "",
      provider: this.kind,
      model: body.model ?? this.model,
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
    };
  }
  async *stream(system: string, messages: ChatMessage[]) {
    // Ollama streams NDJSON (one JSON object per line, no `data:` prefix).
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama stream ${r.status}`);
    let modelOut = this.model;
    let inputTokens = 0;
    let outputTokens = 0;
    const decoder = new TextDecoder();
    let buf = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as {
            message?: { content?: string };
            model?: string;
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (obj.model) modelOut = obj.model;
          if (obj.message?.content) yield obj.message.content;
          if (obj.done) {
            inputTokens = obj.prompt_eval_count ?? inputTokens;
            outputTokens = obj.eval_count ?? outputTokens;
          }
        } catch {
          // skip malformed line
        }
      }
    }
    return { model: modelOut, inputTokens, outputTokens };
  }
}

// Shared SSE line parser — handles `event: X\ndata: Y\n\n` frames used
// by Anthropic + OpenAI streaming APIs. Each yielded frame is an object
// with the latest `event` + accumulated multi-line `data` string.
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }, void, void> {
  const decoder = new TextDecoder();
  let buf = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of body as any as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let frameEnd;
    while ((frameEnd = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, frameEnd);
      buf = buf.slice(frameEnd + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) yield { event, data: dataLines.join("\n") };
    }
  }
}

function build(secrets: ResolvedSecrets): ChatProvider {
  const kind = secrets.provider;
  if (kind === "anthropic") {
    if (!secrets.apiKey) throw new NoChatProviderError();
    return new AnthropicChatProvider(
      secrets.apiKey,
      secrets.defaultModel ?? "claude-3-5-haiku-20241022",
      secrets.baseUrl ?? "https://api.anthropic.com",
    );
  }
  if (kind === "openai") {
    if (!secrets.apiKey) throw new NoChatProviderError();
    return new OpenAIChatProvider(
      "openai",
      secrets.apiKey,
      secrets.defaultModel ?? "gpt-4o-mini",
      secrets.baseUrl ?? "https://api.openai.com/v1",
    );
  }
  if (kind === "brew") {
    if (!secrets.apiKey || !secrets.baseUrl) throw new NoChatProviderError();
    return new OpenAIChatProvider(
      "brew",
      secrets.apiKey,
      secrets.defaultModel ?? "brew-default",
      secrets.baseUrl,
    );
  }
  if (kind === "azure-openai") {
    if (!secrets.apiKey || !secrets.baseUrl) throw new NoChatProviderError();
    return new OpenAIChatProvider(
      "azure-openai",
      secrets.apiKey,
      secrets.defaultModel ?? "gpt-4o-mini",
      secrets.baseUrl,
    );
  }
  if (kind === "ollama") {
    return new OllamaChatProvider(
      secrets.defaultModel ?? "llama3.1",
      secrets.baseUrl ?? "http://localhost:11434",
    );
  }
  throw new NoChatProviderError();
}

/**
 * Resolve a chat provider for the tenant. Walks tenant → platform → env.
 * Throws NoChatProviderError if no usable config exists.
 */
export async function resolveChatProvider(tenantId: string): Promise<ChatProvider> {
  const chain = [
    await fromTenantIntegration(tenantId),
    await fromPlatform(),
    fromEnv(),
  ].filter((s): s is ResolvedSecrets => s !== null);
  for (const secrets of chain) {
    try {
      return build(secrets);
    } catch {
      // skip incomplete config; try the next source
    }
  }
  throw new NoChatProviderError();
}

/**
 * Build a chat provider directly from a known secrets bag — used by the
 * super-admin "Test connection" endpoint before persisting.
 */
export function buildChatProviderFromSecrets(input: {
  provider: ChatProviderKind;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}): ChatProvider {
  return build({ ...input, source: "platform" });
}
