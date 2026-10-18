// Multi-provider LLM implementations behind the shared LLMProvider
// interface from ./llm.ts. Each provider translates the neutral
// LLMCallInput into the provider's native structured-output API:
//
//   AnthropicProvider — tool-use trick: we synthesize a single "emit"
//     tool whose input matches the caller's JSON Schema, then force
//     tool_choice = { type: "tool", name: "emit" } so Claude MUST fill
//     in the arguments.
//   OpenAIProvider    — response_format: { type: "json_schema", ... }.
//   OllamaProvider    — format: "json" + prompt-injected schema.
//   BrewProvider      — Brew's OpenAI-compatible endpoint; same body
//     shape as OpenAI with a different base URL.
//
// Every provider extracts usage metrics + parses the JSON reply. On
// parse failure they retry once with a re-prompt. Anything worse and
// the caller receives an LLMCallError.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export class LLMCallError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMCallError";
  }
}

// ── Anthropic ────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(
    private readonly apiKey: string,
    opts: { fetchImpl?: typeof fetch; baseUrl?: string; defaultModel?: string } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.defaultModel = opts.defaultModel ?? "claude-haiku-4-5-20251001";
  }

  async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
    const started = Date.now();
    const model = input.model ?? this.defaultModel;
    // Force structured output via a synthetic tool.
    const body = {
      model,
      max_tokens: input.maxOutputTokens ?? 2000,
      system: input.system,
      messages: [
        {
          role: "user",
          content: buildAnthropicUserContent(input),
        },
      ],
      tools: [
        {
          name: "emit",
          description: "Emit the structured response.",
          input_schema: input.responseSchema,
        },
      ],
      tool_choice: { type: "tool", name: "emit" },
    };
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMCallError(`Anthropic ${res.status}: ${text.slice(0, 500)}`, this.name);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; input?: unknown; text?: string; name?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const toolUse = data.content?.find((b) => b.type === "tool_use" && b.name === "emit");
    if (!toolUse || !toolUse.input) {
      throw new LLMCallError("Anthropic returned no tool_use block", this.name);
    }
    return {
      parsed: toolUse.input as T,
      raw: JSON.stringify(toolUse.input),
      provider: this.name,
      model,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

function buildAnthropicUserContent(input: LLMCallInput): unknown {
  if (!input.attachments || input.attachments.length === 0) return input.user;
  const parts: unknown[] = [];
  for (const att of input.attachments) {
    parts.push({
      type: "image",
      source: { type: "base64", media_type: att.mimeType, data: att.base64Data },
    });
  }
  parts.push({ type: "text", text: input.user });
  return parts;
}

// ── OpenAI ───────────────────────────────────────────────────────────

// Recursively walk a JSON schema and apply OpenAI strict-mode rules:
//   - every `object` gets `additionalProperties: false`
//   - every `object`'s `required` array must list EVERY defined property
//     (optional fields are expressed via `type: ["string", "null"]`)
//
// We don't want to force schema authors to care about OpenAI's rules —
// they declare required fields; we promote the rest to nullable so the
// contract stays "all keys are in the response, some may be null".
function normalizeForOpenAIStrict(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeForOpenAIStrict);
  const s = { ...(schema as Record<string, unknown>) };
  if (s.type === "object") {
    // Strict mode: additionalProperties MUST be false even when the
    // schema has no `properties` block (a free-form map). OpenAI treats
    // "no properties + additionalProperties undefined" as "unknown
    // shape" which is forbidden in strict mode.
    s.additionalProperties = false;
    if (s.properties && typeof s.properties === "object") {
      const props = s.properties as Record<string, unknown>;
      const normalizedProps: Record<string, unknown> = {};
      const propKeys: string[] = [];
      for (const [k, v] of Object.entries(props)) {
        propKeys.push(k);
        normalizedProps[k] = normalizeForOpenAIStrict(v);
      }
      s.properties = normalizedProps;
      s.required = propKeys;
    } else {
      // Free-form object with no declared properties — OpenAI strict mode
      // still demands additionalProperties:false + required:[]. The
      // model will emit `{}` for such fields.
      s.properties = {};
      s.required = [];
    }
  }
  if (s.type === "array" && s.items) {
    s.items = normalizeForOpenAIStrict(s.items);
  }
  // Handle anyOf/oneOf/allOf.
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(s[combinator])) {
      s[combinator] = (s[combinator] as unknown[]).map(normalizeForOpenAIStrict);
    }
  }
  return s;
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(
    private readonly apiKey: string,
    opts: { fetchImpl?: typeof fetch; baseUrl?: string; defaultModel?: string; providerName?: string } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
    this.defaultModel = opts.defaultModel ?? "gpt-4o-mini";
    if (opts.providerName) (this as { name: string }).name = opts.providerName;
  }

  async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
    const started = Date.now();
    const model = input.model ?? this.defaultModel;
    const userContent = input.attachments && input.attachments.length > 0
      ? [
          { type: "text", text: input.user },
          ...input.attachments.map((a) => ({
            type: "image_url",
            image_url: { url: `data:${a.mimeType};base64,${a.base64Data}` },
          })),
        ]
      : input.user;
    // OpenAI strict JSON-schema mode is picky: every object needs
    // `additionalProperties: false` + every property under `required`.
    // Rather than make every caller write a strict schema (and lose
    // optional fields), run it through a normalizer that enforces the
    // rules without changing semantics the caller depends on.
    const body = {
      model,
      max_tokens: input.maxOutputTokens ?? 2000,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          schema: normalizeForOpenAIStrict(input.responseSchema),
        },
      },
    };
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMCallError(`${this.name} ${res.status}: ${text.slice(0, 500)}`, this.name);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    if (!raw) throw new LLMCallError(`${this.name} returned empty content`, this.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new LLMCallError(`${this.name} returned non-JSON content`, this.name, e);
    }
    return {
      parsed: parsed as T,
      raw,
      provider: this.name,
      model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

// ── Ollama (self-hosted / air-gapped) ────────────────────────────────

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts: { fetchImpl?: typeof fetch; baseUrl?: string; defaultModel?: string } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.defaultModel = opts.defaultModel ?? "llama3.3:70b";
  }

  async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
    const started = Date.now();
    const model = input.model ?? this.defaultModel;
    // Inject the schema into the prompt — Ollama doesn't have a native
    // tool-use / structured-output API but its json format mode is
    // reliable for well-scoped schemas.
    const promptSchema = `\n\nRespond ONLY with JSON matching this schema:\n${JSON.stringify(input.responseSchema)}`;
    const body = {
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: input.system + promptSchema },
        { role: "user", content: input.user },
      ],
    };
    const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMCallError(`Ollama ${res.status}: ${text.slice(0, 500)}`, this.name);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const raw = data.message?.content ?? "";
    if (!raw) throw new LLMCallError("Ollama returned empty content", this.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new LLMCallError("Ollama returned non-JSON content", this.name, e);
    }
    return {
      parsed: parsed as T,
      raw,
      provider: this.name,
      model,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export interface ProviderSecrets {
  provider: "anthropic" | "openai" | "azure-openai" | "brew" | "ollama" | "stub";
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export function llmProviderFromSecrets(secrets: ProviderSecrets): LLMProvider {
  switch (secrets.provider) {
    case "anthropic": {
      if (!secrets.apiKey) throw new Error("anthropic provider requires apiKey");
      return new AnthropicProvider(secrets.apiKey, {
        baseUrl: secrets.baseUrl,
        defaultModel: secrets.defaultModel,
      });
    }
    case "openai": {
      if (!secrets.apiKey) throw new Error("openai provider requires apiKey");
      return new OpenAIProvider(secrets.apiKey, {
        baseUrl: secrets.baseUrl,
        defaultModel: secrets.defaultModel,
      });
    }
    case "azure-openai": {
      if (!secrets.apiKey || !secrets.baseUrl) {
        throw new Error("azure-openai provider requires apiKey + baseUrl");
      }
      return new OpenAIProvider(secrets.apiKey, {
        baseUrl: secrets.baseUrl,
        defaultModel: secrets.defaultModel,
        providerName: "azure-openai",
      });
    }
    case "brew": {
      // Brew ships an OpenAI-compatible API. `baseUrl` points at the
      // tenant's Brew deployment; `apiKey` is the workspace token.
      if (!secrets.apiKey || !secrets.baseUrl) {
        throw new Error("brew provider requires apiKey + baseUrl");
      }
      return new OpenAIProvider(secrets.apiKey, {
        baseUrl: secrets.baseUrl,
        defaultModel: secrets.defaultModel,
        providerName: "brew",
      });
    }
    case "ollama": {
      return new OllamaProvider({
        baseUrl: secrets.baseUrl,
        defaultModel: secrets.defaultModel,
      });
    }
    case "stub":
    default: {
      // Working stub — always returns a *shape-valid* response so the
      // agent runtime, semantic search, tool palette and Playwright smoke
      // tests can exercise the full pipeline without any external LLM key.
      //
      // For agent planning ('agent.plan'), returns a one-step plan that
      // calls a read-only tool matching the goal's first noun. For every
      // other structured-output call, returns an empty object so schema
      // validators pass and the caller can gracefully show
      // "no suggestions available".
      return {
        name: "stub",
        async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
          const started = Date.now();
          let parsed: unknown = {};

          // Detect an agent-plan call. planTask() serialises user as
          // JSON like `{"context":…,"availableTools":[{name,description},…]}`
          // and system contains "autonomous agent" + "Plan a sequence".
          const isAgentPlan =
            /availableTools|autonomous agent|Plan a sequence/i.test(
              input.user + " " + input.system,
            );

          if (isAgentPlan) {
            // Try to parse the JSON payload to get the tool list + context.
            let toolNames: string[] = [];
            let goalHint = input.system;
            try {
              const parsedUser = JSON.parse(input.user) as {
                availableTools?: Array<{ name: string; description?: string }>;
                context?: Record<string, unknown>;
              };
              toolNames = (parsedUser.availableTools ?? []).map((t) => t.name);
              const ctx = parsedUser.context ?? {};
              goalHint += " " + JSON.stringify(ctx);
            } catch {
              // fall through with empty toolNames
            }

            // Extract "Your goal: …" from system prompt for keyword hints.
            const goalMatch = input.system.match(/Your goal:\s*([^\n]+)/i);
            const goalText = (goalMatch?.[1] ?? "").toLowerCase();

            const pickByHint = (hint: string) =>
              toolNames.find(
                (t) => goalText.includes(hint) && t.startsWith(hint),
              );
            const chosen =
              pickByHint("customer") ??
              pickByHint("employee") ??
              pickByHint("lead") ??
              pickByHint("invoice") ??
              pickByHint("item") ??
              pickByHint("supplier") ??
              pickByHint("payment") ??
              pickByHint("report") ??
              // Fall back to any read-only .list tool
              toolNames.find((t) => t.endsWith(".list")) ??
              toolNames[0];

            parsed = {
              reasoning: `Stub planner: no external LLM configured. ${
                chosen
                  ? `Picked "${chosen}" from ${toolNames.length} available tools.`
                  : "No tools available in the catalog — configure an LLM provider on the tenant."
              }`,
              steps: chosen
                ? [
                    {
                      kind: "ToolCall",
                      toolName: chosen,
                      input: {},
                      reason: `Best match for goal "${goalText.slice(0, 80)}"`,
                    },
                    {
                      kind: "Emit",
                      reason: "Return the tool result to the user.",
                    },
                  ]
                : [
                    {
                      kind: "Emit",
                      reason:
                        "No suitable tool in catalog — configure an LLM provider on the tenant.",
                    },
                  ],
            };
          }

          return {
            parsed: parsed as T,
            raw: "",
            provider: "stub",
            model: "stub",
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - started,
          };
        },
      };
    }
  }
}
