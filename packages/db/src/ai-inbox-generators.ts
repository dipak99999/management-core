// AI Inbox signal generators. Each generator returns zero or more
// `Finding` rows for a given tenant. The scheduler tick upserts them
// into the AiInsightInbox table — new signals get fresh rows, existing
// signals get their lastSeenAt refreshed.
//
// Design notes:
//   - Everything deterministic. No LLM calls on the critical path —
//     generators run on raw DB numbers so they're cheap + predictable.
//     The LLM can enrich findings later; v1 ships without that risk.
//   - Each finding carries a stable `signalKey` so re-scans are idempotent.
//   - Severity bands are opinionated but easy to tune.

import { prisma } from "./index";

export interface Finding {
  signalKey: string;
  kind: string;
  severity: "info" | "watch" | "critical";
  category: "Revenue" | "AR" | "Pipeline" | "Cash" | "Inventory" | "HR" | "Operations";
  title: string;
  finding: string;
  targetDoctype?: string;
  targetDocId?: string;
  actionLabel?: string;
  actionHref?: string;
  dataJson?: Record<string, unknown>;
}

// Formatter helpers — kept local to avoid a dep on the frontend money
// util that lives per-app.
const inr = (n: number): string =>
  "₹" + Math.round(n).toLocaleString("en-IN");

// ─── AR / collections ────────────────────────────────────────────────

export async function findOverdueInvoices(tenantId: string): Promise<Finding[]> {
  // Submitted invoices with dueDate in the past that we haven't flagged yet.
  const now = new Date();
  const rows = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      status: "Submitted",
      dueDate: { lt: now },
      outstandingAmt: { gt: 0 },
    },
    select: {
      id: true, name: true, grandTotal: true, outstandingAmt: true,
      dueDate: true,
      customer: { select: { customerName: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 50,
  });
  return rows.map((r) => {
    const days = Math.floor((now.getTime() - r.dueDate!.getTime()) / 86_400_000);
    const severity = days >= 60 ? "critical" : days >= 30 ? "watch" : "info";
    return {
      signalKey: `ar_overdue:${r.id}`,
      kind: "ar_overdue",
      severity,
      category: "AR",
      title: `${r.name} is ${days} day${days === 1 ? "" : "s"} overdue`,
      finding: `${r.customer?.customerName ?? "Customer"} owes ${inr(Number(r.outstandingAmt))} on ${r.name} — due ${r.dueDate!.toLocaleDateString()}, ${days} day${days === 1 ? "" : "s"} ago.`,
      targetDoctype: "SalesInvoice",
      targetDocId: r.id,
      actionLabel: "Send a reminder",
      actionHref: `/accounting/sales-invoices/${r.id}`,
      dataJson: {
        daysOverdue: days,
        outstanding: Number(r.outstandingAmt),
        grandTotal: Number(r.grandTotal),
      },
    };
  });
}

// ─── Revenue trend ───────────────────────────────────────────────────

export async function findRevenueDropsOrSpikes(tenantId: string): Promise<Finding[]> {
  const now = new Date();
  const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [thisMonth, lastMonth] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { tenantId, status: { in: ["Submitted", "Paid"] }, isReturn: false, postingDate: { gte: firstThisMonth } },
      _sum: { grandTotal: true },
    }),
    prisma.salesInvoice.aggregate({
      where: { tenantId, status: { in: ["Submitted", "Paid"] }, isReturn: false, postingDate: { gte: firstLastMonth, lt: firstThisMonth } },
      _sum: { grandTotal: true },
    }),
  ]);
  const t = Number(thisMonth._sum.grandTotal ?? 0);
  const l = Number(lastMonth._sum.grandTotal ?? 0);
  if (l === 0) return []; // can't compute a ratio against zero baseline

  const pctChange = ((t - l) / l) * 100;
  // Only flag if the move is meaningful. Early-month comparisons will
  // always look low; require at least 7 days into the month.
  const daysIntoMonth = Math.ceil((now.getTime() - firstThisMonth.getTime()) / 86_400_000);
  if (daysIntoMonth < 7) return [];

  if (pctChange <= -20) {
    return [{
      signalKey: `revenue_drop:${now.getFullYear()}-${now.getMonth() + 1}`,
      kind: "revenue_drop",
      severity: pctChange <= -40 ? "critical" : "watch",
      category: "Revenue",
      title: `Revenue down ${Math.abs(pctChange).toFixed(0)}% vs last month`,
      finding: `This month's billed total so far is ${inr(t)} vs ${inr(l)} by the same point last month. That's ${Math.abs(pctChange).toFixed(1)}% below trend.`,
      actionLabel: "Review the pipeline",
      actionHref: "/crm/opportunities",
      dataJson: { thisMonth: t, lastMonth: l, pctChange },
    }];
  }
  if (pctChange >= 50) {
    return [{
      signalKey: `revenue_spike:${now.getFullYear()}-${now.getMonth() + 1}`,
      kind: "revenue_spike",
      severity: "info",
      category: "Revenue",
      title: `Revenue up ${pctChange.toFixed(0)}% vs last month`,
      finding: `This month's billed total so far is ${inr(t)} vs ${inr(l)} by the same point last month — ${pctChange.toFixed(1)}% above trend. Worth understanding what drove it.`,
      actionLabel: "Open P&L",
      actionHref: "/accounting/reports/profit-and-loss",
      dataJson: { thisMonth: t, lastMonth: l, pctChange },
    }];
  }
  return [];
}

// ─── Cash runway ─────────────────────────────────────────────────────

export async function findCashRunway(tenantId: string): Promise<Finding[]> {
  // Simple proxy for burn: last 3 months' average expense.
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  // Account.balance isn't a stored column — compute cash from
  // debit-credit on Bank/Cash accounts via JournalEntryAccount.
  const [cashLines, burn] = await Promise.all([
    prisma.journalEntryAccount.aggregate({
      where: {
        account: { tenantId, accountType: { in: ["Bank", "Cash"] } },
        journalEntry: { tenantId, status: "Submitted" },
      },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalEntryAccount.aggregate({
      where: {
        account: { tenantId, accountType: "Expense" },
        journalEntry: { tenantId, postingDate: { gte: threeMonthsAgo }, status: "Submitted" },
      },
      _sum: { debit: true },
    }),
  ]);
  const cash = Number(cashLines._sum.debit ?? 0) - Number(cashLines._sum.credit ?? 0);
  const totalExpense = Number(burn._sum.debit ?? 0);
  const monthlyBurn = totalExpense / 3;
  if (monthlyBurn <= 0 || cash <= 0) return [];

  const months = cash / monthlyBurn;
  if (months >= 6) return []; // healthy

  const sev = months < 2 ? "critical" : months < 4 ? "watch" : "info";
  return [{
    signalKey: `cash_runway:${now.getFullYear()}-${now.getMonth() + 1}`,
    kind: "cash_runway",
    severity: sev,
    category: "Cash",
    title: `Cash runway ${months.toFixed(1)} months at current burn`,
    finding: `${inr(cash)} on hand, ${inr(monthlyBurn)}/month average expense over the last quarter. That's ${months.toFixed(1)} months of runway.`,
    actionLabel: "Open P&L",
    actionHref: "/accounting/reports/profit-and-loss",
    dataJson: { cash, monthlyBurn, months },
  }];
}

// ─── Pipeline freshness ──────────────────────────────────────────────

export async function findStalePipeline(tenantId: string): Promise<Finding[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const stale = await prisma.opportunity.findMany({
    where: {
      tenantId,
      status: { notIn: ["Won", "Lost", "Cancelled"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, name: true, updatedAt: true, expectedAmount: true, customer: { select: { customerName: true } } },
    orderBy: { expectedAmount: "desc" },
    take: 20,
  });
  return stale.map((o) => {
    const days = Math.floor((now.getTime() - o.updatedAt.getTime()) / 86_400_000);
    const amt = Number(o.expectedAmount ?? 0);
    return {
      signalKey: `pipeline_stale:${o.id}`,
      kind: "pipeline_stale",
      severity: amt > 100_000 && days > 30 ? "watch" : "info",
      category: "Pipeline",
      title: `${o.name} (${inr(amt)}) has no activity for ${days} days`,
      finding: `${o.customer?.customerName ?? "Prospect"} opportunity hasn't moved in ${days} days. Last updated ${o.updatedAt.toLocaleDateString()}.`,
      targetDoctype: "Opportunity",
      targetDocId: o.id,
      actionLabel: "Open",
      actionHref: `/crm/opportunities/${o.id}`,
      dataJson: { daysStale: days, amount: amt },
    };
  });
}

// ─── Inventory ───────────────────────────────────────────────────────

export async function findLowStockItems(tenantId: string): Promise<Finding[]> {
  // Reorder levels live on ItemReorderRule (per item + warehouse). We
  // join to Item for display + sum Bin.actualQty for current stock.
  const rules = await prisma.itemReorderRule.findMany({
    where: { tenantId, reorderLevel: { gt: 0 } },
    select: {
      id: true,
      reorderLevel: true,
      item: { select: { id: true, itemCode: true, itemName: true, isStockItem: true } },
      warehouse: { select: { id: true, warehouseName: true } },
    },
    take: 100,
  });
  const findings: Finding[] = [];
  for (const rule of rules) {
    if (!rule.item?.isStockItem) continue;
    const bin = await prisma.bin.aggregate({
      where: { tenantId, itemId: rule.item.id, warehouseId: rule.warehouse?.id ?? undefined },
      _sum: { actualQty: true },
    });
    const qty = Number(bin._sum?.actualQty ?? 0);
    const reorderLevel = Number(rule.reorderLevel);
    if (qty >= reorderLevel) continue;
    const warehouseLabel = rule.warehouse?.warehouseName ? ` at ${rule.warehouse.warehouseName}` : "";
    findings.push({
      signalKey: `inventory_low:${rule.id}`,
      kind: "inventory_low",
      severity: qty <= 0 ? "critical" : qty < reorderLevel * 0.5 ? "watch" : "info",
      category: "Inventory",
      title: `${rule.item.itemName} below reorder level${warehouseLabel} (${qty} vs ${reorderLevel})`,
      finding: `${rule.item.itemCode} has ${qty} on hand${warehouseLabel} against a reorder level of ${reorderLevel}. ${qty <= 0 ? "Zero stock — any new order will backorder." : "Running low."}`,
      targetDoctype: "Item",
      targetDocId: rule.item.id,
      actionLabel: "Create reorder",
      actionHref: `/accounting/items/${rule.item.id}`,
      dataJson: { onHand: qty, reorderLevel, warehouseId: rule.warehouse?.id },
    });
  }
  return findings;
}

// ─── Operations ──────────────────────────────────────────────────────

export async function findOldDraftInvoices(tenantId: string): Promise<Finding[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const count = await prisma.salesInvoice.count({
    where: { tenantId, status: "Draft", createdAt: { lt: sevenDaysAgo } },
  });
  if (count === 0) return [];
  return [{
    signalKey: `ops_draft_backlog:count`,
    kind: "ops_draft_backlog",
    severity: count >= 10 ? "watch" : "info",
    category: "Operations",
    title: `${count} draft invoice${count === 1 ? "" : "s"} older than 7 days`,
    finding: `There are ${count} draft invoices created more than a week ago that still haven't been submitted. Submit or discard them so AR reflects reality.`,
    actionLabel: "Review drafts",
    actionHref: "/accounting/sales-invoices?status=Draft",
    dataJson: { count },
  }];
}

// ─── LLM pattern-match (opt-in) ──────────────────────────────────────
//
// 8th generator — uses the tenant's configured LLM to spot "softer"
// patterns the deterministic generators would miss (unusual expense
// shapes, customer concentration risk, employee-leave clustering, etc.).
//
// Gating:
//   - Opt-in per tenant via env `AI_INBOX_LLM_GENERATOR=1`. Off by default
//     because it uses LLM credits every scan.
//   - Capped at 3 findings per scan. The deterministic generators carry
//     the firehose; this one adds colour.
//   - LLM output is strict JSON validated below; parse failure = silent
//     no-op (never half-insert).
//
// Prompt: structured snapshot of tenant metrics + the open deterministic
// findings. Model is asked to find 0-3 observations ONLY if they're not
// already captured.

export async function findLlmPatterns(tenantId: string): Promise<Finding[]> {
  if (process.env.AI_INBOX_LLM_GENERATOR !== "1") return [];
  // Lazy-require to avoid pulling the LLM resolver into the common path
  // when the generator is disabled.
  const { resolveChatProvider } = await import("./ai-chat-resolver");

  // Build a compact snapshot. Keep bytes low — this is sent per tenant
  // per scan and we don't want to burn tokens.
  const [custCount, invThisQ, topCustomers, openOpps, lowStockCount] = await Promise.all([
    prisma.customer.count({ where: { tenantId } }),
    prisma.salesInvoice.aggregate({
      where: {
        tenantId, status: { in: ["Submitted", "Paid"] }, isReturn: false,
        postingDate: { gte: new Date(Date.now() - 90 * 86_400_000) },
      },
      _sum: { grandTotal: true }, _count: true,
    }),
    prisma.salesInvoice.groupBy({
      by: ["customerId"],
      where: { tenantId, status: { in: ["Submitted", "Paid"] }, isReturn: false, postingDate: { gte: new Date(Date.now() - 180 * 86_400_000) } },
      _sum: { grandTotal: true },
      orderBy: { _sum: { grandTotal: "desc" } },
      take: 5,
    }),
    prisma.opportunity.count({ where: { tenantId, status: { notIn: ["Won", "Lost", "Cancelled"] } } }),
    prisma.itemReorderRule.count({ where: { tenantId, reorderLevel: { gt: 0 } } }),
  ]);
  const existing = await prisma.aiInsightInbox.findMany({
    where: { tenantId, acknowledgedAt: null },
    select: { kind: true, title: true },
    take: 20,
  });
  const snapshot = {
    customerCount: custCount,
    last90dRevenue: Number(invThisQ._sum.grandTotal ?? 0),
    last90dInvoiceCount: invThisQ._count,
    topCustomersBySpend180d: topCustomers.map((c) => ({ customerId: c.customerId, revenue: Number(c._sum.grandTotal ?? 0) })),
    openOpportunities: openOpps,
    itemsTrackingReorder: lowStockCount,
    alreadyKnown: existing.map((e) => `${e.kind}: ${e.title}`),
  };

  let provider;
  try {
    provider = await resolveChatProvider(tenantId);
  } catch { return []; }

  // Tenant may override the prompt via AiInboxTenantConfig.llmSystemPrompt
  // so an operator can tune the model's "voice" for their business.
  const customCfg = await prisma.aiInboxTenantConfig.findUnique({
    where: { tenantId },
    select: { llmSystemPrompt: true },
  });
  const defaultSystem = `You are an operations analyst reviewing a company's ERP snapshot.
Produce 0-3 FRESH observations about non-obvious risks or opportunities the user should see.

Rules:
- Do NOT repeat items already in \`alreadyKnown\`.
- Each finding must cite a specific number from the snapshot.
- Output ONLY a JSON array (no prose, no code fences) with this shape:
  [{"severity":"info"|"watch"|"critical", "category":"Revenue"|"AR"|"Pipeline"|"Cash"|"Inventory"|"HR"|"Operations", "title":string, "finding":string}]
- Keep each title ≤ 10 words and finding ≤ 30 words.
- Return [] if nothing noteworthy.`;
  const system = customCfg?.llmSystemPrompt?.trim() || defaultSystem;

  let text: string;
  try {
    const r = await provider.chat(system, [{ role: "user", content: JSON.stringify(snapshot) }]);
    text = r.text;
  } catch { return []; }

  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); } catch { return []; }
  if (!Array.isArray(parsed)) return [];

  // Hash the title to produce a stable signalKey across scans.
  const findings: Finding[] = [];
  for (const raw of parsed.slice(0, 3)) {
    const r = raw as Record<string, unknown>;
    if (typeof r.title !== "string" || typeof r.finding !== "string") continue;
    const sev = r.severity === "critical" || r.severity === "watch" ? r.severity : "info";
    const cat = ["Revenue", "AR", "Pipeline", "Cash", "Inventory", "HR", "Operations"].includes(String(r.category))
      ? String(r.category)
      : "Operations";
    // 32-char hash of the title for a stable signalKey.
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(String(r.title)).digest("hex").slice(0, 24);
    findings.push({
      signalKey: `llm_pattern:${hash}`,
      kind: "llm_pattern",
      severity: sev as "info" | "watch" | "critical",
      category: cat as Finding["category"],
      title: String(r.title),
      finding: String(r.finding),
    });
  }
  return findings;
}

export async function findPendingLeaveApprovals(tenantId: string): Promise<Finding[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const pending = await prisma.leaveApplication.findMany({
    where: { tenantId, status: "Open", createdAt: { lt: sevenDaysAgo } },
    select: {
      id: true, fromDate: true, toDate: true, leaveType: true,
      employee: { select: { employeeName: true } },
    },
    take: 10,
  });
  return pending.map((l) => ({
    signalKey: `hr_leave_pending:${l.id}`,
    kind: "hr_leave_pending",
    severity: "info" as const,
    category: "HR" as const,
    title: `${l.employee?.employeeName ?? "Employee"}'s leave request has been open > 7 days`,
    finding: `A ${l.leaveType ?? "leave"} request from ${l.fromDate.toLocaleDateString()} to ${l.toDate.toLocaleDateString()} has been pending for over a week.`,
    targetDoctype: "LeaveApplication",
    targetDocId: l.id,
    actionLabel: "Review",
    actionHref: `/hr/leave-applications/${l.id}`,
  }));
}

// ─── Public API: run everything, upsert into the inbox ───────────────

const GENERATORS = [
  findOverdueInvoices,
  findRevenueDropsOrSpikes,
  findCashRunway,
  findStalePipeline,
  findLowStockItems,
  findOldDraftInvoices,
  findPendingLeaveApprovals,
  // 8th generator — opt-in via AI_INBOX_LLM_GENERATOR=1. No-ops when
  // disabled, so safe to keep in the list unconditionally.
  findLlmPatterns,
];

export interface ScanResult {
  tenantId: string;
  scanned: number; // number of generators run
  inserted: number;
  refreshed: number;
  errors: string[];
}

export async function runAiInboxScan(tenantId: string): Promise<ScanResult> {
  const result: ScanResult = { tenantId, scanned: 0, inserted: 0, refreshed: 0, errors: [] };
  for (const gen of GENERATORS) {
    result.scanned++;
    try {
      const findings = await gen(tenantId);
      for (const f of findings) {
        const existing = await prisma.aiInsightInbox.findUnique({
          where: { tenantId_signalKey: { tenantId, signalKey: f.signalKey } },
        });
        if (existing) {
          // Still dismissed within cooldown? skip.
          if (existing.dismissedUntil && existing.dismissedUntil > new Date()) continue;
          await prisma.aiInsightInbox.update({
            where: { id: existing.id },
            data: {
              lastSeenAt: new Date(),
              severity: f.severity,
              title: f.title,
              finding: f.finding,
              actionLabel: f.actionLabel,
              actionHref: f.actionHref,
              dataJson: f.dataJson as unknown as object | undefined,
              // Reset the dismiss window — operator saw the signal, dismissed
              // for a cooldown, cooldown expired, now the signal is still
              // true. Treat as a fresh unresolved issue.
              dismissedAt: null,
              dismissedUntil: null,
              dismissedBy: null,
            },
          });
          result.refreshed++;
        } else {
          await prisma.aiInsightInbox.create({
            data: {
              tenantId,
              signalKey: f.signalKey,
              kind: f.kind,
              severity: f.severity,
              category: f.category,
              title: f.title,
              finding: f.finding,
              targetDoctype: f.targetDoctype,
              targetDocId: f.targetDocId,
              actionLabel: f.actionLabel,
              actionHref: f.actionHref,
              dataJson: f.dataJson as unknown as object | undefined,
            },
          });
          result.inserted++;
        }
      }
    } catch (e) {
      result.errors.push(`${gen.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
