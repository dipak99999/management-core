"use client";

import { useEffect, useState } from "react";
import { accApi, loadSession } from "../lib/api";
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  money,
} from "../components/ui";

interface CustomerSummary {
  partyType: "Customer";
  outstanding: number;
  openInvoices: number;
  overdueInvoices: number;
  pendingQuotations: number;
  openTickets: number;
}
interface SupplierSummary {
  partyType: "Supplier";
  outstandingPayable: number;
  openPurchaseOrders: number;
  draftBills: number;
  openTickets: number;
}
type Summary = CustomerSummary | SupplierSummary;

function Kpi({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "warn" | "danger" | "good";
  href?: string;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "good"
          ? "text-green-700"
          : "text-ink-muted";
  const inner = (
    <Card className="p-4 h-full">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-2xl text-ink mt-1 tabular-nums">
        {value}
      </div>
      {hint && <div className={`text-xs mt-1 ${toneCls}`}>{hint}</div>}
    </Card>
  );
  return href ? (
    <a href={href} className="block hover:opacity-90 transition-opacity">
      {inner}
    </a>
  ) : (
    inner
  );
}

export default function PortalHomePage() {
  const [session, setSession] = useState<ReturnType<typeof loadSession>>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    setSession(s);
    (async () => {
      try {
        setSummary(await accApi.get<Summary>("/portal/summary"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, []);

  if (!session) return null;

  const isCustomer = session.user.partyType === "Customer";
  const displayName =
    session.user.displayName ?? session.user.email.split("@")[0];

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
          title="Dashboard"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">
          {error}
        </Card>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
        title={`Welcome, ${displayName}`}
        subtitle={
          isCustomer
            ? "Your invoices, statement, and support requests at a glance."
            : "Your purchase orders, bills, and support requests at a glance."
        }
        actions={
          <>
            <a href={isCustomer ? "/invoices" : "/purchase-orders"}>
              <Button variant="secondary" type="button">
                {isCustomer ? "View invoices" : "View purchase orders"}
              </Button>
            </a>
            <a href="/tickets">
              <Button variant="primary" type="button">
                Open a ticket
              </Button>
            </a>
          </>
        }
      />

      {summary.partyType === "Customer" && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Kpi
              label="Outstanding"
              value={money(summary.outstanding)}
              hint={`${summary.openInvoices} open · ${summary.overdueInvoices} overdue`}
              tone={
                summary.overdueInvoices > 0
                  ? "danger"
                  : summary.outstanding > 0
                    ? "warn"
                    : "good"
              }
              href="/invoices"
            />
            <Kpi
              label="Overdue invoices"
              value={summary.overdueInvoices}
              tone={summary.overdueInvoices > 0 ? "danger" : undefined}
              href="/invoices"
            />
            <Kpi
              label="Pending quotations"
              value={summary.pendingQuotations}
              href="/quotations"
            />
            <Kpi
              label="Open tickets"
              value={summary.openTickets}
              href="/tickets"
            />
          </section>

          {summary.outstanding > 0 && (
            <Card className="p-4 border-amber-200 bg-amber-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-amber-900">
                    You have {money(summary.outstanding)} outstanding
                  </div>
                  <div className="text-sm text-amber-800 mt-1">
                    Pay online via Razorpay or Stripe, or upload a bank transfer
                    reference for manual reconciliation.
                  </div>
                </div>
                <a href="/invoices">
                  <Button variant="primary" type="button">
                    Pay now
                  </Button>
                </a>
              </div>
            </Card>
          )}
        </>
      )}

      {summary.partyType === "Supplier" && (
        <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Kpi
            label="Amount owed to you"
            value={money(summary.outstandingPayable)}
            tone={summary.outstandingPayable > 0 ? "good" : undefined}
            href="/invoices"
          />
          <Kpi
            label="Open purchase orders"
            value={summary.openPurchaseOrders}
            href="/purchase-orders"
          />
          <Kpi
            label="Draft bills"
            value={summary.draftBills}
            href="/invoices"
          />
          <Kpi
            label="Open tickets"
            value={summary.openTickets}
            href="/tickets"
          />
        </section>
      )}
    </main>
  );
}
