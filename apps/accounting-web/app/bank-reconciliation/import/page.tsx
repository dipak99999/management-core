"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";

interface Account {
  id: string;
  accountName: string;
  accountType: string | null;
  isGroup: boolean;
  disabled: boolean;
  rootType: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const c = s.indexOf(",");
      resolve(c >= 0 ? s.slice(c + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function ImportStatementPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Account[]>("/accounts")
      .then((rs) =>
        setAccounts(
          rs.filter(
            (a) =>
              !a.isGroup &&
              !a.disabled &&
              a.rootType === "Asset" &&
              (a.accountType === "Bank" || a.accountType === "Cash"),
          ),
        ),
      )
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      const result = await api.post<{ id: string; transactionCount: number }>(
        "/bank-reconciliation/import",
        {
          accountId,
          fileName: file.name,
          base64,
        },
      );
      location.href = `/accounting/bank-reconciliation/${result.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-2xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Bank Reconciliation", href: "/accounting/bank-reconciliation" },
          { label: "Import" },
        ]}
        title="Import bank statement"
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      <Card className="p-4">
        <form onSubmit={submit} className="space-y-3">
          <FormField label="Bank/Cash account" required>
            <select
              required
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName}
                </option>
              ))}
            </select>
            {accounts.length === 0 && (
              <div className="text-xs text-amber-700 mt-1">
                No Bank/Cash leaf accounts found. Create one in Chart of Accounts first.
              </div>
            )}
          </FormField>

          <FormField label="Statement CSV file" required>
            <input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
            />
          </FormField>

          <div className="text-xs text-ink-muted border-s-4 border-ink-muted/20 ps-3 py-1">
            <div className="font-semibold text-ink-soft">Expected CSV columns (case-insensitive):</div>
            <div>
              <code>date</code>, <code>description</code>, and either{" "}
              <code>amount</code> (signed: + for deposits, − for withdrawals) OR{" "}
              <code>debit</code> + <code>credit</code>.
            </div>
            <div>
              Optional: <code>reference</code>, <code>balance</code>.
            </div>
          </div>

          <Button variant="primary" type="submit" disabled={busy || !file || !accountId}>
            {busy ? "Importing..." : "Import"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
