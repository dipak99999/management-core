"use client";

// Org chart. Loads the tree from /employees/org-chart and renders it as
// a nested-card layout — no fancy graph library, just CSS grid + a
// recursive component. Cards collapse/expand on click; search filters
// the visible tree (matching branches are kept expanded).

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import { Button, FilterBar, PageHeader, Toast } from "../../components/ui";

interface Node {
  id: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  department: string | null;
  email: string | null;
  status: string;
  reports: Node[];
}

// Flat list of every id whose subtree contains a match, so we can keep
// collapsed nodes visible along the path to a search hit.
function idsMatchingBranches(nodes: Node[], q: string): Set<string> {
  const ids = new Set<string>();
  const walk = (n: Node): boolean => {
    const selfMatch = matches(n, q);
    let subMatch = false;
    for (const r of n.reports) if (walk(r)) subMatch = true;
    if (selfMatch || subMatch) {
      ids.add(n.id);
      return true;
    }
    return false;
  };
  for (const n of nodes) walk(n);
  return ids;
}

function matches(n: Node, q: string): boolean {
  if (!q) return true;
  const l = q.toLowerCase();
  return (
    n.employeeName.toLowerCase().includes(l) ||
    n.employeeCode.toLowerCase().includes(l) ||
    (n.designation ?? "").toLowerCase().includes(l) ||
    (n.department ?? "").toLowerCase().includes(l) ||
    (n.email ?? "").toLowerCase().includes(l)
  );
}

function countSubtree(n: Node): number {
  let c = 1;
  for (const r of n.reports) c += countSubtree(r);
  return c;
}

function OrgNode({
  node,
  depth,
  q,
  visibleIds,
  collapsed,
  toggle,
}: {
  node: Node;
  depth: number;
  q: string;
  visibleIds: Set<string>;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  if (q && !visibleIds.has(node.id)) return null;
  const isCollapsed = collapsed.has(node.id);
  const highlight = q && matches(node, q);
  const reportCount = node.reports.length;
  const subtotal = countSubtree(node) - 1;
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 20 }}>
      <div
        className="card"
        style={{
          padding: "10px 14px",
          marginBottom: 8,
          borderLeft: `3px solid ${highlight ? "#4f46e5" : "#e5e7eb"}`,
          background: highlight ? "#eef2ff" : undefined,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {reportCount > 0 ? (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={isCollapsed ? "Expand" : "Collapse"}
            style={{
              width: 22,
              height: 22,
              border: "1px solid #d1d5db",
              borderRadius: 4,
              background: "white",
              cursor: "pointer",
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {isCollapsed ? "+" : "−"}
          </button>
        ) : (
          <span style={{ width: 22 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>
            {node.employeeName}
            <span style={{ color: "#6b7280", fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              {node.employeeCode}
            </span>
            {node.status !== "Active" ? (
              <span style={{ color: "#b91c1c", fontSize: 11, marginLeft: 8 }}>
                ({node.status})
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {node.designation ?? "—"}
            {node.department ? ` · ${node.department}` : ""}
            {node.email ? ` · ${node.email}` : ""}
          </div>
        </div>
        {reportCount > 0 ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {reportCount} direct · {subtotal} total
          </div>
        ) : null}
      </div>
      {!isCollapsed && reportCount > 0 ? (
        <div style={{ borderLeft: "1px dashed #d1d5db", paddingLeft: 10, marginLeft: 10, marginBottom: 4 }}>
          {node.reports.map((r) => (
            <OrgNode
              key={r.id}
              node={r}
              depth={depth + 1}
              q={q}
              visibleIds={visibleIds}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function OrgChartPage() {
  const [roots, setRoots] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ roots: Node[] }>(
        `/employees/org-chart${includeInactive ? "?includeInactive=1" : ""}`,
      );
      setRoots(data.roots);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  useListPageCommands({
    singular: "Org Chart",
    plural: "Org Chart",
    refresh: load,
  });

  const visibleIds = useMemo(() => idsMatchingBranches(roots, q.trim()), [roots, q]);
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const all = new Set<string>();
    const walk = (n: Node) => {
      if (n.reports.length > 0) all.add(n.id);
      for (const r of n.reports) walk(r);
    };
    for (const r of roots) walk(r);
    setCollapsed(all);
  };

  const totalPeople = useMemo(() => roots.reduce((s, r) => s + countSubtree(r), 0), [roots]);

  return (
    <>
      <PageHeader
        title="Org Chart"
        subtitle={`${totalPeople} employee${totalPeople === 1 ? "" : "s"} · ${roots.length} top-level`}
        actions={
          <>
            <Button variant="secondary" onClick={expandAll}>Expand all</Button>
            <Button variant="secondary" onClick={collapseAll}>Collapse all</Button>
          </>
        }
      />
      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: "Search by name, code, designation…" }}
        filters={
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include inactive
          </label>
        }
        actions={<SavedViewsControls listKey="hr-web:org-chart" current={{ q, includeInactive }} onApply={(fv) => { setQ(fv.q); setIncludeInactive(fv.includeInactive); }} />}
      />
      {error ? (
        <div style={{ color: "#b91c1c", padding: 12 }}>{error}</div>
      ) : loading ? (
        <p style={{ padding: 12, color: "#6b7280" }}>Loading…</p>
      ) : roots.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "#6b7280" }}>
          No employees yet. Add employees and set their manager to build the chart.
        </div>
      ) : (
        <div style={{ padding: 12 }}>
          {roots.map((r) => (
            <OrgNode
              key={r.id}
              node={r}
              depth={0}
              q={q.trim()}
              visibleIds={visibleIds}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </div>
      )}
      {toast ? <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
