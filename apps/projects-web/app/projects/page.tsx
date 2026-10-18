"use client";

import { useEffect, useMemo, useState } from "react";
import { InlineEditCell, useListPageCommands, Tour, type TourStep, useRealtimeList, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Customer { id: string; customerName: string }
interface Employee { id: string; employeeCode: string; employeeName: string }
interface Project {
  id: string;
  name: string;
  projectName: string;
  status: string;
  billingType: string;
  startDate: string | null;
  endDate: string | null;
  customer: { id: string; customerName: string } | null;
  projectManager: { id: string; employeeCode: string; employeeName: string } | null;
  _count: { tasks: number };
}

const emptyForm = {
  projectName: "",
  customerId: "",
  projectManagerId: "",
  startDate: "",
  endDate: "",
  status: "Open" as const,
  billingType: "Non-billable" as "Fixed" | "Hourly" | "Non-billable",
  estimatedCost: 0,
  notes: "",
  // Projects-Plus budget tracking. When set, a project-budget dashboard
  // warns operators once cumulative spend crosses `budgetThresholdPct`% of
  // `budgetAmount` (default 80). Zero/blank = feature off.
  budgetAmount: 0,
  budgetThresholdPct: 80,
};

type StatusFilter = "all" | "Open" | "Completed" | "Cancelled";

export default function ProjectsListPage() {
  const [rows, setRows] = useState<Project[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      const [ps, cs, es] = await Promise.all([
        api.get<Project[]>("/projects"),
        api.get<Customer[]>("/customers"),
        api.get<Employee[]>("/employees"),
      ]);
      setRows(ps);
      setCustomers(cs);
      setEmployees(es);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Project",
    plural: "Projects",
    refresh: load,
  });
  useRealtimeList("project", load);

  const tourSteps: TourStep[] = [
    { target: "[data-tour=projects-projects-v1-header]", title: "Projects", body: "This is where you manage projects. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=projects-projects-v1-new]", title: "Create a new project", body: "Click here to add your first project. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=projects-projects-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/projects", {
        ...form,
        customerId: form.customerId || null,
        projectManagerId: form.projectManagerId || null,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        notes: form.notes || null,
        // Only send budget fields when the operator actually filled them in;
        // zero/unspecified sends undefined so the API treats it as "unset".
        budgetAmount: form.budgetAmount > 0 ? form.budgetAmount : undefined,
        budgetThresholdPct: form.budgetAmount > 0 ? form.budgetThresholdPct : undefined,
      });
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function close() {
    setForm(emptyForm);
    setShowForm(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (
        q &&
        !`${p.projectName} ${p.name} ${p.customer?.customerName ?? ""}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:       rows.length,
    Open:      rows.filter((r) => r.status === "Open").length,
    Completed: rows.filter((r) => r.status === "Completed").length,
    Cancelled: rows.filter((r) => r.status === "Cancelled").length,
  }), [rows]);

  const columns: Column<Project>[] = [
    {
      header: "Project",
      cell: (p) => (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineEditCell
            value={p.projectName}
            save={async (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === p.projectName) return;
              await api.put(`/projects/${p.id}`, { projectName: trimmed });
              await load();
            }}
            display={(v) => (
              <a
                href={`/projects/projects/${p.id}`}
                className="font-medium text-ink hover:text-brand-700"
              >
                {v}
              </a>
            )}
          />
          <div className="font-mono text-xs text-ink-muted">{p.name}</div>
        </div>
      ),
    },
    {
      header: "Customer",
      cell: (p) => <span className="text-ink-soft">{p.customer?.customerName ?? "—"}</span>,
    },
    {
      header: "PM",
      cell: (p) => <span className="text-ink-soft">{p.projectManager?.employeeName ?? "—"}</span>,
    },
    {
      header: "Dates",
      cell: (p) => (
        <span className="text-xs text-ink-soft tabular-nums">
          {dateShort(p.startDate)} → {dateShort(p.endDate)}
        </span>
      ),
    },
    {
      header: "Billing",
      cell: (p) => (
        <span className={p.billingType === "Non-billable" ? "badge-gray" : "badge-brand"}>
          {p.billingType}
        </span>
      ),
    },
    {
      header: "Tasks",
      align: "right",
      cell: (p) => <span className="tabular-nums text-ink">{p._count.tasks}</span>,
    },
    {
      header: "Status",
      cell: (p) => <StatusBadge status={p.status} />,
    },
  ];

  return (
    <>
      <Tour id="projects-web.projects.v1" steps={tourSteps} />
      <div data-tour="projects-projects-v1-header">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Projects" }]}
        title="Projects"
        subtitle={`${rows.length} project${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New project
          </Button>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="projects-projects-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search project, code, or customer…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",       label: "All",       count: counts.all },
                { value: "Open",      label: "Open",      count: counts.Open },
                { value: "Completed", label: "Completed", count: counts.Completed },
                { value: "Cancelled", label: "Cancelled", count: counts.Cancelled },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="projects-web:projects" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
          </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          onRowClick={(p) => (window.location.href = `/projects/projects/${p.id}`)}
          loading={loading}
          empty={{
            icon: Icon.briefcase,
            title: search || statusFilter !== "all" ? "No matching projects" : "No projects yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Create your first project to plan tasks and log time.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New project</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title="New project"
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => create(e as unknown as React.FormEvent)}>
              Create project
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Project name" required>
            <input
              className="input"
              placeholder="Website redesign"
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Customer">
              <select
                className="input"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">— None —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.customerName}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Project manager">
              <select
                className="input"
                value={form.projectManagerId}
                onChange={(e) => setForm({ ...form, projectManagerId: e.target.value })}
              >
                <option value="">— None —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employeeName} ({emp.employeeCode})
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Start">
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </FormField>
            <FormField label="Billing">
              <select
                className="input"
                value={form.billingType}
                onChange={(e) =>
                  setForm({ ...form, billingType: e.target.value as typeof form.billingType })
                }
              >
                <option>Non-billable</option>
                <option>Fixed</option>
                <option>Hourly</option>
              </select>
            </FormField>
          </div>
          <FormField label="Estimated cost">
            <input
              type="number"
              step="any"
              min={0}
              className="input tabular-nums"
              value={form.estimatedCost}
              onChange={(e) => setForm({ ...form, estimatedCost: Number(e.target.value) })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Budget amount (0 = untracked)"
              hint="When >0, the project surfaces an over-budget banner once spend crosses the threshold below."
            >
              <input
                type="number"
                step="any"
                min={0}
                className="input tabular-nums"
                value={form.budgetAmount}
                onChange={(e) => setForm({ ...form, budgetAmount: Number(e.target.value) || 0 })}
              />
            </FormField>
            <FormField label="Warn at % of budget">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="input tabular-nums"
                value={form.budgetThresholdPct}
                onChange={(e) => setForm({ ...form, budgetThresholdPct: Number(e.target.value) || 80 })}
                disabled={form.budgetAmount <= 0}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <textarea
              className="input"
              rows={3}
              placeholder="Optional"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
