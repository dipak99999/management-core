"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Card,
  PageHeader,
  Skeleton,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface TBRow {
  accountId: string;
  accountName: string;
  rootType: string;
  accountType: string | null;
  debit: number;
  credit: number;
  balance: number;
}
interface TB {
  rows: TBRow[];
  totals: { debit: number; credit: number };
}

export default function TrialBalancePage() {
  const [data, setData] = useState<TB | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { qs } = useCompanyScope();

  useEffect(() => {
    setData(null);
    api
      .get<TB>(`/reports/trial-balance${qs}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [qs]);

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Reports" },
            { label: "Trial Balance" },
          ]}
          title="Trial Balance"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[
            { label: "Home", href: "/" },
            { label: "Reports" },
            { label: "Trial Balance" },
          ]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Trial Balance" },
        ]}
        title="Trial Balance"
        subtitle="All active GL entries, grouped by account. Debit and credit totals must match."
      />

      <div className="table-wrap overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Root Type</th>
              <th className="text-end">Debit</th>
              <th className="text-end">Credit</th>
              <th className="text-end">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const isEmpty = r.debit === 0 && r.credit === 0;
              const href = `/accounting/reports/general-ledger?accountId=${r.accountId}`;
              return (
                <tr
                  key={r.accountId}
                  className={`${isEmpty ? "text-ink-muted" : "hover:bg-surface-sunken cursor-pointer"}`}
                  onClick={() => {
                    if (!isEmpty) window.location.href = href;
                  }}
                  title={isEmpty ? "" : "Drill down to General Ledger"}
                >
                  <td>
                    {isEmpty ? (
                      r.accountName
                    ) : (
                      <a href={href} className="text-brand-600 hover:underline">
                        {r.accountName}
                      </a>
                    )}
                  </td>
                  <td className="text-sm">{r.rootType}</td>
                  <td className="text-end font-mono tabular-nums">{r.debit.toFixed(2)}</td>
                  <td className="text-end font-mono tabular-nums">{r.credit.toFixed(2)}</td>
                  <td className="text-end font-mono tabular-nums">
                    {r.balance !== 0
                      ? r.balance > 0
                        ? `${r.balance.toFixed(2)} Dr`
                        : `${Math.abs(r.balance).toFixed(2)} Cr`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-sunken font-semibold">
            <tr>
              <td colSpan={2}>Total</td>
              <td className="text-end font-mono tabular-nums">{data.totals.debit.toFixed(2)}</td>
              <td className="text-end font-mono tabular-nums">{data.totals.credit.toFixed(2)}</td>
              <td className="text-end">
                {Math.abs(data.totals.debit - data.totals.credit) < 0.01 ? (
                  <span className="text-green-700">Balanced</span>
                ) : (
                  <span className="text-red-700 tabular-nums">
                    Off by {(data.totals.debit - data.totals.credit).toFixed(2)}
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </main>
  );
}
