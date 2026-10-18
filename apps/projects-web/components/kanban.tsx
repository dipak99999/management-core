"use client";

// Lumaara KanbanBoard — a Zoho-CRM-inspired drag-and-drop board used by the
// CRM Opportunities/Leads pages (and soon Sales Orders, Quotations, …).
//
// Deliberately dependency-free: uses native HTML5 drag-and-drop so we don't
// pull in react-dnd / dnd-kit for a Phase-1 feature. `draggable=true` on the
// card, `onDragOver`/`onDrop` on the column. Columns visually highlight while
// a card is being dragged over them. Cards get a subtle hover lift.
//
// The caller owns the data. We only:
//   1. Emit `onMoveCard(row, newStatus)` when a card is dropped into a column
//      whose status differs from its current status.
//   2. Render the columns + cards using the provided `renderCard`.
//
// Optimistic UI (move the card immediately, roll back on failure) is the
// caller's responsibility — the board itself is a pure controlled component.

import { ReactNode, useState } from "react";

export interface KanbanColumn {
  /** Value stored on the row (e.g. "Open", "Quotation"). */
  status: string;
  /** Column header label. */
  label: string;
  /** Tailwind classes for the column's accent bar (e.g. "bg-blue-500"). */
  accent?: string;
  /** Optional short subtitle beneath the label. */
  hint?: string;
}

export interface KanbanBoardProps<T> {
  columns: KanbanColumn[];
  rows: T[];
  /** Return the status this row currently belongs to. */
  getStatus: (row: T) => string;
  /** Stable key for React reconciliation. */
  rowKey: (row: T) => string;
  /** Render a single card body. The outer draggable wrapper is provided. */
  renderCard: (row: T) => ReactNode;
  /** Optional: contribute to the column's aggregate (e.g. sum of amounts). */
  aggregate?: (row: T) => number;
  /** Optional: formatter for the aggregate total shown in the header. */
  formatAggregate?: (total: number) => string;
  /** Called when a card is dropped into a column whose status differs. */
  onMoveCard: (row: T, newStatus: string) => void;
  /** Show a compact loading skeleton in every column. */
  loading?: boolean;
  /** Empty-state message when there are zero rows across all columns. */
  emptyMessage?: string;
}

export function KanbanBoard<T>({
  columns,
  rows,
  getStatus,
  rowKey,
  renderCard,
  aggregate,
  formatAggregate,
  onMoveCard,
  loading,
  emptyMessage,
}: KanbanBoardProps<T>) {
  // Which row is being dragged, and which column is currently a drop target.
  // Both are transient UI state — cleared on drop/dragend.
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<string | null>(null);

  // Bucket rows into columns once per render. Rows whose status doesn't match
  // any known column are silently dropped (they'll come back into view when
  // the caller adds a column for that status).
  const bucketed: Record<string, T[]> = {};
  for (const col of columns) bucketed[col.status] = [];
  for (const row of rows) {
    const s = getStatus(row);
    if (bucketed[s]) bucketed[s].push(row);
  }

  function handleDrop(colStatus: string) {
    setOverStatus(null);
    if (!dragKey) return;
    const row = rows.find((r) => rowKey(r) === dragKey);
    setDragKey(null);
    if (!row) return;
    if (getStatus(row) === colStatus) return;
    onMoveCard(row, colStatus);
  }

  const totalRows = rows.length;
  const showEmpty = !loading && totalRows === 0 && emptyMessage;

  return (
    <div className="kanban-scroll -mx-1 px-1 pb-1 overflow-x-auto">
      <div className="flex gap-3 items-start min-w-max">
        {columns.map((col) => {
          const items = bucketed[col.status] ?? [];
          const isOver = overStatus === col.status;
          const total = aggregate ? items.reduce((s, r) => s + (aggregate(r) || 0), 0) : 0;
          const showTotal = aggregate && items.length > 0;
          return (
            <div
              key={col.status}
              onDragOver={(e) => {
                // Required to make the div a valid drop target.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overStatus !== col.status) setOverStatus(col.status);
              }}
              onDragLeave={(e) => {
                // Only clear if we actually left the column (not just entered a
                // nested child). relatedTarget will be outside currentTarget.
                const to = e.relatedTarget as Node | null;
                if (!to || !(e.currentTarget as Node).contains(to)) {
                  if (overStatus === col.status) setOverStatus(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(col.status);
              }}
              className={`kanban-col flex flex-col w-72 shrink-0 rounded-xl border transition-colors ${
                isOver
                  ? "border-brand-400 bg-brand-50/60 shadow-brand-sm"
                  : "border-ink-muted/10 bg-surface-sunken/60"
              }`}
            >
              <div className="px-3 pt-3 pb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${col.accent ?? "bg-ink-muted/40"}`}
                    aria-hidden
                  />
                  <span className="text-xs font-semibold text-ink uppercase tracking-wide">
                    {col.label}
                  </span>
                  <span className="ms-auto text-[11px] tabular-nums text-ink-muted bg-white rounded-full px-2 py-0.5 border border-ink-muted/10">
                    {items.length}
                  </span>
                </div>
                {(showTotal || col.hint) && (
                  <div className="mt-1 text-[11px] text-ink-muted flex items-center gap-1">
                    {showTotal && (
                      <span className="tabular-nums font-medium text-ink-soft">
                        {formatAggregate ? formatAggregate(total) : total}
                      </span>
                    )}
                    {showTotal && col.hint && <span aria-hidden>·</span>}
                    {col.hint && <span>{col.hint}</span>}
                  </div>
                )}
              </div>

              <div className="flex-1 px-2 pb-2 space-y-2 min-h-[120px]">
                {loading && items.length === 0 && (
                  <>
                    <div className="h-16 rounded-lg bg-ink-muted/10 animate-pulse" />
                    <div className="h-16 rounded-lg bg-ink-muted/10 animate-pulse" />
                  </>
                )}

                {items.map((row) => {
                  const key = rowKey(row);
                  const isDragging = dragKey === key;
                  return (
                    <div
                      key={key}
                      draggable
                      onDragStart={(e) => {
                        setDragKey(key);
                        e.dataTransfer.effectAllowed = "move";
                        // Some browsers require setData to enable dragging.
                        try {
                          e.dataTransfer.setData("text/plain", key);
                        } catch {
                          /* ignore — some environments lock this down */
                        }
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setOverStatus(null);
                      }}
                      className={`kanban-card group bg-white rounded-lg border border-ink-muted/10 p-3 text-sm transition-all cursor-grab active:cursor-grabbing ${
                        isDragging
                          ? "opacity-40 shadow-none"
                          : "hover:border-brand-300/60 hover:shadow-brand-sm hover:-translate-y-0.5"
                      }`}
                    >
                      {renderCard(row)}
                    </div>
                  );
                })}

                {!loading && items.length === 0 && (
                  <div
                    className={`kanban-empty flex items-center justify-center text-[11px] rounded-lg border border-dashed h-20 transition-colors ${
                      isOver
                        ? "border-brand-400 text-brand-600 bg-brand-50/40"
                        : "border-ink-muted/20 text-ink-muted"
                    }`}
                  >
                    {isOver ? "Release to move here" : "Drop cards here"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showEmpty && (
        <div className="mt-4 text-center text-sm text-ink-muted">{emptyMessage}</div>
      )}
    </div>
  );
}
