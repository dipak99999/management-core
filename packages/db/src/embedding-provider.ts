// Embedding provider — text → float vector via the same secret bag
// the LLM router uses. Providers:
//
//   OpenAI  — /v1/embeddings, model: text-embedding-3-small (1536d)
//   Ollama  — /api/embeddings, model: nomic-embed-text (768d)
//   Stub    — deterministic hash → 8d vector, for dev + tests
//
// Anthropic doesn't expose a native embedding endpoint (as of Q4-2025);
// tenants using Anthropic for chat should configure a separate
// OpenAI or Ollama embedding provider.

import { createHash } from "node:crypto";

export interface EmbedResult {
  vector: number[];
  model: string;
  provider: string;
  latencyMs: number;
  inputTokens?: number;
}

export interface EmbeddingProvider {
  embed(text: string, opts?: { model?: string }): Promise<EmbedResult>;
  dimensions: number;
}

// ── Stub ─────────────────────────────────────────────────────────────

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 8;
  async embed(text: string): Promise<EmbedResult> {
    const started = Date.now();
    const h = createHash("sha256").update(text).digest();
    // Take 8 bytes → normalized floats in [-1..1].
    const vector: number[] = [];
    for (let i = 0; i < this.dimensions; i++) {
      vector.push((h[i] / 128) - 1);
    }
    return {
      vector,
      model: "stub",
      provider: "stub",
      latencyMs: Date.now() - started,
      inputTokens: text.length / 4,
    };
  }
}

// ── OpenAI ───────────────────────────────────────────────────────────

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    private readonly apiKey: string,
    opts: { fetchImpl?: typeof fetch; baseUrl?: string; model?: string; dimensions?: number } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.model = opts.model ?? "text-embedding-3-small";
    this.dimensions = opts.dimensions ?? (this.model === "text-embedding-3-large" ? 3072 : 1536);
  }

  async embed(text: string, opts?: { model?: string }): Promise<EmbedResult> {
    const started = Date.now();
    const model = opts?.model ?? this.model;
    const res = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI embeddings ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding: number[] }>;
      usage?: { prompt_tokens?: number };
    };
    const vector = data.data?.[0]?.embedding;
    if (!vector) throw new Error("OpenAI embeddings: empty response");
    return {
      vector,
      model,
      provider: "openai",
      latencyMs: Date.now() - started,
      inputTokens: data.usage?.prompt_tokens,
    };
  }
}

// ── Ollama ───────────────────────────────────────────────────────────

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { fetchImpl?: typeof fetch; baseUrl?: string; model?: string; dimensions?: number } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.model = opts.model ?? "nomic-embed-text";
    this.dimensions = opts.dimensions ?? 768;
  }

  async embed(text: string, opts?: { model?: string }): Promise<EmbedResult> {
    const started = Date.now();
    const model = opts?.model ?? this.model;
    const res = await this.fetchImpl(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embeddings ${res.status}`);
    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding) throw new Error("Ollama: empty embedding");
    return {
      vector: data.embedding,
      model,
      provider: "ollama",
      latencyMs: Date.now() - started,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export function embeddingProviderFromSecrets(secrets: Record<string, unknown>): EmbeddingProvider {
  const provider = String(secrets.provider ?? "stub");
  if (provider === "openai") {
    const apiKey = String(secrets.apiKey ?? "");
    if (!apiKey) throw new Error("openai embeddings need apiKey");
    return new OpenAIEmbeddingProvider(apiKey, {
      baseUrl: secrets.baseUrl as string | undefined,
      model: secrets.model as string | undefined,
      dimensions: secrets.dimensions as number | undefined,
    });
  }
  if (provider === "ollama") {
    return new OllamaEmbeddingProvider({
      baseUrl: secrets.baseUrl as string | undefined,
      model: secrets.model as string | undefined,
      dimensions: secrets.dimensions as number | undefined,
    });
  }
  return new StubEmbeddingProvider();
}

// ── Pure math helpers ────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// SHA-256 → hex string. Used to short-circuit re-embedding when the
// source content hasn't changed.
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
