"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import {
  Button,
  Card,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  SectionHeader,
  Toast,
} from "../../../components/ui";

interface CustomField {
  id: string;
  doctype: string;
  fieldName: string;
  label: string;
  fieldType: string;
  options: Record<string, unknown> | null;
  isRequired: boolean;
  sortOrder: number;
  helpText: string | null;
  regexPattern: string | null;
  isUnique: boolean;
  readOnly: boolean;
  hiddenIf: string | null;
}
interface Meta {
  doctypes: string[];
  fieldTypes: string[];
  linkTargets: string[];
}

interface SubField {
  fieldName: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
}

const emptyForm = {
  doctype: "",
  fieldName: "",
  label: "",
  fieldType: "Text",
  isRequired: false,
  sortOrder: 0,
  helpText: "",
  choicesCsv: "",
  minText: "",
  maxText: "",
  maxLengthText: "",
  linkDoctype: "",
  subFields: [{ fieldName: "", label: "", fieldType: "Text", isRequired: false }] as SubField[],
  regexPattern: "",
  isUnique: false,
  readOnly: false,
  hiddenIf: "",
};

export default function CustomFieldsPage() {
  const [rows, setRows] = useState<CustomField[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [rs, m] = await Promise.all([
        api.get<CustomField[]>("/custom-fields" + (filter ? `?doctype=${filter}` : "")),
        api.get<Meta>("/custom-fields/meta"),
      ]);
      setRows(rs);
      setMeta(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useListPageCommands({
    singular: "Custom Field",
    plural: "Custom Fields",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let options: Record<string, unknown> | undefined;
      if (form.fieldType === "Select") {
        const choices = form.choicesCsv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (choices.length === 0) throw new Error("Select needs at least one choice");
        options = { choices };
      } else if (form.fieldType === "Number") {
        const opts: Record<string, number> = {};
        if (form.minText) opts.min = Number(form.minText);
        if (form.maxText) opts.max = Number(form.maxText);
        if (Object.keys(opts).length > 0) options = opts;
      } else if (form.fieldType === "Text" || form.fieldType === "LongText") {
        if (form.maxLengthText)
          options = { maxLength: Number(form.maxLengthText) };
      } else if (form.fieldType === "Link") {
        if (!form.linkDoctype) throw new Error("Link needs a target doctype");
        options = { linkDoctype: form.linkDoctype };
      } else if (form.fieldType === "Table") {
        const cleaned = form.subFields
          .filter((s) => s.fieldName.trim() && s.label.trim())
          .map((s) => ({
            fieldName: s.fieldName,
            label: s.label,
            fieldType: s.fieldType,
            isRequired: s.isRequired,
          }));
        if (cleaned.length === 0) throw new Error("Table needs at least one sub-field");
        options = { subFields: cleaned };
      }

      await api.post("/custom-fields", {
        doctype: form.doctype,
        fieldName: form.fieldName,
        label: form.label,
        fieldType: form.fieldType,
        options,
        isRequired: form.isRequired,
        sortOrder: form.sortOrder,
        helpText: form.helpText || null,
        regexPattern: form.regexPattern || null,
        isUnique: form.isUnique,
        readOnly: form.readOnly,
        hiddenIf: form.hiddenIf || null,
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

  async function del(f: CustomField) {
    if (!confirm(`Delete "${f.label}" on ${f.doctype}? Existing rows keep their JSONB value.`))
      return;
    setError(null);
    try {
      await api.delete(`/custom-fields/${f.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, CustomField[]> = {};
    for (const f of rows) (g[f.doctype] ??= []).push(f);
    return g;
  }, [rows]);

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Custom Fields" }]}
        title="Custom Fields"
        subtitle={
          <>
            Add ad-hoc fields to any doctype without a schema migration. Values live in the
            target row's <code className="bg-surface-sunken px-1 rounded text-xs">customData</code>
            {" "}JSONB column, validated server-side.
          </>
        }
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)} type="button">
            + New field
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">
        <FilterBar
          filters={
            <div className="flex items-center gap-2 text-sm">
              <label className="text-ink-muted">Doctype</label>
              <select
                className="input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">All</option>
                {meta?.doctypes.map((dt) => (
                  <option key={dt} value={dt}>{dt}</option>
                ))}
              </select>
            </div>
          }
          actions={<SavedViewsControls listKey="shell:admin-custom-fields" current={{ filter }} onApply={(fv) => { setFilter(fv.filter); }} />}
        />

        {Object.entries(grouped).map(([dt, fields]) => (
          <Card key={dt} className="p-0 overflow-hidden">
            <div className="bg-surface-sunken px-4 py-2 font-semibold text-sm text-ink">{dt}</div>
            <table className="w-full text-sm">
              <thead className="text-ink-muted text-start border-b border-ink-muted/10">
                <tr>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2 font-mono">Field name</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Options</th>
                  <th className="px-4 py-2">Required</th>
                  <th className="px-4 py-2 text-end"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} className="border-t border-ink-muted/10">
                    <td className="px-4 py-2 text-ink">{f.label}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{f.fieldName}</td>
                    <td className="px-4 py-2 text-xs text-ink-soft">{f.fieldType}</td>
                    <td className="px-4 py-2 text-xs text-ink-muted">
                      {f.options ? JSON.stringify(f.options) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-soft">
                      {f.isRequired ? "yes" : "—"}
                    </td>
                    <td className="px-4 py-2 text-end">
                      <button onClick={() => del(f)} className="text-red-600 text-xs">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="p-6 text-center text-ink-muted text-sm">
            No custom fields yet
          </Card>
        )}
      </div>

      {meta && (
        <Drawer
          open={showForm}
          onClose={() => setShowForm(false)}
          title="New custom field"
          width="w-[640px]"
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button
                variant="brand"
                onClick={(e) => create(e as unknown as React.FormEvent)}
                disabled={busy}
                type="button"
              >
                {busy ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Doctype" required>
                <select
                  required
                  className="input"
                  value={form.doctype}
                  onChange={(e) => setForm({ ...form, doctype: e.target.value })}
                >
                  <option value="">Select…</option>
                  {meta.doctypes.map((dt) => (
                    <option key={dt} value={dt}>{dt}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Field type">
                <select
                  className="input"
                  value={form.fieldType}
                  onChange={(e) => setForm({ ...form, fieldType: e.target.value })}
                >
                  {meta.fieldTypes.map((ft) => (
                    <option key={ft} value={ft}>{ft}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Field name (snake_case)" required>
                <input
                  required
                  className="input font-mono text-sm"
                  placeholder="e.g. gst_state_code"
                  value={form.fieldName}
                  onChange={(e) => setForm({ ...form, fieldName: e.target.value })}
                />
              </FormField>
              <FormField label="Label" required>
                <input
                  required
                  className="input"
                  placeholder="e.g. GST State Code"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </FormField>
            </div>

            {form.fieldType === "Select" && (
              <FormField label="Choices (comma-separated)" required>
                <input
                  className="input"
                  value={form.choicesCsv}
                  onChange={(e) => setForm({ ...form, choicesCsv: e.target.value })}
                  required
                />
              </FormField>
            )}
            {form.fieldType === "Number" && (
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Min">
                  <input
                    className="input"
                    value={form.minText}
                    onChange={(e) => setForm({ ...form, minText: e.target.value })}
                    type="number"
                    step="any"
                  />
                </FormField>
                <FormField label="Max">
                  <input
                    className="input"
                    value={form.maxText}
                    onChange={(e) => setForm({ ...form, maxText: e.target.value })}
                    type="number"
                    step="any"
                  />
                </FormField>
              </div>
            )}
            {(form.fieldType === "Text" || form.fieldType === "LongText") && (
              <FormField label="Max length">
                <input
                  className="input"
                  value={form.maxLengthText}
                  onChange={(e) => setForm({ ...form, maxLengthText: e.target.value })}
                  type="number"
                  min={1}
                />
              </FormField>
            )}
            {form.fieldType === "Link" && (
              <FormField label="Link target doctype" required>
                <select
                  className="input"
                  value={form.linkDoctype}
                  onChange={(e) => setForm({ ...form, linkDoctype: e.target.value })}
                  required
                >
                  <option value="">Select…</option>
                  {meta.linkTargets.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </FormField>
            )}
            {form.fieldType === "Table" && (
              <div className="border border-ink-muted/10 rounded p-2 space-y-2">
                <SectionHeader title="Sub-fields" />
                {form.subFields.map((s, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2">
                    <input
                      className="input text-xs font-mono"
                      placeholder="field_name"
                      value={s.fieldName}
                      onChange={(e) => {
                        const next = [...form.subFields];
                        next[i] = { ...next[i], fieldName: e.target.value };
                        setForm({ ...form, subFields: next });
                      }}
                    />
                    <input
                      className="input text-xs"
                      placeholder="Label"
                      value={s.label}
                      onChange={(e) => {
                        const next = [...form.subFields];
                        next[i] = { ...next[i], label: e.target.value };
                        setForm({ ...form, subFields: next });
                      }}
                    />
                    <select
                      className="input text-xs"
                      value={s.fieldType}
                      onChange={(e) => {
                        const next = [...form.subFields];
                        next[i] = { ...next[i], fieldType: e.target.value };
                        setForm({ ...form, subFields: next });
                      }}
                    >
                      {["Text", "LongText", "Number", "Date", "Boolean", "Select"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs flex items-center gap-1 text-ink-soft">
                        <input
                          type="checkbox"
                          checked={s.isRequired}
                          onChange={(e) => {
                            const next = [...form.subFields];
                            next[i] = { ...next[i], isRequired: e.target.checked };
                            setForm({ ...form, subFields: next });
                          }}
                        />
                        req
                      </label>
                      <button
                        type="button"
                        className="text-red-500 text-xs"
                        onClick={() =>
                          setForm({
                            ...form,
                            subFields: form.subFields.filter((_, idx) => idx !== i),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() =>
                    setForm({
                      ...form,
                      subFields: [
                        ...form.subFields,
                        { fieldName: "", label: "", fieldType: "Text", isRequired: false },
                      ],
                    })
                  }
                >
                  + Add sub-field
                </button>
              </div>
            )}

            <FormField label="Help text">
              <input
                className="input"
                value={form.helpText}
                onChange={(e) => setForm({ ...form, helpText: e.target.value })}
              />
            </FormField>

            <details className="text-sm">
              <summary className="cursor-pointer text-ink-soft">
                Validation rules (opt)
              </summary>
              <div className="ps-4 mt-2 space-y-2">
                <input
                  className="input font-mono text-xs"
                  placeholder="Regex pattern (e.g. ^[A-Z]{2}[0-9]{2}$)"
                  value={form.regexPattern}
                  onChange={(e) => setForm({ ...form, regexPattern: e.target.value })}
                />
                <input
                  className="input font-mono text-xs"
                  placeholder="hiddenIf expression (e.g. status == 'Cancelled')"
                  value={form.hiddenIf}
                  onChange={(e) => setForm({ ...form, hiddenIf: e.target.value })}
                />
                <div className="flex gap-4 text-xs text-ink-soft">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.isUnique}
                      onChange={(e) => setForm({ ...form, isUnique: e.target.checked })}
                    />
                    Unique
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.readOnly}
                      onChange={(e) => setForm({ ...form, readOnly: e.target.checked })}
                    />
                    Read-only
                  </label>
                </div>
              </div>
            </details>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-ink-soft">
                <input
                  type="checkbox"
                  checked={form.isRequired}
                  onChange={(e) => setForm({ ...form, isRequired: e.target.checked })}
                />
                Required
              </label>
              <div>
                <label className="text-xs text-ink-muted me-2">Sort order</label>
                <input
                  type="number"
                  className="input w-24"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                />
              </div>
            </div>
            <button type="submit" className="hidden" />
          </form>
        </Drawer>
      )}
    </AppShell>
  );
}
