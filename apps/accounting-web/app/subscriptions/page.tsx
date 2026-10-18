"use client";

import { useEffect, useState } from "react";
import { useListPageCommands, useRealtimeList } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  StatusBadge,
  dateShort,
  type Column,
} from "../../components/ui";

// D11: Subscriptions admin — list + generate-now button per row.
// Editing is deferred; use POST /subscriptions directly for now.

interface SubItem { qty: string; rate: string }
interface Sub {
  id: string;
  name: string;
  frequency: string;
  startDate: string;
  endDate: string | null;
  nextGenerationDate: string;
  currency: string;
  autoSubmit: boolean;
  status: string;
  customer: { customerName: string };
  items: SubItem[];
}

export default function SubscriptionsPage() {
  const [rows, setRows] = useState<Sub[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<Sub[]>("/subscriptions"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Subscription",
    plural: "Subscriptions",
    refresh: load,
  });
  useRealtimeList("subscription", load);

  async function generate(id: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ generated: number; invoices: string[] }>(
        `/subscriptions/${id}/generate`,
        {},
      );
      setMsg(
        r.generated > 0
          ? `Generated ${r.generated} invoice(s): ${r.invoices.join(", ")}`
          : "Nothing due to generate",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ subsProcessed: number; totalGenerated: number }>(
        "/subscriptions/generate-due",
        {},
      );
      setMsg(
        `Processed ${r.subsProcessed} subscription(s), generated ${r.totalGenerated} invoice(s)`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function pause(id: string) {
    await api.post(`/subscriptions/${id}/pause`, {});
    await load();
  }
  async function resume(id: string) {
    await api.post(`/subscriptions/${id}/resume`, {});
    await load();
  }
  async function cancel(id: string) {
    if (!confirm("Cancel this subscription?")) return;
    await api.post(`/subscriptions/${id}/cancel`, {});
    await load();
  }

  const cols: Column<Sub>[] = [
    { header: "Name", cell: (s) => <span className="font-mono">{s.name}</span> },
    { header: "Customer", cell: (s) => s.customer.customerName },
    { header: "Freq", cell: (s) => <span className="text-xs">{s.frequency}</span> },
    {
      header: "Next due",
      cell: (s) => {
        const overdue = new Date(s.nextGenerationDate) <= new Date();
        return (
          <span
            className={`text-xs ${overdue && s.status === "Active" ? "text-red-700 font-medium" : ""}`}
          >
            {dateShort(s.nextGenerationDate)}
          </span>
        );
      },
    },
    { header: "Lines", align: "right", cell: (s) => <span className="tabular-nums">{s.items.length}</span> },
    { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <span className="space-x-2 text-xs">
          {s.status === "Active" && (
            <>
              <button onClick={() => generate(s.id)} disabled={busy} className="text-brand-600">
                Generate
              </button>
              <button onClick={() => pause(s.id)} className="text-ink-muted">
                Pause
              </button>
            </>
          )}
          {s.status === "Paused" && (
            <button onClick={() => resume(s.id)} className="text-brand-600">
              Resume
            </button>
          )}
          {s.status !== "Cancelled" && s.status !== "Completed" && (
            <button onClick={() => cancel(s.id)} className="text-red-600">
              Cancel
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Subscriptions" },
        ]}
        title="Subscriptions"
        actions={
          <Button variant="primary" onClick={runAll} disabled={busy} type="button">
            {busy ? "Working..." : "Generate all due"}
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}
      {msg && (
        <Card className="p-3 text-green-700 border-green-200 bg-green-50 text-sm">{msg}</Card>
      )}

      <DataTable<Sub>
        columns={cols}
        rows={rows}
        rowKey={(s) => s.id}
        empty={{ title: "No subscriptions yet" }}
      />
    </main>
  );
}
