// Cash flow forecast — the AI-wedge differentiator for Finance & Accounting.
//
// Combines deterministic data gathering (historical cashflows + open
// invoices with due dates + recurring invoices + salary runs) with an
// optional LLM narrative that explains WHY the forecast looks the way it
// does and flags risks (big outflow in week 3, customer X past due, etc).
//
// Returns a structured object the UI can render as a weekly chart:
//   { weeks: [{weekStart, inflow, outflow, net, cumulativeBalance}],
//     narrative: "Cash position improves through October; week 4 shows a
//                 ₹8L squeeze from the salary run coinciding with low
//                 AR collections.",
//     risks: [{severity, message, relatedIds}] }
//
// Latency target: <5s with LLM, <500ms without. Deterministic math
// matters for correctness; the LLM only adds narrative + flags.

import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  getAnthropicClient,
  NoApiKeyError,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { takeToken } from "@lumaara/queue";

export const aiForecastRouter = Router();
const p = perms("SalesInvoice"); // reuse SI read as the finance gate

const AI_FORECAST_RATE_PER_MIN = 10;

const forecastSchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(8),
  // Optional opening balance override (if the API user wants to project
  // from a specific starting cash position instead of today's calculated
  // balance). Useful for scenario modeling.
  openingBalanceInr: z.coerce.number().optional(),
  // Enable LLM narrative + risks when `true` AND the tenant has an
  // Anthropic key. Default false so the endpoint stays fast + free in
  // the common case.
  explain: z.coerce.boolean().default(false),
});

interface WeekBucket {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulativeBalance: number;
  sources: {
    openInvoicesDue: number;
    recurringInvoices: number;
    openPurchaseInvoicesDue: number;
    scheduledSalaryPay: number;
    adhoc: number; // round-off bucket
  };
}

function startOfWeek(d: Date): Date {
  const dow = d.getDay();
  const offset = (dow + 6) % 7; // Mon = 0
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - offset);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

aiForecastRouter.get("/forecast", p.read, async (req, res) => {
  const parsed = forecastSchema.safeParse({ ...req.query });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { weeks, openingBalanceInr, explain } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const allowed = await takeToken(`ai-forecast:${tenantId}`, AI_FORECAST_RATE_PER_MIN);
  if (!allowed) return res.status(429).json({ error: "Forecast rate limit — try again in a minute." });

  // ─── Opening balance: sum current cash/bank account balances ───
  let openingBalance = new Prisma.Decimal(openingBalanceInr ?? 0);
  if (openingBalanceInr == null) {
    const cashAccounts = await prisma.account.findMany({
      where: {
        tenantId, isGroup: false, disabled: false,
        OR: [
          { accountType: "Cash" }, { accountType: "Bank" },
          { accountName: { contains: "Cash", mode: "insensitive" } },
          { accountName: { contains: "Bank", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });
    const cashIds = cashAccounts.map((a) => a.id);
    if (cashIds.length > 0) {
      const agg = await prisma.gLEntry.aggregate({
        where: { tenantId, accountId: { in: cashIds }, isCancelled: false },
        _sum: { debit: true, credit: true },
      });
      openingBalance = new Prisma.Decimal(agg._sum.debit ?? 0).sub(new Prisma.Decimal(agg._sum.credit ?? 0));
    }
  }

  // ─── Build weekly buckets ───
  const start = startOfWeek(new Date());
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => {
    const ws = addDays(start, i * 7);
    const we = addDays(ws, 6);
    return {
      weekStart: iso(ws), weekEnd: iso(we),
      inflow: 0, outflow: 0, net: 0, cumulativeBalance: 0,
      sources: { openInvoicesDue: 0, recurringInvoices: 0, openPurchaseInvoicesDue: 0, scheduledSalaryPay: 0, adhoc: 0 },
    };
  });
  const horizonEnd = addDays(start, weeks * 7);

  function bucketFor(date: Date): WeekBucket | null {
    const d = startOfWeek(date);
    for (const b of buckets) {
      if (b.weekStart === iso(d)) return b;
    }
    return null;
  }

  // ─── INFLOWS: open sales invoices with due dates in horizon ───
  const openSI = await prisma.salesInvoice.findMany({
    where: {
      tenantId, status: "Submitted", outstandingAmt: { gt: 0 },
      dueDate: { gte: start, lte: horizonEnd },
    },
    select: { id: true, name: true, dueDate: true, outstandingAmt: true, customerId: true },
  });
  for (const si of openSI) {
    if (!si.dueDate) continue;
    const b = bucketFor(si.dueDate);
    if (!b) continue;
    const amt = Number(si.outstandingAmt);
    b.inflow += amt;
    b.sources.openInvoicesDue += amt;
  }

  // ─── INFLOWS: recurring invoices scheduled to fire ───
  // The Prisma schema uses `nextRunDate` on RecurringInvoice (not
  // `nextInvoiceDate`). We approximate grand total from the item lines
  // since RecurringInvoice itself doesn't store a cached total — the
  // real total is only known after a run generates a child SalesInvoice.
  const recurring = await prisma.recurringInvoice.findMany({
    where: { tenantId, nextRunDate: { gte: start, lte: horizonEnd } },
    select: {
      id: true, nextRunDate: true, name: true,
      items: { select: { amount: true } },
    },
  });
  for (const r of recurring) {
    if (!r.nextRunDate) continue;
    const b = bucketFor(r.nextRunDate);
    if (!b) continue;
    const amt = r.items.reduce((s, i) => s + Number(i.amount), 0);
    b.inflow += amt;
    b.sources.recurringInvoices += amt;
  }

  // ─── OUTFLOWS: open purchase invoices with due dates in horizon ───
  const openPI = await prisma.purchaseInvoice.findMany({
    where: {
      tenantId, status: "Submitted", outstandingAmt: { gt: 0 },
      dueDate: { gte: start, lte: horizonEnd },
    },
    select: { id: true, name: true, dueDate: true, outstandingAmt: true, supplierId: true },
  });
  for (const pi of openPI) {
    if (!pi.dueDate) continue;
    const b = bucketFor(pi.dueDate);
    if (!b) continue;
    const amt = Number(pi.outstandingAmt);
    b.outflow += amt;
    b.sources.openPurchaseInvoicesDue += amt;
  }

  // ─── OUTFLOWS: salary payroll runs scheduled ───
  // Approximate: find average monthly payroll net total × projected pay dates
  // in the horizon (typical: last working day of month).
  const recentPayroll = await prisma.salarySlip.findMany({
    where: { tenantId, status: "Submitted" },
    orderBy: { endDate: "desc" },
    take: 50,
    select: { endDate: true, netPay: true },
  });
  if (recentPayroll.length > 0) {
    // Avg per month
    const monthly = new Map<string, number>();
    for (const s of recentPayroll) {
      const key = iso(s.endDate).slice(0, 7);
      monthly.set(key, (monthly.get(key) ?? 0) + Number(s.netPay));
    }
    const months = [...monthly.values()];
    const avg = months.reduce((s, x) => s + x, 0) / months.length;
    // Pay date = last day of each month in horizon
    for (let i = 0; i <= weeks; i++) {
      const d = addDays(start, i * 7);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      if (monthEnd >= start && monthEnd <= horizonEnd) {
        const b = bucketFor(monthEnd);
        if (b) {
          b.outflow += avg;
          b.sources.scheduledSalaryPay += avg;
        }
      }
    }
  }

  // ─── Roll up net + cumulative ───
  let running = Number(openingBalance);
  for (const b of buckets) {
    b.net = b.inflow - b.outflow;
    running += b.net;
    b.cumulativeBalance = running;
  }

  // ─── Deterministic risk flags ───
  interface Risk { severity: "low" | "medium" | "high"; message: string; weekStart?: string }
  const risks: Risk[] = [];
  for (const b of buckets) {
    if (b.cumulativeBalance < 0) {
      risks.push({ severity: "high", weekStart: b.weekStart, message: `Cash negative in week starting ${b.weekStart} (₹${b.cumulativeBalance.toFixed(0)})` });
    } else if (b.cumulativeBalance < Math.abs(b.outflow)) {
      risks.push({ severity: "medium", weekStart: b.weekStart, message: `Cash cover <1 week of outflow in week starting ${b.weekStart}` });
    }
    if (b.outflow > 2 * Math.max(1, b.inflow)) {
      risks.push({ severity: "medium", weekStart: b.weekStart, message: `Outflow ${(b.outflow / Math.max(1, b.inflow)).toFixed(1)}× inflow in week starting ${b.weekStart}` });
    }
  }

  // ─── Optional LLM narrative ───
  let narrative: string | null = null;
  if (explain) {
    try {
      const client = await getAnthropicClient(tenantId);
      const summary = {
        openingBalance: Number(openingBalance),
        weeks: buckets.map((b) => ({
          wk: b.weekStart, in: b.inflow, out: b.outflow, net: b.net, bal: b.cumulativeBalance,
        })),
        risks: risks.slice(0, 10),
      };
      const resp = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 400,
        system: "You are a finance analyst summarizing a cash-flow forecast. Be concise (≤120 words), direct, and name specific weeks or amounts. Never invent numbers; only use what's in the <forecast> block.",
        messages: [
          { role: "user", content: `<forecast>${JSON.stringify(summary)}</forecast>\n\nSummarize the trajectory, call out the top 2 risks by severity, and suggest 1 action to improve the position.` },
        ],
      });
      narrative = resp.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text).join("").trim();
    } catch (e) {
      if (e instanceof NoApiKeyError) {
        narrative = null; // graceful: skip explanation
      } else {
        narrative = `(explanation unavailable: ${e instanceof Error ? e.message.slice(0, 80) : "error"})`;
      }
    }
  }

  res.json({
    openingBalance: Number(openingBalance),
    weeks: buckets,
    risks,
    narrative,
    generatedAt: new Date().toISOString(),
  });
});
