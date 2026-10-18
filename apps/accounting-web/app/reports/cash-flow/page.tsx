"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
} from "../../../components/ui";
import { useCompanyScope } from "../../../components/company-scope";

interface Breakdown {
  voucherType: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
}
interface Section {
  inflow: number;
  outflow: number;
  net: number;
  breakdown: Breakdown[];
}
interface CashFlow {
  from: string;
  to: string;
  openingBalance: number;
  closingBalance: number;
  netChange: number;
  operating: Section;
  investing: Section;
  financing: Section;
  cashAccounts: { id: string; name: string; accountType: string | null }[];
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "decimal",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(n);
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SectionBlock({ title, section }: { title: string; section: Section }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-ink">{title} activities</h3>
        <span
          className={`font-mono tabular-nums text-sm ${section.net >= 0 ? "text-green-700" : "text-red-700"}`}
        >
          {section.net >= 0 ? "+" : ""}
          {fmtMoney(section.net)}
        </span>
      </div>
      {section.breakdown.length === 0 ? (
        <div className="text-xs text-ink-muted">No activity in this period.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-ink-muted text-start text-xs">
            <tr>
              <th className="py-1">Source</th>
              <th className="py-1 text-end">Inflow</th>
              <th className="py-1 text-end">Outflow</th>
              <th className="py-1 text-end">Net</th>
              <th className="py-1 text-end">Txns</th>
            </tr>
          </thead>
          <tbody>
            {section.breakdown.map((b) => (
              <tr key={b.voucherType} className="border-t border-ink-muted/10">
                <td className="py-1">{b.voucherType}</td>
                <td className="py-1 text-end font-mono tabular-nums">
                  {b.inflow > 0 ? fmtMoney(b.inflow) : "—"}
                </td>
                <td className="py-1 text-end font-mono tabular-nums">
                  {b.outflow > 0 ? fmtMoney(b.outflow) : "—"}
                </td>
                <td
                  className={`py-1 text-end font-mono tabular-nums ${b.net >= 0 ? "text-green-700" : "text-red-700"}`}
                >
                  {b.net >= 0 ? "+" : ""}
                  {fmtMoney(b.net)}
                </td>
                <td className="py-1 text-end text-xs text-ink-muted tabular-nums">{b.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function CashFlowPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<CashFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { companyId } = useCompanyScope();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const co = companyId ? `&companyId=${encodeURIComponent(companyId)}` : "";
      setData(
        await api.get<CashFlow>(
          `/reports/cash-flow?from=${from}&to=${to}${co}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <main className="p-8 space-y-4 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports" },
          { label: "Cash Flow" },
        ]}
        title="Cash flow statement"
        subtitle="Direct-method statement showing every cash + bank movement in the period classified as Operating, Investing, or Financing. Source: GL entries against your Cash/Bank accounts."
      />

      <Card className="p-3 flex gap-3 items-end">
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
        <Button variant="primary" onClick={run} disabled={busy} type="button">
          {busy ? "…" : "Run"}
        </Button>
      </Card>

      {error && (
        <Card className="p-3 text-red-700 border-red-200 bg-red-50 text-sm">{error}</Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Opening cash</div>
              <div className="font-semibold text-lg font-mono tabular-nums">
                {fmtMoney(data.openingBalance)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Net change</div>
              <div
                className={`font-semibold text-lg font-mono tabular-nums ${data.netChange >= 0 ? "text-green-700" : "text-red-700"}`}
              >
                {data.netChange >= 0 ? "+" : ""}
                {fmtMoney(data.netChange)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Closing cash</div>
              <div className="font-semibold text-lg font-mono tabular-nums">
                {fmtMoney(data.closingBalance)}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Cash accounts</div>
              <div className="text-xs">
                {data.cashAccounts.length === 0
                  ? "None"
                  : data.cashAccounts.map((a) => a.name).join(", ")}
              </div>
            </Card>
          </div>

          <SectionBlock title="Operating" section={data.operating} />
          <SectionBlock title="Investing" section={data.investing} />
          <SectionBlock title="Financing" section={data.financing} />
        </>
      )}
    </main>
  );
}
