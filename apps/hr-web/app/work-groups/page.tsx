"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  type Column,
} from "../../components/ui";

interface WorkGroup {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  _count: { employees: number };
}

export default function WorkGroupsPage() {
  const [rows, setRows] = useState<WorkGroup[]>([]);
  const [form, setForm] = useState({ name: "", code: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<WorkGroup[]>("/work-groups"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Work Group",
    plural: "Work Groups",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/work-groups", form);
      setForm({ name: "", code: "", description: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this work group?")) return;
    try {
      await api.del(`/work-groups/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<WorkGroup>[] = [
    { header: "Name", cell: (r) => r.name },
    { header: "Code", cell: (r) => r.code ?? "—" },
    { header: "Description", cell: (r) => r.description ?? "—" },
    { header: "Employees", align: "right", cell: (r) => r._count.employees },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "HR", href: "/" }, { label: "Work Groups" }]}
        title="Work Groups"
        subtitle="Org unit used by 'Leave Entitlement by Work Group' and other dashboards"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="New work group" />
        <form onSubmit={create} className="grid grid-cols-3 gap-3">
          <FormField label="Name" required>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Code">
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </FormField>
          <FormField label="Description">
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          <div className="col-span-3 flex justify-end">
            <Button variant="brand" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-0 overflow-hidden">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No work groups yet." }} />
      </Card>
    </>
  );
}
