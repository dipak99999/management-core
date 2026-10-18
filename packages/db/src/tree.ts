// Tree view pure helpers — used by every list page that toggles on a
// hierarchical view (Chart of Accounts, Warehouses, Cost Centers, Item
// Groups, …). Kept dependency-free so vitest can exercise the tricky
// bits — orphans, cycles, ancestor-preservation on filter — without a DB
// or a rendered React component.
//
// The consuming React component (apps/*/components/tree-view.tsx) accepts
// pre-nested TreeNode<T>[] so callers whose backend already returns nested
// data (e.g. /accounts/tree) skip the helper and pass rows straight in.

export interface TreeNode<T> {
  row: T;
  children: TreeNode<T>[];
}

/**
 * Build a canonical nested tree from flat rows. Rows whose `parentId`
 * doesn't resolve to a known id are treated as roots (this is more useful
 * than silently dropping them — the operator can then see the orphan and
 * fix its parent).
 *
 * Cycle-safe: if A→B→A the participants become roots (their parentId is
 * ignored) rather than looping forever.
 */
export function buildTree<T>(
  rows: T[],
  getId: (row: T) => string,
  getParentId: (row: T) => string | null | undefined,
): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const row of rows) nodes.set(getId(row), { row, children: [] });

  const roots: TreeNode<T>[] = [];
  for (const row of rows) {
    const id = getId(row);
    const parentId = getParentId(row);
    const node = nodes.get(id)!;
    if (parentId && parentId !== id && nodes.has(parentId) && !wouldCycle(id, parentId, rows, getId, getParentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// Follow parent links up from `parentId` — if we ever hit `id`, adding
// `id → parentId` would create a cycle. Bounded loop (rows.length) as a
// belt-and-braces guard against malformed data.
function wouldCycle<T>(
  id: string,
  parentId: string,
  rows: T[],
  getId: (row: T) => string,
  getParentId: (row: T) => string | null | undefined,
): boolean {
  const byId = new Map(rows.map((r) => [getId(r), r]));
  let cursor: string | null | undefined = parentId;
  for (let hops = 0; hops < rows.length && cursor; hops++) {
    if (cursor === id) return true;
    const nextRow = byId.get(cursor);
    if (!nextRow) return false;
    cursor = getParentId(nextRow);
  }
  return false;
}

/** Total number of nodes in a tree, including nested descendants. */
export function countTree<T>(nodes: TreeNode<T>[]): number {
  return nodes.reduce((s, n) => s + 1 + countTree(n.children), 0);
}

/** Flatten depth-first into a list, preserving order. */
export function flattenTree<T>(nodes: TreeNode<T>[]): T[] {
  const out: T[] = [];
  const walk = (ns: TreeNode<T>[]) => {
    for (const n of ns) {
      out.push(n.row);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Filter a tree by predicate, KEEPING ancestors of any match — so a
 * search-hit deep in the tree stays visible with its full path. Matches
 * ERPNext + every file-browser convention.
 */
export function filterTree<T>(
  nodes: TreeNode<T>[],
  predicate: (row: T) => boolean,
): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  for (const n of nodes) {
    const filteredChildren = filterTree(n.children, predicate);
    if (predicate(n.row) || filteredChildren.length > 0) {
      out.push({ row: n.row, children: filteredChildren });
    }
  }
  return out;
}

/**
 * Collect every id in the tree (roots + descendants). Used to seed the
 * expand-all state or compare against a persisted collapse set.
 */
export function collectIds<T>(
  nodes: TreeNode<T>[],
  getId: (row: T) => string,
): string[] {
  const out: string[] = [];
  const walk = (ns: TreeNode<T>[]) => {
    for (const n of ns) {
      out.push(getId(n.row));
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
