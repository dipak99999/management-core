"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// Meta shape mirrors packages/db CustomField.
export interface CustomFieldDef {
  id: string;
  doctype: string;
  fieldName: string;
  label: string;
  fieldType: "Text" | "LongText" | "Number" | "Date" | "Boolean" | "Select";
  options: {
    choices?: string[];
    min?: number;
    max?: number;
    maxLength?: number;
  } | null;
  isRequired: boolean;
  sortOrder: number;
  helpText: string | null;
  // I4: JS-flavored boolean expression. When it evaluates to truthy against
  // the current form context (custom-field values + optional host-doc data),
  // the field is hidden from the form + view + skipped by required check.
  hiddenIf: string | null;
}

// Evaluate a hiddenIf expression in a sandboxed function scope. Context keys
// are bound as parameters (custom fieldNames are snake_case per schema —
// safe as JS identifiers). Errors treat the field as visible (safer default:
// broken expression shouldn't silently hide user input).
export function evalHiddenIf(expr: string, ctx: Record<string, unknown>): boolean {
  if (!expr) return false;
  try {
    const keys = Object.keys(ctx);
    const vals = Object.values(ctx);
     
    const fn = new Function(...keys, `"use strict"; return (${expr});`);
    return !!fn(...vals);
  } catch {
    return false;
  }
}

// Fetches the meta for a doctype from the same service the page already
// talks to (uses the /custom-fields-for read-through mount).
export function useCustomFields(doctype: string) {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .get<CustomFieldDef[]>(`/custom-fields-for/${doctype}`)
      .then((rs) => {
        if (!cancelled) {
          setFields(rs);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [doctype]);
  return { fields, loaded };
}

// Renders inputs for each field, controlled via `value` bag + `onChange`.
// Values are stored keyed by CustomField.fieldName; the parent form merges
// this bag into the doctype's `customData` on submit.
// `hostData` is an optional context bag from the parent form (e.g., the
// host doctype's own fields like status, customerId, currency) so hiddenIf
// expressions can reference them.
export function CustomFieldsForm({
  doctype,
  value,
  onChange,
  hostData,
}: {
  doctype: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  hostData?: Record<string, unknown>;
}) {
  const { fields, loaded } = useCustomFields(doctype);
  if (!loaded || fields.length === 0) return null;

  function set(fieldName: string, v: unknown) {
    onChange({ ...value, [fieldName]: v });
  }

  const ctx = { ...(hostData ?? {}), ...value };
  const visibleFields = fields.filter(
    (f) => !f.hiddenIf || !evalHiddenIf(f.hiddenIf, ctx),
  );
  if (visibleFields.length === 0) return null;

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="text-xs uppercase text-gray-500">Custom fields</div>
      {visibleFields.map((f) => {
        const v = value[f.fieldName];
        const commonLabel = (
          <label className="text-xs text-gray-600 block mb-0.5">
            {f.label}
            {f.isRequired && <span className="text-red-600"> *</span>}
          </label>
        );
        const helpText = f.helpText && (
          <div className="text-xs text-gray-500 mt-0.5">{f.helpText}</div>
        );
        switch (f.fieldType) {
          case "Text":
            return (
              <div key={f.id}>
                {commonLabel}
                <input
                  className="w-full border rounded px-3 py-2"
                  value={(v as string) ?? ""}
                  onChange={(e) => set(f.fieldName, e.target.value)}
                  required={f.isRequired}
                  maxLength={f.options?.maxLength}
                />
                {helpText}
              </div>
            );
          case "LongText":
            return (
              <div key={f.id}>
                {commonLabel}
                <textarea
                  className="w-full border rounded px-3 py-2"
                  value={(v as string) ?? ""}
                  onChange={(e) => set(f.fieldName, e.target.value)}
                  required={f.isRequired}
                  maxLength={f.options?.maxLength}
                  rows={3}
                />
                {helpText}
              </div>
            );
          case "Number":
            return (
              <div key={f.id}>
                {commonLabel}
                <input
                  type="number"
                  step="any"
                  className="w-full border rounded px-3 py-2"
                  value={(v as number) ?? ""}
                  onChange={(e) =>
                    set(f.fieldName, e.target.value === "" ? undefined : Number(e.target.value))
                  }
                  required={f.isRequired}
                  min={f.options?.min}
                  max={f.options?.max}
                />
                {helpText}
              </div>
            );
          case "Date":
            return (
              <div key={f.id}>
                {commonLabel}
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  value={((v as string) ?? "").slice(0, 10)}
                  onChange={(e) => set(f.fieldName, e.target.value)}
                  required={f.isRequired}
                />
                {helpText}
              </div>
            );
          case "Boolean":
            return (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!v}
                  onChange={(e) => set(f.fieldName, e.target.checked)}
                />
                {f.label}
                {f.helpText && (
                  <span className="text-xs text-gray-500 ms-1">({f.helpText})</span>
                )}
              </label>
            );
          case "Select":
            return (
              <div key={f.id}>
                {commonLabel}
                <select
                  className="w-full border rounded px-3 py-2"
                  value={(v as string) ?? ""}
                  onChange={(e) => set(f.fieldName, e.target.value)}
                  required={f.isRequired}
                >
                  <option value="">Select...</option>
                  {f.options?.choices?.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {helpText}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// Read-only display of stored custom-field values for a doctype detail page.
// hostData lets hiddenIf expressions reference host-doctype fields (e.g.,
// invoice.status) when deciding what to render.
export function CustomFieldsView({
  doctype,
  data,
  hostData,
}: {
  doctype: string;
  data: Record<string, unknown> | null | undefined;
  hostData?: Record<string, unknown>;
}) {
  const { fields, loaded } = useCustomFields(doctype);
  if (!loaded || fields.length === 0 || !data) return null;
  const ctx = { ...(hostData ?? {}), ...data };
  const rows = fields.filter(
    (f) =>
      data[f.fieldName] !== undefined &&
      data[f.fieldName] !== null &&
      (!f.hiddenIf || !evalHiddenIf(f.hiddenIf, ctx)),
  );
  if (rows.length === 0) return null;
  return (
    <div className="bg-white rounded shadow p-4">
      <div className="text-xs uppercase text-gray-500 mb-2">Custom fields</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map((f) => {
          const raw = data[f.fieldName];
          const display =
            f.fieldType === "Boolean"
              ? raw
                ? "Yes"
                : "No"
              : String(raw);
          return (
            <div key={f.id} className="flex justify-between">
              <dt className="text-gray-600">{f.label}</dt>
              <dd>{display}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
