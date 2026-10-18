"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
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

interface Contract {
  id: string;
  name: string;
  contractType: string;
  startDate: string;
  endDate: string;
  entitledUnits: string;
  usedUnits: string;
  currency: string;
  contractValue: string;
  status: string;
  customer: { customerName: string };
  slaPolicy: { name: string } | null;
}
interface Customer { id: string; customerName: string; }
interface SlaPolicy { id: string; name: string; }

// Module 53 — Service Contract list + create + cancel.
export default function ServiceContractsPage() {
  const [rows, setRows] = useState<Contract[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [slas, setSlas] = useState<SlaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    slaPolicyId: "",
    contractType: "Fixed Hours" as "Fixed Hours" | "Unlimited" | "Per Ticket",
    startDate: "",
    endDate: "",
    entitledUnits: 40,
    contractValue: 0,
    currency: "INR",
  });

  async function load() {
    setLoading(true);
    try {
      const [c, cust, sla] = await Promise.all([
        api.get<Contract[]>("/service-contracts"),
        api.get<Customer[]>("/customers"),
        api.get<SlaPolicy[]>("/desk/sla-policies").catch(() => []),
      ]);
      setRows(c);
      setCustomers(cust);
      setSlas(sla);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Service Contract",
    plural: "Service Contracts",
    refresh: load,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/service-contracts", {
        customerId: form.customerId,
        slaPolicyId: form.slaPolicyId || null,
        contractType: form.contractType,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        entitledUnits: form.entitledUnits,
        contractValue: form.contractValue,
        currency: form.currency,
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function cancel(c: Contract, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Cancel ${c.name}?`)) return;
    try {
      await api.post(`/service-contracts/${c.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Contract>[] = [
    { header: "Name", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { header: "Customer", cell: (r) => <span>{r.customer.customerName}</span> },
    { header: "Type", cell: (r) => <span className="text-sm">{r.contractType}</span> },
    {
      header: "Window",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{dateShort(r.startDate)} → {dateShort(r.endDate)}</span>
      ),
    },
    {
      header: "Usage",
      align: "right",
      cell: (r) => {
        if (r.contractType === "Unlimited") return <span className="text-xs text-ink-muted">—</span>;
        const used = Number(r.usedUnits);
        const total = Number(r.entitledUnits);
        return <span className="font-mono">{used.toFixed(1)} / {total.toFixed(1)}</span>;
      },
    },
    { header: "SLA", cell: (r) => <span className="text-xs text-ink-muted">{r.slaPolicy?.name ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Active" ? (
          <button onClick={(e) => cancel(r, e)} className="btn-ghost btn-sm text-red-600">Cancel</button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Service Contracts"
        subtitle="Support agreements with customers. Tickets can look up the covering contract to enforce SLA + track usage."
        actions={<Button variant="brand" onClick={() => setShowForm(true)}>+ New contract</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        empty={{
          icon: Icon.shield,
          title: "No service contracts yet",
          description: "Set up support agreements to enforce SLA tiers by customer.",
          action: <Button variant="brand" onClick={() => setShowForm(true)}>+ New contract</Button>,
        }}
      />

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title="New service contract"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>Create</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="Customer" required>
            <select className="input" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required>
              <option value="">— pick —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.customerName}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select className="input" value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as "Fixed Hours" | "Unlimited" | "Per Ticket" })}>
                <option>Fixed Hours</option><option>Unlimited</option><option>Per Ticket</option>
              </select>
            </FormField>
            <FormField label="SLA policy">
              <select className="input" value={form.slaPolicyId} onChange={(e) => setForm({ ...form, slaPolicyId: e.target.value })}>
                <option value="">— none —</option>
                {slas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
            <FormField label="Start date" required>
              <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            </FormField>
            <FormField label="End date" required>
              <input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </FormField>
            {form.contractType !== "Unlimited" && (
              <FormField label={form.contractType === "Fixed Hours" ? "Entitled hours" : "Entitled tickets"}>
                <input type="number" step="0.5" className="input font-mono" value={form.entitledUnits} onChange={(e) => setForm({ ...form, entitledUnits: Number(e.target.value) })} />
              </FormField>
            )}
            <FormField label="Contract value">
              <input type="number" step="0.01" className="input font-mono" value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: Number(e.target.value) })} />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
