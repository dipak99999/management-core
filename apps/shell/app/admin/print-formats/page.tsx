"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface PrintFormat {
  id: string;
  doctype: string;
  name: string;
  isDefault: boolean;
  headerText: string | null;
  footerText: string | null;
  thankYouNote: string | null;
  termsText: string | null;
  showItemDescription: boolean;
  showTaxBreakdown: boolean;
  showRemarks: boolean;
  paperSize: string;
  orientation: string;
}

const DOCTYPES = [
  "SalesInvoice",
  "PurchaseInvoice",
  "PaymentEntry",
  "JournalEntry",
  "Quotation",
  "SalesOrder",
  "DeliveryNote",
  "PurchaseReceipt",
  "StockEntry",
  "ExpenseClaim",
  "SalarySlip",
  "Loan",
];

const emptyForm = {
  doctype: "SalesInvoice",
  name: "",
  isDefault: false,
  headerText: "",
  footerText: "",
  thankYouNote: "",
  termsText: "",
  showItemDescription: true,
  showTaxBreakdown: true,
  showRemarks: true,
  paperSize: "A4" as "A4" | "Letter" | "Legal",
  orientation: "portrait" as "portrait" | "landscape",
};

export default function PrintFormatsPage() {
  const [rows, setRows] = useState<PrintFormat[]>([]);
  const [editing, setEditing] = useState<PrintFormat | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await dashboardApi.get<PrintFormat[]>("/print-formats"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Print Format",
    plural: "Print Formats",
    refresh: load,
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(f: PrintFormat) {
    setEditing(f);
    setForm({
      doctype: f.doctype,
      name: f.name,
      isDefault: f.isDefault,
      headerText: f.headerText ?? "",
      footerText: f.footerText ?? "",
      thankYouNote: f.thankYouNote ?? "",
      termsText: f.termsText ?? "",
      showItemDescription: f.showItemDescription,
      showTaxBreakdown: f.showTaxBreakdown,
      showRemarks: f.showRemarks,
      paperSize: f.paperSize as "A4" | "Letter" | "Legal",
      orientation: f.orientation as "portrait" | "landscape",
    });
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...form,
        headerText: form.headerText || null,
        footerText: form.footerText || null,
        thankYouNote: form.thankYouNote || null,
        termsText: form.termsText || null,
      };
      if (editing) {
        await dashboardApi.put(`/print-formats/${editing.id}`, payload);
      } else {
        await dashboardApi.post("/print-formats", payload);
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete print format?")) return;
    try {
      await dashboardApi.delete(`/print-formats/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Print formats" }]}
        title="Print formats"
        subtitle="Per-doctype print templates: header/footer, thank-you note, terms, column toggles."
        actions={
          <Button variant="brand" onClick={openNew} type="button">
            + New print format
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-4xl space-y-4">

      {showForm && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select
              className="border rounded px-3 py-2"
              value={form.doctype}
              onChange={(e) => setForm({ ...form, doctype: e.target.value })}
              disabled={!!editing}
            >
              {DOCTYPES.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <input
              className="border rounded px-3 py-2"
              placeholder="Format name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select
              className="border rounded px-3 py-2"
              value={form.paperSize}
              onChange={(e) =>
                setForm({ ...form, paperSize: e.target.value as "A4" | "Letter" | "Legal" })
              }
            >
              <option>A4</option>
              <option>Letter</option>
              <option>Legal</option>
            </select>
            <select
              className="border rounded px-3 py-2"
              value={form.orientation}
              onChange={(e) =>
                setForm({ ...form, orientation: e.target.value as "portrait" | "landscape" })
              }
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Default for this doctype
            </label>
          </div>
          <textarea
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Header text (opt)"
            rows={2}
            value={form.headerText}
            onChange={(e) => setForm({ ...form, headerText: e.target.value })}
          />
          <textarea
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Footer text (opt, overrides letterhead footer)"
            rows={2}
            value={form.footerText}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
          />
          <textarea
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Thank you note (opt)"
            rows={2}
            value={form.thankYouNote}
            onChange={(e) => setForm({ ...form, thankYouNote: e.target.value })}
          />
          <textarea
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Terms & Conditions (opt)"
            rows={3}
            value={form.termsText}
            onChange={(e) => setForm({ ...form, termsText: e.target.value })}
          />
          <div className="text-sm space-y-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.showItemDescription}
                onChange={(e) => setForm({ ...form, showItemDescription: e.target.checked })}
              />
              Show item descriptions
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.showTaxBreakdown}
                onChange={(e) => setForm({ ...form, showTaxBreakdown: e.target.checked })}
              />
              Show tax breakdown
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.showRemarks}
                onChange={(e) => setForm({ ...form, showRemarks: e.target.checked })}
              />
              Show remarks
            </label>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              className="bg-brand-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {busy ? "Saving…" : editing ? "Update" : "Save"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-600">
              Cancel
            </button>
          </div>
        </form>
      )}

      <table className="w-full bg-white rounded shadow overflow-hidden text-sm">
        <thead className="bg-gray-100 text-start text-gray-600">
          <tr>
            <th className="px-4 py-2">Doctype</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Paper</th>
            <th className="px-4 py-2">Default</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2 text-xs">{r.doctype}</td>
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 text-xs">
                {r.paperSize} {r.orientation}
              </td>
              <td className="px-4 py-2 text-xs">
                {r.isDefault && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                    Default
                  </span>
                )}
              </td>
              <td className="px-4 py-2 text-end text-xs space-x-2">
                <button onClick={() => openEdit(r)} className="text-brand-600">
                  Edit
                </button>
                <button onClick={() => del(r.id)} className="text-red-600">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                No print formats yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </AppShell>
  );
}
