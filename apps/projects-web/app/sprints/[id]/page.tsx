"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  Segmented,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";

// Sprints workspace detail — Zoho-Sprints-style tabbed workspace with backlog,
// board, reports, epics and OKRs. Every mutation goes through the shared api
// helper and re-loads the affected slice. Tab state lives in the URL search
// param so links + refreshes preserve context.

// ── Types ───────────────────────────────────────────────────────────────

interface WorkspaceCounts {
  sprints: number;
  epics: number;
  workItems: number;
  releases: number;
  okrs: number;
}
interface Workspace {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isActive: boolean;
  _count: WorkspaceCounts;
}

type SprintStatus = "Planning" | "Active" | "Completed" | "Cancelled";
interface SprintRow {
  id: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  _count: { workItems: number };
}

type EpicColor = "violet" | "blue" | "green" | "amber" | "rose";
type EpicStatus = "Open" | "InProgress" | "Completed" | "Cancelled";
interface EpicRow {
  id: string;
  name: string;
  description: string | null;
  color: EpicColor;
  status: EpicStatus;
  targetDate: string | null;
  _count: { workItems: number };
}

type WorkItemType = "Story" | "Task" | "Bug" | "SubTask";
type WorkItemStatus = "Todo" | "InProgress" | "InReview" | "Done" | "Cancelled";
type WorkItemPriority = "Low" | "Medium" | "High" | "Urgent";
interface WorkItem {
  id: string;
  key: string;
  type: WorkItemType;
  title: string;
  description: string | null;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  points: number | null;
  assigneeUserIds: string[];
  labels: string[];
  dueDate: string | null;
  sortOrder: number;
  epic: { id: string; name: string; color: EpicColor } | null;
  sprint: { id: string; name: string; status: SprintStatus } | null;
  release: { id: string; name: string } | null;
}

interface BacklogPayload {
  total: number;
  totalPoints: number;
  items: WorkItem[];
}
interface BoardColumn {
  status: Exclude<WorkItemStatus, "Cancelled">;
  items: WorkItem[];
}
interface BoardPayload {
  sprint: SprintRow | null;
  columns: BoardColumn[];
}

interface BurndownPayload {
  sprint: SprintRow;
  totalPoints: number;
  completedPoints: number;
  totalItems: number;
  doneItems: number;
  series: { date: string; remaining: number; ideal: number }[];
}
interface VelocityPayload {
  averageVelocity: number;
  series: { id: string; name: string; completedPoints: number; totalPoints: number }[];
}

interface KeyResult {
  id: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  sortOrder: number;
}
type OkrStatus = "OnTrack" | "AtRisk" | "OffTrack" | "Completed" | "Cancelled";
interface Okr {
  id: string;
  objective: string;
  description: string | null;
  ownerUserId: string | null;
  period: string;
  status: OkrStatus;
  progress: number;
  keyResults: KeyResult[];
}

// ── Utilities ───────────────────────────────────────────────────────────

const EPIC_TINTS: Record<EpicColor, { bg: string; ring: string; dot: string; text: string }> = {
  violet: { bg: "bg-violet-50", ring: "ring-violet-200", dot: "bg-violet-500", text: "text-violet-700" },
  blue:   { bg: "bg-blue-50",   ring: "ring-blue-200",   dot: "bg-blue-500",   text: "text-blue-700" },
  green:  { bg: "bg-emerald-50",ring: "ring-emerald-200",dot: "bg-emerald-500",text: "text-emerald-700" },
  amber:  { bg: "bg-amber-50",  ring: "ring-amber-200",  dot: "bg-amber-500",  text: "text-amber-700" },
  rose:   { bg: "bg-rose-50",   ring: "ring-rose-200",   dot: "bg-rose-500",   text: "text-rose-700" },
};

const PRIORITY_BADGE: Record<WorkItemPriority, string> = {
  Low:    "badge-gray",
  Medium: "badge-blue",
  High:   "badge-amber",
  Urgent: "badge-red",
};

const TYPE_GLYPH: Record<WorkItemType, { label: string; cls: string }> = {
  Story:   { label: "S", cls: "bg-emerald-100 text-emerald-700" },
  Task:    { label: "T", cls: "bg-blue-100 text-blue-700" },
  Bug:     { label: "B", cls: "bg-rose-100 text-rose-700" },
  SubTask: { label: "s", cls: "bg-gray-100 text-gray-700" },
};

const OKR_BADGE: Record<OkrStatus, string> = {
  OnTrack:   "badge-green",
  AtRisk:    "badge-amber",
  OffTrack:  "badge-red",
  Completed: "badge-brand",
  Cancelled: "badge-gray",
};

const BOARD_STATUSES: Exclude<WorkItemStatus, "Cancelled">[] = [
  "Todo",
  "InProgress",
  "InReview",
  "Done",
];
const BOARD_LABEL: Record<Exclude<WorkItemStatus, "Cancelled">, string> = {
  Todo:       "To do",
  InProgress: "In progress",
  InReview:   "In review",
  Done:       "Done",
};

function currentPeriod(d = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}
function pointsSum(items: WorkItem[]): number {
  return items.reduce((a, b) => a + (b.points ?? 0), 0);
}

// SVG chart helpers ─ compute a simple line over (index, value) inside a box.
function scaleX(i: number, total: number, w: number, pad: number): number {
  if (total <= 1) return pad;
  return pad + (i / (total - 1)) * (w - pad * 2);
}
function scaleY(v: number, maxV: number, h: number, pad: number): number {
  if (maxV <= 0) return h - pad;
  const clamped = Math.max(0, Math.min(v, maxV));
  return pad + (1 - clamped / maxV) * (h - pad * 2);
}

// ── Page ────────────────────────────────────────────────────────────────

type TabKey = "backlog" | "board" | "reports" | "epics" | "okrs";
const TAB_ORDER: TabKey[] = ["backlog", "board", "reports", "epics", "okrs"];

function InnerWorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams?.get("tab") as TabKey) || "backlog";

  const [tab, setTabState] = useState<TabKey>(
    TAB_ORDER.includes(initialTab) ? initialTab : "backlog",
  );
  const setTab = useCallback(
    (v: TabKey) => {
      setTabState(v);
      const usp = new URLSearchParams(Array.from(searchParams?.entries() ?? []));
      usp.set("tab", v);
      router.replace(`/projects/sprints/${workspaceId}?${usp.toString()}`);
    },
    [router, searchParams, workspaceId],
  );

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [sprints, setSprints] = useState<SprintRow[]>([]);
  const [epics, setEpics] = useState<EpicRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    const w = await api.get<Workspace>(`/agile/workspaces/${workspaceId}`);
    setWorkspace(w);
  }, [workspaceId]);

  const loadSprints = useCallback(async () => {
    const s = await api.get<SprintRow[]>(
      `/agile/sprints?workspaceId=${workspaceId}`,
    );
    setSprints(s);
  }, [workspaceId]);

  const loadEpics = useCallback(async () => {
    const e = await api.get<EpicRow[]>(`/agile/epics?workspaceId=${workspaceId}`);
    setEpics(e);
  }, [workspaceId]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadWorkspace(), loadSprints(), loadEpics()]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
  }, [loadWorkspace, loadSprints, loadEpics]);

  if (error && !workspace) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Sprints", href: "/projects/sprints" }]}
          title="Workspace"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </>
    );
  }
  if (!workspace) {
    return (
      <>
        <PageHeader
          breadcrumb={[{ label: "Sprints", href: "/projects/sprints" }]}
          title="Loading…"
        />
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" rounded="rounded-lg" />
          <Skeleton className="h-40 w-full" rounded="rounded-lg" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Sprints", href: "/projects/sprints" },
          { label: workspace.name },
        ]}
        title={workspace.name}
        subtitle={
          <span className="flex items-center gap-3">
            <span className="font-mono text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded border border-brand-100">
              {workspace.key}
            </span>
            {workspace.isActive ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-gray">Archived</span>
            )}
            <span className="text-ink-muted">
              {workspace._count.sprints} sprints · {workspace._count.epics} epics ·{" "}
              {workspace._count.workItems} items
            </span>
          </span>
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
        </div>
      )}

      <div className="mb-4">
        <Segmented<TabKey>
          value={tab}
          onChange={setTab}
          options={[
            { value: "backlog", label: "Backlog" },
            { value: "board",   label: "Board" },
            { value: "reports", label: "Reports" },
            { value: "epics",   label: "Epics",   count: epics.length },
            { value: "okrs",    label: "OKRs" },
          ]}
        />
      </div>

      {tab === "backlog" && (
        <BacklogTab
          workspaceId={workspaceId}
          workspaceKey={workspace.key}
          sprints={sprints}
          epics={epics}
          reloadSprints={loadSprints}
          onNotice={(k, m) => (k === "error" ? setError(m) : setMsg(m))}
        />
      )}
      {tab === "board" && (
        <BoardTab
          workspaceId={workspaceId}
          sprints={sprints}
          onNotice={(k, m) => (k === "error" ? setError(m) : setMsg(m))}
        />
      )}
      {tab === "reports" && (
        <ReportsTab
          workspaceId={workspaceId}
          sprints={sprints}
          onNotice={(k, m) => (k === "error" ? setError(m) : setMsg(m))}
        />
      )}
      {tab === "epics" && (
        <EpicsTab
          workspaceId={workspaceId}
          epics={epics}
          reloadEpics={loadEpics}
          onNotice={(k, m) => (k === "error" ? setError(m) : setMsg(m))}
        />
      )}
      {tab === "okrs" && (
        <OkrsTab
          workspaceId={workspaceId}
          onNotice={(k, m) => (k === "error" ? setError(m) : setMsg(m))}
        />
      )}

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Sprint" docId={workspaceId} />
      </div>
    </>
  );
}

// ── Backlog tab ─────────────────────────────────────────────────────────

type Notice = (kind: "success" | "error", msg: string) => void;

function BacklogTab({
  workspaceId,
  workspaceKey: _workspaceKey,
  sprints,
  epics,
  reloadSprints,
  onNotice,
}: {
  workspaceId: string;
  workspaceKey: string;
  sprints: SprintRow[];
  epics: EpicRow[];
  reloadSprints: () => Promise<void>;
  onNotice: Notice;
}) {
  // "backlog" or a sprintId
  const [scope, setScope] = useState<string>("backlog");
  const [items, setItems] = useState<WorkItem[]>([]);
  const [totals, setTotals] = useState<{ count: number; points: number }>({ count: 0, points: 0 });
  const [loading, setLoading] = useState(true);

  // Sprint create
  const [showSprintDrawer, setShowSprintDrawer] = useState(false);
  const emptySprintForm = {
    name: "",
    goal: "",
    startDate: "",
    endDate: "",
  };
  const [sprintForm, setSprintForm] = useState(emptySprintForm);
  const [sprintBusy, setSprintBusy] = useState(false);

  // Work item create
  const [showItemDrawer, setShowItemDrawer] = useState(false);
  const emptyItemForm = {
    type: "Story" as WorkItemType,
    title: "",
    description: "",
    priority: "Medium" as WorkItemPriority,
    points: 0,
    epicId: "",
    sprintId: "",
    labels: "",
    dueDate: "",
  };
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [itemBusy, setItemBusy] = useState(false);

  // Complete sprint
  const [completeFor, setCompleteFor] = useState<SprintRow | null>(null);
  const [moveIncompleteTo, setMoveIncompleteTo] = useState<string>("");
  const [completeBusy, setCompleteBusy] = useState(false);

  const activeSprint = sprints.find((s) => s.id === scope) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (scope === "backlog") {
        const p = await api.get<BacklogPayload>(
          `/agile/backlog?workspaceId=${workspaceId}`,
        );
        setItems(p.items);
        setTotals({ count: p.total, points: p.totalPoints });
      } else {
        const list = await api.get<WorkItem[]>(
          `/agile/work-items?workspaceId=${workspaceId}&sprintId=${scope}`,
        );
        setItems(list);
        setTotals({ count: list.length, points: pointsSum(list) });
      }
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Failed to load backlog");
    } finally {
      setLoading(false);
    }
  }, [scope, workspaceId, onNotice]);
  useEffect(() => {
    load();
  }, [load]);

  const movableSprints = useMemo(
    () => sprints.filter((s) => s.status === "Planning" || s.status === "Active"),
    [sprints],
  );

  const grouped = useMemo(() => {
    const bucketMap = new Map<string, { epic: EpicRow | null; items: WorkItem[] }>();
    bucketMap.set("__none__", { epic: null, items: [] });
    for (const it of items) {
      const key = it.epic?.id ?? "__none__";
      if (!bucketMap.has(key)) {
        const epic = epics.find((e) => e.id === key) ?? null;
        bucketMap.set(key, { epic, items: [] });
      }
      bucketMap.get(key)!.items.push(it);
    }
    return Array.from(bucketMap.values()).filter((b) => b.items.length > 0);
  }, [items, epics]);

  async function saveSprint(e: React.FormEvent) {
    e.preventDefault();
    setSprintBusy(true);
    try {
      await api.post("/agile/sprints", {
        workspaceId,
        name: sprintForm.name.trim(),
        goal: sprintForm.goal.trim() || null,
        startDate: sprintForm.startDate ? new Date(sprintForm.startDate).toISOString() : null,
        endDate: sprintForm.endDate ? new Date(sprintForm.endDate).toISOString() : null,
      });
      setShowSprintDrawer(false);
      setSprintForm(emptySprintForm);
      await reloadSprints();
      onNotice("success", "Sprint created");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSprintBusy(false);
    }
  }

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setItemBusy(true);
    try {
      await api.post("/agile/work-items", {
        workspaceId,
        type: itemForm.type,
        title: itemForm.title.trim(),
        description: itemForm.description.trim() || null,
        priority: itemForm.priority,
        points: Number(itemForm.points) || 0,
        epicId: itemForm.epicId || undefined,
        sprintId: itemForm.sprintId || undefined,
        labels: itemForm.labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        dueDate: itemForm.dueDate ? new Date(itemForm.dueDate).toISOString() : undefined,
      });
      setShowItemDrawer(false);
      setItemForm(emptyItemForm);
      await load();
      onNotice("success", "Work item created");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setItemBusy(false);
    }
  }

  async function moveToSprint(itemId: string, sprintId: string | null) {
    try {
      await api.post(`/agile/work-items/${itemId}/move`, { sprintId });
      await load();
      onNotice("success", sprintId ? "Moved to sprint" : "Moved to backlog");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Move failed");
    }
  }

  async function startSprint(s: SprintRow) {
    if (!confirm(`Start sprint "${s.name}"?`)) return;
    try {
      await api.post(`/agile/sprints/${s.id}/start`, {});
      await reloadSprints();
      await load();
      onNotice("success", "Sprint started");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Start failed");
    }
  }

  function openCompleteSprint(s: SprintRow) {
    setCompleteFor(s);
    setMoveIncompleteTo("");
  }
  async function submitCompleteSprint() {
    if (!completeFor) return;
    setCompleteBusy(true);
    try {
      const payload = {
        moveIncompleteTo: moveIncompleteTo === "__backlog__"
          ? null
          : moveIncompleteTo || undefined,
      };
      await api.post(`/agile/sprints/${completeFor.id}/complete`, payload);
      setCompleteFor(null);
      await reloadSprints();
      await load();
      onNotice("success", "Sprint completed");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Complete failed");
    } finally {
      setCompleteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-muted uppercase tracking-wide">View</label>
          <select
            className="input input-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="backlog">Backlog</option>
            {sprints
              .filter((s) => s.status === "Planning" || s.status === "Active")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.status}
                </option>
              ))}
          </select>
        </div>
        <div className="text-xs text-ink-muted">
          {loading
            ? "Loading…"
            : `${totals.count} item${totals.count === 1 ? "" : "s"} · ${totals.points} pts`}
        </div>
        {activeSprint && activeSprint.status === "Planning" && (
          <Button variant="brand" size="sm" onClick={() => startSprint(activeSprint)}>
            Start sprint
          </Button>
        )}
        {activeSprint && activeSprint.status === "Active" && (
          <Button variant="secondary" size="sm" onClick={() => openCompleteSprint(activeSprint)}>
            Complete sprint
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => setShowSprintDrawer(true)}>
          + New Sprint
        </Button>
        <Button variant="brand" onClick={() => setShowItemDrawer(true)}>
          + New Work Item
        </Button>
      </Card>

      {grouped.length === 0 && !loading && (
        <Card className="p-10 text-center text-ink-muted text-sm">
          Nothing here yet — create a work item to get started.
        </Card>
      )}

      {grouped.map((bucket) => {
        const key = bucket.epic?.id ?? "__none__";
        const tint = bucket.epic ? EPIC_TINTS[bucket.epic.color] : null;
        return (
          <Card key={key} className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-ink-muted/10 bg-surface-sunken">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    tint ? tint.dot : "bg-gray-300"
                  }`}
                />
                <span className="font-semibold text-ink text-sm">
                  {bucket.epic?.name ?? "No epic"}
                </span>
                <span className="text-[11px] text-ink-muted">
                  {bucket.items.length} · {pointsSum(bucket.items)} pts
                </span>
              </div>
            </div>
            <div className="divide-y divide-ink-muted/10">
              {bucket.items.map((it) => (
                <BacklogRow
                  key={it.id}
                  item={it}
                  movableSprints={movableSprints}
                  onMove={(sid) => moveToSprint(it.id, sid)}
                />
              ))}
            </div>
          </Card>
        );
      })}

      <Drawer
        open={showSprintDrawer}
        onClose={() => setShowSprintDrawer(false)}
        title="New sprint"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowSprintDrawer(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => saveSprint(e as unknown as React.FormEvent)}
              disabled={sprintBusy || !sprintForm.name.trim()}
            >
              {sprintBusy ? "Saving…" : "Create sprint"}
            </Button>
          </>
        }
      >
        <form onSubmit={saveSprint} className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              value={sprintForm.name}
              onChange={(e) => setSprintForm({ ...sprintForm, name: e.target.value })}
              placeholder="Sprint 12"
              required
              autoFocus
            />
          </FormField>
          <FormField label="Goal">
            <input
              className="input"
              value={sprintForm.goal}
              onChange={(e) => setSprintForm({ ...sprintForm, goal: e.target.value })}
              placeholder="Ship checkout redesign"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start date">
              <input
                type="date"
                className="input"
                value={sprintForm.startDate}
                onChange={(e) => setSprintForm({ ...sprintForm, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End date">
              <input
                type="date"
                className="input"
                value={sprintForm.endDate}
                onChange={(e) => setSprintForm({ ...sprintForm, endDate: e.target.value })}
              />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showItemDrawer}
        onClose={() => setShowItemDrawer(false)}
        title="New work item"
        width="w-[620px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowItemDrawer(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => saveItem(e as unknown as React.FormEvent)}
              disabled={itemBusy || !itemForm.title.trim()}
            >
              {itemBusy ? "Saving…" : "Create item"}
            </Button>
          </>
        }
      >
        <form onSubmit={saveItem} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select
                className="input"
                value={itemForm.type}
                onChange={(e) =>
                  setItemForm({ ...itemForm, type: e.target.value as WorkItemType })
                }
              >
                <option value="Story">Story</option>
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="SubTask">Sub-task</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                className="input"
                value={itemForm.priority}
                onChange={(e) =>
                  setItemForm({ ...itemForm, priority: e.target.value as WorkItemPriority })
                }
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </FormField>
          </div>
          <FormField label="Title" required>
            <input
              className="input"
              value={itemForm.title}
              onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[80px]"
              value={itemForm.description}
              onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Points">
              <input
                type="number"
                min={0}
                className="input text-end"
                value={itemForm.points}
                onChange={(e) =>
                  setItemForm({ ...itemForm, points: Number(e.target.value) || 0 })
                }
              />
            </FormField>
            <FormField label="Epic">
              <select
                className="input"
                value={itemForm.epicId}
                onChange={(e) => setItemForm({ ...itemForm, epicId: e.target.value })}
              >
                <option value="">— none —</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Sprint">
              <select
                className="input"
                value={itemForm.sprintId}
                onChange={(e) => setItemForm({ ...itemForm, sprintId: e.target.value })}
              >
                <option value="">Backlog</option>
                {movableSprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Labels" hint="Comma-separated">
              <input
                className="input"
                value={itemForm.labels}
                onChange={(e) => setItemForm({ ...itemForm, labels: e.target.value })}
                placeholder="frontend, checkout"
              />
            </FormField>
            <FormField label="Due date">
              <input
                type="date"
                className="input"
                value={itemForm.dueDate}
                onChange={(e) => setItemForm({ ...itemForm, dueDate: e.target.value })}
              />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={!!completeFor}
        onClose={() => setCompleteFor(null)}
        title={completeFor ? `Complete ${completeFor.name}` : "Complete sprint"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCompleteFor(null)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={submitCompleteSprint}
              disabled={completeBusy}
            >
              {completeBusy ? "Working…" : "Complete sprint"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-ink-soft">
            Any incomplete items in this sprint can be moved to another destination.
          </div>
          <FormField label="Move incomplete items to">
            <select
              className="input"
              value={moveIncompleteTo}
              onChange={(e) => setMoveIncompleteTo(e.target.value)}
            >
              <option value="">Leave in this sprint</option>
              <option value="__backlog__">Backlog</option>
              {sprints
                .filter(
                  (s) =>
                    s.id !== completeFor?.id &&
                    (s.status === "Planning" || s.status === "Active"),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.status}
                  </option>
                ))}
            </select>
          </FormField>
        </div>
      </Drawer>
    </div>
  );
}

function BacklogRow({
  item,
  movableSprints,
  onMove,
}: {
  item: WorkItem;
  movableSprints: SprintRow[];
  onMove: (sprintId: string | null) => void;
}) {
  const tint = item.epic ? EPIC_TINTS[item.epic.color] : null;
  const glyph = TYPE_GLYPH[item.type];
  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-brand-50/40 transition">
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${glyph.cls}`}
        title={item.type}
      >
        {glyph.label}
      </span>
      <span className="font-mono text-[11px] text-ink-muted w-16 shrink-0">{item.key}</span>
      <span className="flex-1 text-sm text-ink truncate">{item.title}</span>
      {tint && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${tint.bg} ${tint.text}`}
          title={item.epic?.name}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${tint.dot}`} />
          {item.epic?.name}
        </span>
      )}
      <span className={PRIORITY_BADGE[item.priority]}>{item.priority}</span>
      <span className="badge-gray tabular-nums">{item.points ?? 0} pts</span>
      <select
        className="input input-sm w-40"
        value={item.sprint?.id ?? ""}
        onChange={(e) => onMove(e.target.value || null)}
        title="Move to sprint"
      >
        <option value="">Backlog</option>
        {movableSprints.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Board tab ───────────────────────────────────────────────────────────

function BoardTab({
  workspaceId,
  sprints,
  onNotice,
}: {
  workspaceId: string;
  sprints: SprintRow[];
  onNotice: Notice;
}) {
  const pickable = useMemo(
    () => sprints.filter((s) => s.status === "Active" || s.status === "Planning"),
    [sprints],
  );
  const defaultSprint =
    sprints.find((s) => s.status === "Active")?.id ??
    pickable[0]?.id ??
    "";
  const [sprintId, setSprintId] = useState<string>(defaultSprint);
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailFor, setDetailFor] = useState<WorkItem | null>(null);

  useEffect(() => {
    // If sprints load after mount, hydrate default.
    if (!sprintId && defaultSprint) setSprintId(defaultSprint);
  }, [defaultSprint, sprintId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ workspaceId });
      if (sprintId) qs.set("sprintId", sprintId);
      const p = await api.get<BoardPayload>(`/agile/board?${qs.toString()}`);
      setBoard(p);
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, [sprintId, workspaceId, onNotice]);
  useEffect(() => {
    load();
  }, [load]);

  async function moveStatus(item: WorkItem, status: WorkItemStatus) {
    try {
      await api.post(`/agile/work-items/${item.id}/move`, { status });
      await load();
      onNotice("success", `Moved to ${BOARD_LABEL[status as Exclude<WorkItemStatus, "Cancelled">] ?? status}`);
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Move failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-ink-muted uppercase tracking-wide">Sprint</label>
        <select
          className="input input-sm"
          value={sprintId}
          onChange={(e) => setSprintId(e.target.value)}
        >
          <option value="">Pick sprint…</option>
          {pickable.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.status}
            </option>
          ))}
        </select>
        <div className="text-xs text-ink-muted">
          {loading
            ? "Loading…"
            : board?.sprint
              ? `${board.sprint.name} · ${board.sprint.status}`
              : "No active sprint"}
        </div>
      </Card>

      {!board || board.columns.length === 0 ? (
        <Card className="p-10 text-center text-ink-muted text-sm">
          {loading ? "Loading…" : "No sprint selected or nothing to show."}
        </Card>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {BOARD_STATUSES.map((st) => {
            const col = board.columns.find((c) => c.status === st) ?? {
              status: st,
              items: [] as WorkItem[],
            };
            return (
              <div key={st} className="flex flex-col min-h-[400px]">
                <div className="flex items-center justify-between px-3 py-2 bg-surface-sunken rounded-t-lg border border-b-0 border-ink-muted/10">
                  <span className="text-xs font-semibold uppercase text-ink-soft tracking-wide">
                    {BOARD_LABEL[st]}
                  </span>
                  <span className="text-[11px] text-ink-muted tabular-nums">
                    {col.items.length} · {pointsSum(col.items)} pts
                  </span>
                </div>
                <div className="flex-1 space-y-2 p-2 bg-surface rounded-b-lg border border-t-0 border-ink-muted/10">
                  {col.items.map((it) => (
                    <BoardCard
                      key={it.id}
                      item={it}
                      onOpen={() => setDetailFor(it)}
                      onMove={(status) => moveStatus(it, status)}
                    />
                  ))}
                  {col.items.length === 0 && (
                    <div className="text-[11px] text-ink-muted italic text-center py-4">
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailFor && (
        <WorkItemDrawer
          itemId={detailFor.id}
          onClose={() => setDetailFor(null)}
          onSaved={async () => {
            setDetailFor(null);
            await load();
            onNotice("success", "Work item updated");
          }}
          onError={(m) => onNotice("error", m)}
        />
      )}
    </div>
  );
}

function BoardCard({
  item,
  onOpen,
  onMove,
}: {
  item: WorkItem;
  onOpen: () => void;
  onMove: (status: WorkItemStatus) => void;
}) {
  const tint = item.epic ? EPIC_TINTS[item.epic.color] : null;
  const glyph = TYPE_GLYPH[item.type];
  const others = BOARD_STATUSES.filter((s) => s !== item.status);
  return (
    <div className="card p-2.5 hover:shadow-brand-glow transition cursor-pointer group">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold ${glyph.cls}`}
        >
          {glyph.label}
        </span>
        <span className="font-mono text-[10px] text-ink-muted">{item.key}</span>
        {tint && (
          <span className={`w-1.5 h-1.5 rounded-full ${tint.dot}`} title={item.epic?.name} />
        )}
        <div className="flex-1" />
        <select
          className="input input-sm py-0 px-1 text-[10px] opacity-0 group-hover:opacity-100 transition w-20"
          value=""
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value as WorkItemStatus);
          }}
          onClick={(e) => e.stopPropagation()}
          title="Move to…"
        >
          <option value="">Move…</option>
          {others.map((s) => (
            <option key={s} value={s}>
              {BOARD_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={onOpen}
        className="text-start text-sm text-ink font-medium w-full leading-snug hover:text-brand-700"
      >
        {item.title}
      </button>
      <div className="flex items-center gap-2 mt-2 text-[11px]">
        <span className={PRIORITY_BADGE[item.priority]}>{item.priority}</span>
        <span className="badge-gray tabular-nums">{item.points ?? 0} pts</span>
        <div className="flex-1" />
        {item.assigneeUserIds.length > 0 && (
          <span className="text-ink-muted">{item.assigneeUserIds.length} 👤</span>
        )}
      </div>
    </div>
  );
}

// ── Work item detail drawer ─────────────────────────────────────────────

function WorkItemDrawer({
  itemId,
  onClose,
  onSaved,
  onError,
}: {
  itemId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [item, setItem] = useState<WorkItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "Story" as WorkItemType,
    status: "Todo" as WorkItemStatus,
    priority: "Medium" as WorkItemPriority,
    points: 0,
    labels: "",
    dueDate: "",
  });

  useEffect(() => {
    (async () => {
      try {
        const it = await api.get<WorkItem>(`/agile/work-items/${itemId}`);
        setItem(it);
        setForm({
          title: it.title,
          description: it.description ?? "",
          type: it.type,
          status: it.status,
          priority: it.priority,
          points: it.points ?? 0,
          labels: (it.labels ?? []).join(", "),
          dueDate: it.dueDate ? it.dueDate.slice(0, 10) : "",
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to load work item");
      }
    })();
  }, [itemId, onError]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.put(`/agile/work-items/${itemId}`, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        type: form.type,
        status: form.status,
        priority: form.priority,
        points: Number(form.points) || 0,
        labels: form.labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
      });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? `${item.key} · ${item.title}` : "Work item"}
      width="w-[620px]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="brand"
            onClick={(e) => save(e as unknown as React.FormEvent)}
            disabled={busy || !form.title.trim()}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </>
      }
    >
      {!item ? (
        <div className="text-sm text-ink-muted">Loading…</div>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Sprint" value={item.sprint?.name ?? "Backlog"} />
            <Field label="Epic" value={item.epic?.name ?? "—"} />
            <Field label="Release" value={item.release?.name ?? "—"} />
          </div>
          <FormField label="Title" required>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[100px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select
                className="input"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as WorkItemType })}
              >
                <option value="Story">Story</option>
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="SubTask">Sub-task</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select
                className="input"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value as WorkItemPriority })
                }
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as WorkItemStatus })}
              >
                <option value="Todo">To do</option>
                <option value="InProgress">In progress</option>
                <option value="InReview">In review</option>
                <option value="Done">Done</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </FormField>
            <FormField label="Points">
              <input
                type="number"
                min={0}
                className="input text-end"
                value={form.points}
                onChange={(e) => setForm({ ...form, points: Number(e.target.value) || 0 })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Labels" hint="Comma-separated">
              <input
                className="input"
                value={form.labels}
                onChange={(e) => setForm({ ...form, labels: e.target.value })}
              />
            </FormField>
            <FormField label="Due date">
              <input
                type="date"
                className="input"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      )}
    </Drawer>
  );
}

// ── Reports tab ─────────────────────────────────────────────────────────

function ReportsTab({
  workspaceId,
  sprints,
  onNotice,
}: {
  workspaceId: string;
  sprints: SprintRow[];
  onNotice: Notice;
}) {
  const defaultSprint =
    sprints.find((s) => s.status === "Active")?.id ??
    sprints.find((s) => s.status === "Completed")?.id ??
    sprints[0]?.id ??
    "";
  const [sprintId, setSprintId] = useState<string>(defaultSprint);
  const [burndown, setBurndown] = useState<BurndownPayload | null>(null);
  const [velocity, setVelocity] = useState<VelocityPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sprintId && defaultSprint) setSprintId(defaultSprint);
  }, [defaultSprint, sprintId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [b, v] = await Promise.all([
          sprintId
            ? api.get<BurndownPayload>(`/agile/sprints/${sprintId}/burndown`)
            : Promise.resolve(null),
          api.get<VelocityPayload>(`/agile/velocity?workspaceId=${workspaceId}`),
        ]);
        setBurndown(b);
        setVelocity(v);
      } catch (e) {
        onNotice("error", e instanceof Error ? e.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    })();
  }, [sprintId, workspaceId, onNotice]);

  return (
    <div className="space-y-6">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-ink-muted uppercase tracking-wide">Sprint</label>
        <select
          className="input input-sm"
          value={sprintId}
          onChange={(e) => setSprintId(e.target.value)}
        >
          <option value="">Pick sprint…</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.status}
            </option>
          ))}
        </select>
        <div className="text-xs text-ink-muted">{loading ? "Loading…" : ""}</div>
      </Card>

      {burndown && (
        <Card className="p-4">
          <SectionHeader
            title={`Burndown — ${burndown.sprint.name}`}
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge status={burndown.sprint.status} />
              </div>
            }
          />
          <div className="grid grid-cols-4 gap-4 mb-4">
            <MiniStat label="Total pts" value={burndown.totalPoints} />
            <MiniStat label="Completed pts" value={burndown.completedPoints} />
            <MiniStat label="Total items" value={burndown.totalItems} />
            <MiniStat label="Done items" value={burndown.doneItems} />
          </div>
          <BurndownChart series={burndown.series} totalPoints={burndown.totalPoints} />
        </Card>
      )}

      {velocity && (
        <Card className="p-4">
          <SectionHeader
            title="Velocity"
            actions={
              <span className="badge-brand">
                avg {velocity.averageVelocity.toFixed(1)} pts
              </span>
            }
          />
          {velocity.series.length === 0 ? (
            <div className="text-sm text-ink-muted py-6 text-center">
              No completed sprints yet.
            </div>
          ) : (
            <VelocityBars series={velocity.series} />
          )}
        </Card>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase text-ink-muted">{label}</div>
      <div className="text-2xl font-semibold text-ink tabular-nums">{value}</div>
    </div>
  );
}

function BurndownChart({
  series,
  totalPoints,
}: {
  series: { date: string; remaining: number; ideal: number }[];
  totalPoints: number;
}) {
  const W = 720;
  const H = 240;
  const PAD = 32;
  if (series.length === 0) {
    return (
      <div className="text-sm text-ink-muted text-center py-8">
        No burndown data yet.
      </div>
    );
  }
  const maxV = Math.max(totalPoints, ...series.map((p) => Math.max(p.remaining, p.ideal)), 1);
  const idealPath = series
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(i, series.length, W, PAD).toFixed(1)} ${scaleY(
          p.ideal,
          maxV,
          H,
          PAD,
        ).toFixed(1)}`,
    )
    .join(" ");
  const remainPath = series
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(i, series.length, W, PAD).toFixed(1)} ${scaleY(
          p.remaining,
          maxV,
          H,
          PAD,
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="text-ink-muted">
        <g>
          {/* horizontal gridlines */}
          {[0.25, 0.5, 0.75].map((f) => {
            const y = PAD + f * (H - PAD * 2);
            return (
              <line
                key={f}
                x1={PAD}
                x2={W - PAD}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeDasharray="4 4"
              />
            );
          })}
          {/* axes */}
          <line
            x1={PAD}
            x2={W - PAD}
            y1={H - PAD}
            y2={H - PAD}
            stroke="currentColor"
            strokeOpacity={0.4}
          />
          <line
            x1={PAD}
            x2={PAD}
            y1={PAD}
            y2={H - PAD}
            stroke="currentColor"
            strokeOpacity={0.4}
          />
          {/* y labels */}
          <text x={4} y={PAD + 4} fontSize={10} fill="currentColor">
            {maxV}
          </text>
          <text x={4} y={H - PAD} fontSize={10} fill="currentColor">
            0
          </text>
        </g>
        {/* ideal */}
        <path
          d={idealPath}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
        {/* remaining */}
        <path d={remainPath} fill="none" stroke="#7c3aed" strokeWidth={2.5} />
        {series.map((p, i) => (
          <circle
            key={i}
            cx={scaleX(i, series.length, W, PAD)}
            cy={scaleY(p.remaining, maxV, H, PAD)}
            r={2.5}
            fill="#7c3aed"
          />
        ))}
        {/* start / end date labels */}
        {series[0] && (
          <text
            x={PAD}
            y={H - 8}
            fontSize={10}
            fill="currentColor"
            textAnchor="start"
          >
            {dateShort(series[0].date)}
          </text>
        )}
        {series.length > 1 && (
          <text
            x={W - PAD}
            y={H - 8}
            fontSize={10}
            fill="currentColor"
            textAnchor="end"
          >
            {dateShort(series[series.length - 1]!.date)}
          </text>
        )}
      </svg>
      <div className="flex items-center gap-4 text-[11px] text-ink-muted mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-0.5 bg-[#7c3aed]" /> remaining
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-0.5 bg-slate-400"
            style={{ borderTop: "1px dashed #94a3b8", height: 0 }}
          />
          ideal
        </span>
      </div>
    </div>
  );
}

function VelocityBars({
  series,
}: {
  series: { id: string; name: string; completedPoints: number; totalPoints: number }[];
}) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.totalPoints, s.completedPoints)));
  return (
    <div className="space-y-2">
      {series.map((s) => {
        const pctDone = (s.completedPoints / max) * 100;
        const pctTotal = (s.totalPoints / max) * 100;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <div className="w-40 text-xs text-ink-soft truncate">{s.name}</div>
            <div className="flex-1 relative h-4 bg-surface-sunken rounded">
              <div
                className="absolute inset-y-0 start-0 bg-brand-100 rounded"
                style={{ width: `${pctTotal}%` }}
                title={`Total ${s.totalPoints}`}
              />
              <div
                className="absolute inset-y-0 start-0 bg-brand-gradient rounded"
                style={{ width: `${pctDone}%` }}
                title={`Completed ${s.completedPoints}`}
              />
            </div>
            <div className="w-24 text-end text-xs tabular-nums text-ink-soft">
              {s.completedPoints} / {s.totalPoints}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Epics tab ───────────────────────────────────────────────────────────

function EpicsTab({
  workspaceId,
  epics,
  reloadEpics,
  onNotice,
}: {
  workspaceId: string;
  epics: EpicRow[];
  reloadEpics: () => Promise<void>;
  onNotice: Notice;
}) {
  const [drawer, setDrawer] = useState<{ open: boolean; editing: EpicRow | null }>({
    open: false,
    editing: null,
  });
  const emptyForm = {
    name: "",
    description: "",
    color: "violet" as EpicColor,
    status: "Open" as EpicStatus,
    targetDate: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  function openNew() {
    setForm(emptyForm);
    setDrawer({ open: true, editing: null });
  }
  function openEdit(ep: EpicRow) {
    setForm({
      name: ep.name,
      description: ep.description ?? "",
      color: ep.color,
      status: ep.status,
      targetDate: ep.targetDate ? ep.targetDate.slice(0, 10) : "",
    });
    setDrawer({ open: true, editing: ep });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        workspaceId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
        status: form.status,
        targetDate: form.targetDate ? new Date(form.targetDate).toISOString() : null,
      };
      if (drawer.editing) {
        await api.put(`/agile/epics/${drawer.editing.id}`, body);
      } else {
        await api.post("/agile/epics", body);
      }
      setDrawer({ open: false, editing: null });
      await reloadEpics();
      onNotice("success", drawer.editing ? "Epic updated" : "Epic created");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  async function remove(ep: EpicRow) {
    if (!confirm(`Delete epic "${ep.name}"?`)) return;
    try {
      await api.del(`/agile/epics/${ep.id}`);
      await reloadEpics();
      onNotice("success", "Epic deleted");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-muted">
          {epics.length} epic{epics.length === 1 ? "" : "s"}
        </div>
        <Button variant="brand" onClick={openNew}>
          + New Epic
        </Button>
      </div>

      {epics.length === 0 ? (
        <Card className="p-10 text-center text-ink-muted text-sm">
          No epics yet. Epics group related work items across sprints.
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {epics.map((ep) => {
            const tint = EPIC_TINTS[ep.color];
            return (
              <div
                key={ep.id}
                className={`card p-4 ring-1 ${tint.ring} ${tint.bg}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${tint.dot}`} />
                    <h3 className={`font-semibold ${tint.text}`}>{ep.name}</h3>
                  </div>
                  <StatusBadge status={ep.status} />
                </div>
                {ep.description && (
                  <p className="text-xs text-ink-soft line-clamp-3 mb-3">
                    {ep.description}
                  </p>
                )}
                <div className="flex items-center justify-between text-[11px] text-ink-muted">
                  <span>{ep._count.workItems} items</span>
                  <span>Target: {dateShort(ep.targetDate)}</span>
                </div>
                <div className="flex items-center gap-2 mt-3 justify-end">
                  <button
                    onClick={() => openEdit(ep)}
                    className="text-xs text-ink-soft hover:text-brand-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(ep)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Drawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, editing: null })}
        title={drawer.editing ? "Edit epic" : "New epic"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDrawer({ open: false, editing: null })}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim()}
            >
              {busy ? "Saving…" : drawer.editing ? "Save changes" : "Create epic"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Color">
              <div className="flex items-center gap-2">
                {(Object.keys(EPIC_TINTS) as EpicColor[]).map((c) => {
                  const tint = EPIC_TINTS[c];
                  const active = form.color === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className={`w-7 h-7 rounded-full ${tint.dot} ${
                        active ? "ring-2 ring-offset-2 ring-brand-500" : ""
                      }`}
                      title={c}
                    />
                  );
                })}
              </div>
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as EpicStatus })
                }
              >
                <option value="Open">Open</option>
                <option value="InProgress">In progress</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </FormField>
          </div>
          <FormField label="Target date">
            <input
              type="date"
              className="input"
              value={form.targetDate}
              onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </div>
  );
}

// ── OKRs tab ────────────────────────────────────────────────────────────

interface KrForm {
  id?: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
}

function OkrsTab({
  workspaceId,
  onNotice,
}: {
  workspaceId: string;
  onNotice: Notice;
}) {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [okrs, setOkrs] = useState<Okr[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawer, setDrawer] = useState<{ open: boolean; editing: Okr | null }>({
    open: false,
    editing: null,
  });
  const emptyForm = {
    objective: "",
    description: "",
    period: currentPeriod(),
    status: "OnTrack" as OkrStatus,
    keyResults: [] as KrForm[],
  };
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ workspaceId });
      if (period) qs.set("period", period);
      const list = await api.get<Okr[]>(`/agile/okrs?${qs.toString()}`);
      setOkrs(list);
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Failed to load OKRs");
    } finally {
      setLoading(false);
    }
  }, [period, workspaceId, onNotice]);
  useEffect(() => {
    load();
  }, [load]);

  const periods = useMemo(() => {
    const now = new Date();
    const list = new Set<string>();
    for (let i = -2; i <= 2; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i * 3, 1);
      list.add(currentPeriod(d));
    }
    for (const o of okrs) list.add(o.period);
    return Array.from(list).sort();
  }, [okrs]);

  function openNew() {
    setForm({ ...emptyForm, period });
    setDrawer({ open: true, editing: null });
  }
  function openEdit(o: Okr) {
    setForm({
      objective: o.objective,
      description: o.description ?? "",
      period: o.period,
      status: o.status,
      keyResults: o.keyResults.map((k) => ({
        id: k.id,
        title: k.title,
        targetValue: k.targetValue,
        currentValue: k.currentValue,
        unit: k.unit ?? "",
      })),
    });
    setDrawer({ open: true, editing: o });
  }
  function addKr() {
    setForm({
      ...form,
      keyResults: [
        ...form.keyResults,
        { title: "", targetValue: 100, currentValue: 0, unit: "%" },
      ],
    });
  }
  function updateKr(i: number, patch: Partial<KrForm>) {
    const next = [...form.keyResults];
    next[i] = { ...next[i]!, ...patch };
    setForm({ ...form, keyResults: next });
  }
  function removeKr(i: number) {
    setForm({ ...form, keyResults: form.keyResults.filter((_, ix) => ix !== i) });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        workspaceId,
        objective: form.objective.trim(),
        description: form.description.trim() || null,
        period: form.period.trim() || currentPeriod(),
        status: form.status,
        keyResults: form.keyResults.map((k) => ({
          title: k.title.trim(),
          targetValue: Number(k.targetValue) || 0,
          currentValue: Number(k.currentValue) || 0,
          unit: k.unit.trim() || null,
        })),
      };
      if (drawer.editing) {
        await api.put(`/agile/okrs/${drawer.editing.id}`, body);
      } else {
        await api.post("/agile/okrs", body);
      }
      setDrawer({ open: false, editing: null });
      await load();
      onNotice("success", drawer.editing ? "OKR updated" : "OKR created");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(o: Okr) {
    if (!confirm(`Delete OKR "${o.objective}"?`)) return;
    try {
      await api.del(`/agile/okrs/${o.id}`);
      await load();
      onNotice("success", "OKR deleted");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function bumpKr(kr: KeyResult) {
    const raw = window.prompt(
      `Update "${kr.title}" — new current value (target ${kr.targetValue}${kr.unit ?? ""})`,
      String(kr.currentValue),
    );
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      onNotice("error", "Enter a number");
      return;
    }
    try {
      await api.post(`/agile/key-results/${kr.id}/progress`, { currentValue: value });
      await load();
      onNotice("success", "Key result updated");
    } catch (e) {
      onNotice("error", e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-3 flex flex-wrap items-center gap-3">
        <label className="text-xs text-ink-muted uppercase tracking-wide">Period</label>
        <select
          className="input input-sm"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <div className="text-xs text-ink-muted">
          {loading ? "Loading…" : `${okrs.length} OKR${okrs.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex-1" />
        <Button variant="brand" onClick={openNew}>
          + New OKR
        </Button>
      </Card>

      {okrs.length === 0 ? (
        <Card className="p-10 text-center text-ink-muted text-sm">
          No OKRs for {period}. Create one to set an objective and its measurable key results.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {okrs.map((o) => (
            <Card key={o.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">{o.objective}</h3>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {o.period} · <span className={OKR_BADGE[o.status]}>{o.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(o)}
                    className="text-xs text-ink-soft hover:text-brand-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(o)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {o.description && (
                <p className="text-xs text-ink-soft">{o.description}</p>
              )}
              <div>
                <div className="flex items-center justify-between text-[11px] text-ink-muted mb-1">
                  <span>Progress</span>
                  <span>{Math.round(o.progress)}%</span>
                </div>
                <div className="h-2 bg-brand-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-gradient"
                    style={{ width: `${Math.min(100, Math.max(0, o.progress))}%` }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                {o.keyResults.map((kr) => {
                  const pct =
                    kr.targetValue > 0
                      ? Math.min(100, (kr.currentValue / kr.targetValue) * 100)
                      : 0;
                  return (
                    <div key={kr.id} className="flex items-center gap-2 text-xs">
                      <div className="flex-1">
                        <div className="text-ink">{kr.title}</div>
                        <div className="h-1 bg-surface-sunken rounded overflow-hidden mt-0.5">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-ink-muted tabular-nums whitespace-nowrap">
                        {kr.currentValue} / {kr.targetValue}
                        {kr.unit ?? ""}
                      </span>
                      <button
                        onClick={() => bumpKr(kr)}
                        className="text-brand-600 hover:underline text-[11px]"
                      >
                        Update
                      </button>
                    </div>
                  );
                })}
                {o.keyResults.length === 0 && (
                  <div className="text-[11px] text-ink-muted italic">No key results yet.</div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, editing: null })}
        title={drawer.editing ? "Edit OKR" : "New OKR"}
        width="w-[680px]"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDrawer({ open: false, editing: null })}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.objective.trim()}
            >
              {busy ? "Saving…" : drawer.editing ? "Save changes" : "Create OKR"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Objective" required>
            <input
              className="input"
              value={form.objective}
              onChange={(e) => setForm({ ...form, objective: e.target.value })}
              required
              autoFocus
              placeholder="Delight customers with a faster checkout"
            />
          </FormField>
          <FormField label="Description">
            <textarea
              className="input min-h-[70px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period" required>
              <input
                className="input"
                value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="Q3 2026"
                required
              />
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as OkrStatus })}
              >
                <option value="OnTrack">On track</option>
                <option value="AtRisk">At risk</option>
                <option value="OffTrack">Off track</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </FormField>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">
                Key results{" "}
                <span className="text-ink-muted font-normal">({form.keyResults.length})</span>
              </label>
              <button
                type="button"
                onClick={addKr}
                className="text-xs text-brand-600 hover:underline"
              >
                + Add key result
              </button>
            </div>
            {form.keyResults.length === 0 ? (
              <div className="card p-3 text-xs text-ink-muted text-center">
                No key results yet.
              </div>
            ) : (
              <div className="space-y-2">
                {form.keyResults.map((kr, i) => (
                  <div key={kr.id ?? i} className="card p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="input input-sm flex-1"
                        placeholder="e.g. Reduce checkout time to under 30s"
                        value={kr.title}
                        onChange={(e) => updateKr(i, { title: e.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => removeKr(i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">
                          Current
                        </div>
                        <input
                          type="number"
                          className="input input-sm text-end"
                          value={kr.currentValue}
                          onChange={(e) =>
                            updateKr(i, { currentValue: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">
                          Target
                        </div>
                        <input
                          type="number"
                          className="input input-sm text-end"
                          value={kr.targetValue}
                          onChange={(e) =>
                            updateKr(i, { targetValue: Number(e.target.value) || 0 })
                          }
                        />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-muted mb-1">Unit</div>
                        <input
                          className="input input-sm"
                          value={kr.unit}
                          onChange={(e) => updateKr(i, { unit: e.target.value })}
                          placeholder="%, USD, users"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </div>
  );
}

export default function WorkspaceDetailPage() {
  return (
    <Suspense fallback={null}>
      <InnerWorkspaceDetailPage />
    </Suspense>
  );
}
