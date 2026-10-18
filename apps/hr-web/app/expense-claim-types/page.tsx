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

interface Account { id: string; accountName: string; rootType: string; isGroup: boolean }
interface ClaimType {
  id: string;
  typeName: string;
  description: string | null;
  expenseAccountId: string | null;
  expenseAccount: { id: string; accountName: string } | null;
}

const ACCOUNTING = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
function token(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

async function loadAccounts(): Promise<Account[]> {
  const res = await fetch(`${ACCOUNTING}/accounts`, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`Accounts fetch failed (${res.status})`);
  return res.json();
}

const emptyForm = { typeName: "", expenseAccountId: "", description: "" };

export default function ExpenseClaimTypesPage() {
  const [rows, setRows] = useState<ClaimType[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [ts, accs] = await Promise.all([
        api.get<ClaimType[]>("/expense-claim-types"),
        loadAccounts(),
      ]);
      setRows(ts);
      setAccounts(accs.filter((a) => !a.isGroup && a.rootType === "Expense"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Expense Claim Type",
    plural: "Expense Claim Types",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/expense-claim-types", {
        ...form,
        expenseAccountId: form.expenseAccountId || null,
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

  const cols: Column<ClaimType>[] = [
    {
      header: "Type",
      cell: (r) => <span className="font-medium text-ink">{r.typeName}</span>,
    },
    {
      header: "Account",
      cell: (r) =>
        r.expenseAccount?.accountName ?? (
          <span className="text-ink-muted italic">(tenant default)</span>
        ),
    },
    {
      header: "Description",
      cell: (r) => (
        <span className="text-ink-muted text-sm">{r.description ?? "—"}</span>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Expense claim types" },
        ]}
        title="Expense claim types"
        subtitle="Reimbursement categories — optionally map to specific expense accounts."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowForm((s) => !s)}
            type="button"
          >
            {showForm ? "Cancel" : "+ New type"}
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
          <SectionHeader title="New expense claim type" />
          <form onSubmit={create} className="space-y-3">
            <FormField label="Type name" required>
              <input
                required
                className="input"
                placeholder="Travel, Meals, Supplies…"
                value={form.typeName}
                onChange={(e) => setForm({ ...form, typeName: e.target.value })}
              />
            </FormField>
            <FormField label="Expense account">
              <select
                className="input"
                value={form.expenseAccountId}
                onChange={(e) =>
                  setForm({ ...form, expenseAccountId: e.target.value })
                }
              >
                <option value="">(use tenant default expense account)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
              </select>
            </FormField>
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

      <DataTable<ClaimType>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "No expense claim types yet" }}
      />
    </main>
  );
}
