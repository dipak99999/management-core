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

interface Category {
  id: string;
  name: string;
  description: string | null;
  _count: { employees: number };
}

export default function EmployeeCategoriesPage() {
  const [rows, setRows] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<Category[]>("/employee-categories"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Employee Category",
    plural: "Employee Categories",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/employee-categories", form);
      setForm({ name: "", description: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this category?")) return;
    try {
      await api.del(`/employee-categories/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<Category>[] = [
    { header: "Name", cell: (r) => r.name },
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
        breadcrumb={[{ label: "HR", href: "/" }, { label: "Employee Categories" }]}
        title="Employee Categories"
        subtitle="Permanent / Contract / Intern / Consultant · used by 'Leave Distribution by Employee Category'"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="New category" />
        <form onSubmit={create} className="grid grid-cols-2 gap-3">
          <FormField label="Name" required>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </FormField>
          <FormField label="Description">
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FormField>
          <div className="col-span-2 flex justify-end">
            <Button variant="brand" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Create"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-0 overflow-hidden">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No categories yet." }} />
      </Card>
    </>
  );
}
