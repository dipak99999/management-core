import { Router } from "express";
import { z } from "zod";
import {
  decryptSecrets,
  embeddingProviderFromSecrets,
  prisma,
  routerFromSecrets,
  scoreEmbeddings,
  type SearchHit,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// AI retrieval-augmented endpoints.
//
//   POST /ai/search  { q, doctypes?, limit? }
//     → hybrid keyword + vector search across the Embedding table.
//
//   POST /ai/ask     { q, doctypes?, limit? }
//     → RAG: same retrieval → feeds top-K into the LLM router with a
//       structured prompt → returns a narrative answer + the source hits.
//
//   GET  /ai/similar/:doctype/:id
//     → nearest-neighbor "show me records like this one".
//
// All endpoints require the same auth as any other route. The
// underlying data is already tenant-scoped by the Embedding table.

export const aiRagRouter = Router();
const p = perms("Report"); // reuse Report perms for read-only AI

async function loadEmbeddingProvider(tenantId: string) {
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "EmbeddingProvider", isActive: true },
  });
  if (!integration) {
    return embeddingProviderFromSecrets({ provider: "stub" });
  }
  return embeddingProviderFromSecrets(decryptSecrets(integration.secrets) as Record<string, unknown>);
}

async function loadEmbeddedRows(tenantId: string, doctypes?: string[]) {
  return prisma.embedding.findMany({
    where: {
      tenantId,
      vectorLength: { gt: 0 },
      ...(doctypes && doctypes.length > 0 ? { doctype: { in: doctypes } } : {}),
    },
    select: {
      doctype: true,
      docId: true,
      title: true,
      content: true,
      vector: true,
    },
  });
}

const searchSchema = z.object({
  q: z.string().min(1),
  doctypes: z.array(z.string()).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  minScore: z.coerce.number().min(-1).max(1).default(0),
});

aiRagRouter.post("/search", p.read, async (req, res) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const emb = await loadEmbeddingProvider(tenantId);
  const query = await emb.embed(parsed.data.q);
  const rows = await loadEmbeddedRows(tenantId, parsed.data.doctypes);
  const shaped = rows.map((r) => ({
    ...r,
    vector: Array.isArray(r.vector) ? (r.vector as number[]) : [],
  }));
  const hits = scoreEmbeddings(shaped, {
    queryVector: query.vector,
    queryText: parsed.data.q,
    doctypes: parsed.data.doctypes,
    limit: parsed.data.limit,
    minScore: parsed.data.minScore,
  });
  res.json({ query: parsed.data.q, hits, provider: query.provider, model: query.model });
});

const askSchema = searchSchema.extend({
  q: z.string().min(1),
  systemPrompt: z.string().optional(),
});

aiRagRouter.post("/ask", p.read, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  // Retrieve top-K.
  const emb = await loadEmbeddingProvider(tenantId);
  const query = await emb.embed(parsed.data.q);
  const rows = await loadEmbeddedRows(tenantId, parsed.data.doctypes);
  const shaped = rows.map((r) => ({
    ...r,
    vector: Array.isArray(r.vector) ? (r.vector as number[]) : [],
  }));
  const hits = scoreEmbeddings(shaped, {
    queryVector: query.vector,
    queryText: parsed.data.q,
    doctypes: parsed.data.doctypes,
    limit: parsed.data.limit,
  });

  // Generate a narrative via the LLM router.
  const routerIntegration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "LLMRouter", isActive: true },
  });
  if (!routerIntegration) {
    return res.json({
      query: parsed.data.q,
      answer: "AI answering isn't configured — set up an LLMRouter TenantIntegration to enable narrative responses.",
      hits,
    });
  }
  const router = routerFromSecrets(
    decryptSecrets(routerIntegration.secrets) as Record<string, unknown>,
    tenantId,
  );

  const systemPrompt =
    parsed.data.systemPrompt ??
    "You are the tenant's business-data analyst. Answer the user's question using ONLY the RETRIEVED_RECORDS provided. If the answer isn't in the records, say so. Cite hits by their title. Be concise (2-4 sentences).";
  const user = [
    `QUESTION: ${parsed.data.q}`,
    "",
    "RETRIEVED_RECORDS:",
    ...hits.map((h, i) =>
      `[${i + 1}] (${h.doctype}) ${h.title}\n${h.content}`,
    ),
  ].join("\n");

  try {
    const result = await router.call<{ answer: string; sourceIndexes: number[] }>(
      "ai.ask",
      {
        system: systemPrompt,
        user,
        responseSchema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            sourceIndexes: {
              type: "array",
              items: { type: "integer", minimum: 1 },
            },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    );
    const citedHits: SearchHit[] = (result.parsed.sourceIndexes ?? [])
      .map((i) => hits[i - 1])
      .filter(Boolean);
    res.json({
      query: parsed.data.q,
      answer: result.parsed.answer,
      hits,
      cited: citedHits,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "LLM failed",
      hits,
    });
  }
});

aiRagRouter.get("/similar/:doctype/:id", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { doctype, id } = req.params;
  const src = await prisma.embedding.findUnique({
    where: { tenantId_doctype_docId: { tenantId, doctype, docId: id } },
    select: { title: true, content: true, vector: true },
  });
  if (!src) return res.status(404).json({ error: "No embedding for this record — refresh may be pending" });
  const vector = Array.isArray(src.vector) ? (src.vector as number[]) : [];
  if (vector.length === 0) return res.status(400).json({ error: "Record not yet embedded" });

  const rows = await loadEmbeddedRows(tenantId, [doctype]);
  const shaped = rows
    .filter((r) => r.docId !== id) // exclude self
    .map((r) => ({ ...r, vector: Array.isArray(r.vector) ? (r.vector as number[]) : [] }));
  const hits = scoreEmbeddings(shaped, {
    queryVector: vector,
    queryText: src.title,
    limit: 20,
  });
  res.json({ source: { doctype, docId: id, title: src.title }, hits });
});

// Trigger re-embed on demand — used by the doctype-write hooks in v2.
// For now, admin UI can manually flag a row as stale to force re-embed.
const markStaleSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
});

aiRagRouter.post("/mark-stale", p.write, async (req, res) => {
  const parsed = markStaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const row = await prisma.embedding.upsert({
    where: { tenantId_doctype_docId: { tenantId, doctype: b.doctype, docId: b.docId } },
    update: { title: b.title, content: b.content, stale: true },
    create: {
      tenantId,
      doctype: b.doctype,
      docId: b.docId,
      title: b.title,
      content: b.content,
      contentHash: "",
      stale: true,
    },
  });
  res.status(201).json(row);
});
