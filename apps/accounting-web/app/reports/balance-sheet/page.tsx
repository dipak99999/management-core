"use client";

import { Fragment, useEffect, useState } from "react";
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
interface BS {
  asOfDate: string;
  assets: Row[];
  liabilities: Row[];
  equity: Row[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  retainedEarnings: number;
  totalLiabAndEquity: number;
  difference: number;
  balanced: boolean;
}

function fmtMoney(n: number) {
  const s = Math.abs(n).toFixed(2);
  return n < 0 ? `(${s})` : s;
}

function Section({
  title,
  rows,
  total,
  asOfDate,
}: {
  title: string;
  rows: Row[];
  total: number;
  asOfDate: string;
}) {
  return (
    <Fragment>
      <tr className="bg-surface-sunken">
        <td className="px-4 py-2 font-semibold pt-4" colSpan={2}>
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.accountId} className="hover:bg-surface-sunken">
          <td className="px-4 py-2 ps-8">
            <a
              href={`/accounting/reports/general-ledger?accountId=${r.accountId}&to=${asOfDate}`}
              className="text-brand-600 hover:underline"
            >
              {r.accountName}
            </a>
          </td>
          <td className="px-4 py-2 text-end font-mono tabular-nums">{fmtMoney(r.amount)}</td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr>
          <td className="px-4 py-2 ps-8 text-ink-muted italic" colSpan={2}>
            No activity
          </td>
        </tr>
      )}
      <tr className="bg-surface-sunken">
        <td className="px-4 py-2 font-semibold">Total {title}</td>
        <td className="px-4 py-2 text-end font-semibold font-mono tabular-nums">{fmtMoney(total)}</td>
      </tr>
    </Fragment>
  );
}

export default function BalanceSheetPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<BS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { companyId } = useCompanyScope();

  async function load() {
    setError(null);
    try {
      const co = companyId ? `&companyId=${encodeURIComponent(companyId)}` : "";
      const d = await api.get<BS>(
        `/reports/balance-sheet?asOfDate=${new Date(asOfDate).toISOString()}${co}`,
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
    singular: "Balance Sheet",
    plural: "Balance Sheet",
    refresh: load,
  });

  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Balance Sheet" },
        ]}
        title="Balance Sheet"
      />

      <Card className="p-3 flex items-end gap-3">
        <FormField label="As of">
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
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
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <div className="table-wrap overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Assets</th>
                    <th className="text-end w-40">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <Section
                    title="Assets"
                    rows={data.assets}
                    total={data.totalAssets}
                    asOfDate={data.asOfDate}
                  />
                </tbody>
                <tfoot className="border-t-2 bg-surface-sunken">
                  <tr>
                    <td className="px-4 py-3 font-bold">Total Assets</td>
                    <td className="px-4 py-3 text-end font-bold font-mono tabular-nums">
                      {fmtMoney(data.totalAssets)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <div className="table-wrap overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Liabilities &amp; Equity</th>
                    <th className="text-end w-40">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <Section
                    title="Liabilities"
                    rows={data.liabilities}
                    total={data.totalLiabilities}
                    asOfDate={data.asOfDate}
                  />
                  <Section
                    title="Equity"
                    rows={data.equity}
                    total={data.totalEquity}
                    asOfDate={data.asOfDate}
                  />
                  <tr>
                    <td className="px-4 py-2 ps-8">Retained Earnings (current period)</td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums">
                      {fmtMoney(data.retainedEarnings)}
                    </td>
                  </tr>
                </tbody>
                <tfoot className="border-t-2 bg-surface-sunken">
                  <tr>
                    <td className="px-4 py-3 font-bold">Total Liabilities &amp; Equity</td>
                    <td className="px-4 py-3 text-end font-bold font-mono tabular-nums">
                      {fmtMoney(data.totalLiabAndEquity)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card
            className={`col-span-2 p-3 text-center font-semibold ${
              data.balanced ? "bg-green-50 text-green-800 border-green-200" : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {data.balanced
              ? "✓ Balanced (Assets = Liabilities + Equity + Retained Earnings)"
              : `⚠ Off by ${fmtMoney(data.difference)} — there's a bug somewhere in GL posting`}
          </Card>
        </div>
      )}
    </main>
  );
}
