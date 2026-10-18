"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  Segmented,
  Toast,
  dateShort,
} from "../../components/ui";

type Doctype = "Customer" | "Supplier" | "Item";

interface Pair {
  id: string;
  doctype: string;
  score: number;
  breakdown: { name: number; email: number; gstin: number; pan: number; phone: number };
  status: string;
  scannedAt: string;
  left: Record<string, unknown> | null;
  right: Record<string, unknown> | null;
}

// Module 55 — Duplicate review UI.
//
// Doctype tabs → list of pending pairs sorted by score. Each pair
// renders a side-by-side compare card; operator picks "Keep left" or
// "Keep right" to merge, or Dismiss/Snooze if it's a false positive.
export default function DuplicatesPage() {
  const [doctype, setDoctype] = useState<Doctype>("Customer");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPairs(await api.get<Pair[]>(`/duplicates/pairs?doctype=${doctype}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [doctype]);
  useEffect(() => { load(); }, [load]);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const r = await api.post<{ candidatesScanned: number; pairsFound: number; pairsUpserted: number }>(
        "/duplicates/scan",
        { doctype, threshold: 70 },
      );
      setInfo(`Scanned ${r.candidatesScanned} ${doctype.toLowerCase()}s · ${r.pairsFound} pair(s) at threshold 70`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function merge(pair: Pair, keeperKey: "left" | "right") {
    const keeper = keeperKey === "left" ? pair.left : pair.right;
    const merged = keeperKey === "left" ? pair.right : pair.left;
    if (!keeper || !merged) return;
    const keeperName = pickDisplayName(doctype, keeper);
    const mergedName = pickDisplayName(doctype, merged);
    if (!confirm(`Merge "${mergedName}" INTO "${keeperName}"?\n\nAll FK references to "${mergedName}" will be re-pointed to "${keeperName}", and "${mergedName}" will be deleted. This is audited but hard to reverse.`)) return;

    setBusy(pair.id);
    setError(null);
    try {
      const r = await api.post<{ fkCounts: Record<string, number> }>("/duplicates/merge", {
        doctype,
        keeperId: keeper.id as string,
        mergedId: merged.id as string,
      });
      const total = Object.values(r.fkCounts).reduce((s, n) => s + n, 0);
      setInfo(`Merged: ${total} FK reference(s) re-pointed across ${Object.keys(r.fkCounts).length} table(s).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(pair: Pair) {
    if (!confirm("Mark this pair as NOT a duplicate?")) return;
    try {
      await api.post(`/duplicates/${pair.id}/dismiss`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function snooze(pair: Pair) {
    try {
      await api.post(`/duplicates/${pair.id}/snooze`, { days: 30 });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Duplicate Detection"
        subtitle="Find + merge likely-duplicate Customers, Suppliers, and Items. Fuzzy name + exact GSTIN/email matching."
        actions={<Button variant="brand" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "Rescan"}</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <div className="mb-4">
        <Segmented
          value={doctype}
          onChange={(v) => setDoctype(v as Doctype)}
          options={[
            { value: "Customer", label: "Customers" },
            { value: "Supplier", label: "Suppliers" },
            { value: "Item", label: "Items" },
          ]}
        />
      </div>

      {loading && <Card className="p-6 text-center text-ink-muted">Loading…</Card>}
      {!loading && pairs.length === 0 && (
        <Card className="p-8 text-center text-ink-muted">
          <div className="font-medium text-ink mb-1">No pending duplicates</div>
          <div className="text-sm">Click Rescan to look for candidate pairs above the 70% threshold.</div>
        </Card>
      )}

      <div className="space-y-3">
        {pairs.map((pair) => (
          <Card key={pair.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className={`font-mono font-semibold text-lg ${pair.score >= 85 ? "text-red-600" : pair.score >= 70 ? "text-amber-600" : "text-brand-600"}`}>
                  {pair.score}%
                </span>
                <span className="text-xs text-ink-muted">
                  scanned {dateShort(pair.scannedAt)}
                </span>
                <span className="text-xs text-ink-muted">
                  name: {pair.breakdown.name}% · email: {pair.breakdown.email}% · gstin: {pair.breakdown.gstin}%
                  {pair.breakdown.phone > 0 && ` · phone: ${pair.breakdown.phone}%`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => snooze(pair)} className="btn-ghost btn-sm">Snooze 30d</button>
                <button onClick={() => dismiss(pair)} className="btn-ghost btn-sm text-red-600">Not a dup</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <RowCard
                doctype={doctype}
                row={pair.left}
                onKeep={() => merge(pair, "left")}
                disabled={busy === pair.id}
              />
              <RowCard
                doctype={doctype}
                row={pair.right}
                onKeep={() => merge(pair, "right")}
                disabled={busy === pair.id}
              />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function pickDisplayName(doctype: Doctype, row: Record<string, unknown>): string {
  const keys: Record<Doctype, string> = {
    Customer: "customerName",
    Supplier: "supplierName",
    Item: "itemName",
  };
  return String(row[keys[doctype]] ?? row.name ?? "(unnamed)");
}

function RowCard({
  doctype,
  row,
  onKeep,
  disabled,
}: {
  doctype: Doctype;
  row: Record<string, unknown> | null;
  onKeep: () => void;
  disabled: boolean;
}) {
  if (!row) {
    return <div className="border border-line rounded p-3 text-sm text-ink-muted italic">deleted</div>;
  }
  const displayName = pickDisplayName(doctype, row);
  return (
    <div className="border border-line rounded p-3">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-medium text-ink">{displayName}</div>
          <div className="text-xs text-ink-muted font-mono">{String(row.id)}</div>
        </div>
        <button
          onClick={onKeep}
          className="btn-brand btn-sm"
          disabled={disabled}
        >
          Keep this
        </button>
      </div>
      <div className="text-xs space-y-1">
        {doctype === "Item" && row.itemCode ? <FieldRow label="Code" value={String(row.itemCode)} /> : null}
        {row.email ? <FieldRow label="Email" value={String(row.email)} /> : null}
        {row.mobile ? <FieldRow label="Mobile" value={String(row.mobile)} /> : null}
        {row.gstin ? <FieldRow label="GSTIN" value={String(row.gstin)} /> : null}
        {row.pan ? <FieldRow label="PAN" value={String(row.pan)} /> : null}
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-muted w-14">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}
