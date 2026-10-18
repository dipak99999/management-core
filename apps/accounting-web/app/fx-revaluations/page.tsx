"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Line {
  kind: "AR" | "AP";
  docId: string;
  docName: string;
  currency: string;
  outstandingFx: number;
  originalRate: number;
  currentRate: number;
  oldBaseValue: number;
  newBaseValue: number;
  delta: number;
}
interface Summary {
  lines: Line[];
  totals: { arDelta: number; apDelta: number; netFxGainLoss: number };
  skipped: { baseCurrencyDocs: number; missingRate: string[] };
}
interface Run {
  id: string;
  asOfDate: string;
  status: string;
  ratesJson: Array<{ currency: string; rate: number }>;
  summaryJson: Summary;
  journalEntryId: string | null;
  journalEntry: { name: string; status: string } | null;
  createdAt: string;
  committedAt: string | null;
}

interface Rate {
  currency: string;
  rate: string;
}

// Module 57 — FX Revaluation UI.
// Two-stage flow: preview (rate input → summary card with per-doc lines)
// → commit (posts the balancing JE). Preview rows persist even if not
// committed for audit.
export default function FxRevaluationsPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [rates, setRates] = useState<Rate[]>([{ currency: "USD", rate: "" }]);

  async function load() {
    setLoading(true);
    try {
      setRuns(await api.get<Run[]>("/fx-revaluations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Fx Revaluation",
    plural: "Fx Revaluations",
    refresh: load,
  });

  async function preview(e: React.FormEvent) {
    e.preventDefault();
    if (rates.some((r) => !r.currency || !r.rate)) {
      setError("Every rate needs a 3-letter currency + numeric rate");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await api.post<{ run: Run; summary: Summary }>(
        "/fx-revaluations/preview",
        {
          asOfDate: new Date(asOfDate).toISOString(),
          rates: rates.map((x) => ({ currency: x.currency.toUpperCase(), rate: Number(x.rate) })),
        },
      );
      setShowForm(false);
      setSelectedRun(r.run);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit(run: Run) {
    if (!confirm(`Commit this revaluation? Posts a Submitted JE dated ${dateShort(run.asOfDate)} with the net FX gain/loss.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ journalEntry: { name: string } }>(
        `/fx-revaluations/${run.id}/commit`,
        {},
      );
      setInfo(`Posted ${r.journalEntry.name}`);
      setSelectedRun(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setBusy(false);
    }
  }

  async function discard(run: Run, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Discard this preview? Non-reversible; a new preview must be re-run.")) return;
    try {
      await api.post(`/fx-revaluations/${run.id}/discard`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Run>[] = [
    {
      header: "As of",
      cell: (r) => (
        <button className="text-start" onClick={() => setSelectedRun(r)}>
          <span className="font-medium text-brand-600 hover:underline">{dateShort(r.asOfDate)}</span>
        </button>
      ),
    },
    {
      header: "Currencies",
      cell: (r) => (
        <span className="text-xs font-mono text-ink-muted">
          {r.ratesJson.map((x) => `${x.currency}=${x.rate}`).join(" · ")}
        </span>
      ),
    },
    {
      header: "Net gain/loss",
      align: "right",
      cell: (r) => {
        const n = r.summaryJson?.totals?.netFxGainLoss ?? 0;
        return (
          <span className={`font-mono ${n > 0 ? "text-green-700" : n < 0 ? "text-red-700" : ""}`}>
            {n > 0 ? "+" : ""}{n.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        );
      },
    },
    {
      header: "Lines",
      align: "right",
      cell: (r) => <span className="font-mono text-xs">{r.summaryJson?.lines?.length ?? 0}</span>,
    },
    {
      header: "JE",
      cell: (r) => (
        <span className="text-xs font-mono text-ink-muted">
          {r.journalEntry?.name ?? "—"}
        </span>
      ),
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        r.status === "Preview" ? (
          <button onClick={(e) => discard(r, e)} className="btn-ghost btn-sm text-red-600">Discard</button>
        ) : null
      ),
    },
  ];

  const summary = selectedRun?.summaryJson;

  return (
    <>
      <PageHeader
        title="FX Revaluation"
        subtitle="Mark-to-market open FX-denominated AR/AP at period end. Posts a Submitted JE with the balancing FX gain/loss."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New revaluation</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <DataTable
        columns={columns}
        rows={runs}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{
          icon: Icon.cash,
          title: "No revaluations yet",
          description: "Run one at period end to mark-to-market your foreign-currency AR + AP.",
          action: <Button variant="brand" onClick={() => setShowForm(true)}>+ New revaluation</Button>,
        }}
      />

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Preview FX revaluation"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => preview(e as unknown as React.FormEvent)} disabled={busy}>
              {busy ? "Computing…" : "Preview"}
            </Button>
          </>
        }
      >
        <form onSubmit={preview} className="space-y-4">
          <FormField label="As-of date" required>
            <input type="date" className="input" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} required />
          </FormField>
          <FormField label="Spot rates (foreign → base)" required>
            <div className="space-y-2">
              {rates.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[80px_1fr_auto] gap-2">
                  <input
                    className="input font-mono uppercase"
                    placeholder="USD"
                    maxLength={3}
                    value={r.currency}
                    onChange={(e) => {
                      const next = [...rates];
                      next[idx] = { ...r, currency: e.target.value };
                      setRates(next);
                    }}
                  />
                  <input
                    type="number"
                    step="0.0001"
                    className="input font-mono"
                    placeholder="85.0000"
                    value={r.rate}
                    onChange={(e) => {
                      const next = [...rates];
                      next[idx] = { ...r, rate: e.target.value };
                      setRates(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-red-600"
                    onClick={() => setRates(rates.filter((_, i) => i !== idx))}
                    disabled={rates.length <= 1}
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setRates([...rates, { currency: "", rate: "" }])}
              >+ Add currency</button>
            </div>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={selectedRun !== null}
        onClose={() => setSelectedRun(null)}
        title={selectedRun ? `Revaluation ${dateShort(selectedRun.asOfDate)}` : ""}
        footer={
          selectedRun?.status === "Preview" ? (
            <>
              <Button variant="secondary" onClick={() => setSelectedRun(null)}>Close</Button>
              <Button variant="brand" onClick={() => commit(selectedRun)} disabled={busy || summary?.lines.length === 0}>
                {busy ? "Committing…" : "Commit + post JE"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setSelectedRun(null)}>Close</Button>
          )
        }
      >
        {summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <SummaryCard label="AR Δ" value={summary.totals.arDelta} />
              <SummaryCard label="AP Δ" value={summary.totals.apDelta} />
              <SummaryCard label="Net gain/loss" value={summary.totals.netFxGainLoss} highlight />
            </div>

            {summary.skipped.missingRate.length > 0 && (
              <Card className="p-2 border-amber-200 bg-amber-50 text-xs text-amber-800">
                Missing rate for: {summary.skipped.missingRate.join(", ")} — those docs were skipped.
              </Card>
            )}

            <div>
              <div className="text-xs uppercase tracking-wide text-ink-muted mb-1">
                {summary.lines.length} line{summary.lines.length === 1 ? "" : "s"}
              </div>
              <table className="table text-xs">
                <thead>
                  <tr>
                    <th>Doc</th>
                    <th className="text-end">FX outstanding</th>
                    <th className="text-end">Old rate</th>
                    <th className="text-end">New rate</th>
                    <th className="text-end">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((l) => (
                    <tr key={l.docId}>
                      <td>
                        <span className="badge text-xs me-1">{l.kind}</span>
                        <span className="font-mono">{l.docName}</span>
                      </td>
                      <td className="text-end font-mono">{l.outstandingFx.toFixed(2)} {l.currency}</td>
                      <td className="text-end font-mono text-ink-muted">{l.originalRate}</td>
                      <td className="text-end font-mono">{l.currentRate}</td>
                      <td className={`text-end font-mono ${l.delta > 0 ? "text-green-700" : "text-red-700"}`}>
                        {l.delta > 0 ? "+" : ""}{l.delta.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.lines.length === 0 && (
                <div className="p-4 text-sm text-ink-muted italic text-center">
                  No non-zero deltas. Nothing to post.
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const cls = value > 0 ? "text-green-700" : value < 0 ? "text-red-700" : "text-ink-muted";
  return (
    <div className={`border rounded p-2 ${highlight ? "border-brand-300 bg-brand-50" : "border-line"}`}>
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`font-mono font-medium mt-0.5 ${cls}`}>
        {value > 0 ? "+" : ""}{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
    </div>
  );
}
