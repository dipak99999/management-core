"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Subscription {
  id: string;
  name: string;
  targetUrl: string;
  events: string[];
  signingSecret: string;
  isActive: boolean;
  _count: { deliveries: number };
}

interface Delivery {
  id: string;
  eventKey: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
}

const EVENT_CHOICES = [
  "SalesInvoice.submit",
  "PaymentEntry.submit",
  "Quotation.submit",
  "PurchaseInvoice.submit",
  "PurchaseOrder.submit",
];

const emptyForm = {
  name: "",
  targetUrl: "",
  events: new Set<string>(),
};

export default function WebhooksPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [freshSecret, setFreshSecret] = useState<{ id: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, d] = await Promise.all([
        dashboardApi.get<Subscription[]>("/webhook-subscriptions"),
        dashboardApi.get<Delivery[]>("/webhook-deliveries"),
      ]);
      setSubs(s);
      setDeliveries(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Webhook",
    plural: "Webhooks",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFreshSecret(null);
    try {
      const r = await dashboardApi.post<Subscription & { signingSecret: string }>(
        "/webhook-subscriptions",
        {
          name: form.name,
          targetUrl: form.targetUrl,
          events: Array.from(form.events),
        },
      );
      setFreshSecret({ id: r.id, secret: r.signingSecret });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function processQueue() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await dashboardApi.post<{ processed: number; delivered: number; failed: number }>(
        "/webhook-deliveries/process",
        {},
      );
      setMsg(`Processed ${r.processed} · delivered ${r.delivered} · failed ${r.failed}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    try {
      await dashboardApi.post(`/webhook-deliveries/${id}/retry`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function rotate(id: string) {
    try {
      const r = await dashboardApi.post<{ signingSecret: string }>(
        `/webhook-subscriptions/${id}/rotate-secret`,
        {},
      );
      setFreshSecret({ id, secret: r.signingSecret });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del(id: string) {
    if (!confirm("Delete subscription?")) return;
    try {
      await dashboardApi.delete(`/webhook-subscriptions/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function toggleEvent(k: string) {
    const next = new Set(form.events);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setForm({ ...form, events: next });
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Outgoing webhooks" }]}
        title="Outgoing webhooks"
        subtitle="HMAC-signed POSTs to external URLs whenever selected events fire."
        actions={
          <>
            <Button variant="secondary" onClick={processQueue} disabled={busy} type="button">
              Process queue
            </Button>
            <Button variant="brand" onClick={() => setShowForm((s) => !s)} type="button">
              {showForm ? "Cancel" : "+ New subscription"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">

      {freshSecret && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs">
          <div className="font-medium mb-1">
            Signing secret for {freshSecret.id.slice(0, 8)}… — copy it now, we
            won&apos;t show it again:
          </div>
          <code className="break-all">{freshSecret.secret}</code>
        </div>
      )}

      {showForm && (
        <form onSubmit={create} className="bg-white p-4 rounded shadow space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="url"
            className="w-full border rounded px-3 py-2"
            placeholder="Target URL (https://…)"
            value={form.targetUrl}
            onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            required
          />
          <div>
            <div className="text-xs uppercase text-gray-500 mb-1">
              Events (leave empty to receive all)
            </div>
            {EVENT_CHOICES.map((e) => (
              <label key={e} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.events.has(e)}
                  onChange={() => toggleEvent(e)}
                />
                <span className="font-mono">{e}</span>
              </label>
            ))}
          </div>
          <button
            disabled={busy}
            className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Save
          </button>
        </form>
      )}

      <section>
        <h2 className="text-sm font-medium mb-2">Subscriptions</h2>
        <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
          <thead className="bg-gray-100 text-start text-gray-600">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">Events</th>
              <th className="px-4 py-2 text-end">Deliveries</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {subs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 text-xs break-all">{r.targetUrl}</td>
                <td className="px-4 py-2 text-xs">
                  {r.events.length === 0 ? "all" : r.events.join(", ")}
                </td>
                <td className="px-4 py-2 text-end">{r._count.deliveries}</td>
                <td className="px-4 py-2 text-xs">{r.isActive ? "yes" : "no"}</td>
                <td className="px-4 py-2 text-end text-xs space-x-2">
                  <button onClick={() => rotate(r.id)} className="text-brand-600">
                    Rotate secret
                  </button>
                  <button onClick={() => del(r.id)} className="text-red-600">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {subs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No subscriptions yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">Recent deliveries</h2>
        <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
          <thead className="bg-gray-100 text-start text-gray-600">
            <tr>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Event</th>
              <th className="px-4 py-2 text-end">Attempts</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Detail</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="px-4 py-2 text-xs">
                  {new Date(d.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs font-mono">{d.eventKey}</td>
                <td className="px-4 py-2 text-end">{d.attempts}</td>
                <td className="px-4 py-2 text-xs">{d.status}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ""}
                  {d.lastError ? ` · ${d.lastError}` : ""}
                </td>
                <td className="px-4 py-2 text-end">
                  {(d.status === "Failed" || d.status === "Cancelled") && (
                    <button
                      onClick={() => retry(d.id)}
                      className="text-brand-600 text-xs"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                  No deliveries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      </div>
    </AppShell>
  );
}
