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

interface LoanType {
  id: string;
  loanTypeName: string;
  interestRate: string;
  defaultTermMonths: number;
  description: string | null;
}

const emptyForm = {
  loanTypeName: "",
  interestRate: 0,
  defaultTermMonths: 12,
  description: "",
};

export default function LoanTypesPage() {
  const [rows, setRows] = useState<LoanType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await api.get<LoanType[]>("/loan-types"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Loan Type",
    plural: "Loan Types",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/loan-types", {
        ...form,
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

  const cols: Column<LoanType>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium">{r.loanTypeName}</span>,
    },
    {
      header: "Interest %",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums font-mono">
          {Number(r.interestRate).toFixed(2)}
        </span>
      ),
    },
    {
      header: "Default term",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">{r.defaultTermMonths} mo</span>
      ),
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-sm text-ink-muted">{r.description ?? "—"}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Loan types" },
        ]}
        title="Loan types"
        subtitle="Reusable templates: annual interest rate and default term."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New loan type"}
          </Button>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      {showForm && (
        <Card className="p-4 max-w-md">
          <SectionHeader title="New loan type" />
          <form onSubmit={create} className="space-y-3">
            <FormField label="Name" required>
              <input
                required
                className="input"
                placeholder="Personal Loan, Salary Advance…"
                value={form.loanTypeName}
                onChange={(e) =>
                  setForm({ ...form, loanTypeName: e.target.value })
                }
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Annual interest %">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="input"
                  value={form.interestRate}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      interestRate: Number(e.target.value),
                    })
                  }
                />
              </FormField>
              <FormField label="Default term (months)">
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={form.defaultTermMonths}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      defaultTermMonths: Number(e.target.value),
                    })
                  }
                />
              </FormField>
            </div>
            <FormField label="Description">
              <textarea
                className="input"
                placeholder="(optional)"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </FormField>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <DataTable<LoanType>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No loan types yet" }}
      />
    </main>
  );
}
