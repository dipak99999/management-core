"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Vehicle {
  id: string;
  licensePlate: string;
  make: string | null;
  model: string | null;
  fuelType: string | null;
  currentOdometer: number;
  lastServiceDate: string | null;
  disabled: boolean;
  _count: { logs: number };
}

const emptyForm = {
  licensePlate: "",
  make: "",
  model: "",
  vin: "",
  fuelType: "Petrol",
  color: "",
  yearOfMake: "",
  currentOdometer: 0,
};

const emptyLog = {
  vehicleId: "",
  logDate: new Date().toISOString().slice(0, 10),
  logType: "Fuel" as "Odometer" | "Fuel" | "Expense" | "Service",
  odometer: "",
  fuelQty: "",
  fuelRate: "",
  amount: "",
  vendor: "",
  driverName: "",
  notes: "",
};

// Module 48 — Vehicle master + log entry Drawer.
export default function VehiclesPage() {
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showLog, setShowLog] = useState(false);
  const [logForm, setLogForm] = useState(emptyLog);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Vehicle[]>("/vehicles"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Vehicle",
    plural: "Vehicles",
    refresh: load,
  });
  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(v: Vehicle) {
    setEditingId(v.id);
    setForm({
      licensePlate: v.licensePlate,
      make: v.make ?? "",
      model: v.model ?? "",
      vin: "",
      fuelType: v.fuelType ?? "Petrol",
      color: "",
      yearOfMake: "",
      currentOdometer: v.currentOdometer,
    });
    setShowForm(true);
  }
  function openLog(v: Vehicle, e: React.MouseEvent) {
    e.stopPropagation();
    setLogForm({ ...emptyLog, vehicleId: v.id, odometer: String(v.currentOdometer) });
    setShowLog(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        licensePlate: form.licensePlate,
        make: form.make || null,
        model: form.model || null,
        vin: form.vin || null,
        fuelType: form.fuelType || null,
        color: form.color || null,
        yearOfMake: form.yearOfMake ? Number(form.yearOfMake) : null,
        currentOdometer: Number(form.currentOdometer),
      };
      if (editingId) {
        await api.put(`/vehicles/${editingId}`, payload);
      } else {
        await api.post("/vehicles", payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function submitLog(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/vehicles/logs", {
        vehicleId: logForm.vehicleId,
        logDate: new Date(logForm.logDate).toISOString(),
        logType: logForm.logType,
        odometer: logForm.odometer ? Number(logForm.odometer) : null,
        fuelQty: logForm.fuelQty ? Number(logForm.fuelQty) : null,
        fuelRate: logForm.fuelRate ? Number(logForm.fuelRate) : null,
        amount: logForm.amount ? Number(logForm.amount) : null,
        vendor: logForm.vendor || null,
        driverName: logForm.driverName || null,
        notes: logForm.notes || null,
      });
      setShowLog(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.licensePlate.toLowerCase().includes(q) ||
        (r.make?.toLowerCase().includes(q) ?? false) ||
        (r.model?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, search]);

  const columns: Column<Vehicle>[] = [
    {
      header: "Plate",
      cell: (v) => (
        <button onClick={() => openEdit(v)} className="text-start">
          <div className="font-mono font-medium text-ink">{v.licensePlate}</div>
        </button>
      ),
    },
    {
      header: "Vehicle",
      cell: (v) => (
        <div className="text-sm">
          <div>{[v.make, v.model].filter(Boolean).join(" / ") || "—"}</div>
          <div className="text-xs text-ink-muted">{v.fuelType ?? ""}</div>
        </div>
      ),
    },
    {
      header: "Odometer",
      align: "right",
      cell: (v) => <span className="font-mono">{v.currentOdometer.toLocaleString()}</span>,
    },
    {
      header: "Last service",
      cell: (v) => (
        <span className="text-xs text-ink-muted">
          {v.lastServiceDate ? dateShort(v.lastServiceDate) : "—"}
        </span>
      ),
    },
    { header: "Logs", align: "right", cell: (v) => <span className="font-mono">{v._count.logs}</span> },
    {
      header: "",
      align: "right",
      cell: (v) => (
        <button onClick={(e) => openLog(v, e)} className="btn-ghost btn-sm">+ Log</button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Vehicles"
        subtitle="Fleet master with odometer, fuel, and service history."
        actions={<Button variant="brand" onClick={openCreate}>+ New vehicle</Button>}
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search plate / make / model…" }}
          actions={<SavedViewsControls listKey="accounting-web:vehicles" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(v) => v.id}
          loading={loading}
          empty={{
            icon: Icon.box,
            title: search ? "No matches" : "No vehicles yet",
            description: "Add vehicles to track odometer, fuel, and service history.",
            action: !search && <Button variant="brand" onClick={openCreate}>+ New vehicle</Button>,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? "Edit vehicle" : "New vehicle"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submit(e as unknown as React.FormEvent)}>
              {editingId ? "Save" : "Create"}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <FormField label="License plate" required>
            <input
              className="input font-mono"
              value={form.licensePlate}
              onChange={(e) => setForm({ ...form, licensePlate: e.target.value.toUpperCase() })}
              required
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Make">
              <input className="input" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </FormField>
            <FormField label="Model">
              <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </FormField>
            <FormField label="Fuel type">
              <select className="input" value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                <option>Petrol</option><option>Diesel</option><option>Electric</option><option>CNG</option><option>Hybrid</option>
              </select>
            </FormField>
            <FormField label="Year">
              <input type="number" className="input" value={form.yearOfMake} onChange={(e) => setForm({ ...form, yearOfMake: e.target.value })} />
            </FormField>
            <FormField label="VIN">
              <input className="input font-mono" value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
            </FormField>
            <FormField label="Odometer">
              <input type="number" className="input font-mono" value={form.currentOdometer} onChange={(e) => setForm({ ...form, currentOdometer: Number(e.target.value) })} />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showLog}
        onClose={() => setShowLog(false)}
        title="Add vehicle log"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowLog(false)}>Cancel</Button>
            <Button variant="brand" onClick={(e) => submitLog(e as unknown as React.FormEvent)}>
              Add log
            </Button>
          </>
        }
      >
        <form onSubmit={submitLog} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required>
              <input type="date" className="input" value={logForm.logDate} onChange={(e) => setLogForm({ ...logForm, logDate: e.target.value })} required />
            </FormField>
            <FormField label="Type" required>
              <select className="input" value={logForm.logType} onChange={(e) => setLogForm({ ...logForm, logType: e.target.value as "Odometer" | "Fuel" | "Expense" | "Service" })}>
                <option>Fuel</option><option>Odometer</option><option>Service</option><option>Expense</option>
              </select>
            </FormField>
            <FormField label="Odometer">
              <input type="number" className="input font-mono" value={logForm.odometer} onChange={(e) => setLogForm({ ...logForm, odometer: e.target.value })} />
            </FormField>
            {logForm.logType === "Fuel" && (
              <>
                <FormField label="Fuel qty">
                  <input type="number" step="0.001" className="input font-mono" value={logForm.fuelQty} onChange={(e) => setLogForm({ ...logForm, fuelQty: e.target.value })} />
                </FormField>
                <FormField label="Rate">
                  <input type="number" step="0.001" className="input font-mono" value={logForm.fuelRate} onChange={(e) => setLogForm({ ...logForm, fuelRate: e.target.value })} />
                </FormField>
              </>
            )}
            <FormField label="Amount">
              <input type="number" step="0.01" className="input font-mono" value={logForm.amount} onChange={(e) => setLogForm({ ...logForm, amount: e.target.value })} />
            </FormField>
            <FormField label="Vendor">
              <input className="input" value={logForm.vendor} onChange={(e) => setLogForm({ ...logForm, vendor: e.target.value })} />
            </FormField>
            <FormField label="Driver">
              <input className="input" value={logForm.driverName} onChange={(e) => setLogForm({ ...logForm, driverName: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Notes">
            <input className="input" value={logForm.notes} onChange={(e) => setLogForm({ ...logForm, notes: e.target.value })} />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
