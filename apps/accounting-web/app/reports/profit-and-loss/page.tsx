"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface Row {
  accountId: string;
  accountName: string;
  amount: number;
}
interface PL {
  from: string | null;
  to: string | null;
  income: Row[];
  expense: Row[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

function fmtMoney(n: number) {
  const s = Math.abs(n).toFixed(2);
  return n < 0 ? `(${s})` : s;
}

// Default: current fiscal year (Apr 1 → today) — India convention. Adjust later.
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    from: new Date(year, 3, 1).toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function ProfitLossPage() {
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [data, setData] = useState<PL | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { companyId } = useCompanyScope();

  async function load() {
    setError(null);
    try {
      const co = companyId ? `&companyId=${encodeURIComponent(companyId)}` : "";
      const d = await api.get<PL>(
        `/reports/profit-and-loss?from=${new Date(from).toISOString()}&to=${new Date(
          to,
        ).toISOString()}${co}`,
      );
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useListPageCommands({
    singular: "Profit And Los",
    plural: "Profit And Loss",
    refresh: load,
  });

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Profit & Loss" },
        ]}
        title="Profit & Loss"
      />

      <Card className="p-3 flex items-end gap-3">
        <FormField label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </FormField>
        <FormField label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </FormField>
        <Button variant="primary" onClick={load} type="button">
          Run
        </Button>
      </Card>

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {data && (
        <Card>
          <div className="table-wrap overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-end w-40">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-surface-sunken">
                  <td className="px-4 py-2 font-semibold" colSpan={2}>
                    Income
                  </td>
                </tr>
                {data.income.map((r) => (
                  <tr key={r.accountId} className="hover:bg-surface-sunken">
                    <td className="px-4 py-2 ps-8">
                      <a
                        href={`/accounting/reports/general-ledger?accountId=${r.accountId}${data.from ? `&from=${data.from}` : ""}${data.to ? `&to=${data.to}` : ""}`}
                        className="text-brand-600 hover:underline"
                      >
                        {r.accountName}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-sunken">
                  <td className="px-4 py-2 font-semibold">Total Income</td>
                  <td className="px-4 py-2 text-end font-semibold font-mono tabular-nums">
                    {fmtMoney(data.totalIncome)}
                  </td>
                </tr>

                <tr className="bg-surface-sunken">
                  <td className="px-4 py-2 font-semibold pt-6" colSpan={2}>
                    Expenses
                  </td>
                </tr>
                {data.expense.map((r) => (
                  <tr key={r.accountId} className="hover:bg-surface-sunken">
                    <td className="px-4 py-2 ps-8">
                      <a
                        href={`/accounting/reports/general-ledger?accountId=${r.accountId}${data.from ? `&from=${data.from}` : ""}${data.to ? `&to=${data.to}` : ""}`}
                        className="text-brand-600 hover:underline"
                      >
                        {r.accountName}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-sunken">
                  <td className="px-4 py-2 font-semibold">Total Expenses</td>
                  <td className="px-4 py-2 text-end font-semibold font-mono tabular-nums">
                    {fmtMoney(data.totalExpense)}
                  </td>
                </tr>
              </tbody>
              <tfoot
                className={`border-t-2 ${data.netProfit >= 0 ? "bg-green-50" : "bg-red-50"}`}
              >
                <tr>
                  <td className="px-4 py-3 font-bold text-lg">
                    {data.netProfit >= 0 ? "Net Profit" : "Net Loss"}
                  </td>
                  <td className="px-4 py-3 text-end font-bold text-lg font-mono tabular-nums">
                    {fmtMoney(data.netProfit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
