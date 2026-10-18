"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";

interface Account { id: string; accountName: string; isGroup: boolean; rootType: string }

interface Line { accountId: string; debit: number; credit: number }
interface ExistingJE {
  status: string;
  remarks: string | null;
  accounts: { accountId: string; debit: string; credit: string }[];
}

function InnerNewJournalEntryPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { accountId: "", debit: 0, credit: 0 },
    { accountId: "", debit: 0, credit: 0 },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Account[]>("/accounts")
      .then((all) => setAccounts(all.filter((a) => !a.isGroup)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingJE>(`/journal-entries/${editId}`)
      .then((je) => {
        if (je.status !== "Draft") {
          setError(`Cannot edit JE in status ${je.status}`);
          return;
        }
        setRemarks(je.remarks ?? "");
        setLines(
          je.accounts.length
            ? je.accounts.map((a) => ({
                accountId: a.accountId,
                debit: Number(a.debit),
                credit: Number(a.credit),
              }))
            : [
                { accountId: "", debit: 0, credit: 0 },
                { accountId: "", debit: 0, credit: 0 },
              ],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const totalDebit = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
    [lines],
  );
  const totalCredit = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
    [lines],
  );
  const balanced = Math.abs(totalDebit - totalCredit) < 0.0001 && totalDebit > 0;

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        remarks,
        accounts: lines
          .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0))
          .map((l) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
          })),
      };
      if (editId) {
        await api.put(`/journal-entries/${editId}`, body);
        location.href = `/accounting/journal-entries/${editId}`;
      } else {
        await api.post("/journal-entries", body);
        location.href = "/accounting/journal-entries";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Journal Entries", href: "/accounting/journal-entries" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Journal Entry" : "New Journal Entry"}
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
        <form onSubmit={submit} className="space-y-4">
          <div>
            <div className="label mb-2">Lines</div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start">
                <tr>
                  <th className="py-1">Account</th>
                  <th className="py-1 w-28">Debit</th>
                  <th className="py-1 w-28">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1 pe-2">
                      <select
                        className="input"
                        value={l.accountId}
                        onChange={(e) => updateLine(idx, { accountId: e.target.value })}
                      >
                        <option value="">Select account...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({a.rootType})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pe-2">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input tabular-nums"
                        value={l.debit || ""}
                        onChange={(e) =>
                          updateLine(idx, {
                            debit: Number(e.target.value),
                            credit: Number(e.target.value) > 0 ? 0 : l.credit,
                          })
                        }
                      />
                    </td>
                    <td className="py-1">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        className="input tabular-nums"
                        value={l.credit || ""}
                        onChange={(e) =>
                          updateLine(idx, {
                            credit: Number(e.target.value),
                            debit: Number(e.target.value) > 0 ? 0 : l.debit,
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="mt-2"
              onClick={() => setLines([...lines, { accountId: "", debit: 0, credit: 0 }])}
            >
              + Add line
            </Button>
          </div>

          <FormField label="Remarks">
            <textarea
              className="input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <div className="text-sm">
              <span className="me-4 tabular-nums">
                Debit: <b>{totalDebit.toFixed(2)}</b>
              </span>
              <span className="me-4 tabular-nums">
                Credit: <b>{totalCredit.toFixed(2)}</b>
              </span>
              <span className={balanced ? "text-green-700" : "text-red-600"}>
                {balanced ? "Balanced" : `Off by ${(totalDebit - totalCredit).toFixed(2)}`}
              </span>
            </div>
            <Button variant="primary" type="submit" disabled={busy || !balanced}>
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}

export default function NewJournalEntryPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewJournalEntryPage />
    </Suspense>
  );
}
