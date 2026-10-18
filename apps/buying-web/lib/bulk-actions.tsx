"use client";

import { useState } from "react";
import { api } from "./api";

// Client-side helpers for the /bulk-actions endpoint. `<BulkActionsBar>` is
// designed to sit above a list-view table and receives the current selection
// as a prop.

export interface BulkActionsBarProps {
  doctype: string;
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
  // Optional allow-list of statuses for the setStatus dropdown. Empty ==
  // dropdown hidden. Match to the server's BULK_TARGETS.allowedStatuses.
  statuses?: string[];
}

export function BulkActionsBar({
  doctype,
  selectedIds,
  onClear,
  onDone,
  statuses = [],
}: BulkActionsBarProps) {
  const [busy, setBusy] = useState<null | "delete" | "setStatus">(null);
  const [status, setStatus] = useState(statuses[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  if (selectedIds.length === 0) return null;

  async function run(action: "delete" | "setStatus") {
    setBusy(action);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        doctype,
        ids: selectedIds,
        action,
      };
      if (action === "setStatus") body.status = status;
      await api.post<{ deleted?: number; updated?: number }>("/bulk-actions", body);
      onDone();
      onClear();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function confirmDelete() {
    if (!window.confirm(`Delete ${selectedIds.length} ${doctype}(s)?`)) return;
    await run("delete");
  }

  return (
    <div className="sticky top-0 z-10 bg-brand-50 border border-brand-200 rounded p-2 flex items-center gap-3 text-sm">
      <div className="font-medium">{selectedIds.length} selected</div>
      <button
        onClick={onClear}
        className="text-brand-700 hover:underline text-xs"
      >
        clear
      </button>
      <div className="ms-auto flex items-center gap-2">
        {statuses.length > 0 && (
          <>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border rounded px-2 py-1 text-xs"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={() => run("setStatus")}
              disabled={busy !== null}
              className="text-xs bg-white border rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === "setStatus" ? "Applying…" : "Set status"}
            </button>
          </>
        )}
        <button
          onClick={confirmDelete}
          disabled={busy !== null}
          className="text-xs bg-red-600 text-white rounded px-2 py-1 hover:bg-red-700 disabled:opacity-50"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error && (
        <div className="w-full text-red-700 text-xs mt-1">{error}</div>
      )}
    </div>
  );
}

// Helper hook: manages the selection state for a checkbox list-view. Returns
// { selected, toggle, toggleAll, clear, isSelected, allSelected }.
export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return {
    selected: Array.from(selected),
    isSelected: (id: string) => selected.has(id),
    toggle: (id: string) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () =>
      setSelected((s) =>
        s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
      ),
    clear: () => setSelected(new Set()),
    allSelected: rows.length > 0 && selected.size === rows.length,
  };
}
