"use client";

import { useState } from "react";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Gstr1Row {
  rate: number;
  taxableValue: number;
  taxAmount: number;
  invoiceCount: number;
}
interface Gstr1 {
  from: string;
  to: string;
  b2b: Gstr1Row[];
  b2c: Gstr1Row[];
  totalTaxableValue: number;
  totalTax: number;
}
interface Gstr3b {
  from: string;
  to: string;
  outward: { taxableSupplies: number; tax: number };
  itc: { available: number };
  liability: number;
}

export default function GstReportsPage() {
  const now = new Date();
  const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(monthEnd);
  const [gstr1, setGstr1] = useState<Gstr1 | null>(null);
  const [gstr3b, setGstr3b] = useState<Gstr3b | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const [a, b] = await Promise.all([
        dashboardApi.get<Gstr1>(`/gst/gstr1?from=${from}&to=${to}`),
        dashboardApi.get<Gstr3b>(`/gst/gstr3b?from=${from}&to=${to}`),
      ]);
      setGstr1(a);
      setGstr3b(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "GST reports" }]}
        title="GST reports"
        subtitle="GSTR-1 outward supplies + GSTR-3B headline summary for a chosen period."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-4xl space-y-6">
      <div className="card p-4 flex gap-2 items-end">
        <div>
          <label className="text-xs uppercase text-gray-500">From</label>
          <input
            type="date"
            className="border rounded px-2 py-2"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs uppercase text-gray-500">To</label>
          <input
            type="date"
            className="border rounded px-2 py-2"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {busy ? "Loading…" : "Run"}
        </button>
      </div>

      {gstr3b && (
        <section className="bg-white rounded shadow p-4 space-y-2">
          <h2 className="font-medium">GSTR-3B (headline summary)</h2>
          <div className="text-xs text-gray-500">
            {gstr3b.from} → {gstr3b.to}
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <div className="text-xs uppercase text-gray-500">
                Outward taxable
              </div>
              <div className="text-lg font-semibold">
                {gstr3b.outward.taxableSupplies.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Outward tax</div>
              <div className="text-lg font-semibold">
                {gstr3b.outward.tax.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">ITC available</div>
              <div className="text-lg font-semibold">
                {gstr3b.itc.available.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">Net liability</div>
              <div
                className={`text-lg font-semibold ${
                  gstr3b.liability >= 0 ? "text-red-700" : "text-green-700"
                }`}
              >
                {gstr3b.liability.toFixed(2)}
              </div>
            </div>
          </div>
        </section>
      )}

      {gstr1 && (
        <section className="bg-white rounded shadow p-4 space-y-2">
          <h2 className="font-medium">GSTR-1 (outward supplies)</h2>
          <div className="text-xs text-gray-500">
            {gstr1.from} → {gstr1.to} · total taxable{" "}
            {gstr1.totalTaxableValue.toFixed(2)} · total tax{" "}
            {gstr1.totalTax.toFixed(2)}
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">
                B2B (registered)
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-start">
                  <tr>
                    <th className="px-2 py-1">Rate %</th>
                    <th className="px-2 py-1 text-end">Taxable</th>
                    <th className="px-2 py-1 text-end">Tax</th>
                    <th className="px-2 py-1 text-end">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {gstr1.b2b.map((r) => (
                    <tr key={r.rate} className="border-t">
                      <td className="px-2 py-1">{r.rate}</td>
                      <td className="px-2 py-1 text-end">
                        {r.taxableValue.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-end">
                        {r.taxAmount.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-end">{r.invoiceCount}</td>
                    </tr>
                  ))}
                  {gstr1.b2b.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-center text-gray-500">
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">
                B2C (unregistered)
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 text-start">
                  <tr>
                    <th className="px-2 py-1">Rate %</th>
                    <th className="px-2 py-1 text-end">Taxable</th>
                    <th className="px-2 py-1 text-end">Tax</th>
                    <th className="px-2 py-1 text-end">Invoices</th>
                  </tr>
                </thead>
                <tbody>
                  {gstr1.b2c.map((r) => (
                    <tr key={r.rate} className="border-t">
                      <td className="px-2 py-1">{r.rate}</td>
                      <td className="px-2 py-1 text-end">
                        {r.taxableValue.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-end">
                        {r.taxAmount.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-end">{r.invoiceCount}</td>
                    </tr>
                  ))}
                  {gstr1.b2c.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-center text-gray-500">
                        —
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      </div>
    </AppShell>
  );
}
