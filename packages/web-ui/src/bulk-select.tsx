"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";

export interface BulkAction<T> {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: (selected: T[]) => boolean;
  run: (selected: T[]) => void | Promise<void>;
}

/**
 * Row-selection state hook. Pair with <SelectCheckbox> cells and
 * <BulkActionBar>. Caller provides the full row list (filtered or not); the
 * hook stores selected ids and exposes helpers that work with current rows.
 */
export function useBulkSelect<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(rows.map((r) => r.id)));
  }, [rows]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.id));

  const toggleAll = useCallback(() => {
    if (allSelected) clear();
    else selectAll();
  }, [allSelected, clear, selectAll]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );

  return {
    selected,
    selectedRows,
    toggle,
    toggleAll,
    allSelected,
    someSelected,
    clear,
    isSelected: (id: string) => selected.has(id),
  };
}

export function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  "aria-label"?: string;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-ink/25 text-brew focus:ring-brew"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel ?? "Select row"}
    />
  );
}

export function BulkActionBar<T>({
  count,
  actions,
  selected,
  onClear,
}: {
  count: number;
  actions: BulkAction<T>[];
  selected: T[];
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky top-16 z-20 mb-3 flex items-center gap-3 rounded-lg bg-ink text-white px-4 py-2 shadow">
      <span className="text-sm">
        <span className="font-semibold">{count}</span>{" "}
        selected
      </span>
      <div className="h-5 w-px bg-white/20" />
      <div className="flex items-center gap-1 flex-1">
        {actions.map((a) => {
          const disabled = a.disabled?.(selected) ?? false;
          return (
            <button
              key={a.id}
              onClick={() => void a.run(selected)}
              disabled={disabled}
              className={`btn-sm text-sm px-2.5 py-1 rounded transition ${
                a.destructive
                  ? "text-red-200 hover:bg-red-500/20"
                  : "text-white hover:bg-white/10"
              } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {a.icon && <span className="me-1">{a.icon}</span>}
              {a.label}
            </button>
          );
        })}
      </div>
      <button
        onClick={onClear}
        className="text-white/60 hover:text-white"
        aria-label="Clear selection"
      >
        ✕
      </button>
    </div>
  );
}
