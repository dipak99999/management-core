"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  Toast,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface SP {
  id: string;
  name: string;
  employeeId: string | null;
  defaultCommissionPercent: string;
  enabled: boolean;
  employee: { employeeCode: string; employeeName: string } | null;
}
interface CommRow {
  id: string;
  name: string;
  count: number;
  totalSales: number;
  commission: number;
}
interface CommEnvelope {
  rows: CommRow[];
  invoices: number;
  from: string;
  to: string;
}

const empty = { name: "", employeeId: "", defaultCommissionPercent: 0, enabled: true };

async function loadEmployees(): Promise<
  { id: string; employeeCode: string; employeeName: string }[]
> {
  const HR = process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "/api/hr";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${HR}/employees`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

type Tab = "list" | "report";

export default function SalesPersonsPage() {
  const [tab, setTab] = useState<Tab>("list");
  const [rows, setRows] = useState<SP[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<
    { id: string; employeeCode: string; employeeName: string }[]
  >([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(new Date().setMonth(new Date().getMonth() - 1))
    .toISOString()
    .slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<CommEnvelope | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SP[]>("/sales-persons"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    loadEmployees().then(setEmployees);
  }, []);

  useListPageCommands({
    singular: "Sales Person",
    plural: "Sales Persons",
    refresh: load,
  });
  async function loadReport() {
    try {
      setReport(
        await api.get<CommEnvelope>(
          `/sales-persons/commission-report?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    if (tab === "report") loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function edit(sp: SP, e: React.MouseEvent) {
    e.stopPropagation();
    setForm({
      name: sp.name,
      employeeId: sp.employeeId ?? "",
      defaultCommissionPercent: Number(sp.defaultCommissionPercent),
      enabled: sp.enabled,
    });
    setEditingId(sp.id);
    setShowForm(true);
  }

  function close() {
    setForm(empty);
    setEditingId(null);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...form, employeeId: form.employeeId || null };
      if (editingId) await api.put(`/sales-persons/${editingId}`, body);
      else await api.post("/sales-persons", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function remove(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this sales person?")) return;
    try {
      await api.del(`/sales-persons/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((sp) =>
      `${sp.name} ${sp.employee?.employeeName ?? ""} ${sp.employee?.employeeCode ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const activeCount = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);

  const columns: Column<SP>[] = [
    { header: "Name", cell: (sp) => <span className="font-medium text-ink">{sp.name}</span> },
    {
      header: "Linked employee",
      cell: (sp) => (
        <span className="text-xs text-ink-soft">
          {sp.employee
            ? `${sp.employee.employeeCode} — ${sp.employee.employeeName}`
            : "—"}
        </span>
      ),
    },
    {
      header: "Default commission",
      align: "right",
      cell: (sp) => (
        <span className="tabular-nums text-ink">
          {Number(sp.defaultCommissionPercent).toFixed(2)}%
        </span>
      ),
    },
    {
      header: "Status",
      cell: (sp) => (
        <span className={sp.enabled ? "badge-green" : "badge-gray"}>
          {sp.enabled ? "Active" : "Disabled"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (sp) => (
        <div className="flex items-center justify-end gap-2">
          <button onClick={(e) => edit(sp, e)} className="btn-ghost btn-sm">Edit</button>
          <button onClick={(e) => remove(sp.id, e)} className="btn-ghost btn-sm text-red-600">Delete</button>
        </div>
      ),
    },
  ];

  const reportColumns: Column<CommRow>[] = [
    { header: "Sales Person", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
    {
      header: "Invoices",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{r.count}</span>,
    },
    {
      header: "Total sales",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink-soft">{money(r.totalSales)}</span>,
    },
    {
      header: "Commission",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium text-ink">{money(r.commission)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Persons"
        subtitle={`${activeCount} active · ${rows.length} total sales person${rows.length === 1 ? "" : "s"}`}
        actions={
          tab === "list" ? (
            <Button variant="brand" onClick={() => setShowForm(true)}>+ New sales person</Button>
          ) : null
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "list",   label: "List" },
            { value: "report", label: "Commission report" },
          ]}
        />
      </div>

      {tab === "list" && (
        <div className="space-y-4">
          <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search name or employee…" }}
          actions={<SavedViewsControls listKey="accounting-web:sales-persons" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(sp) => sp.id}
            loading={loading}
            empty={{
              icon: Icon.users,
              title: search ? "No matching sales persons" : "No sales persons yet",
              description: search
                ? "Try a different search term."
                : "Add a sales person to attribute invoices and pay commission.",
              action: !search && (
                <Button variant="brand" onClick={() => setShowForm(true)}>+ Add sales person</Button>
              ),
            }}
          />
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-4">
          <Card className="p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label">From</label>
              <input
                type="date"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="label">To</label>
              <input
                type="date"
                className="input"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button variant="brand" onClick={loadReport}>Refresh</Button>
          </Card>
          <DataTable
            columns={reportColumns}
            rows={report?.rows ?? []}
            rowKey={(r) => r.id}
            empty={{
              icon: Icon.bar,
              title: "No attributed invoices in period",
              description: "Try a wider date range or attribute invoices to sales persons.",
            }}
          />
        </div>
      )}

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? "Edit sales person" : "New sales person"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create sales person"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              required
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Linked employee">
              <select
                className="input"
                value={form.employeeId}
                onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              >
                <option value="">— No employee link —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeCode} — {emp.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Default commission %">
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                className="input"
                value={form.defaultCommissionPercent}
                onChange={(e) =>
                  setForm({ ...form, defaultCommissionPercent: Number(e.target.value) })
                }
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
