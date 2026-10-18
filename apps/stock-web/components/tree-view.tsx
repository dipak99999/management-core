"use client";

// Lumaara TreeView — used by every list page that toggles on a
// hierarchical view (Chart of Accounts, Warehouses, Cost Centers, …).
// Same shape as KanbanBoard and CalendarView: dependency-free, pure
// controlled component, caller owns the data.
//
// We only:
//   1. Recursively render a `TreeNode<T>[]` (pre-nested by the pure
//      `buildTree` helper in @lumaara/db, or by the server if it returns
//      nested data directly, e.g. /accounts/tree).
//   2. Manage per-node expand/collapse state, defaulting to open.
//   3. Emit `onRowClick(row)` when a row label is clicked.
//
// The tree-shaping logic (build from flat, filter preserving ancestors,
// count, flatten) lives in the pure helper package so it's tested without
// a browser.

import { ReactNode, useCallback, useMemo, useState } from "react";
import { type TreeNode, countTree } from "@lumaara/db/tree";

export interface TreeViewProps<T> {
  nodes: TreeNode<T>[];
  rowKey: (row: T) => string;
  /** The visible label + optional inline metadata for one row. */
  renderRow: (row: T, ctx: { depth: number; hasChildren: boolean }) => ReactNode;
  onRowClick?: (row: T) => void;
  /** Ids to keep collapsed on first render. Every other node starts open. */
  initiallyCollapsed?: string[];
  emptyMessage?: string;
  /** Show expand-all / collapse-all buttons in a mini toolbar. */
  showToolbar?: boolean;
}

export function TreeView<T>({
  nodes,
  rowKey,
  renderRow,
  onRowClick,
  initiallyCollapsed,
  emptyMessage,
  showToolbar = true,
}: TreeViewProps<T>) {
  // We track COLLAPSED ids rather than open ids so brand-new nodes
  // (added while the tree is on screen) inherit the sensible "open"
  // default without an extra state pass.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initiallyCollapsed ?? []),
  );

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    // Collect every id that has children — leaf nodes have nothing to
    // collapse, so leaving them out keeps the state set small.
    const ids: string[] = [];
    const walk = (ns: TreeNode<T>[]) => {
      for (const n of ns) {
        if (n.children.length > 0) ids.push(rowKey(n.row));
        walk(n.children);
      }
    };
    walk(nodes);
    setCollapsed(new Set(ids));
  };

  const total = useMemo(() => countTree(nodes), [nodes]);

  if (total === 0 && emptyMessage) {
    return (
      <div className="p-6 text-center text-sm text-ink-muted">{emptyMessage}</div>
    );
  }

  return (
    <div className="lumaara-tree">
      {showToolbar && total > 1 && (
        <div className="flex items-center gap-2 mb-2 px-1 text-xs">
          <button
            onClick={expandAll}
            className="text-ink-muted hover:text-brand-600 hover:underline"
          >
            Expand all
          </button>
          <span className="text-ink-muted/60">·</span>
          <button
            onClick={collapseAll}
            className="text-ink-muted hover:text-brand-600 hover:underline"
          >
            Collapse all
          </button>
        </div>
      )}
      <div>
        {nodes.map((n) => (
          <TreeNodeRow
            key={rowKey(n.row)}
            node={n}
            depth={0}
            rowKey={rowKey}
            renderRow={renderRow}
            onRowClick={onRowClick}
            collapsed={collapsed}
            toggle={toggle}
          />
        ))}
      </div>
    </div>
  );
}

function TreeNodeRow<T>({
  node,
  depth,
  rowKey,
  renderRow,
  onRowClick,
  collapsed,
  toggle,
}: {
  node: TreeNode<T>;
  depth: number;
  rowKey: (row: T) => string;
  renderRow: (row: T, ctx: { depth: number; hasChildren: boolean }) => ReactNode;
  onRowClick?: (row: T) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const id = rowKey(node.row);
  const hasChildren = node.children.length > 0;
  const isOpen = !collapsed.has(id);
  // 20px per depth level matches the existing Accounts page — visually
  // consistent when the two pages sit next to each other.
  const pad = { paddingLeft: `${depth * 20}px` };
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1.5 border-b border-ink-muted/10 hover:bg-brand-50/50"
        style={pad}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggle(id);
            }}
            className="text-ink-muted w-4 text-xs hover:text-brand-600"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <div
          className={`flex-1 min-w-0 ${onRowClick ? "cursor-pointer" : ""}`}
          onClick={onRowClick ? () => onRowClick(node.row) : undefined}
        >
          {renderRow(node.row, { depth, hasChildren })}
        </div>
      </div>
      {isOpen &&
        node.children.map((c) => (
          <TreeNodeRow
            key={rowKey(c.row)}
            node={c}
            depth={depth + 1}
            rowKey={rowKey}
            renderRow={renderRow}
            onRowClick={onRowClick}
            collapsed={collapsed}
            toggle={toggle}
          />
        ))}
    </div>
  );
}
