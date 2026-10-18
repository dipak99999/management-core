"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Line {
  id: string;
  date: string;
  hours: string;
  isBillable: boolean;
  billingRate: string;
  billingAmount: string;
  description: string | null;
  salesInvoiceItemId: string | null;
  project: { id: string; name: string; projectName: string };
  task: { id: string; subject: string } | null;
}
interface ItemRow {
  id: string;
  itemCode: string;
  itemName: string;
  isStockItem: boolean;
}
interface Timesheet {
  id: string;
  name: string;
  weekStartDate: string;
  totalHours: string;
  totalBillableHours: string;
  totalBillingAmount: string;
  status: string;
  notes: string | null;
  employee: { id: string; employeeCode: string; employeeName: string };
  lines: Line[];
}

export default function TimesheetDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Timesheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showBill, setShowBill] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [billItemId, setBillItemId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [billed, setBilled] = useState<{ id: string; name: string }[] | null>(null);

  async function load() {
    try {
      setData(await api.get<Timesheet>(`/timesheets/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/timesheets/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this timesheet? Task hours will be reversed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/timesheets/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function openBill() {
    setShowBill(true);
    setBilled(null);
    if (items.length === 0) {
      try {
        setItems(await api.get<ItemRow[]>("/items"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load items");
      }
    }
  }

  async function bill(e: React.FormEvent) {
    e.preventDefault();
    if (!billItemId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ invoices: { id: string; name: string }[] }>(
        `/timesheets/${params.id}/convert-to-invoice`,
        {
          itemId: billItemId,
          postingDate: new Date(billDate).toISOString(),
        },
      );
      setBilled(result.invoices);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Billing failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Timesheets", href: "/projects/timesheets" }]}
          title="Timesheet"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Timesheets", href: "/projects/timesheets" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </>
    );
  }

  const lineColumns: Column<Line>[] = [
    { header: "Date", cell: (l) => <span className="text-xs">{dateShort(l.date)}</span> },
    {
      header: "Project",
      cell: (l) => (
        <a
          href={`/projects/projects/${l.project.id}`}
          className="text-brand-600 hover:underline"
        >
          {l.project.projectName}
        </a>
      ),
    },
    { header: "Task", cell: (l) => <span className="text-sm">{l.task?.subject ?? "—"}</span> },
    {
      header: "Hours",
      align: "right",
      cell: (l) => <span className="tabular-nums">{Number(l.hours).toFixed(2)}</span>,
    },
    {
      header: "Rate",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums text-xs">
          {l.isBillable ? Number(l.billingRate).toFixed(2) : "—"}
        </span>
      ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (l) => (
        <span className="tabular-nums">
          {l.isBillable ? Number(l.billingAmount).toFixed(2) : "—"}
          {l.salesInvoiceItemId && (
            <span className="ms-1 text-[10px] text-green-700">✓ billed</span>
          )}
        </span>
      ),
    },
    {
      header: "Description",
      cell: (l) => <span className="text-xs text-ink-soft">{l.description ?? "—"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Timesheets", href: "/projects/timesheets" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={
          <span className="flex items-center gap-3">
            <StatusBadge status={data.status} />
            <span className="text-ink-soft">
              {data.employee.employeeName}{" "}
              <span className="text-xs font-mono text-ink-muted">
                ({data.employee.employeeCode})
              </span>
            </span>
            <span className="text-ink-muted text-xs">
              week of {dateShort(data.weekStartDate)}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {data.status === "Draft" && (
              <Button variant="primary" onClick={submit} disabled={busy} type="button">
                Submit
              </Button>
            )}
            {data.status === "Submitted" &&
              data.lines.some((l) => l.isBillable && !l.salesInvoiceItemId) && (
                <Button variant="brand" onClick={openBill} disabled={busy} type="button">
                  Bill →
                </Button>
              )}
            {data.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div>
        <WorkflowActions doctype="Timesheet" docId={data.id} onChange={load} />
      </div>

      {showBill && (
        <Card className="p-4 max-w-lg space-y-3">
          <CardHeader
            title="Generate sales invoices"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBill(false)}
                type="button"
              >
                Close
              </Button>
            }
          />
          {billed ? (
            <div className="text-sm space-y-2">
              <div className="text-green-700">
                Created {billed.length} invoice{billed.length > 1 ? "s" : ""}:
              </div>
              <ul className="space-y-1">
                {billed.map((inv) => (
                  <li key={inv.id}>
                    <a
                      href={`/accounting/sales-invoices/${inv.id}`}
                      className="text-brand-600 hover:underline font-mono"
                    >
                      {inv.name}
                    </a>
                    <span className="text-xs text-ink-muted ms-2">
                      (open in Accounting to submit)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <form onSubmit={bill} className="space-y-3">
              <FormField
                label="Service item"
                hint="Used on every generated SI line. Non-stock service items work best (e.g. Consulting hours)."
              >
                <select
                  required
                  className="input"
                  value={billItemId}
                  onChange={(e) => setBillItemId(e.target.value)}
                >
                  <option value="">Select an item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemCode} — {it.itemName}
                      {it.isStockItem ? " (stock item)" : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Posting date">
                <input
                  type="date"
                  required
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="input"
                />
              </FormField>
              <Button
                variant="brand"
                type="submit"
                disabled={busy || !billItemId}
              >
                {busy ? "Generating…" : "Generate"}
              </Button>
              <div className="text-xs text-ink-muted">
                One draft SI per unique customer will be created. Lines are grouped
                by project; hours = sum, rate = weighted avg. Billable lines that
                are already invoiced will be skipped.
              </div>
            </form>
          )}
        </Card>
      )}

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Total hours
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">
            {Number(data.totalHours).toFixed(2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Billable hours
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">
            {Number(data.totalBillableHours).toFixed(2)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            Billing amount
          </div>
          <div className="text-2xl font-semibold text-ink tabular-nums mt-0.5">
            {money(Number(data.totalBillingAmount))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Lines" />
        <div className="hidden md:block">
          <DataTable<Line>
            columns={lineColumns}
            rows={data.lines}
            rowKey={(l) => l.id}
            empty={{ title: "No lines yet" }}
          />
        </div>
        {data.lines.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No lines yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.lines.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{l.project.projectName}</div>
                    <div className="text-xs text-ink-muted">
                      {dateShort(l.date)}
                      {l.task && ` · ${l.task.subject}`}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="font-mono text-ink tabular-nums">
                      {Number(l.hours).toFixed(2)}h
                    </div>
                    {l.isBillable && (
                      <div className="text-xs text-ink-muted tabular-nums">
                        {Number(l.billingAmount).toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
                {l.description && (
                  <div className="mt-1 text-xs text-ink-muted">{l.description}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.notes && (
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1">
            Notes
          </div>
          <div className="whitespace-pre-wrap text-sm text-ink">{data.notes}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Timesheet" docId={data.id} />
        <CommentsPanel
          doctype="Timesheet"
          docId={data.id}
          currentUserId={currentUserId()}
        />
      </section>
    </>
  );
}
