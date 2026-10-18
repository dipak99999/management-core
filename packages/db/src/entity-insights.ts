// Entity-level AI advisory. One file per concern: load the entity +
// context, optionally pull public web signals, feed into the LLM with a
// doctype-specific system prompt, cache the structured JSON.
//
// The public API is `generateInsight(doctype, docId, tenantId, opts)`.
// Caller is a thin HTTP route; this module does all the work.

import { createHash } from "node:crypto";
import { prisma } from "./index";
import { resolveChatProvider } from "./ai-chat-resolver";

export const INSIGHT_DOCTYPES = [
  "Lead",
  "Customer",
  "SalesInvoice",
  "Employee",
  "Item",
] as const;
export type InsightDoctype = (typeof INSIGHT_DOCTYPES)[number];

export interface RiskFlag {
  severity: "low" | "med" | "high";
  label: string;
  why: string;
}
export interface SuggestedAction {
  label: string;
  href?: string;
}
export interface InsightPayload {
  oneLiner: string;
  bulletFindings: string[];
  riskFlags: RiskFlag[];
  suggestedActions: SuggestedAction[];
  sources?: Array<{ title: string; url: string }>;
}

export interface Insight {
  payload: InsightPayload;
  model: string | null;
  generatedAt: Date;
  cached: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getOrGenerateInsight(
  doctype: InsightDoctype,
  docId: string,
  tenantId: string,
  opts: { refresh?: boolean } = {},
): Promise<Insight> {
  // Build the input snapshot the LLM will see — must come first so we
  // can fingerprint it and decide whether the cache is still valid.
  const ctx = await loadContext(doctype, docId, tenantId);
  if (!ctx) throw new Error(`${doctype} ${docId} not found`);
  const fingerprint = fp(ctx);

  if (!opts.refresh) {
    const cached = await prisma.entityInsight.findUnique({
      where: { tenantId_doctype_docId: { tenantId, doctype, docId } },
    });
    if (
      cached &&
      cached.inputFingerprint === fingerprint &&
      Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS
    ) {
      return {
        payload: cached.payloadJson as unknown as InsightPayload,
        model: cached.model,
        generatedAt: cached.generatedAt,
        cached: true,
      };
    }
  }

  // Web lookup for sales-side entities when a search provider is configured.
  const webHits = await maybeWebSearch(doctype, ctx);
  const prompt = buildPrompt(doctype, ctx, webHits);

  const provider = await resolveChatProvider(tenantId);
  const result = await provider.chat(prompt.system, [
    { role: "user", content: prompt.user },
  ]);
  const payload = parseInsight(result.text, webHits);

  const saved = await prisma.entityInsight.upsert({
    where: { tenantId_doctype_docId: { tenantId, doctype, docId } },
    update: {
      payloadJson: payload as unknown as object,
      model: provider.model,
      inputFingerprint: fingerprint,
      generatedAt: new Date(),
    },
    create: {
      tenantId,
      doctype,
      docId,
      payloadJson: payload as unknown as object,
      model: provider.model,
      inputFingerprint: fingerprint,
    },
  });
  return {
    payload: saved.payloadJson as unknown as InsightPayload,
    model: saved.model,
    generatedAt: saved.generatedAt,
    cached: false,
  };
}

// ── Context loaders ────────────────────────────────────────────────────
//
// Each loader returns a plain object that will be JSON-stringified into
// the prompt. Keep it tight — more context ≠ better insights, and token
// cost adds up fast at 100 pages/day * N users.

interface Ctx {
  // The one-line title we display + feed to the model.
  subject: string;
  // Everything the model needs. Doctype-specific.
  entity: Record<string, unknown>;
  related: Record<string, unknown>;
}

async function loadContext(
  doctype: InsightDoctype,
  docId: string,
  tenantId: string,
): Promise<Ctx | null> {
  switch (doctype) {
    case "Lead":          return loadLead(docId, tenantId);
    case "Customer":      return loadCustomer(docId, tenantId);
    case "SalesInvoice":  return loadSalesInvoice(docId, tenantId);
    case "Employee":      return loadEmployee(docId, tenantId);
    case "Item":          return loadItem(docId, tenantId);
  }
}

async function loadLead(id: string, tenantId: string): Promise<Ctx | null> {
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId },
    select: {
      id: true, name: true, leadName: true, companyName: true,
      email: true, mobile: true, status: true, source: true, remarks: true,
      score: true, createdAt: true,
    },
  });
  if (!lead) return null;
  const subject = (lead.leadName ?? lead.name) + (lead.companyName ? ` @ ${lead.companyName}` : "");
  return { subject, entity: lead, related: {} };
}

async function loadCustomer(id: string, tenantId: string): Promise<Ctx | null> {
  const cust = await prisma.customer.findFirst({
    where: { id, tenantId },
    select: {
      id: true, customerName: true, customerType: true, customerGroup: true,
      territory: true, email: true, mobile: true, gstin: true,
      creditLimit: true,
    },
  });
  if (!cust) return null;

  // Last 10 invoices + aging snapshot
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId: id },
    select: { name: true, status: true, grandTotal: true, outstandingAmt: true,
              postingDate: true, dueDate: true },
    orderBy: { postingDate: "desc" },
    take: 10,
  });
  const totalBilled = invoices.reduce((s, i) => s + Number(i.grandTotal ?? 0), 0);
  const outstanding = invoices.reduce((s, i) => s + Number(i.outstandingAmt ?? 0), 0);
  const now = Date.now();
  const overdue = invoices.filter(i =>
    i.status === "Submitted" && i.dueDate && new Date(i.dueDate).getTime() < now,
  ).length;

  return {
    subject: cust.customerName,
    entity: cust,
    related: {
      recentInvoices: invoices,
      aggregate: { totalBilled, outstanding, overdueCount: overdue, invoiceCount: invoices.length },
    },
  };
}

async function loadSalesInvoice(id: string, tenantId: string): Promise<Ctx | null> {
  const inv = await prisma.salesInvoice.findFirst({
    where: { id, tenantId },
    select: {
      id: true, name: true, status: true, grandTotal: true,
      outstandingAmt: true, currency: true, postingDate: true, dueDate: true,
      customer: { select: { customerName: true, id: true } },
      // SalesInvoiceItem has no itemCode/itemName of its own — pull them
      // via the related Item.
      items: { select: { qty: true, rate: true, amount: true, item: { select: { itemCode: true, itemName: true } } } },
    },
  });
  if (!inv) return null;

  // Customer payment history — late/on-time ratio
  const siblings = await prisma.salesInvoice.findMany({
    where: { tenantId, customerId: inv.customer?.id, id: { not: inv.id }, status: "Paid" },
    select: { postingDate: true, dueDate: true, grandTotal: true },
    take: 20, orderBy: { postingDate: "desc" },
  });

  return {
    subject: inv.name,
    entity: inv,
    related: { customerPaidHistory: siblings },
  };
}

async function loadEmployee(id: string, tenantId: string): Promise<Ctx | null> {
  const emp = await prisma.employee.findFirst({
    where: { id, tenantId },
    select: {
      id: true, employeeCode: true, employeeName: true, email: true,
      department: true, designation: true, dateOfJoining: true, baseSalary: true,
    },
  });
  if (!emp) return null;
  // Internal signals only — leave count, slip count. No personal web crawl.
  const leaves = await prisma.leaveApplication.count({
    where: { tenantId, employeeId: id, status: "Approved" },
  });
  const slips = await prisma.salarySlip.count({
    where: { tenantId, employeeId: id },
  });
  return {
    subject: emp.employeeName,
    entity: emp,
    related: { approvedLeaveCount: leaves, salarySlipCount: slips },
  };
}

async function loadItem(id: string, tenantId: string): Promise<Ctx | null> {
  const item = await prisma.item.findFirst({
    where: { id, tenantId },
    select: {
      id: true, itemCode: true, itemName: true, itemGroup: true,
      description: true, standardRate: true, isStockItem: true, stockUom: true,
      hsnCode: true,
    },
  });
  if (!item) return null;
  // Sold units + revenue (approximate; from Submitted invoice items).
  // SalesInvoiceItem has no tenantId/itemCode columns of its own — filter
  // tenant via the parent SalesInvoice relation, and target by itemId.
  const sold = await prisma.salesInvoiceItem.aggregate({
    where: { itemId: item.id, salesInvoice: { tenantId, status: "Submitted" } },
    _sum: { qty: true, amount: true },
    _count: { id: true },
  });
  const soldCount = sold._count && typeof sold._count !== "boolean" ? sold._count.id ?? 0 : 0;
  return {
    subject: `${item.itemName} (${item.itemCode})`,
    entity: item,
    related: {
      salesSinceInception: {
        unitsSold: Number(sold._sum?.qty ?? 0),
        revenue: Number(sold._sum?.amount ?? 0),
        invoiceLines: soldCount,
      },
    },
  };
}

// ── Web search (Serper) with graceful fallback ────────────────────────

interface WebHit {
  title: string;
  url: string;
  snippet?: string;
}

async function maybeWebSearch(
  doctype: InsightDoctype,
  ctx: Ctx,
): Promise<WebHit[]> {
  // Only for sales-side entities where public info moves the needle.
  if (doctype !== "Lead" && doctype !== "Customer") return [];
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return []; // graceful no-op

  // Build the search query from the entity's company/name.
  const e = ctx.entity as Record<string, unknown>;
  const name =
    (e.companyName as string | undefined) ??
    (e.customerName as string | undefined) ??
    ctx.subject;
  if (!name || name.length < 3) return [];
  const q = `${name} company profile funding leadership`;

  try {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ q, num: 5 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { organic?: Array<{ title: string; link: string; snippet?: string }> };
    return (data.organic ?? []).slice(0, 5).map((h) => ({
      title: h.title,
      url: h.link,
      snippet: h.snippet,
    }));
  } catch {
    return [];
  }
}

// ── Prompt builder ─────────────────────────────────────────────────────

function buildPrompt(
  doctype: InsightDoctype,
  ctx: Ctx,
  webHits: WebHit[],
): { system: string; user: string } {
  const baseSystem = `You are the Lumaara AI advisor — an experienced business operator who reviews a single ERP record and surfaces useful, non-obvious observations the user can act on *today*.

Return ONLY a JSON object with this shape — no prose, no code fences, no commentary:
{
  "oneLiner": string,            // ONE sentence summarising the record and its most notable attribute
  "bulletFindings": string[],    // 3-5 crisp observations grounded in the data provided
  "riskFlags":  [{"severity":"low"|"med"|"high","label":string,"why":string}],  // 0-3 flags; omit if nothing concerning
  "suggestedActions": [{"label":string,"href":string|null}]  // 2-4 concrete next steps the user could take
}

Rules:
- Be specific — "credit limit is 60% utilised" beats "watch the credit limit".
- Reference actual numbers / fields from the data when relevant.
- If web search results are provided, use them to add verifiable context; cite nothing you can't ground.
- Never make up facts about a person. If data is thin, say so in oneLiner and keep flags empty.
- Keep each bullet ≤ 20 words.`;

  const perDoctype: Record<InsightDoctype, string> = {
    Lead:
      "This is a sales Lead. Focus on fit, buying intent signals, and next-step outreach suggestions. If web hits reveal recent funding, hiring, M&A, note it. Suggested hrefs can be internal routes like /crm/leads/{id} or external URLs.",
    Customer:
      "This is an existing Customer. Focus on account health: payment behaviour, aging, upsell/cross-sell signal, churn risk. Credit limit utilisation matters. Suggest actions like 'Call about overdue INV-X' with hrefs pointing at /accounting/sales-invoices/* when relevant.",
    SalesInvoice:
      "This is a single Sales Invoice. Focus on collection risk given the customer's payment history, the amount, days to due. Suggest reminder cadences or specific collection moves.",
    Employee:
      "This is an Employee record (internal data only). Focus on tenure, leave usage pattern, salary slip regularity. Keep insights HR-manager-useful; do NOT speculate about personal matters. No web lookup.",
    Item:
      "This is an Item (SKU). Focus on sales velocity, revenue contribution, pricing posture. Suggest reorder/pricing moves. No web lookup.",
  };

  const user = JSON.stringify({
    doctype,
    subject: ctx.subject,
    entity: ctx.entity,
    related: ctx.related,
    webHits,
  }, null, 2);

  return {
    system: `${baseSystem}\n\n${perDoctype[doctype]}`,
    user,
  };
}

// ── Response parsing ───────────────────────────────────────────────────

function parseInsight(raw: string, webHits: WebHit[]): InsightPayload {
  // Strip common markdown fences the model sometimes adds despite instructions
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return fallbackInsight(raw);
  }
  const p = parsed as Record<string, unknown>;
  const payload: InsightPayload = {
    oneLiner: typeof p.oneLiner === "string" ? p.oneLiner : "",
    bulletFindings: Array.isArray(p.bulletFindings)
      ? p.bulletFindings.filter((x): x is string => typeof x === "string").slice(0, 6)
      : [],
    riskFlags: Array.isArray(p.riskFlags)
      ? (p.riskFlags as Array<Record<string, unknown>>)
          .filter((f) => typeof f.label === "string" && typeof f.why === "string")
          .map((f) => ({
            severity:
              f.severity === "high" || f.severity === "med" || f.severity === "low"
                ? (f.severity as "high" | "med" | "low")
                : "low",
            label: f.label as string,
            why: f.why as string,
          }))
          .slice(0, 4)
      : [],
    suggestedActions: Array.isArray(p.suggestedActions)
      ? (p.suggestedActions as Array<Record<string, unknown>>)
          .filter((a) => typeof a.label === "string")
          .map((a) => ({
            label: a.label as string,
            href: typeof a.href === "string" && a.href.length > 0 ? a.href : undefined,
          }))
          .slice(0, 5)
      : [],
  };
  if (webHits.length > 0) {
    payload.sources = webHits.map((h) => ({ title: h.title, url: h.url }));
  }
  return payload;
}

function fallbackInsight(raw: string): InsightPayload {
  // Model didn't produce valid JSON — surface a graceful fallback instead
  // of a 500. The oneLiner reflects the problem.
  return {
    oneLiner: "AI advisor output could not be parsed; showing raw text below.",
    bulletFindings: raw.length > 0 ? [raw.slice(0, 400)] : [],
    riskFlags: [],
    suggestedActions: [],
  };
}

// Fingerprint over the inputs the LLM saw so the cache invalidates when
// the entity changes materially (e.g. a new invoice is paid).
function fp(ctx: Ctx): string {
  return createHash("sha256").update(JSON.stringify(ctx)).digest("hex").slice(0, 32);
}
