// Hybrid semantic + keyword search over the Embedding table.
//
// Strategy: fetch all Embedding rows for the tenant/doctype filter,
// score each by cosineSimilarity(queryVector, row.vector) merged with
// a lightweight BM25-ish keyword score, then rank + limit.
//
// Optimisation path: once tenants outgrow ~50k embeddings per doctype,
// migrate to pgvector and swap this in-memory scoring for an indexed
// nearest-neighbor query.

import { cosineSimilarity } from "./embedding-provider";

export interface SearchInput {
  queryVector: number[];
  queryText: string;
  doctypes?: string[]; // filter by doctype (empty → all)
  limit?: number;
  minScore?: number; // threshold — rows below excluded
}

export interface SearchHit {
  doctype: string;
  docId: string;
  title: string;
  content: string;
  vectorScore: number;
  keywordScore: number;
  score: number; // combined
}

interface EmbeddingRow {
  doctype: string;
  docId: string;
  title: string;
  content: string;
  vector: number[];
}

// Tokenize + lower — cheap, good-enough matching.
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// TF score (occurrences / doc length). Not full BM25 — no IDF because
// we don't have corpus stats up front. Good enough to boost obvious
// keyword hits.
function keywordScore(query: string, content: string): number {
  const qTokens = new Set(tokens(query));
  if (qTokens.size === 0) return 0;
  const cTokens = tokens(content);
  if (cTokens.length === 0) return 0;
  let hits = 0;
  for (const t of cTokens) if (qTokens.has(t)) hits++;
  return hits / cTokens.length;
}

export function scoreEmbeddings(
  rows: EmbeddingRow[],
  input: SearchInput,
): SearchHit[] {
  const filtered = input.doctypes && input.doctypes.length > 0
    ? rows.filter((r) => input.doctypes!.includes(r.doctype))
    : rows;
  const hits: SearchHit[] = filtered.map((r) => {
    const vectorScore = cosineSimilarity(input.queryVector, r.vector);
    const kw = keywordScore(input.queryText, `${r.title} ${r.content}`);
    // Weighted merge — vector dominates for semantic matches, but a
    // pure-keyword row still shows up. Tunable per tenant later.
    const combined = vectorScore * 0.7 + kw * 0.3;
    return {
      doctype: r.doctype,
      docId: r.docId,
      title: r.title,
      content: r.content,
      vectorScore,
      keywordScore: kw,
      score: combined,
    };
  });
  const threshold = input.minScore ?? 0;
  return hits
    .filter((h) => h.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 20);
}

// ── Content builder — one summary string per doctype for embedding ──

// The semantic tick calls this for each row it's about to embed. Kept
// centralized so we can tune "what to embed" per doctype without
// hunting through the code.
export type DoctypeContentBuilder = (row: Record<string, unknown>) => {
  title: string;
  content: string;
};

export const DEFAULT_CONTENT_BUILDERS: Record<string, DoctypeContentBuilder> = {
  Customer: (r) => ({
    title: String(r.customerName ?? r.name ?? "Customer"),
    content: [
      r.customerName, r.email, r.mobile, r.gstin,
      r.address1, r.city, r.state, r.country,
      r.customerGroup, r.territory,
    ].filter(Boolean).join(" · "),
  }),
  Supplier: (r) => ({
    title: String(r.supplierName ?? r.name ?? "Supplier"),
    content: [r.supplierName, r.email, r.mobile, r.gstin, r.city].filter(Boolean).join(" · "),
  }),
  Item: (r) => ({
    title: String(r.itemName ?? r.itemCode ?? "Item"),
    content: [r.itemCode, r.itemName, r.description, r.itemGroup, r.brand].filter(Boolean).join(" · "),
  }),
  Lead: (r) => ({
    title: String(r.leadName ?? "Lead"),
    content: [r.leadName, r.companyName, r.email, r.mobile, r.source, r.status, r.remarks].filter(Boolean).join(" · "),
  }),
  Opportunity: (r) => ({
    title: `Opp ${r.name}: ${r.leadName ?? r.customerName ?? ""}`,
    content: [r.name, r.status, r.source, r.remarks, r.expectedAmount].filter(Boolean).join(" · "),
  }),
  SalesInvoice: (r) => ({
    title: `${r.name} · ${r.customerName ?? ""} · ₹${r.grandTotal ?? ""}`,
    content: [r.name, r.customerName, r.status, r.remarks].filter(Boolean).join(" · "),
  }),
  DeskTicket: (r) => ({
    title: `${r.name}: ${r.subject}`,
    content: [r.subject, r.description, r.status, r.priority, r.category].filter(Boolean).join(" · "),
  }),
};

export function buildContent(
  doctype: string,
  row: Record<string, unknown>,
): { title: string; content: string } {
  const builder = DEFAULT_CONTENT_BUILDERS[doctype];
  if (builder) return builder(row);
  // Generic fallback — take a stab at the most common field names.
  return {
    title: String(row.name ?? row.title ?? row.id ?? doctype),
    content: JSON.stringify(row).slice(0, 500),
  };
}
