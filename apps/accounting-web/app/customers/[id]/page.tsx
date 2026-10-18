"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { trackRecent } from "../../../lib/recent";
import { CustomFieldsView } from "../../../lib/custom-fields";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AiInsightCard } from "../../../components/ai-insight-card";
import { ActivityTimeline } from "../../../components/activity-timeline";
import { AddressesPanel, ContactsPanel } from "../../../lib/party-panels";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  NotFoundState,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Customer {
  id: string;
  customerName: string;
  customerType: string;
  email: string | null;
  mobile: string | null;
  gstin: string | null;
  customerGroup: string | null;
  territory: string | null;
  creditLimit: string;
  creditLimitBypassAllowed: boolean;
  customerGroupRel: { groupName: string } | null;
  territoryRel: { territoryName: string } | null;
  loyaltyProgram: { name: string; pointsPerCurrency: string } | null;
  customData: Record<string, unknown> | null;
  createdAt: string;
}
interface Invoice {
  id: string;
  name: string;
  postingDate: string;
  dueDate: string | null;
  status: string;
  currency: string;
  grandTotal: string;
  outstandingAmt: string;
  isReturn: boolean;
}
interface Payment {
  id: string;
  name: string;
  postingDate: string;
  modeOfPayment: string;
  paidAmount: string;
  status: string;
}
interface Payload {
  customer: Customer;
  stats: {
    outstanding: number;
    openInvoices: number;
    lifetimeBilled: number;
    loyaltyBalance: number;
    openSOs: number;
    openQuotes: number;
    activeSubscriptions: number;
    creditLimit: number;
    creditUsedPct: number | null;
  };
  ageing: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
  invoices: Invoice[];
  payments: Payment[];
}

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
  tone?: "warn" | "danger";
  href?: string;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-ink-muted";
  const inner = (
    <Card className={`p-3 min-h-[90px] ${href ? "transition hover:border-ink/20 cursor-pointer" : ""}`}>
      <div className="text-xs uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-xl text-ink mt-1 tabular-nums">{value}</div>
      {hint && <div className={`text-xs mt-1 ${toneCls}`}>{hint}</div>}
    </Card>
  );
  return href ? <a href={href} className="block">{inner}</a> : inner;
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Payload>(`/customers/${params.id}/full`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [params.id]);
  useEffect(() => {
    if (data?.customer) {
      trackRecent({
        doctype: "Customer",
        id: data.customer.id,
        label: data.customer.customerName,
        href: `/accounting/customers/${data.customer.id}`,
      });
    }
    // deliberately granular — adding `data.customer` would re-fire on
    // every unrelated field change in the customer object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.customer?.id, data?.customer?.customerName]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Customers", href: "/accounting/customers" }]}
          title="Customer"
        />
        {/not found/i.test(error) || /404/.test(error) ? (
          <NotFoundState doctype="Customer" listHref="/accounting/customers" listLabel="Customers" />
        ) : (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
        )}
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Customers", href: "/accounting/customers" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const c = data.customer;
  const subtitleParts = [
    c.customerType,
    c.customerGroupRel?.groupName ?? c.customerGroup,
    c.territoryRel?.territoryName ?? c.territory,
  ].filter(Boolean);

  const invoiceCols: Column<Invoice>[] = [
    {
      header: "Invoice",
      cell: (i) => (
        <a
          href={`/accounting/sales-invoices/${i.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {i.name}
        </a>
      ),
    },
    { header: "Date", cell: (i) => dateShort(i.postingDate) },
    {
      header: "Grand total",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums">
          {money(Number(i.grandTotal), i.currency)}
        </span>
      ),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (i) => (
        <span className="tabular-nums">
          {money(Number(i.outstandingAmt), i.currency)}
        </span>
      ),
    },
    { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
  ];

  const paymentCols: Column<Payment>[] = [
    {
      header: "Payment",
      cell: (p) => (
        <a
          href={`/accounting/payments/${p.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {p.name}
        </a>
      ),
    },
    { header: "Date", cell: (p) => dateShort(p.postingDate) },
    { header: "Mode", cell: (p) => p.modeOfPayment },
    {
      header: "Amount",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums">{money(Number(p.paidAmount))}</span>
      ),
    },
    { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Customers", href: "/accounting/customers" },
          { label: c.customerName },
        ]}
        title={c.customerName}
        subtitle={subtitleParts.length ? subtitleParts.join(" · ") : undefined}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <a href={`/accounting/customers?editId=${c.id}`}>
              <Button variant="primary" type="button">Edit</Button>
            </a>
          </>
        }
      />

      <AiInsightCard doctype="Customer" docId={c.id} />

      <ActivityTimeline parentType="Customer" parentId={c.id} />

      <section className="grid grid-cols-4 gap-3">
        <Kpi
          label="Outstanding"
          value={money(data.stats.outstanding)}
          hint={`${data.stats.openInvoices} open`}
          href={data.stats.openInvoices > 0 ? `/accounting/sales-invoices?customerId=${c.id}&status=Submitted` : undefined}
        />
        <Kpi
          label="Credit limit"
          value={data.stats.creditLimit > 0 ? money(data.stats.creditLimit) : "—"}
          hint={
            data.stats.creditUsedPct != null
              ? `${data.stats.creditUsedPct.toFixed(0)}% used`
              : undefined
          }
          tone={
            data.stats.creditUsedPct != null && data.stats.creditUsedPct > 90
              ? "danger"
              : data.stats.creditUsedPct != null && data.stats.creditUsedPct > 70
                ? "warn"
                : undefined
          }
        />
        <Kpi
          label="Lifetime billed"
          value={money(data.stats.lifetimeBilled)}
          href={data.stats.lifetimeBilled > 0 ? `/accounting/sales-invoices?customerId=${c.id}` : undefined}
        />
        <Kpi
          label="Loyalty"
          value={
            c.loyaltyProgram ? `${data.stats.loyaltyBalance} pts` : "—"
          }
          hint={c.loyaltyProgram?.name}
        />
      </section>

      <section className="grid grid-cols-4 gap-3">
        <Kpi
          label="Open quotes"
          value={data.stats.openQuotes}
          href={data.stats.openQuotes > 0 ? `/crm/quotations?customerId=${c.id}` : undefined}
        />
        <Kpi
          label="Open SOs"
          value={data.stats.openSOs}
          href={data.stats.openSOs > 0 ? `/crm/sales-orders?customerId=${c.id}` : undefined}
        />
        <Kpi
          label="Active subs"
          value={data.stats.activeSubscriptions}
          href={data.stats.activeSubscriptions > 0 ? `/accounting/subscriptions?customerId=${c.id}` : undefined}
        />
        <Kpi label="Since" value={dateShort(c.createdAt)} />
      </section>

      {data.stats.outstanding > 0 && (
        <Card className="p-4">
          <SectionHeader title="Ageing (outstanding by overdue-days bucket)" />
          <div className="grid grid-cols-5 gap-2 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">Current</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {money(data.ageing.current)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">1–30 d</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {money(data.ageing.d1_30)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">31–60 d</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {money(data.ageing.d31_60)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">61–90 d</div>
              <div className="font-semibold tabular-nums mt-0.5">
                {money(data.ageing.d61_90)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-red-700">90+ d</div>
              <div
                className={`font-semibold tabular-nums mt-0.5 ${data.ageing.d90_plus > 0 ? "text-red-700" : ""}`}
              >
                {money(data.ageing.d90_plus)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {(c.email || c.mobile || c.gstin) && (
        <Card className="p-4">
          <SectionHeader title="Primary contact" />
          <div className="grid grid-cols-3 gap-4 text-sm">
            {c.email && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">Email</div>
                <div className="mt-0.5 text-ink">{c.email}</div>
              </div>
            )}
            {c.mobile && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">Phone</div>
                <div className="mt-0.5 text-ink">{c.mobile}</div>
              </div>
            )}
            {c.gstin && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">GSTIN</div>
                <div className="mt-0.5 font-mono text-ink">{c.gstin}</div>
              </div>
            )}
          </div>
        </Card>
      )}

      <CustomFieldsView doctype="Customer" data={c.customData} />

      <section className="grid grid-cols-2 gap-4">
        <AddressesPanel linkedDoctype="Customer" linkedId={c.id} />
        <ContactsPanel linkedDoctype="Customer" linkedId={c.id} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Customer" docId={c.id} />
        <CommentsPanel
          doctype="Customer"
          docId={c.id}
          currentUserId={currentUserId()}
        />
      </section>

      <section>
        <SectionHeader title="Sales invoices (latest 50)" />
        <div className="hidden md:block">
          <DataTable<Invoice>
            columns={invoiceCols}
            rows={data.invoices}
            rowKey={(i) => i.id}
            empty={{ title: "No invoices yet" }}
          />
        </div>
        {data.invoices.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No invoices yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.invoices.map((i) => (
              <li key={i.id}>
                <a href={`/accounting/sales-invoices/${i.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{i.name}</div>
                      <div className="text-xs text-ink-muted">{dateShort(i.postingDate)}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">
                        {Number(i.grandTotal).toFixed(2)} {i.currency}
                      </div>
                      <div className="text-xs text-ink-muted">{i.status}</div>
                    </div>
                  </div>
                  {Number(i.outstandingAmt) > 0 && (
                    <div className="mt-1 text-xs text-red-600 tabular-nums">
                      Outstanding {Number(i.outstandingAmt).toFixed(2)} {i.currency}
                    </div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Payments received (latest 50)" />
        <div className="hidden md:block">
          <DataTable<Payment>
            columns={paymentCols}
            rows={data.payments}
            rowKey={(p) => p.id}
            empty={{ title: "No payments yet" }}
          />
        </div>
        {data.payments.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No payments yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.payments.map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm text-ink truncate">{p.name}</div>
                    <div className="text-xs text-ink-muted">
                      {dateShort(p.postingDate)} · {p.modeOfPayment}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">
                      {Number(p.paidAmount).toFixed(2)}
                    </div>
                    <div className="text-xs text-ink-muted">{p.status}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
