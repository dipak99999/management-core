"use client";

import { useEffect, useState } from "react";
import { authApi } from "../../../lib/auth-api";
import { NextActionsPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { trackRecent } from "../../../lib/recent";
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
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { AiInsightCard } from "../../../components/ai-insight-card";
import { AddressesPanel, ContactsPanel } from "../../../lib/party-panels";
import { ActivityTimeline } from "../../../components/activity-timeline";
import { currentUserId } from "../../../lib/collab-api";

interface Lead {
  id: string;
  name: string;
  leadName: string;
  companyName: string | null;
  email: string | null;
  mobile: string | null;
  status: string;
  source: string | null;
  remarks: string | null;
  convertedCustomerId: string | null;
  convertedCustomer: { id: string; customerName: string } | null;
  createdAt: string;
}
interface Opportunity {
  id: string;
  name: string;
  status: string;
  expectedAmount: string;
  expectedCloseDate: string | null;
}
interface Quotation {
  id: string;
  name: string;
  status: string;
  quotationDate: string;
  grandTotal: string;
}
interface Payload {
  lead: Lead;
  opportunities: Opportunity[];
  quotations: Quotation[];
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/leads/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);
  // Track to the dashboard's Recent strip.
  useEffect(() => {
    if (data?.lead) {
      trackRecent({
        doctype: "Lead",
        id: data.lead.id,
        label: data.lead.leadName,
        href: `/crm/leads/${data.lead.id}`,
      });
    }
    // deliberately granular — avoid refiring on unrelated lead edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.lead?.id, data?.lead?.leadName]);

  async function convert() {
    if (!confirm("Convert this lead to a Customer? Can't be undone.")) return;
    setBusy(true);
    try {
      await api.post(`/leads/${params.id}/convert`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      setBusy(false);
    }
  }

  async function convertToQuotation() {
    setBusy(true);
    try {
      const r = await api.post<{ id: string; name: string }>(
        `/leads/${params.id}/convert-to-quotation`,
        {},
      );
      window.location.href = `/crm/quotations/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Leads", href: "/crm/leads" }]}
          title="Lead"
        />
        {/not found/i.test(error) || /404/.test(error) ? (
          <NotFoundState doctype="Lead" listHref="/crm/leads" listLabel="Leads" />
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
          breadcrumb={[{ label: "Leads", href: "/crm/leads" }]}
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

  const l = data.lead;
  const pipelineValue = data.opportunities.reduce(
    (s, o) => s + Number(o.expectedAmount),
    0,
  );
  const subtitleParts = [
    l.name,
    l.companyName,
    l.source ? `from ${l.source}` : null,
  ].filter(Boolean);

  const oppCols: Column<Opportunity>[] = [
    {
      header: "Opp",
      cell: (o) => (
        <a
          href={`/crm/opportunities/${o.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {o.name}
        </a>
      ),
    },
    {
      header: "Expected",
      align: "right",
      cell: (o) => (
        <span className="tabular-nums">{money(Number(o.expectedAmount))}</span>
      ),
    },
    { header: "Close date", cell: (o) => dateShort(o.expectedCloseDate) },
    { header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
  ];

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
          { label: "Leads", href: "/crm/leads" },
          { label: l.leadName },
        ]}
        title={l.leadName}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={l.status} />
            {subtitleParts.length > 0 && (
              <span>{subtitleParts.join(" · ")}</span>
            )}
          </span>
        }
        actions={
          <>
            <a href="/crm/leads">
              <Button variant="secondary" type="button">
                ← Back
              </Button>
            </a>
            {l.status !== "Lost" && (
              <Button
                variant="secondary"
                onClick={convertToQuotation}
                disabled={busy}
                type="button"
              >
                Quick Quote
              </Button>
            )}
            {l.status !== "Converted" && l.status !== "Lost" && (
              <Button
                variant="primary"
                onClick={convert}
                disabled={busy}
                type="button"
              >
                Convert to Customer
              </Button>
            )}
          </>
        }
      />

      <NextActionsPanel
        doctype="Lead"
        docId={params.id}
        heading="What next?"
        fetchChips={() => authApi.post("/ai/next-actions", { doctype: "Lead", docId: params.id })}
        callService={(method, path, body) => {
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

            <WorkflowActions doctype="Lead" docId={l.id} onChange={load} />

      <AiInsightCard doctype="Lead" docId={l.id} />

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Contact
          </div>
          {l.email && (
            <div className="text-sm text-ink flex items-center justify-between gap-2 group">
              <span className="truncate">{l.email}</span>
              <a
                href={`mailto:${l.email}`}
                className="p-1.5 rounded hover:bg-canvas-warm text-ink-muted hover:text-ink opacity-0 group-hover:opacity-100 transition"
                title="Send email"
                aria-label="Send email"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          )}
          {l.mobile && (
            <div className="text-sm text-ink-soft flex items-center justify-between gap-2 group mt-1">
              <span className="truncate">{l.mobile}</span>
              <a
                href={`tel:${l.mobile}`}
                className="p-1.5 rounded hover:bg-canvas-warm text-ink-muted hover:text-ink opacity-0 group-hover:opacity-100 transition"
                title="Call"
                aria-label="Call"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
                  />
                </svg>
              </a>
            </div>
          )}
          {!l.email && !l.mobile && (
            <div className="text-sm text-ink-muted italic">
              No contact info
            </div>
          )}
          <div className="text-xs text-ink-muted mt-2">
            Added {dateShort(l.createdAt)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Pipeline
          </div>
          <div className="font-semibold text-2xl tabular-nums text-ink">
            {money(pipelineValue)}
          </div>
          <div className="text-xs text-ink-muted mt-1">
            {data.opportunities.length} opportunit
            {data.opportunities.length === 1 ? "y" : "ies"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-2">
            Converted to
          </div>
          {l.convertedCustomer ? (
            <a
              href={`/accounting/customers/${l.convertedCustomer.id}`}
              className="font-semibold text-brand-600 hover:underline"
            >
              {l.convertedCustomer.customerName}
            </a>
          ) : (
            <div className="text-sm text-ink-muted italic">
              Not yet a customer
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionHeader
          title={`Opportunities (${data.opportunities.length})`}
        />
        <div className="hidden md:block">
          <DataTable<Opportunity>
            columns={oppCols}
            rows={data.opportunities}
            rowKey={(o) => o.id}
            empty={{ title: "No opportunities" }}
          />
        </div>
        {data.opportunities.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No opportunities
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.opportunities.map((o) => (
              <li key={o.id}>
                <a href={`/crm/opportunities/${o.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-brand-600 truncate">{o.name}</div>
                      <div className="text-xs text-ink-muted">
                        {o.status}
                        {o.expectedCloseDate && ` · close ${dateShort(o.expectedCloseDate)}`}
                      </div>
                    </div>
                    <div className="font-mono text-ink tabular-nums text-end">
                      {Number(o.expectedAmount).toFixed(2)}
                    </div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionHeader title={`Quotations (${data.quotations.length})`} />
        <div className="hidden md:block">
          <DataTable<Quotation>
            columns={quoteCols}
            rows={data.quotations}
            rowKey={(q) => q.id}
            empty={{ title: "No quotations" }}
          />
        </div>
        {data.quotations.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No quotations
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.quotations.map((q) => (
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

      {l.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">
            {l.remarks}
          </div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AddressesPanel linkedDoctype="Lead" linkedId={l.id} />
        <ContactsPanel linkedDoctype="Lead" linkedId={l.id} />
      </section>

      <section>
        <ActivityTimeline parentType="Lead" parentId={l.id} />
      </section>

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Lead" docId={l.id} />
        <CommentsPanel
          doctype="Lead"
          docId={l.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
