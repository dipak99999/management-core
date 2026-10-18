"use client";

import { useCallback, useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../../lib/dashboards";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../../components/ui";

// TDS deposit tracking. Two panels:
//   Top:    Monthly-due summary for the current FY. Per (section, month):
//           deducted vs paid via challan → dueBalance. Rows in the red
//           when a month has deducted TDS but no matching challan yet.
//   Bottom: Challan history + form to add a new challan.

interface Category {
  id: string;
  name: string;
  sectionCode: string | null;
}

interface Challan {
  id: string;
  bsrCode: string;
  challanSerialNo: string;
  paidDate: string;
  amountPaid: string;
  fyLabel: string;
  quarter: number;
  notes: string | null;
  category: { name: string; sectionCode: string | null };
}

interface MonthlyDueRow {
  fyLabel: string;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  categoryId: string;
  categoryName: string;
  sectionCode: string;
  deducted: number;
  paid: number;
  dueBalance: number;
  challans: {
    id: string;
    bsrCode: string;
    challanSerialNo: string;
    paidDate: string;
    amountPaid: number;
  }[];
}

const emptyForm = {
  categoryId: "",
  bsrCode: "",
  challanSerialNo: "",
  paidDate: new Date().toISOString().slice(0, 10),
  amountPaid: "",
  notes: "",
};

export default function TdsChallansPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [challans, setChallans] = useState<Challan[]>([]);
  const [monthly, setMonthly] = useState<MonthlyDueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cats, chals, due] = await Promise.all([
        dashboardApi.get<Category[]>("/tax-withholding-categories"),
        dashboardApi.get<Challan[]>("/tds-challans"),
        dashboardApi.get<{ fyLabel: string | null; rows: MonthlyDueRow[] }>(
          "/reports/tds-monthly-due",
        ),
      ]);
      setCategories(cats);
      setChallans(chals);
      setMonthly(due.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useListPageCommands({
    singular: "Tds Challan",
    plural: "Tds Challans",
    refresh: load,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await dashboardApi.post("/tds-challans", {
        ...form,
        paidDate: new Date(form.paidDate).toISOString(),
        amountPaid: Number(form.amountPaid),
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

  async function del(id: string) {
    if (!confirm("Delete challan?")) return;
    setBusy(true);
    try {
      await dashboardApi.delete(`/tds-challans/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // Aggregate the monthly-due into a headline: total deducted, total paid,
  // total outstanding. Highlights months with dueBalance > 0.
  const totals = monthly.reduce(
    (t, r) => ({
      deducted: t.deducted + r.deducted,
      paid: t.paid + r.paid,
      due: t.due + Math.max(0, r.dueBalance),
    }),
    { deducted: 0, paid: 0, due: 0 },
  );
  const outstandingMonths = monthly.filter((r) => r.dueBalance > 0.01).length;

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Reports" },
          { label: "TDS challans" },
        ]}
        title="TDS challans"
        subtitle="Track monthly TDS deposits (Section 200 requires deposit by the 7th of the following month). Red rows: deducted TDS with no matching challan yet."
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

      <div className="max-w-6xl space-y-6">

      <section className="space-y-3">
        <h2 className="font-medium">Monthly TDS due — current FY</h2>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded shadow">
            <div className="text-xs uppercase text-gray-500">Deducted</div>
            <div className="text-2xl font-semibold">
              ₹{totals.deducted.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <div className="text-xs uppercase text-gray-500">Deposited (challans)</div>
            <div className="text-2xl font-semibold">
              ₹{totals.paid.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <div className="text-xs uppercase text-gray-500">Still owed</div>
            <div
              className={`text-2xl font-semibold ${
                totals.due > 0.01 ? "text-red-600" : "text-green-700"
              }`}
            >
              ₹{totals.due.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <div className="text-xs uppercase text-gray-500">Months with balance</div>
            <div
              className={`text-2xl font-semibold ${
                outstandingMonths > 0 ? "text-red-600" : "text-green-700"
              }`}
            >
              {outstandingMonths}
            </div>
          </div>
        </div>

        <div className="bg-white rounded shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600 text-start">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-end">Deducted</th>
                <th className="px-3 py-2 text-end">Deposited</th>
                <th className="px-3 py-2 text-end">Balance</th>
                <th className="px-3 py-2">Challans</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((r) => (
                <tr
                  key={`${r.monthLabel}-${r.categoryId}`}
                  className={`border-t ${r.dueBalance > 0.01 ? "bg-red-50" : ""}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.monthLabel}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.sectionCode}</td>
                  <td className="px-3 py-2">{r.categoryName}</td>
                  <td className="px-3 py-2 text-end">
                    ₹{r.deducted.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-end">
                    ₹{r.paid.toLocaleString("en-IN")}
                  </td>
                  <td
                    className={`px-3 py-2 text-end font-semibold ${
                      r.dueBalance > 0.01 ? "text-red-600" : "text-green-700"
                    }`}
                  >
                    ₹{r.dueBalance.toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.challans.length > 0
                      ? r.challans
                          .map((c) => `${c.bsrCode}-${c.challanSerialNo}`)
                          .join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
              {monthly.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                    No TDS deducted this FY yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Challan history</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-brand-600 text-white px-3 py-2 rounded"
          >
            {showForm ? "Cancel" : "+ Add challan"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="bg-white p-4 rounded shadow space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {/* Labels wrap their input so screen readers + Playwright's
                  getByLabel() can associate them without an id/htmlFor
                  dance on every field. */}
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">Category</span>
                <select
                  className="border rounded px-2 py-2 w-full mt-1"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.sectionCode ? ` (${c.sectionCode})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">
                  BSR code (7 digits)
                </span>
                <input
                  className="border rounded px-2 py-2 w-full mt-1 font-mono"
                  value={form.bsrCode}
                  onChange={(e) => setForm({ ...form, bsrCode: e.target.value })}
                  pattern="[0-9]{7}"
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">
                  Challan serial no
                </span>
                <input
                  className="border rounded px-2 py-2 w-full mt-1 font-mono"
                  value={form.challanSerialNo}
                  onChange={(e) =>
                    setForm({ ...form, challanSerialNo: e.target.value })
                  }
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">Paid date</span>
                <input
                  type="date"
                  className="border rounded px-2 py-2 w-full mt-1"
                  value={form.paidDate}
                  onChange={(e) => setForm({ ...form, paidDate: e.target.value })}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">
                  Amount paid (₹)
                </span>
                <input
                  type="number"
                  step="0.01"
                  className="border rounded px-2 py-2 w-full mt-1"
                  value={form.amountPaid}
                  onChange={(e) => setForm({ ...form, amountPaid: e.target.value })}
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-gray-500 block">Notes</span>
                <input
                  className="border rounded px-2 py-2 w-full mt-1"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                />
              </label>
            </div>
            <button
              disabled={busy}
              className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save challan"}
            </button>
          </form>
        )}

        <div className="bg-white rounded shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600 text-start">
              <tr>
                <th className="px-3 py-2">Paid date</th>
                <th className="px-3 py-2">Section</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">BSR / Serial</th>
                <th className="px-3 py-2 text-end">Amount</th>
                <th className="px-3 py-2">FY / Q</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {challans.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2 text-xs">
                    {new Date(c.paidDate).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.category.sectionCode ?? "—"}
                  </td>
                  <td className="px-3 py-2">{c.category.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.bsrCode}-{c.challanSerialNo}
                  </td>
                  <td className="px-3 py-2 text-end">
                    ₹{Number(c.amountPaid).toLocaleString("en-IN")}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.fyLabel} · Q{c.quarter}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <button
                      onClick={() => del(c.id)}
                      className="text-red-600 hover:underline text-xs"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {challans.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-ink-muted">
                    No challans recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      </div>
    </AppShell>
  );
}
