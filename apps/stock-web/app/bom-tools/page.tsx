"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../components/ui";

// C13: BOM Update tool. Two operations:
//  - Refresh cost across all active BOMs (recomputes BOMItem.rate/amount +
//    BOM.totalCost from live bin valuations).
//  - Replace one RM item with another across every BOM (bulk substitution).

interface Item { id: string; itemCode: string; itemName: string }

export default function BOMToolsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.get<Item[]>("/items").then(setItems).catch(() => {});
  }, []);

  async function refreshAll() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ updated: number }>(
        "/boms/all/update-cost",
        {},
      );
      setMsg(`Refreshed ${r.updated} BOMs`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function replaceItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ replacedRows: number; affectedBOMs: number }>(
        "/boms/tools/replace-item",
        { fromItemId: fromId, toItemId: toId },
      );
      setMsg(
        `Replaced ${r.replacedRows} BOM rows across ${r.affectedBOMs} BOMs`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "BOM Tools" }]}
        title="BOM Tools"
        subtitle="Bulk maintenance for Bill-of-Materials"
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}
      {msg && (
        <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
      )}

      <Card className="p-4 space-y-3">
        <SectionHeader title="Refresh BOM cost" />
        <p className="text-sm text-ink-muted">
          Recomputes each BOMItem&apos;s rate + amount from the current bin
          valuation (weighted across all warehouses) + refreshes BOM totalCost
          including operation labour.
        </p>
        <Button
          variant="primary"
          onClick={refreshAll}
          disabled={busy}
          type="button"
        >
          {busy ? "Refreshing..." : "Refresh all active BOMs"}
        </Button>
      </Card>

      <Card className="p-4 space-y-3">
        <SectionHeader title="Replace item in every BOM" />
        <p className="text-sm text-ink-muted">
          Substitutes one raw-material item with another across every BOM in
          the tenant. Runs cost refresh on the affected BOMs after the swap.
        </p>
        <form onSubmit={replaceItem} className="grid grid-cols-2 gap-3 items-end">
          <FormField label="From item" required>
            <select
              required
              className="input"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
            >
              <option value="">Select item...</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} — {i.itemName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="To item" required>
            <select
              required
              className="input"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              <option value="">Select item...</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.itemCode} — {i.itemName}
                </option>
              ))}
            </select>
          </FormField>
          <div className="col-span-2">
            <Button variant="primary" disabled={busy} type="submit">
              {busy ? "Replacing..." : "Replace across every BOM"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
