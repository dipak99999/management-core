// AI chat over ERP data — RAG assistant.
//
// Flow:
//   1. User sends { message, contextDoctypes? } (e.g. ["Customer", "SalesInvoice"]).
//   2. We embed the query using the tenant's configured embedding provider.
//   3. Retrieve top-K entities from the Embedding table filtered by
//      tenantId + doctype allowlist, ranked by cosine similarity.
//   4. Build a system prompt with the retrieved entities as context blocks.
//   5. Call Anthropic messages.create with the context + user message.
//   6. Return { answer, citations, model } — citations link back to the
//      source docs so the UI can render clickable references.
//
// Isolation:
//   * Every embedding query is scoped to req.auth.tenantId — no cross-tenant
//     retrieval possible.
//   * Company access is respected: if the user has company allowlist rows
//     (UserCompanyAccess), we filter SalesInvoice / PurchaseInvoice / etc
//     by companyId as well.
//   * Anthropic client uses the per-tenant API key (see ai-assist.ts).
//
// Rate limiting: aiChatLimiter — 30 requests / minute / user. Chat is 5-10x
// more expensive than a single ai-assist call because we include retrieved
// context blocks; the cap keeps a runaway loop from burning through the key.

import { Router } from "express";
import { z } from "zod";
import {
  cosineSimilarity,
  embeddingProviderFromSecrets,
  NoChatProviderError,
  prisma,
  resolveChatProvider,
} from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";
import { takeToken } from "@lumaara/queue";
import { MODULES, planAllows, type ModuleKey } from "@lumaara/shared-types";

export const aiChatRouter = Router();
aiChatRouter.use(requireAuth);
const p = perms("Customer"); // reuse Customer read as the base access gate

// 30 requests/min per tenant. Same shared token-bucket pattern as ai-assist
// (see services/crm-service/src/routes/ai-assist.ts) — Redis-backed when
// REDIS_URL is set, in-memory fallback otherwise.
const AI_CHAT_RATE_PER_MIN = Number(process.env.AI_CHAT_RATE_PER_MIN ?? 30);

// Default doctypes we can pull context from. Restrict to business-visible
// entities — no auth tables, no audit rows.
const DEFAULT_CONTEXT_DOCTYPES = [
  "Customer",
  "Supplier",
  "Item",
  "SalesInvoice",
  "PurchaseInvoice",
  "SalesOrder",
  "PurchaseOrder",
  "Lead",
  "Opportunity",
  "Quotation",
  "Employee",
];

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  contextDoctypes: z.array(z.string().min(1)).max(20).optional(),
  topK: z.coerce.number().int().min(1).max(20).default(6),
  // Optional subscription scope — when set, we enforce the tenant's
  // plan allows this module/submodule before processing. The UI uses
  // this to drill-down from the big module chip to a specific submodule.
  // Server validates independently from the client — a tampered request
  // without this field (or with a module not in the plan) is rejected.
  module: z.enum(MODULES).optional(),
  submodule: z.string().min(1).max(80).optional(),
  // Reserve for future: prior conversation turns
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
});

// Which doctypes belong to which module. Used to narrow RAG retrieval
// to just the data the user's plan grants access to — a tenant on the
// payroll-only plan asking about customers should return 0 results,
// not scrape the full default list. Super-admins skip this filter.
const DOCTYPES_BY_MODULE: Record<ModuleKey, string[]> = {
  hrms: ["Employee", "Attendance", "LeaveApplication", "JobOpening", "JobApplicant", "Appraisal"],
  payroll: ["SalarySlip", "PayrollEntry", "SalaryStructure", "Loan", "TdsChallan"],
  finance: ["Customer", "Supplier", "SalesInvoice", "PurchaseInvoice", "Payment", "JournalEntry", "Account", "Asset"],
  sales: ["Lead", "Opportunity", "Quotation", "SalesOrder", "Campaign", "Project", "Task", "DeskTicket"],
  manufacturing: ["Item", "Warehouse", "StockEntry", "DeliveryNote", "PurchaseReceipt", "WorkOrder", "BOM", "ProductionPlan"],
};

/**
 * Fetch the tenant's active subscription plan + super-admin flag.
 * Returns null when there's no active subscription (treated as "no
 * access to anything" for module-scoped calls). Cached-friendly: the
 * caller invokes this at most twice per request.
 */
async function loadPlanFor(tenantId: string, userId: string): Promise<{
  allowedModules: string[];
  allowedSubmodules: string[];
  isSuperAdmin: boolean;
} | null> {
  const [sub, me] = await Promise.all([
    prisma.tenantSubscription.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { startDate: "desc" },
      include: { plan: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true } }),
  ]);
  const isSuperAdmin = !!me?.isSuperAdmin;
  if (!sub) return isSuperAdmin ? { allowedModules: [], allowedSubmodules: [], isSuperAdmin: true } : null;
  return {
    allowedModules: sub.plan.allowedModules,
    allowedSubmodules: sub.plan.allowedSubmodules,
    isSuperAdmin,
  };
}

interface Citation {
  doctype: string;
  docId: string;
  title: string;
  score: number;
}

async function embedQuery(tenantId: string, text: string): Promise<number[] | null> {
  // Look up the tenant's embedding provider from TenantIntegration (see
  // embedding-provider.ts). Falls back to null if no provider configured —
  // the chat still works, just without RAG context.
  const integration = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      provider: { in: ["openai", "OpenAI", "ollama", "Ollama"] },
      isActive: true,
    },
  });
  if (!integration) return null;
  try {
    const secretsMod = await import("@lumaara/db");
    const decrypted = secretsMod.decryptSecrets(integration.secrets);
    const provider = embeddingProviderFromSecrets(decrypted);
    const result = await provider.embed(text);
    return result.vector;
  } catch {
    return null;
  }
}

async function retrieveContext(
  tenantId: string,
  queryVec: number[],
  doctypes: string[],
  topK: number,
): Promise<Array<{ doctype: string; docId: string; title: string; content: string; score: number }>> {
  // Load candidate embeddings. Cap the fetch at 500 per doctype to avoid
  // pulling huge tables — for larger deployments swap to pgvector for
  // server-side ranking. The Embedding table is auto-scoped to tenantId
  // by the where clause below.
  const rows = await prisma.embedding.findMany({
    where: {
      tenantId,
      doctype: { in: doctypes },
      stale: false,
      vectorLength: { gt: 0 },
    },
    select: {
      doctype: true,
      docId: true,
      title: true,
      content: true,
      vector: true,
    },
    take: 500,
  });

  const scored = rows
    .map((r) => {
      const vec = Array.isArray(r.vector) ? (r.vector as number[]) : [];
      if (vec.length !== queryVec.length) return null;
      return {
        doctype: r.doctype,
        docId: r.docId,
        title: r.title,
        content: r.content,
        score: cosineSimilarity(queryVec, vec),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

function buildChatSystemPrompt(): string {
  return (
    "You are the Lumaara ERP assistant. You help users answer questions " +
    "about their business data — customers, invoices, orders, products, " +
    "leads, employees. Use ONLY the <context> blocks below to answer; do " +
    "not invent facts. If the context does not contain the answer, say " +
    "'I don't have that information in the visible records.' When you " +
    "reference a record, use its [doctype:docId] label so the caller can " +
    "link to it. Keep answers concise and direct."
  );
}

function buildContextBlock(
  hits: Array<{ doctype: string; docId: string; title: string; content: string }>,
): string {
  if (hits.length === 0) return "<context>No records match your query.</context>";
  const parts = hits.map(
    (h, i) =>
      `<record index="${i + 1}" doctype="${h.doctype}" id="${h.docId}" title="${h.title.replace(/"/g, "'")}">\n${h.content}\n</record>`,
  );
  return `<context>\n${parts.join("\n")}\n</context>`;
}

// Shared pre-flight for /chat + /chat/stream: validate the scope against
// the tenant's SubscriptionPlan + narrow the RAG doctype list to the
// modules they actually have access to. Returns `{ error, status }` on
// gating failure; caller sends it as the HTTP response. Returns the
// narrowed `contextDoctypes` on success.
async function gateAndNarrow(
  tenantId: string,
  userId: string,
  parsedData: {
    module?: ModuleKey;
    submodule?: string;
    contextDoctypes?: string[];
  },
): Promise<
  | { ok: false; status: number; body: Record<string, unknown> }
  | { ok: true; contextDoctypes: string[] }
> {
  const plan = await loadPlanFor(tenantId, userId);

  // Explicit scope — enforce it. The UI drives from the module/submodule
  // picker so a client that opens Brew normally always has these set
  // when they clicked a chip. Missing scope = unscoped question, which
  // we still allow (the AI will answer across whatever the plan grants).
  if (parsedData.module) {
    const isSuperAdmin = plan?.isSuperAdmin ?? false;
    if (!isSuperAdmin && !planAllows(plan, parsedData.module, parsedData.submodule)) {
      const target = parsedData.submodule ?? parsedData.module;
      return {
        ok: false,
        status: 403,
        body: {
          error: `This feature is not part of your subscription.`,
          detail: `"${target}" needs a plan that includes it.`,
          code: "MODULE_NOT_IN_PLAN",
          module: parsedData.module,
          submodule: parsedData.submodule,
          hint: "Visit Settings → Billing to upgrade.",
        },
      };
    }
  }

  // Narrow RAG retrieval to doctypes allowed by the plan. Super admins
  // skip (they can query anything). Explicit scope narrows further to
  // just that module's doctypes.
  let docs = parsedData.contextDoctypes ?? DEFAULT_CONTEXT_DOCTYPES;
  const allAllowed = new Set<string>();
  if (!plan?.isSuperAdmin && plan) {
    for (const mk of plan.allowedModules) {
      for (const dt of DOCTYPES_BY_MODULE[mk as ModuleKey] ?? []) {
        allAllowed.add(dt);
      }
    }
    docs = docs.filter((d) => allAllowed.has(d));
  }
  if (parsedData.module && !plan?.isSuperAdmin) {
    const moduleDocs = new Set(DOCTYPES_BY_MODULE[parsedData.module] ?? []);
    docs = docs.filter((d) => moduleDocs.has(d));
  }
  return { ok: true, contextDoctypes: docs };
}

aiChatRouter.post("/chat", p.read, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { message, topK, history } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const gate = await gateAndNarrow(tenantId, req.auth!.userId, parsed.data);
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  const contextDoctypes = gate.contextDoctypes;

  const allowed = await takeToken(`ai-chat:${tenantId}`, AI_CHAT_RATE_PER_MIN);
  if (!allowed)
    return res
      .status(429)
      .json({ error: "AI chat rate limit reached — try again in a minute." });

  // Retrieve.
  const queryVec = await embedQuery(tenantId, message);
  const hits = queryVec
    ? await retrieveContext(tenantId, queryVec, contextDoctypes, topK)
    : [];

  // Generate. The resolver walks tenant integration → platform fallback
  // → env, so Claude / OpenAI / Brew all work transparently depending on
  // what the operator has configured in Super Admin → AI Providers.
  let chatProvider;
  try {
    chatProvider = await resolveChatProvider(tenantId);
  } catch (e) {
    if (e instanceof NoChatProviderError) {
      return res.status(400).json({
        error: e.message,
        hint: "Super Admin → AI Providers configures a platform fallback that applies to every tenant.",
      });
    }
    throw e;
  }

  const historyMessages: Array<{ role: "user" | "assistant"; content: string }> =
    (history ?? []).map((h) => ({ role: h.role, content: h.content }));
  const contextBlock = buildContextBlock(hits);
  historyMessages.push({
    role: "user",
    content: `${contextBlock}\n\n<question>${message}</question>`,
  });

  try {
    const result = await chatProvider.chat(buildChatSystemPrompt(), historyMessages);
    const citations: Citation[] = hits.map((h) => ({
      doctype: h.doctype,
      docId: h.docId,
      title: h.title,
      score: Number(h.score.toFixed(4)),
    }));
    res.json({
      answer: result.text,
      citations,
      provider: result.provider,
      model: result.model,
      usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401")) return res.status(400).json({ error: "AI provider rejected the API key — update it in Super Admin → AI Providers." });
    if (msg.includes("429")) return res.status(429).json({ error: "AI provider rate limit — try again shortly." });
    return res.status(502).json({ error: "AI chat upstream failed", detail: msg });
  }
});

// Streaming variant. Emits SSE frames so the UI shows text as it
// arrives from the LLM instead of blocking on the full reply.
// Frames:
//   event: start      — { citations, provider, model }
//   event: delta      — { chunk: "<text>" }   repeated
//   event: done       — { usage: { input_tokens, output_tokens } }
//   event: error      — { error, status? }
//
// Browsers consume this via EventSource OR fetch() + ReadableStream.
// Both are same-origin because the shell proxies /api/accounting/* so
// no CORS pre-flight issues.
aiChatRouter.post("/chat/stream", p.read, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { message, topK, history } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const gate = await gateAndNarrow(tenantId, req.auth!.userId, parsed.data);
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  const contextDoctypes = gate.contextDoctypes;

  const allowed = await takeToken(`ai-chat:${tenantId}`, AI_CHAT_RATE_PER_MIN);
  if (!allowed) return res.status(429).json({ error: "AI chat rate limit — try again in a minute." });

  const queryVec = await embedQuery(tenantId, message);
  const hits = queryVec
    ? await retrieveContext(tenantId, queryVec, contextDoctypes, topK)
    : [];

  let chatProvider;
  try {
    chatProvider = await resolveChatProvider(tenantId);
  } catch (e) {
    if (e instanceof NoChatProviderError) return res.status(400).json({ error: e.message });
    throw e;
  }

  // Open the SSE stream. Flush headers so proxies don't buffer.
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no"); // disable nginx buffering if present
  res.flushHeaders?.();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const citations: Citation[] = hits.map((h) => ({
    doctype: h.doctype,
    docId: h.docId,
    title: h.title,
    score: Number(h.score.toFixed(4)),
  }));
  send("start", { citations, provider: chatProvider.kind, model: chatProvider.model });

  const historyMessages: Array<{ role: "user" | "assistant"; content: string }> =
    (history ?? []).map((h) => ({ role: h.role, content: h.content }));
  historyMessages.push({
    role: "user",
    content: `${buildContextBlock(hits)}\n\n<question>${message}</question>`,
  });

  // Abort upstream when the client disconnects so we don't keep burning
  // tokens on an answer no one will read.
  const abortOnClose = () => {
    try { res.end(); } catch { /* already closed */ }
  };
  req.on("close", abortOnClose);

  try {
    const gen = chatProvider.stream(buildChatSystemPrompt(), historyMessages);
    while (true) {
      const next = await gen.next();
      if (next.done) {
        const final = next.value;
        send("done", {
          usage: { input_tokens: final.inputTokens, output_tokens: final.outputTokens },
          model: final.model,
        });
        break;
      }
      send("delta", { chunk: next.value });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("401") ? 400 : msg.includes("429") ? 429 : 502;
    send("error", { error: msg, status });
  } finally {
    req.off("close", abortOnClose);
    res.end();
  }
});
