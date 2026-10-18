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
  Segmented,
  StatusBadge,
  Toast,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface Opening {
  id: string;
  name: string;
  title: string;
  department: string | null;
  designation: string | null;
  status: string;
  employmentType: string | null;
  _count: { applicants: number };
}

type StatusFilter = "all" | "Open" | "Closed";

const emptyForm = {
  title: "",
  department: "",
  designation: "",
  employmentType: "Full-time",
  description: "",
};

export default function JobOpeningsPage() {
  const [rows, setRows] = useState<Opening[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Opening[]>("/job-openings"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Job Opening",
    plural: "Job Openings",
    refresh: load,
  });
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/job-openings", {
        title: form.title,
        department: form.department || null,
        designation: form.designation || null,
        employmentType: form.employmentType,
        description: form.description || null,
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && ![r.name, r.title, r.department, r.designation]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:    rows.length,
    Open:   rows.filter((r) => r.status === "Open").length,
    Closed: rows.filter((r) => r.status === "Closed").length,
  }), [rows]);

  const columns: Column<Opening>[] = [
    {
      header: "Name",
      cell: (r) => (
        <a
          href={`/hr/job-openings/${r.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(e) => e.stopPropagation()}
        >
          {r.name}
        </a>
      ),
    },
    { header: "Title",      cell: (r) => <span className="font-medium text-ink">{r.title}</span> },
    { header: "Department", cell: (r) => <span className="text-ink-soft">{r.department ?? "—"}</span> },
    { header: "Type",       cell: (r) => <span className="text-ink-soft">{r.employmentType ?? "—"}</span> },
    {
      header: "Applicants",
      align: "right",
      cell: (r) => <span className="tabular-nums text-ink">{r._count.applicants}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Job Openings"
        subtitle={`${counts.Open} open · ${rows.length} total`}
        actions={
          <>
            <a href="/hr/job-applicants" className="btn-secondary">All applicants</a>
            <Button variant="brand" onClick={() => setShowForm(true)}>+ New opening</Button>
          </>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search openings…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",    label: "All",    count: counts.all },
                { value: "Open",   label: "Open",   count: counts.Open },
                { value: "Closed", label: "Closed", count: counts.Closed },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:job-openings" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          onRowClick={(r) => (window.location.href = `/hr/job-openings/${r.id}`)}
          loading={loading}
          empty={{
            icon: Icon.briefcase,
            title: search || statusFilter !== "all" ? "No matching openings" : "No openings yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Post a role to start collecting applicants.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ New opening</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => { setShowForm(false); setForm(emptyForm); }}
        title="New job opening"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(emptyForm); }}>Cancel</Button>
            <Button variant="brand" disabled={busy} onClick={(e) => create(e as unknown as React.FormEvent)}>
              {busy ? "Saving…" : "Create opening"}
            </Button>
          </>
        }
      >
        <form onSubmit={create} className="space-y-4">
          <FormField label="Title" required>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Employment type">
              <select
                className="input"
                value={form.employmentType}
                onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
              >
                <option>Full-time</option>
                <option>Part-time</option>
                <option>Contract</option>
                <option>Intern</option>
              </select>
            </FormField>
            <FormField label="Department">
              <input
                className="input"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Designation">
            <input
              className="input"
              value={form.designation}
              onChange={(e) => setForm({ ...form, designation: e.target.value })}
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input"
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
