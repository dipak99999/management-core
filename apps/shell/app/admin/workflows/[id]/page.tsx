"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  Toast,
} from "../../../../components/ui";

interface State {
  id?: string;
  stateName: string;
  docStatus: number;
  style: string | null;
  sortOrder: number;
}
interface Transition {
  id?: string;
  fromState: string;
  actionLabel: string;
  toState: string;
  allowedRoles: string[];
}
interface WorkflowDetail {
  id: string;
  name: string;
  doctype: string;
  isActive: boolean;
  statusField: string;
  states: State[];
  transitions: Transition[];
}
interface Role {
  id: string;
  roleName: string;
}

const STYLE_PRESETS = [
  { label: "Gray (Draft)", value: "bg-gray-200 text-gray-800" },
  { label: "Yellow (Pending)", value: "bg-yellow-100 text-yellow-800" },
  { label: "Blue (In Progress)", value: "bg-blue-100 text-blue-800" },
  { label: "Green (Approved)", value: "bg-green-100 text-green-800" },
  { label: "Red (Rejected)", value: "bg-red-100 text-red-800" },
];

// ── Validator ─────────────────────────────────────────────────────────
//
// Finds configuration mistakes an admin typically only notices after
// activating the workflow and watching a doc get stuck. Running these
// inline (not just on save) means the warnings show up as the admin edits.

interface WorkflowIssue {
  severity: "error" | "warn";
  message: string;
}

function validateWorkflow(states: State[], transitions: Transition[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const stateNames = new Set(states.map((s) => s.stateName).filter(Boolean));
  if (states.length === 0) {
    issues.push({ severity: "error", message: "No states defined — add at least one state." });
    return issues;
  }
  // Duplicate state names
  const dupStates = new Set<string>();
  const seen = new Set<string>();
  for (const s of states) {
    if (!s.stateName) continue;
    if (seen.has(s.stateName)) dupStates.add(s.stateName);
    seen.add(s.stateName);
  }
  for (const name of dupStates) {
    issues.push({ severity: "error", message: `Duplicate state "${name}" — each state name must be unique.` });
  }
  // Transitions pointing to or from states that don't exist
  for (const t of transitions) {
    if (t.fromState && !stateNames.has(t.fromState)) {
      issues.push({ severity: "error", message: `Transition "${t.actionLabel}" starts from "${t.fromState}" which isn't a defined state.` });
    }
    if (t.toState && !stateNames.has(t.toState)) {
      issues.push({ severity: "error", message: `Transition "${t.actionLabel}" ends at "${t.toState}" which isn't a defined state.` });
    }
    if (!t.actionLabel.trim()) {
      issues.push({ severity: "error", message: `Transition from "${t.fromState || "?"}" to "${t.toState || "?"}" has no action label.` });
    }
    if (t.allowedRoles.length === 0) {
      issues.push({ severity: "warn", message: `Transition "${t.actionLabel || "?"}" has no roles assigned — only SystemManager can trigger it.` });
    }
  }
  // Orphan states (no incoming AND no outgoing). The initial state is a special
  // case — it should have outgoing but no incoming is OK.
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const t of transitions) {
    if (t.toState) incoming.add(t.toState);
    if (t.fromState) outgoing.add(t.fromState);
  }
  const initial = [...states].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.stateName;
  for (const s of states) {
    if (!s.stateName) continue;
    const hasIn = incoming.has(s.stateName);
    const hasOut = outgoing.has(s.stateName);
    if (!hasIn && !hasOut) {
      issues.push({ severity: "warn", message: `State "${s.stateName}" is orphan — no transitions in or out. Users can't reach or leave it.` });
    } else if (!hasIn && s.stateName !== initial) {
      issues.push({ severity: "warn", message: `State "${s.stateName}" has no incoming transition — can only be reached by setting it manually.` });
    } else if (!hasOut) {
      // Terminal state — not necessarily a bug, but worth noting.
      issues.push({ severity: "warn", message: `State "${s.stateName}" is terminal — no transitions out. Docs in this state can't move forward.` });
    }
  }
  return issues;
}

// ── Visual state diagram ──────────────────────────────────────────────
//
// SVG-based. Lays states out left-to-right in rows of 4 (keeps the diagram
// readable without a layout engine). Transitions render as curved arrows
// with the action label at the midpoint. Hover highlights the connected
// states so admins can trace flows in dense workflows. No external deps.

interface Point { x: number; y: number }

function WorkflowDiagram({ states, transitions }: { states: State[]; transitions: Transition[] }) {
  const [hoverTransitionId, setHoverTransitionId] = useState<string | null>(null);
  if (states.length === 0) {
    return (
      <div className="text-sm text-ink-muted italic p-4 text-center border border-dashed border-ink-muted/20 rounded-lg">
        Add states + transitions below to see the flow diagram.
      </div>
    );
  }
  // Layout: 4 states per row, 180px wide + 80px gap, 90px row height.
  const PER_ROW = 4;
  const NODE_W = 160;
  const NODE_H = 44;
  const GAP_X = 60;
  const GAP_Y = 60;
  const PAD = 20;
  const sorted = [...states].sort((a, b) => a.sortOrder - b.sortOrder);
  const pos = new Map<string, Point>();
  sorted.forEach((s, i) => {
    const col = i % PER_ROW;
    const row = Math.floor(i / PER_ROW);
    pos.set(s.stateName, {
      x: PAD + col * (NODE_W + GAP_X) + NODE_W / 2,
      y: PAD + row * (NODE_H + GAP_Y) + NODE_H / 2,
    });
  });
  const rows = Math.ceil(sorted.length / PER_ROW);
  const width = PAD * 2 + PER_ROW * NODE_W + (PER_ROW - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;

  // Edge path: cubic bezier that curves out and back. Reduces overlap
  // between parallel arrows (two transitions between the same pair).
  function edgePath(from: Point, to: Point, curveOffset: number): string {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular offset for the curve control points.
    const nx = -dy / len;
    const ny = dx / len;
    const cx = midX + nx * curveOffset;
    const cy = midY + ny * curveOffset;
    return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
  }

  // Group transitions by (from, to) so parallel arrows get staggered.
  const edgeIndex = new Map<string, number>();
  const edges = transitions
    .filter((t) => pos.has(t.fromState) && pos.has(t.toState))
    .map((t) => {
      const key = `${t.fromState}→${t.toState}`;
      const seq = edgeIndex.get(key) ?? 0;
      edgeIndex.set(key, seq + 1);
      return { ...t, parallelIndex: seq };
    });

  const stateColor = new Map<string, string>();
  for (const s of states) {
    // Extract the first bg color class, convert to a hex-ish fill.
    const bg = (s.style ?? "").match(/bg-(\w+)-(\d+)/);
    stateColor.set(s.stateName, bg ? tailwindColorToHex(bg[1], bg[2]) : "#F1F0ED");
  }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <svg
        width={width}
        height={height}
        className="min-w-full"
        style={{ maxWidth: "100%" }}
        role="img"
        aria-label="Workflow state diagram"
      >
        {/* Arrowhead marker */}
        <defs>
          <marker
            id="wf-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
          </marker>
          <marker
            id="wf-arrow-hover"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="#2563EB" />
          </marker>
        </defs>

        {/* Edges first so nodes draw on top */}
        {edges.map((t, i) => {
          const from = pos.get(t.fromState)!;
          const to = pos.get(t.toState)!;
          // Stagger parallel edges by alternating curve direction.
          const curve = (t.parallelIndex % 2 === 0 ? 1 : -1) * (30 + Math.floor(t.parallelIndex / 2) * 20);
          const path = edgePath(from, to, curve);
          const hovered = hoverTransitionId === (t.id ?? `edge-${i}`);
          const noRoles = t.allowedRoles.length === 0;
          const strokeColor = hovered ? "#2563EB" : noRoles ? "#DC2626" : "#64748B";
          const dash = noRoles ? "4 3" : undefined;
          return (
            <g
              key={t.id ?? `edge-${i}`}
              onMouseEnter={() => setHoverTransitionId(t.id ?? `edge-${i}`)}
              onMouseLeave={() => setHoverTransitionId(null)}
              style={{ cursor: "default", color: strokeColor }}
            >
              <path
                d={path}
                fill="none"
                stroke={strokeColor}
                strokeWidth={hovered ? 2 : 1.5}
                strokeDasharray={dash}
                markerEnd={hovered ? "url(#wf-arrow-hover)" : "url(#wf-arrow)"}
              />
              {/* Label at midpoint of the curve (approx) */}
              {(() => {
                const midX = (from.x + to.x) / 2;
                const midY = (from.y + to.y) / 2;
                const nx = -(to.y - from.y);
                const ny = (to.x - from.x);
                const len = Math.hypot(nx, ny) || 1;
                const lx = midX + (nx / len) * curve * 0.7;
                const ly = midY + (ny / len) * curve * 0.7;
                return (
                  <>
                    <rect
                      x={lx - (t.actionLabel.length * 3.5 + 6)}
                      y={ly - 9}
                      width={t.actionLabel.length * 7 + 12}
                      height={18}
                      rx={9}
                      fill="white"
                      stroke={strokeColor}
                      strokeWidth={1}
                    />
                    <text
                      x={lx}
                      y={ly + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill={hovered ? "#1D4ED8" : "#334155"}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {t.actionLabel || "(no action)"}
                    </text>
                  </>
                );
              })()}
            </g>
          );
        })}

        {/* State nodes */}
        {sorted.map((s) => {
          const p = pos.get(s.stateName)!;
          const fill = stateColor.get(s.stateName) ?? "#F1F0ED";
          return (
            <g key={s.stateName}>
              <rect
                x={p.x - NODE_W / 2}
                y={p.y - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={fill}
                stroke="#1F2937"
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill="#1F2937"
                style={{ userSelect: "none" }}
              >
                {s.stateName || "(unnamed)"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[11px] text-ink-muted mt-2">
        Red dashed arrows = transition has no roles assigned (SystemManager only).
        Hover an arrow to highlight it.
      </p>
    </div>
  );
}

// Minimal Tailwind color → hex map covering the preset badge styles. Any
// non-matching style falls back to the canvas color.
function tailwindColorToHex(hue: string, shade: string): string {
  const palette: Record<string, Record<string, string>> = {
    gray:   { "100": "#F3F4F6", "200": "#E5E7EB" },
    yellow: { "100": "#FEF3C7", "200": "#FDE68A" },
    blue:   { "100": "#DBEAFE", "200": "#BFDBFE" },
    green:  { "100": "#D1FAE5", "200": "#A7F3D0" },
    red:    { "100": "#FEE2E2", "200": "#FECACA" },
    purple: { "100": "#EDE9FE", "200": "#DDD6FE" },
  };
  return palette[hue]?.[shade] ?? "#F1F0ED";
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [w, r] = await Promise.all([
        api.get<WorkflowDetail>(`/workflows/${params.id}`),
        api.get<Role[]>("/roles"),
      ]);
      setWorkflow(w);
      setRoles(r);
      setStates(w.states);
      setTransitions(w.transitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function toggleActive() {
    if (!workflow) return;
    setError(null);
    try {
      const updated = await api.put<WorkflowDetail>(`/workflows/${workflow.id}`, {
        isActive: !workflow.isActive,
      });
      setWorkflow({ ...workflow, isActive: updated.isActive });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function del() {
    if (!workflow) return;
    if (!confirm(`Delete workflow "${workflow.name}"?`)) return;
    setError(null);
    try {
      await api.delete(`/workflows/${workflow.id}`);
      window.location.href = "/admin/workflows";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  // ---------- State editing ----------
  function addState() {
    setStates([
      ...states,
      { stateName: "", docStatus: 0, style: "bg-gray-200 text-gray-800", sortOrder: states.length },
    ]);
  }
  function updateState(i: number, patch: Partial<State>) {
    setStates((ss) => ss.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeState(i: number) {
    const name = states[i].stateName;
    setStates((ss) => ss.filter((_, idx) => idx !== i));
    // Also drop transitions referencing this state.
    setTransitions((ts) => ts.filter((t) => t.fromState !== name && t.toState !== name));
  }

  async function saveStates() {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<WorkflowDetail>(`/workflows/${workflow.id}/states`, {
        states: states.map((s, idx) => ({ ...s, sortOrder: idx })),
      });
      setStates(updated.states);
      setTransitions(updated.transitions); // server may have dropped orphaned ones
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save states");
    } finally {
      setSaving(false);
    }
  }

  // ---------- Transition editing ----------
  function addTransition() {
    if (states.length === 0) return;
    setTransitions([
      ...transitions,
      {
        fromState: states[0].stateName,
        actionLabel: "",
        toState: states[0].stateName,
        allowedRoles: [],
      },
    ]);
  }
  function updateTransition(i: number, patch: Partial<Transition>) {
    setTransitions((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function toggleTransitionRole(i: number, roleName: string) {
    setTransitions((ts) =>
      ts.map((t, idx) => {
        if (idx !== i) return t;
        const set = new Set(t.allowedRoles);
        if (set.has(roleName)) set.delete(roleName);
        else set.add(roleName);
        return { ...t, allowedRoles: [...set] };
      }),
    );
  }
  function removeTransition(i: number) {
    setTransitions((ts) => ts.filter((_, idx) => idx !== i));
  }

  async function saveTransitions() {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.put<WorkflowDetail>(
        `/workflows/${workflow.id}/transitions`,
        { transitions },
      );
      setTransitions(updated.transitions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save transitions");
    } finally {
      setSaving(false);
    }
  }

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Workflows", href: "/admin/workflows" },
    { label: workflow?.name ?? "Workflow" },
  ];

  if (error && !workflow) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Workflow"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }

  if (!workflow) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading workflow…" />
        <Skeleton className="h-96" rounded="rounded-lg" />
      </AppShell>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={workflow.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className={workflow.isActive ? "badge-green" : "badge-gray"}>
              {workflow.isActive ? "Active" : "Inactive"}
            </span>
            <span className="text-ink-muted">·</span>
            <span>Doctype: <span className="font-mono">{workflow.doctype}</span></span>
            <span className="text-ink-muted">·</span>
            <span>Status field: <span className="font-mono">{workflow.statusField}</span></span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            <Button variant="secondary" onClick={toggleActive} type="button">
              {workflow.isActive ? "Deactivate" : "Activate"}
            </Button>
            <Button variant="danger" onClick={del} type="button">
              Delete
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {workflow.isActive && (
        <div className="mb-4">
          <Toast
            kind="info"
            message="This workflow is active. Any existing docs in states not listed here will be stuck — add matching states before activating on live data."
          />
        </div>
      )}

      <div className="max-w-5xl space-y-6">
        {/* ---------- Visual flow + validation ---------- */}
        {(() => {
          const issues = validateWorkflow(states, transitions);
          return (
            <>
              <Card className="p-4">
                <SectionHeader title="Flow" />
                <WorkflowDiagram states={states} transitions={transitions} />
              </Card>
              {issues.length > 0 && (
                <Card className="p-4">
                  <SectionHeader title={`Validation (${issues.length})`} />
                  <ul className="space-y-1.5 text-sm">
                    {issues.map((iss, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-2 ${
                          iss.severity === "error" ? "text-red-700" : "text-amber-700"
                        }`}
                      >
                        <span className="font-bold">
                          {iss.severity === "error" ? "✗" : "⚠"}
                        </span>
                        <span className="flex-1">{iss.message}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          );
        })()}

        {/* ---------- States ---------- */}
        <Card className="p-4">
          <SectionHeader
            title="States"
            actions={
              <>
                <Button variant="secondary" size="sm" onClick={addState} type="button">
                  + Add state
                </Button>
                <Button
                  variant="brand"
                  size="sm"
                  onClick={saveStates}
                  disabled={saving}
                  type="button"
                >
                  Save states
                </Button>
              </>
            }
          />
          <table className="w-full text-sm">
            <thead className="text-ink-muted text-start">
              <tr>
                <th className="py-1">Name</th>
                <th className="py-1 w-32">DocStatus</th>
                <th className="py-1 w-64">Badge style</th>
                <th className="py-1 w-32">Preview</th>
                <th className="py-1 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {states.map((s, i) => (
                <tr key={i} className="border-t border-ink-muted/10">
                  <td className="py-1 pe-2">
                    <input
                      className="input"
                      value={s.stateName}
                      onChange={(e) => updateState(i, { stateName: e.target.value })}
                      placeholder="e.g. Pending Approval"
                      required
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <select
                      className="input"
                      value={s.docStatus}
                      onChange={(e) => updateState(i, { docStatus: Number(e.target.value) })}
                    >
                      <option value={0}>0 · Draft</option>
                      <option value={1}>1 · Submitted</option>
                      <option value={2}>2 · Cancelled</option>
                    </select>
                  </td>
                  <td className="py-1 pe-2">
                    <select
                      className="input"
                      value={s.style ?? ""}
                      onChange={(e) => updateState(i, { style: e.target.value || null })}
                    >
                      <option value="">(none)</option>
                      {STYLE_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pe-2">
                    {s.style && (
                      <span className={`px-2 py-1 rounded text-xs ${s.style}`}>
                        {s.stateName || "state"}
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-end">
                    <button
                      onClick={() => removeState(i)}
                      className="text-red-600 text-xs"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {states.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-ink-muted text-xs">
                    No states yet. Add states before defining transitions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {/* ---------- Transitions ---------- */}
        <Card className="p-4">
          <SectionHeader
            title="Transitions"
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addTransition}
                  disabled={states.length === 0}
                  type="button"
                >
                  + Add transition
                </Button>
                <Button
                  variant="brand"
                  size="sm"
                  onClick={saveTransitions}
                  disabled={saving}
                  type="button"
                >
                  Save transitions
                </Button>
              </>
            }
          />
          <table className="w-full text-sm">
            <thead className="text-ink-muted text-start">
              <tr>
                <th className="py-1 w-36">From</th>
                <th className="py-1 w-40">Action label</th>
                <th className="py-1 w-36">To</th>
                <th className="py-1">Allowed roles</th>
                <th className="py-1 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((t, i) => (
                <tr key={i} className="border-t border-ink-muted/10 align-top">
                  <td className="py-1 pe-2">
                    <select
                      className="input"
                      value={t.fromState}
                      onChange={(e) => updateTransition(i, { fromState: e.target.value })}
                    >
                      {states.map((s, idx) => (
                        <option key={idx} value={s.stateName}>
                          {s.stateName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pe-2">
                    <input
                      className="input"
                      value={t.actionLabel}
                      onChange={(e) => updateTransition(i, { actionLabel: e.target.value })}
                      placeholder="e.g. Approve"
                      required
                    />
                  </td>
                  <td className="py-1 pe-2">
                    <select
                      className="input"
                      value={t.toState}
                      onChange={(e) => updateTransition(i, { toState: e.target.value })}
                    >
                      {states.map((s, idx) => (
                        <option key={idx} value={s.stateName}>
                          {s.stateName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pe-2">
                    <div className="flex flex-wrap gap-1">
                      {roles.map((r) => {
                        const on = t.allowedRoles.includes(r.roleName);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => toggleTransitionRole(i, r.roleName)}
                            className={`text-xs px-2 py-0.5 rounded border ${
                              on
                                ? "bg-brand-600 text-white border-brand-600"
                                : "bg-surface-raised text-ink-soft border-ink-muted/20"
                            }`}
                          >
                            {r.roleName}
                          </button>
                        );
                      })}
                      {t.allowedRoles.length === 0 && (
                        <span className="text-xs text-ink-muted italic self-center">
                          SystemManager only
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-1 text-end">
                    <button
                      onClick={() => removeTransition(i)}
                      className="text-red-600 text-xs"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {transitions.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-ink-muted text-xs">
                    No transitions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Workflow" docId={params.id} />
      </div>
</AppShell>
  );
}
