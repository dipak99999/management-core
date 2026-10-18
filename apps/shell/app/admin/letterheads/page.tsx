"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { dashboardApi } from "../../../lib/dashboards";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Letterhead {
  id: string;
  name: string;
  logoBase64: string | null;
  addressText: string | null;
  footerText: string | null;
  isDefault: boolean;
  appliesToDoctypes: string[];
}

const emptyForm = {
  name: "",
  logoBase64: "",
  addressText: "",
  footerText: "",
  isDefault: false,
  appliesToDoctypes: "",
};

export default function LetterheadsPage() {
  const [rows, setRows] = useState<Letterhead[]>([]);
  const [editing, setEditing] = useState<Letterhead | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setRows(await dashboardApi.get<Letterhead[]>("/letterheads"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Letterhead",
    plural: "Letterheads",
    refresh: load,
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }
  function openEdit(l: Letterhead) {
    setEditing(l);
    setForm({
      name: l.name,
      logoBase64: l.logoBase64 ?? "",
      addressText: l.addressText ?? "",
      footerText: l.footerText ?? "",
      isDefault: l.isDefault,
      appliesToDoctypes: l.appliesToDoctypes.join(", "),
    });
    setShowForm(true);
  }

  async function onLogoFile(f: File) {
    if (f.size > 500_000) {
      setError("Logo file must be < 500 KB");
      return;
    }
    const buf = await f.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b64 = (globalThis as any).btoa(
      String.fromCharCode(...new Uint8Array(buf)),
    );
    const dataUri = `data:${f.type};base64,${b64}`;
    setForm((s) => ({ ...s, logoBase64: dataUri }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        logoBase64: form.logoBase64 || null,
        addressText: form.addressText || null,
        footerText: form.footerText || null,
        isDefault: form.isDefault,
        appliesToDoctypes: form.appliesToDoctypes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (editing) {
        await dashboardApi.put(`/letterheads/${editing.id}`, payload);
      } else {
        await dashboardApi.post("/letterheads", payload);
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
    if (!confirm("Delete letterhead?")) return;
    try {
      await dashboardApi.delete(`/letterheads/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Letterheads" }]}
        title="Letterheads"
        subtitle="Branded header/footer templates applied to printed documents (invoices, quotes, etc.)."
        actions={
          <Button variant="brand" onClick={openNew} type="button">
            + New letterhead
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
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Letterhead name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div>
            <label className="text-xs uppercase text-gray-500">Logo (opt, {"<"} 500KB)</label>
            <input
              type="file"
              accept="image/*"
              className="block text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onLogoFile(f);
              }}
            />
            {form.logoBase64 && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={form.logoBase64}
                alt="logo preview"
                className="mt-2 h-20 border rounded"
              />
            )}
          </div>
          <textarea
            className="w-full border rounded px-3 py-2"
            placeholder="Address (plain text)"
            rows={3}
            value={form.addressText}
            onChange={(e) => setForm({ ...form, addressText: e.target.value })}
          />
          <textarea
            className="w-full border rounded px-3 py-2"
            placeholder="Footer text (plain text)"
            rows={2}
            value={form.footerText}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
          />
          <input
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="Applies to (comma-separated doctypes, e.g. SalesInvoice, Quotation)"
            value={form.appliesToDoctypes}
            onChange={(e) =>
              setForm({ ...form, appliesToDoctypes: e.target.value })
            }
          />
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            Make this the tenant default
          </label>
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
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Applies To</th>
            <th className="px-4 py-2">Default</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2 font-medium">{r.name}</td>
              <td className="px-4 py-2 text-xs">
                {r.appliesToDoctypes.join(", ") || "any doctype"}
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
              <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                No letterheads yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </AppShell>
  );
}
