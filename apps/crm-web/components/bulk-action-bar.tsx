"use client";

// Floating action bar shown at the bottom-center when 1+ rows are selected
// in a list page. Call-site owns the selected set + the action handlers;
// this component is purely presentational.
//
// Pattern:
//   <BulkActionBar
//     count={selectedIds.size}
//     onClear={() => setSelectedIds(new Set())}
//     actions={[
//       { label: "Submit drafts", onClick: bulkSubmit, busy: bulkBusy },
//       { label: "Delete",        onClick: bulkDelete, danger: true },
//     ]}
//   />

import type { ReactNode } from "react";

export interface BulkAction {
  label: string;
  onClick: () => void | Promise<void>;
  busy?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

export function BulkActionBar({
  count,
  onClear,
  actions,
  itemLabel = "selected",
}: {
  count: number;
  onClear: () => void;
  actions: BulkAction[];
  itemLabel?: string;
}) {
  if (count === 0) return null;
  return (
    <div
      className="fixed bottom-6 start-1/2 -translate-x-1/2 z-30 bg-ink text-white rounded-pill shadow-raised px-4 py-2.5 flex items-center gap-3"
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-xs font-medium">
        {count} {itemLabel}
      </span>
      <span className="h-4 w-px bg-white/20" />
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          disabled={a.disabled || a.busy}
          className={
            "text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1 " +
            (a.danger ? "text-red-300 hover:text-red-200" : "text-white hover:text-gold-300")
          }
        >
          {a.icon}
          {a.busy ? "Working…" : a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-white/70 hover:text-white"
      >
        Clear
      </button>
    </div>
  );
}

// Column cell helper — a row-checkbox you can drop into any Column<T>.cell.
export function SelectCell<T>({
  row,
  rowKey,
  selectedIds,
  onToggle,
}: {
  row: T;
  rowKey: (r: T) => string;
  selectedIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const id = rowKey(row);
  return (
    <input
      type="checkbox"
      aria-label="Select row"
      checked={selectedIds.has(id)}
      onChange={(e) => onToggle(id, e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 rounded border-ink/20 accent-ink"
    />
  );
}

export function SelectAllHeader({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={allSelected}
      onChange={(e) => onToggleAll(e.target.checked)}
      className="h-4 w-4 rounded border-ink/20 accent-ink"
    />
  );
}
