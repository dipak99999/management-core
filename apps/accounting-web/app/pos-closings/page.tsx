"use client";

// Audit list of past session closings — cashier + profile + sales + diff.

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { PageHeader, Card } from "../../components/ui";

type Row = {
  id: string;
  name: string;
  status: string;
  postingDate: string;
  totalSales: string;
  totalDifference: string;
  invoiceCount: number;
  posProfile: { title: string };
  user: { fullName: string };
};

export default function POSClosingsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Row[]>("/pos-closings")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="POS Session Closings"
        subtitle="Reconciliation records — expected vs counted per method."
      />
      {error && <div className="mt-3 text-danger">{error}</div>}
      <Card className="mt-4">
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-ink-muted uppercase">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Date</th>
              <th className="p-3">Cashier</th>
              <th className="p-3">Terminal</th>
              <th className="p-3 text-end">Invoices</th>
              <th className="p-3 text-end">Sales</th>
              <th className="p-3 text-end">Difference</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-ink-muted">
                  No sessions closed yet.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const diff = Number(r.totalDifference);
              return (
                <tr key={r.id} className="border-t hover:bg-surface-2">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3">{r.postingDate.slice(0, 10)}</td>
                  <td className="p-3">{r.user.fullName}</td>
                  <td className="p-3">{r.posProfile.title}</td>
                  <td className="p-3 text-end">{r.invoiceCount}</td>
                  <td className="p-3 text-end">{Number(r.totalSales).toFixed(2)}</td>
                  <td className={`p-3 text-end ${diff === 0 ? "" : "text-danger"}`}>
                    {diff.toFixed(2)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${r.status === "Submitted" ? "bg-brand-50 text-brand-600" : "bg-surface-2 text-ink-muted"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
