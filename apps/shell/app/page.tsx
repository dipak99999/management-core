"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadSession, type Session } from "../lib/auth";
import { fetchDashboard, type DashboardData } from "../lib/dashboard";
import { readRecent, type RecentItem } from "../lib/recent";
import { AppShell, Icon, PageHeader } from "../components/app-shell";
import { SHELL_NAV } from "../components/shell-nav";

function money(n: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

// ── KPI wash tile — mirrors the tinted cards in screenshot 01 ─────────

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  wash: "cream" | "sage" | "mist" | "rose" | "lilac";
  delta?: string;
  deltaDir?: "up" | "down" | "flat";
}
function Kpi({ label, value, sub, href, wash, delta, deltaDir }: KpiProps) {
  const inner = (
    <div className={`kpi-${wash} h-full flex flex-col justify-between min-h-[140px]`}>
      <div className="flex items-start justify-between gap-3">
        <span className="stat-label">{label}</span>
        {delta && (
          <span
            className={`stat-delta flex items-center gap-1 ${
              deltaDir === "down"
                ? "stat-delta-down"
                : deltaDir === "up"
                ? "stat-delta-up"
                : "text-ink-muted"
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              {deltaDir === "down" ? (
                <path
                  d="M3 4l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : deltaDir === "flat" ? (
                <path
                  d="M3 6h6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M3 8l3-3 3 3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
            {delta}
          </span>
        )}
      </div>
      <div>
        <div className="stat-value mt-2">{value}</div>
        {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Dashboard body ────────────────────────────────────────────────────

interface InboxTopEntry {
  id: string;
  severity: "info" | "watch" | "critical";
  title: string;
  finding: string;
  actionLabel: string | null;
  actionHref: string | null;
}

// Dashboard-level "What needs your attention" surfaces the top 3 open
// AI-Inbox findings. Keeps the dashboard a landing-pad for the day: KPIs
// above, actionable alerts here, Recent + Quick Actions below.
function AttentionStrip() {
  const [items, setItems] = useState<InboxTopEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const token = (() => {
      try { return (JSON.parse(localStorage.getItem("lumaara.session") ?? "{}") as { token?: string }).token ?? null; }
      catch { return null; }
    })();
    if (!token) return;
    const base = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
    fetch(`${base}/ai/inbox?filter=open&limit=3`, {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : [])
      .then((rows) => { setItems(rows ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);
  if (!loaded || items.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="section-title mb-3 flex items-center justify-between">
        <span>What needs your attention</span>
        <Link href="/ai-inbox" className="text-xs text-ink-muted hover:text-ink font-medium normal-case tracking-normal">
          Open AI Inbox →
        </Link>
      </div>
      <ul className="space-y-2">
        {items.map((r) => {
          const dot =
            r.severity === "critical" ? "bg-red-500"
            : r.severity === "watch" ? "bg-amber-500"
            : "bg-sky-500";
          return (
            <li key={r.id} className="rounded-xl border border-ink/8 bg-white p-3 flex items-start gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 rounded-full flex-shrink-0 ${dot}`} aria-label={r.severity} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink">{r.title}</div>
                <div className="text-xs text-ink-soft mt-0.5 line-clamp-2">{r.finding}</div>
              </div>
              {r.actionHref && (
                <a href={r.actionHref} className="text-xs text-ink hover:text-brand-700 font-medium whitespace-nowrap">
                  {r.actionLabel ?? "Open"} →
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecentStrip() {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    setItems(readRecent(6));
    const refresh = () => setItems(readRecent(6));
    window.addEventListener("lumaara:recent-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("lumaara:recent-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  if (items.length === 0) return null;
  return (
    <section className="mt-6">
      <div className="section-title mb-3">Recent</div>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="inline-flex items-center gap-2 rounded-pill bg-white border border-ink/8 hover:border-ink/20 hover:bg-canvas-warm px-3 py-1.5 text-xs"
          >
            <span className="text-[10px] uppercase tracking-wider text-ink-muted">{it.doctype}</span>
            <span className="text-ink font-medium truncate max-w-[200px]">{it.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DashboardBody() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then((d) => { setData(d); setLoadedAt(new Date()); })
      .catch(() => {
        setData({
          accounting: null,
          stock: null,
          crm: null,
          hr: null,
          projects: null,
          errors: ["Failed to load"],
        });
        setLoadedAt(new Date());
      });
  }, []);

  const updatedLabel = (() => {
    if (!loadedAt) return "Loading…";
    const s = Math.floor((Date.now() - loadedAt.getTime()) / 1000);
    if (s < 30)   return "Updated now";
    if (s < 60)   return `Updated ${s}s ago`;
    if (s < 3600) return `Updated ${Math.floor(s / 60)}m ago`;
    return `Updated ${Math.floor(s / 3600)}h ago`;
  })();

  return (
    <>
      <PageHeader
        eyebrow="Workspace Overview"
        icon={Icon.dashboard}
        title="Owner"
        subtitle="Revenue, pipeline, production, and inventory at a glance."
        actions={
          <>
            <button className="btn-secondary">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path
                  d="M4 4h4v4H4zM12 4h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              This month
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path
                  d="M2 3.5l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="badge-gray text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-success inline-block me-1" />
              {updatedLabel}
            </span>
            <Link href="/accounting/sales-invoices/new" className="btn-primary">
              + New invoice
            </Link>
          </>
        }
      />

      {!data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="kpi bg-white animate-pulse">
              <div className="h-3 w-24 bg-ink/10 rounded mb-4" />
              <div className="h-8 w-32 bg-ink/10 rounded mb-2" />
              <div className="h-3 w-20 bg-ink/10 rounded" />
            </div>
          ))}
        </div>
      )}

      {data && data.errors.length > 0 && (
        <div className="mb-4 rounded-xl border border-gold-200 bg-gold-50 text-gold-800 text-sm px-3 py-2">
          Partial load: {data.errors.join(" · ")}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.accounting && (
            <>
              <Kpi
                wash="cream"
                label="Revenue"
                value={money(data.accounting.mtd.income)}
                sub="this month vs prior"
                delta="new"
                deltaDir="up"
                href="/accounting/reports/profit-and-loss"
              />
              <Kpi
                wash="mist"
                label="AR Outstanding"
                value={money(data.accounting.receivables.outstanding)}
                sub={`${data.accounting.receivables.openInvoices} open · ${data.accounting.receivables.overdueInvoices} overdue`}
                delta=""
                deltaDir="flat"
                href={
                  data.accounting.receivables.overdueInvoices > 0
                    ? "/accounting/sales-invoices?overdue=1"
                    : "/accounting/sales-invoices?status=Submitted"
                }
              />
              <Kpi
                wash="sage"
                label="Cash on hand"
                value={money(data.accounting.cashOnHand)}
                sub="Cash + Bank accounts"
                href="/accounting/reports/trial-balance"
              />
            </>
          )}

          {data.crm && (
            <>
              <Kpi
                wash="lilac"
                label="Quotes"
                value={String(data.crm.openQuotations)}
                sub={money(data.crm.quotedValue)}
                delta="new"
                deltaDir="up"
                href="/crm/quotations?status=Submitted"
              />
              <Kpi
                wash="sage"
                label="Orders"
                value={String(data.crm.openSalesOrders)}
                sub={money(data.crm.salesOrderValue)}
                delta="new"
                deltaDir="up"
                href="/crm/sales-orders?status=Submitted"
              />
              <Kpi
                wash="cream"
                label="Pipeline"
                value={money(data.crm.pipelineValue)}
                sub={`${data.crm.openOpportunities} opps · ${data.crm.openLeads} leads`}
                href="/crm/opportunities"
              />
            </>
          )}

          {data.stock && (
            <Kpi
              wash="rose"
              label="Stock value"
              value={money(data.stock.totalStockValue)}
              sub={`${data.stock.itemsInStock} SKUs · ${data.stock.openWorkOrders} open WO`}
              href="/stock/reports/stock-balance"
            />
          )}

          {data.hr && (
            <>
              <Kpi
                wash="mist"
                label="Headcount"
                value={String(data.hr.activeEmployees)}
                sub={`${data.hr.absentToday} absent · ${data.hr.onLeaveToday} on leave`}
                href={
                  data.hr.onLeaveToday > 0
                    ? "/hr/leave-applications?status=Approved&today=1"
                    : "/hr/employees?status=Active"
                }
              />
              <Kpi
                wash="cream"
                label="Payroll MTD"
                value={money(data.hr.mtdPayrollGross)}
                sub={`${data.hr.mtdSlipsSubmitted} slips submitted${
                  data.hr.draftSlips ? ` · ${data.hr.draftSlips} draft` : ""
                }`}
                href="/hr/salary-slips"
              />
            </>
          )}

          {data.projects && (
            <>
              <Kpi
                wash="sage"
                label="Projects"
                value={String(data.projects.openProjects)}
                sub={`${data.projects.openTasks} open tasks`}
                href="/projects/projects?status=Open"
              />
              <Kpi
                wash="lilac"
                label="Hours this week"
                value={data.projects.weekHours.toFixed(1)}
                sub={
                  data.projects.weekBillingAmount > 0
                    ? `Billable ${money(data.projects.weekBillingAmount)}`
                    : undefined
                }
                href="/projects/timesheets"
              />
            </>
          )}
        </div>
      )}

      <AttentionStrip />

      <RecentStrip />

      {/* Quick actions row */}
      <div className="mt-10">
        <div className="section-title mb-3">Quick actions</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { href: "/accounting/customers/new",       label: "New customer",  icon: Icon.users },
            { href: "/accounting/sales-invoices/new",  label: "New invoice",   icon: Icon.invoice },
            { href: "/buying/purchase-orders/new",     label: "New PO",        icon: Icon.cart },
            { href: "/crm/leads",                      label: "Add lead",      icon: Icon.target },
            { href: "/hr/employees",                   label: "Add employee",  icon: Icon.briefcase },
            { href: "/stock/stock-entries/new",        label: "Stock entry",   icon: Icon.box },
          ].map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="card-hover flex items-center gap-3 p-3.5"
            >
              <span className="icon-square-soft h-9 w-9 rounded-lg">
                {a.icon}
              </span>
              <span className="text-sm font-medium text-ink">{a.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!session) {
    return (
      <main className="min-h-screen bg-canvas grid place-items-center px-6">
        <div className="w-full max-w-sm text-center space-y-8">
          <div className="space-y-3">
            <div className="mx-auto flex items-center justify-center gap-2.5">
              <svg width="42" height="42" viewBox="0 0 32 32" fill="none">
                <g fill="#C09040">
                  <circle cx="16" cy="6" r="3" />
                  <circle cx="24.66" cy="11" r="3" />
                  <circle cx="24.66" cy="21" r="3" />
                  <circle cx="16" cy="26" r="3" />
                  <circle cx="7.34" cy="21" r="3" />
                  <circle cx="7.34" cy="11" r="3" />
                  <circle cx="16" cy="16" r="3.5" fill="#DDBB77" />
                </g>
              </svg>
              <span className="font-wordmark text-[36px] text-ink">LUMAARA</span>
            </div>
            <p className="text-ink-muted text-sm">
              Multi-tenant ERP · powered by{" "}
              <span className="text-brew font-semibold">Brew AI</span>
            </p>
          </div>
          <div className="card p-6 text-start space-y-3">
            <Link href="/login" className="btn-primary w-full">
              Sign in to your workspace
            </Link>
            <Link href="/signup" className="btn-secondary w-full">
              Create a new workspace
            </Link>
          </div>
          {process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === "1" && (
            <p className="text-xs text-ink-muted">
              Demo credentials:{" "}
              <span className="font-mono text-ink-soft">
                demo@lumaara.local · demo1234
              </span>
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <DashboardBody />
    </AppShell>
  );
}
