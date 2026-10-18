"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
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
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import { ActivityTimeline } from "../../../components/activity-timeline";

interface Opportunity {
  id: string;
  name: string;
  status: string;
  partyType: string;
  leadId: string | null;
  customerId: string | null;
  expectedAmount: string;
  expectedCloseDate: string | null;
  source: string | null;
  remarks: string | null;
  createdAt: string;
  lead: { id: string; name: string; leadName: string; companyName: string | null } | null;
  customer: { id: string; customerName: string; email: string | null } | null;
}
interface Quotation {
  id: string;
  name: string;
  status: string;
  quotationDate: string;
  grandTotal: string;
}
interface Payload {
  opportunity: Opportunity;
  oppQuotations: Quotation[];
  partyQuotations: Quotation[];
}

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/opportunities/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function convertToQuotation() {
    setConverting(true);
    try {
      const r = await api.post<{ id: string; name: string }>(
        `/opportunities/${params.id}/convert-to-quotation`,
        {},
      );
      // Straight to the new draft so operator can add items.
      window.location.href = `/crm/quotations/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
      setConverting(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Opportunities", href: "/crm/opportunities" }]}
          title="Opportunity"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Opportunities", href: "/crm/opportunities" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const o = data.opportunity;

  const quoteCols: Column<Quotation>[] = [
    {
      header: "Quotation",
      cell: (q) => (
        <a
          href={`/crm/quotations/${q.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {q.name}
        </a>
      ),
    },
    { header: "Date", cell: (q) => dateShort(q.quotationDate) },
    {
      header: "Grand Total",
      align: "right",
      cell: (q) => (
        <span className="tabular-nums">{money(Number(q.grandTotal))}</span>
      ),
    },
    { header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Opportunities", href: "/crm/opportunities" },
          { label: o.name },
        ]}
        title={o.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={o.status} />
            <span>Added {dateShort(o.createdAt)}</span>
            {o.source && <span>from {o.source}</span>}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {o.status !== "Lost" && o.status !== "Converted" && (
              <Button
                variant="primary"
                onClick={convertToQuotation}
                disabled={converting}
                type="button"
              >
                {converting ? "Converting…" : "Create quotation"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
          </div>
        }
      />

      <WorkflowActions doctype="Opportunity" docId={o.id} onChange={load} />

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Party ({o.partyType})
          </div>
          {o.customer && (
            <a
              href={`/accounting/customers/${o.customer.id}`}
              className="font-semibold text-brand-600 hover:underline"
            >
              {o.customer.customerName}
            </a>
          )}
          {o.lead && (
            <>
              <a
                href={`/crm/leads/${o.lead.id}`}
                className="font-semibold text-brand-600 hover:underline"
              >
                {o.lead.leadName}
              </a>
              {o.lead.companyName && (
                <div className="text-xs text-ink-muted">{o.lead.companyName}</div>
              )}
              <div className="text-xs text-amber-700 mt-1">
                Convert lead to customer before creating a Sales Order
              </div>
            </>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Expected amount
          </div>
          <div className="font-semibold text-2xl tabular-nums text-ink">
            {money(Number(o.expectedAmount))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Expected close
          </div>
          <div className="font-semibold text-lg text-ink">
            {dateShort(o.expectedCloseDate)}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader
          title={`Quotations from this opportunity (${data.oppQuotations.length})`}
        />
        <p className="text-xs text-ink-muted -mt-2 mb-2">
          Direct link — created via Convert to quotation
        </p>
        <div className="hidden md:block">
          <DataTable<Quotation>
            columns={quoteCols}
            rows={data.oppQuotations}
            rowKey={(q) => q.id}
            empty={{
              title: "No quotations from this opportunity yet",
              description:
                o.status !== "Lost" && o.status !== "Converted"
                  ? "Use the Create quotation button above to spawn one."
                  : undefined,
            }}
          />
        </div>
        {data.oppQuotations.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No quotations from this opportunity yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.oppQuotations.map((q) => (
              <li key={q.id}>
                <a href={`/crm/quotations/${q.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{q.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(q.quotationDate)} · {q.status}
                      </div>
                    </div>
                    <div className="font-mono text-ink tabular-nums text-end">
                      {Number(q.grandTotal).toFixed(2)}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader
          title={`Other quotations for this party (${data.partyQuotations.length})`}
        />
        <p className="text-xs text-ink-muted -mt-2 mb-2">
          Loose match — not linked to this opportunity
        </p>
        <div className="hidden md:block">
          <DataTable<Quotation>
            columns={quoteCols}
            rows={data.partyQuotations}
            rowKey={(q) => q.id}
            empty={{ title: "No other quotations for this party" }}
          />
        </div>
        {data.partyQuotations.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No other quotations for this party
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.partyQuotations.map((q) => (
              <li key={q.id}>
                <a href={`/crm/quotations/${q.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{q.name}</div>
                      <div className="text-xs text-ink-muted">
                        {dateShort(q.quotationDate)} · {q.status}
                      </div>
                    </div>
                    <div className="font-mono text-ink tabular-nums text-end">
                      {Number(q.grandTotal).toFixed(2)}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {o.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">
            {o.remarks}
          </div>
        </Card>
      )}

      <section>
        <ActivityTimeline parentType="Opportunity" parentId={o.id} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Opportunity" docId={o.id} />
        <CommentsPanel
          doctype="Opportunity"
          docId={o.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
