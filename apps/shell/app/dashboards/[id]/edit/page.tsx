"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toast,
  type Column,
} from "../../../../components/ui";

interface Card_ {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  config: Record<string, unknown>;
  gridCol: number;
  gridRow: number;
  gridWidth: number;
  gridHeight: number;
  sortOrder: number;
}

interface Dashboard {
  id: string;
  name: string;
  cards: Card_[];
}

interface DoctypeMeta {
  doctype: string;
  label: string;
  columns: { key: string; label: string; type: string }[];
  filterableFields: string[];
  sortableFields: string[];
}

interface SavedReport {
  id: string;
  name: string;
  doctype: string;
}

const KINDS = ["KPI", "BarChart", "LineChart", "PieChart", "SavedReport", "Text"] as const;
type Kind = (typeof KINDS)[number];

export default function DashboardEditPage() {
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<Dashboard | null>(null);
  const [meta, setMeta] = useState<DoctypeMeta[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-card form state
  const [kind, setKind] = useState<Kind>("KPI");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [width, setWidth] = useState(4);
  const [doctype, setDoctype] = useState("");
  const [aggregate, setAggregate] = useState<"count" | "sum" | "avg">("count");
  const [field, setField] = useState("");
  const [dateField, setDateField] = useState("");
  const [period, setPeriod] = useState<"" | "today" | "last7" | "last30" | "mtd" | "qtd" | "ytd">("mtd");
  const [showDelta, setShowDelta] = useState(true);
  const [groupBy, setGroupBy] = useState("");
  const [savedReportId, setSavedReportId] = useState("");
  const [textBody, setTextBody] = useState("");

  async function load() {
    try {
      const [dash, m, s] = await Promise.all([
        dashboardApi.get<Dashboard>(`/dashboards/${params.id}`),
        dashboardApi.get<{ doctypes: DoctypeMeta[] }>("/reports-builder/meta"),
        dashboardApi.get<SavedReport[]>("/reports-builder/saved"),
      ]);
      setD(dash);
      setMeta(m.doctypes);
      setSaved(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const selectedMeta = meta.find((m) => m.doctype === doctype);

  function buildConfig(): Record<string, unknown> {
    if (kind === "KPI") {
      return {
        kind: "KPI",
        doctype,
        aggregate,
        field: aggregate === "count" ? undefined : field,
        dateField: dateField || undefined,
        period: period || undefined,
        showDelta,
      };
    }
    if (kind === "BarChart" || kind === "LineChart" || kind === "PieChart") {
      return {
        kind,
        doctype,
        aggregate,
        field: aggregate === "count" ? undefined : field,
        groupBy,
        dateField: dateField || undefined,
        period: period || undefined,
        limit: 12,
      };
    }
    if (kind === "SavedReport") {
      return { kind: "SavedReport", savedReportId };
    }
    if (kind === "Text") {
      return { kind: "Text", body: textBody };
    }
    return {};
  }

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post(`/dashboards/${params.id}/cards`, {
        kind,
        title,
        subtitle: subtitle || null,
        config: buildConfig(),
        gridWidth: width,
        sortOrder: (d?.cards.length ?? 0) + 1,
      });
      setTitle("");
      setSubtitle("");
      setTextBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(cardId: string) {
    if (!confirm("Delete card?")) return;
    try {
      await dashboardApi.delete(`/dashboards/${params.id}/cards/${cardId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const breadcrumb = [
    { label: "Dashboards", href: "/dashboards" },
    { label: d?.name ?? "Dashboard", href: `/dashboards/${params.id}` },
    { label: "Edit" },
  ];

  if (error && !d) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Edit dashboard"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }

  if (!d) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading…" />
        <Skeleton className="h-96" rounded="rounded-lg" />
      </AppShell>
    );
  }

  const columns: Column<Card_>[] = [
    {
      header: "Title",
      cell: (c) => (
        <>
          <span className="text-ink font-medium">{c.title}</span>
          {c.subtitle && (
            <span className="text-xs text-ink-muted"> — {c.subtitle}</span>
          )}
        </>
      ),
    },
    { header: "Kind", cell: (c) => <span className="text-xs text-ink-soft">{c.kind}</span> },
    {
      header: "Width",
      align: "right",
      cell: (c) => <span className="tabular-nums text-xs text-ink-soft">{c.gridWidth}/12</span>,
    },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <button
          onClick={() => del(c.id)}
          className="text-xs text-red-600 hover:underline"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={`Edit: ${d.name}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <a href={`/dashboards/${params.id}`}>
              <Button variant="secondary" type="button">View dashboard</Button>
            </a>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-4xl space-y-6">
        <Card className="p-4">
          <SectionHeader title="Add card" />
          <form onSubmit={addCard} className="space-y-3">
            <div className="grid grid-cols-4 gap-2">
              <FormField label="Kind">
                <select
                  className="input"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                >
                  {KINDS.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </FormField>
              <div className="col-span-2">
                <FormField label="Title" required>
                  <input
                    className="input"
                    placeholder="Card title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </FormField>
              </div>
              <FormField label="Width">
                <select
                  className="input"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                >
                  {[2, 3, 4, 6, 8, 12].map((w) => (
                    <option key={w} value={w}>
                      {w} / 12
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label="Subtitle">
              <input
                className="input"
                placeholder="Subtitle (opt)"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </FormField>

            {(kind === "KPI" || kind === "BarChart" || kind === "LineChart" || kind === "PieChart") && (
              <div className="grid grid-cols-3 gap-2">
                <select
                  className="input"
                  value={doctype}
                  onChange={(e) => setDoctype(e.target.value)}
                  required
                >
                  <option value="">Doctype…</option>
                  {meta.map((m) => (
                    <option key={m.doctype} value={m.doctype}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={aggregate}
                  onChange={(e) => setAggregate(e.target.value as "count" | "sum" | "avg")}
                >
                  <option value="count">count</option>
                  <option value="sum">sum</option>
                  <option value="avg">avg</option>
                </select>
                {aggregate !== "count" && (
                  <select
                    className="input"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                    required
                  >
                    <option value="">Field…</option>
                    {selectedMeta?.columns
                      .filter((c) => c.type === "number")
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                  </select>
                )}
                <select
                  className="input"
                  value={dateField}
                  onChange={(e) => setDateField(e.target.value)}
                >
                  <option value="">No period (all-time)</option>
                  {selectedMeta?.columns
                    .filter((c) => c.type === "date")
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        Period on {c.label}
                      </option>
                    ))}
                </select>
                {dateField && (
                  <select
                    className="input"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as typeof period)}
                  >
                    <option value="today">Today</option>
                    <option value="last7">Last 7 days</option>
                    <option value="last30">Last 30 days</option>
                    <option value="mtd">Month-to-date</option>
                    <option value="qtd">Quarter-to-date</option>
                    <option value="ytd">Year-to-date</option>
                  </select>
                )}
                {kind === "KPI" && (
                  <label className="text-sm flex items-center text-ink-soft">
                    <input
                      type="checkbox"
                      className="me-1"
                      checked={showDelta}
                      onChange={(e) => setShowDelta(e.target.checked)}
                    />
                    Show delta vs prev period
                  </label>
                )}
                {(kind === "BarChart" || kind === "LineChart" || kind === "PieChart") && (
                  <select
                    className="input"
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value)}
                    required
                  >
                    <option value="">Group by…</option>
                    {selectedMeta?.columns
                      .filter((c) => !c.key.includes("."))
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}

            {kind === "SavedReport" && (
              <FormField label="Saved report">
                <select
                  className="input"
                  value={savedReportId}
                  onChange={(e) => setSavedReportId(e.target.value)}
                  required
                >
                  <option value="">Choose a saved report…</option>
                  {saved.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.doctype})
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            {kind === "Text" && (
              <FormField label="Text body">
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Free-form text"
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  required
                />
              </FormField>
            )}

            <Button variant="brand" disabled={busy} type="submit">
              {busy ? "Adding…" : "Add card"}
            </Button>
          </form>
        </Card>

        <section>
          <SectionHeader title="Existing cards" />
          <DataTable
            columns={columns}
            rows={d.cards}
            rowKey={(c) => c.id}
            empty={{ title: "No cards yet" }}
          />
        </section>
      </div>
    </AppShell>
  );
}
