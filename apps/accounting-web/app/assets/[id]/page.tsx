"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../../components/ui";

interface Account { id: string; accountName: string; rootType: string; isGroup: boolean }
interface ScheduleRow {
  id: string;
  installmentNo: number;
  dueDate: string;
  amount: string;
  balanceAfter: string;
  isBooked: boolean;
  bookedAt: string | null;
}
interface MaintenanceLog {
  id: string;
  date: string;
  maintenanceType: string;
  cost: string;
  performedBy: string | null;
  notes: string | null;
}
interface Asset {
  id: string;
  assetCode: string;
  assetName: string;
  status: string;
  purchaseDate: string;
  purchasePrice: string;
  salvageValue: string;
  usefulLifeMonths: number;
  currentValue: string;
  location: string | null;
  notes: string | null;
  category: {
    id: string;
    categoryName: string;
    assetAccount: { id: string; accountName: string };
    accumDepreciationAccount: { id: string; accountName: string };
    depExpenseAccount: { id: string; accountName: string };
  };
  schedule: ScheduleRow[];
  maintenanceLogs: MaintenanceLog[];
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Asset | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMaint, setShowMaint] = useState(false);
  const [maintForm, setMaintForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    maintenanceType: "Preventive",
    cost: 0,
    performedBy: "",
    notes: "",
  });

  async function load() {
    try {
      const [asset, accs] = await Promise.all([
        api.get<Asset>(`/assets/${params.id}`),
        api.get<Account[]>("/accounts"),
      ]);
      setData(asset);
      setAccounts(accs.filter((a) => !a.isGroup));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    if (!data) return;
    const acqId = prompt(
      "Also post acquisition GL entry? Enter Cash/Bank/Creditors account ID (blank = skip):",
      "",
    );
    setBusy(true);
    setError(null);
    try {
      await api.post(`/assets/${data.id}/submit`, {
        acquisitionAccountId: acqId || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function bookOne(inst: ScheduleRow) {
    const date = prompt(
      `Post date for installment ${inst.installmentNo}:`,
      inst.dueDate.slice(0, 10),
    );
    if (!date) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/assets/${params.id}/book-depreciation`, {
        installmentNo: inst.installmentNo,
        postingDate: new Date(date).toISOString(),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function bookAllDueThroughToday() {
    if (!data) return;
    const now = Date.now();
    const due = data.schedule.filter(
      (s) => !s.isBooked && new Date(s.dueDate).getTime() <= now,
    );
    if (due.length === 0) { showToast("Nothing due to book.", "info"); return; }
    if (!confirm(`Book ${due.length} installment${due.length > 1 ? "s" : ""} due through today?`))
      return;
    setBusy(true);
    setError(null);
    try {
      for (const inst of due) {
        await api.post(`/assets/${params.id}/book-depreciation`, {
          installmentNo: inst.installmentNo,
          postingDate: inst.dueDate,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function scrap() {
    if (!data) return;
    const date = prompt("Scrap date:", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const proceeds = prompt("Proceeds received (0 if none):", "0");
    if (proceeds === null) return;
    const proceedsN = Number(proceeds);
    let procAcct: string | null = null;
    if (proceedsN > 0) {
      procAcct = prompt("Cash/Bank account ID for proceeds:", "") || null;
      if (!procAcct) return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/assets/${params.id}/scrap`, {
        postingDate: new Date(date).toISOString(),
        proceedsAmount: proceedsN,
        proceedsAccountId: procAcct,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel this draft asset?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/assets/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function createMaint(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/asset-maintenance-logs", {
        assetId: data.id,
        date: new Date(maintForm.date).toISOString(),
        maintenanceType: maintForm.maintenanceType,
        cost: maintForm.cost,
        performedBy: maintForm.performedBy || null,
        notes: maintForm.notes || null,
      });
      setMaintForm({
        date: new Date().toISOString().slice(0, 10),
        maintenanceType: "Preventive",
        cost: 0,
        performedBy: "",
        notes: "",
      });
      setShowMaint(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Assets", href: "/accounting/assets" }]}
          title="Asset"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
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
          breadcrumb={[{ label: "Assets", href: "/accounting/assets" }]}
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

  const bookedTotal = data.schedule
    .filter((s) => s.isBooked)
    .reduce((s, r) => s + Number(r.amount), 0);
  const dueThroughToday = data.schedule.filter(
    (s) => !s.isBooked && new Date(s.dueDate).getTime() <= Date.now(),
  ).length;

  const subtitleParts = [data.category.categoryName, data.location].filter(Boolean);

  const scheduleCols: Column<ScheduleRow>[] = [
    { header: "#", width: "64px", cell: (s) => <span className="font-mono">{s.installmentNo}</span> },
    { header: "Due", cell: (s) => <span className="text-ink-soft">{dateShort(s.dueDate)}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (s) => <span className="font-mono tabular-nums">{money(Number(s.amount))}</span>,
    },
    {
      header: "Balance after",
      align: "right",
      cell: (s) => <span className="font-mono tabular-nums">{money(Number(s.balanceAfter))}</span>,
    },
    {
      header: "Booked",
      cell: (s) =>
        s.isBooked ? (
          <span className="badge-green">{s.bookedAt ? dateShort(s.bookedAt) : "booked"}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (s) =>
        !s.isBooked && data.status === "Depreciating" ? (
          <Button variant="secondary" size="sm" onClick={() => bookOne(s)} disabled={busy} type="button">
            Book…
          </Button>
        ) : null,
    },
  ];

  const maintCols: Column<MaintenanceLog>[] = [
    { header: "Date", cell: (l) => dateShort(l.date) },
    { header: "Type", cell: (l) => l.maintenanceType },
    {
      header: "Cost",
      align: "right",
      cell: (l) => <span className="font-mono tabular-nums">{money(Number(l.cost))}</span>,
    },
    { header: "Performed by", cell: (l) => l.performedBy ?? "—" },
    { header: "Notes", cell: (l) => <span className="text-ink-soft">{l.notes ?? "—"}</span> },
  ];

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "Assets", href: "/accounting/assets" },
          { label: data.assetName },
        ]}
        title={data.assetName}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            <span className="font-mono text-ink-muted">{data.assetCode}</span>
            {subtitleParts.length > 0 && <span>· {subtitleParts.join(" · ")}</span>}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {data.status === "Draft" && (
              <>
                <Button variant="primary" onClick={submit} disabled={busy} type="button">
                  Submit
                </Button>
                <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                  Cancel
                </Button>
              </>
            )}
            {data.status === "Depreciating" && dueThroughToday > 0 && (
              <Button
                variant="primary"
                onClick={bookAllDueThroughToday}
                disabled={busy}
                type="button"
                title={`Book ${dueThroughToday} installment(s) whose due date is today or earlier`}
              >
                Book due ({dueThroughToday})
              </Button>
            )}
            {(data.status === "Depreciating" || data.status === "FullyDepreciated") && (
              <Button variant="danger" onClick={scrap} disabled={busy} type="button">
                Scrap
              </Button>
            )}
          </>
        }
      />

      <WorkflowActions doctype="Asset" docId={data.id} onChange={load} />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <section className="grid grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Purchase</div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(Number(data.purchasePrice))}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">{dateShort(data.purchaseDate)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Book value</div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(Number(data.currentValue))}
          </div>
          <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
            salvage {money(Number(data.salvageValue))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Depreciated</div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {money(bookedTotal)}
          </div>
          <div className="text-xs text-ink-muted mt-0.5">
            {data.schedule.filter((s) => s.isBooked).length} / {data.schedule.length} booked
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Life</div>
          <div className="font-semibold text-lg text-ink mt-0.5 tabular-nums">
            {data.usefulLifeMonths} mo
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title="Depreciation schedule" />
        {data.schedule.length === 0 ? (
          <Card className="p-6">
            <EmptyState title="No schedule yet" description="Submit to generate one." />
          </Card>
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<ScheduleRow>
                columns={scheduleCols}
                rows={data.schedule}
                rowKey={(s) => s.id}
              />
            </div>
            <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
              {data.schedule.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink">#{s.installmentNo}</div>
                      <div className="text-xs text-ink-muted">Due {dateShort(s.dueDate)}</div>
                    </div>
                    <div className="text-end">
                      <div className="font-mono text-ink tabular-nums">{Number(s.amount).toFixed(2)}</div>
                      <div className="text-xs text-ink-muted tabular-nums">
                        Balance {Number(s.balanceAfter).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs">
                    {s.isBooked ? (
                      <span className="text-green-700">Booked {s.bookedAt && `· ${dateShort(s.bookedAt)}`}</span>
                    ) : (
                      <span className="text-ink-muted">Pending</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <SectionHeader
          title="Maintenance log"
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMaint((s) => !s)}
              type="button"
            >
              {showMaint ? "Cancel" : "+ Log maintenance"}
            </Button>
          }
        />
        {showMaint && (
          <Card className="p-4 mb-3 max-w-xl">
            <form onSubmit={createMaint} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <FormField label="Date" required>
                  <input
                    type="date"
                    required
                    className="input"
                    value={maintForm.date}
                    onChange={(e) => setMaintForm({ ...maintForm, date: e.target.value })}
                  />
                </FormField>
                <FormField label="Type">
                  <select
                    className="input"
                    value={maintForm.maintenanceType}
                    onChange={(e) => setMaintForm({ ...maintForm, maintenanceType: e.target.value })}
                  >
                    <option>Preventive</option>
                    <option>Corrective</option>
                    <option>Calibration</option>
                    <option>Inspection</option>
                  </select>
                </FormField>
                <FormField label="Cost">
                  <input
                    type="number"
                    step="any"
                    min={0}
                    className="input"
                    value={maintForm.cost}
                    onChange={(e) => setMaintForm({ ...maintForm, cost: Number(e.target.value) })}
                  />
                </FormField>
              </div>
              <FormField label="Performed by">
                <input
                  className="input"
                  placeholder="Optional"
                  value={maintForm.performedBy}
                  onChange={(e) => setMaintForm({ ...maintForm, performedBy: e.target.value })}
                />
              </FormField>
              <FormField label="Notes">
                <textarea
                  className="input"
                  placeholder="Optional"
                  value={maintForm.notes}
                  onChange={(e) => setMaintForm({ ...maintForm, notes: e.target.value })}
                />
              </FormField>
              <Button variant="primary" type="submit" disabled={busy}>
                Save
              </Button>
            </form>
          </Card>
        )}
        <div className="hidden md:block">
          <DataTable<MaintenanceLog>
            columns={maintCols}
            rows={data.maintenanceLogs}
            rowKey={(l) => l.id}
            empty={{ title: "No maintenance logged" }}
          />
        </div>
        {data.maintenanceLogs.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No maintenance logged
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.maintenanceLogs.map((l) => (
              <li key={l.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{l.maintenanceType}</div>
                    <div className="text-xs text-ink-muted">
                      {dateShort(l.date)}
                      {l.performedBy && ` · ${l.performedBy}`}
                    </div>
                  </div>
                  <div className="font-mono text-ink tabular-nums text-end">
                    {Number(l.cost).toFixed(2)}
                  </div>
                </div>
                {l.notes && <div className="mt-1 text-xs text-ink-muted">{l.notes}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="p-4">
        <SectionHeader title="GL accounts for this category" />
        <div className="grid grid-cols-3 gap-4">
          <Field label="Asset" value={data.category.assetAccount.accountName} />
          <Field label="Accum. Depreciation" value={data.category.accumDepreciationAccount.accountName} />
          <Field label="Depreciation Expense" value={data.category.depExpenseAccount.accountName} />
        </div>
        <div className="mt-3 text-xs text-ink-muted">
          ({accounts.length} tenant accounts available for reference)
        </div>
      </Card>

      {data.notes && (
        <Card className="p-4">
          <SectionHeader title="Notes" />
          <div className="whitespace-pre-wrap text-sm text-ink">{data.notes}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="Asset" docId={data.id} />
        <CommentsPanel
          doctype="Asset"
          docId={data.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
