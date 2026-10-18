"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { CustomFieldsView } from "../../../lib/custom-fields";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AddressesPanel, ContactsPanel } from "../../../lib/party-panels";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Supplier {
  id: string;
  supplierName: string;
  supplierType: string;
  email: string | null;
  mobile: string | null;
  gstin: string | null;
  supplierGroup: string | null;
  customData: Record<string, unknown> | null;
  createdAt: string;
}
interface Bill {
  id: string;
  name: string;
  supplierInvoiceNo: string | null;
  postingDate: string;
  status: string;
  currency: string;
  grandTotal: string;
  outstandingAmt: string;
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
  supplier: Supplier;
  stats: { outstanding: number; openBills: number; lifetimeBilled: number };
  bills: Bill[];
  payments: Payment[];
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-lg text-ink mt-0.5">{value}</div>
      {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
    </Card>
  );
}

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Payload>(`/suppliers/${params.id}/full`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [params.id]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Suppliers", href: "/buying/suppliers" }]}
          title="Supplier"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Suppliers", href: "/buying/suppliers" }]}
          title="Loading…"
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const s = data.supplier;
  const subtitleParts = [s.supplierType, s.supplierGroup].filter(Boolean);

  const billCols: Column<Bill>[] = [
    {
      header: "Bill",
      cell: (b) => (
        <a
          href={`/buying/purchase-invoices/${b.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {b.name}
        </a>
      ),
    },
    {
      header: "Supplier Bill #",
      cell: (b) => (
        <span className="font-mono text-xs text-ink-soft">
          {b.supplierInvoiceNo ?? "—"}
        </span>
      ),
    },
    { header: "Date", cell: (b) => dateShort(b.postingDate) },
    {
      header: "Grand total",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums">{money(Number(b.grandTotal), b.currency)}</span>
      ),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (b) => (
        <span className="tabular-nums">
          {money(Number(b.outstandingAmt), b.currency)}
        </span>
      ),
    },
    { header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
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
          { label: "Suppliers", href: "/buying/suppliers" },
          { label: s.supplierName },
        ]}
        title={s.supplierName}
        subtitle={subtitleParts.length ? subtitleParts.join(" · ") : undefined}
        actions={
          <>
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
            <a href={`/buying/suppliers?editId=${s.id}`}>
              <Button variant="primary" type="button">Edit</Button>
            </a>
          </>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        <Kpi
          label="We owe"
          value={money(data.stats.outstanding)}
          hint={`${data.stats.openBills} open`}
        />
        <Kpi label="Lifetime billed" value={money(data.stats.lifetimeBilled)} />
        <Kpi label="Since" value={dateShort(s.createdAt)} />
      </section>

      {(s.email || s.mobile || s.gstin) && (
        <Card className="p-4">
          <SectionHeader title="Primary contact" />
          <div className="grid grid-cols-3 gap-4 text-sm">
            {s.email && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Email
                </div>
                <div className="mt-0.5 text-ink">{s.email}</div>
              </div>
            )}
            {s.mobile && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Phone
                </div>
                <div className="mt-0.5 text-ink">{s.mobile}</div>
              </div>
            )}
            {s.gstin && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  GSTIN
                </div>
                <div className="mt-0.5 font-mono text-ink">{s.gstin}</div>
              </div>
            )}
          </div>
        </Card>
      )}

      <CustomFieldsView doctype="Supplier" data={s.customData} />

      <section className="grid grid-cols-2 gap-4">
        <AddressesPanel linkedDoctype="Supplier" linkedId={s.id} />
        <ContactsPanel linkedDoctype="Supplier" linkedId={s.id} />
      </section>

      <section>
        <SectionHeader title="Purchase invoices (latest 50)" />
        <div className="hidden md:block">
          <DataTable<Bill>
            columns={billCols}
            rows={data.bills}
            rowKey={(b) => b.id}
            empty={{ title: "No bills yet" }}
          />
        </div>
        {data.bills.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No bills yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.bills.map((b) => (
              <li key={b.id}>
                <a href={`/buying/purchase-invoices/${b.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{b.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(b.postingDate)}
                        {b.supplierInvoiceNo && ` · ${b.supplierInvoiceNo}`}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">
                        {Number(b.grandTotal).toFixed(2)} {b.currency}
                      </div>
                      <div className="text-xs text-ink-muted">{b.status}</div>
                    </div>
                  </div>
                  {Number(b.outstandingAmt) > 0 && (
                    <div className="mt-1 text-xs text-red-600 tabular-nums">
                      Outstanding {Number(b.outstandingAmt).toFixed(2)} {b.currency}
                    </div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title="Payments made (latest 50)" />
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

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Supplier" docId={s.id} />
        <CommentsPanel
          doctype="Supplier"
          docId={s.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
