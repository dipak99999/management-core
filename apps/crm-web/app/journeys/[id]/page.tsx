"use client";

// Journey detail + visual builder. Loads /journeys/:id, hands the graph to
// JourneyBuilder, and persists edits back via PUT. Activate/Pause/Resume
// hit the dedicated state-transition endpoints. Test-enroll drawer lets the
// user POST /:id/enroll for a specific customer/lead without waiting on the
// trigger to fire.

import dynamic from "next/dynamic";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  relativeTime,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// Dynamic import: React Flow accesses `window` during initialization, so
// SSR would blow up. ssr:false forces client-only render.
const JourneyBuilder = dynamic(
  () => import("../../../components/journey-builder").then((m) => m.JourneyBuilder),
  { ssr: false, loading: () => <Skeleton className="h-[520px]" rounded="rounded-lg" /> },
);
// Reuse the same module for the client-side validator.
import type { JEdge, JNode } from "../../../components/journey-builder";
import { validateJourneyGraph } from "../../../components/journey-builder";

interface Journey {
  id: string;
  name: string;
  description: string | null;
  status: "Draft" | "Active" | "Paused" | "Archived";
  triggerType: string;
  triggerConfig: Record<string, unknown> | null;
  nodesJson: JNode[];
  edgesJson: JEdge[];
  totalEnrolled: number;
  totalCompleted: number;
  totalFailed: number;
  updatedAt: string;
}

interface Enrollment {
  id: string;
  contactType: "Customer" | "Lead";
  contactId: string;
  emailTo: string | null;
  status: "Active" | "Completed" | "Failed" | "Paused" | "Exited";
  enrolledAt: string;
  completedAt: string | null;
  currentNodeId: string | null;
  nextTickAt: string | null;
  lastError: string | null;
}

interface Customer { id: string; customerName: string }
interface Lead { id: string; name: string; leadName: string; email: string | null }

const TRIGGER_LABEL: Record<string, string> = {
  Manual: "Manual",
  ListAdd: "On list add",
  LeadCreated: "On lead created",
  FormSubmit: "On form submit",
  TagAdded: "On tag added",
  ScheduledDate: "Scheduled date",
};

type EnrollFilter = "all" | "Active" | "Completed" | "Failed" | "Paused";

export default function JourneyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [journey, setJourney] = useState<Journey | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [enrollFilter, setEnrollFilter] = useState<EnrollFilter>("all");

  // Draft graph while editing. Kept separate from `journey` so we can track
  // the dirty bit and throttle auto-save without re-fetching between saves.
  const [graph, setGraph] = useState<{ nodes: JNode[]; edges: JEdge[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");

  // Test-enroll drawer.
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollType, setEnrollType] = useState<"Customer" | "Lead">("Customer");
  const [enrollContactId, setEnrollContactId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  async function loadJourney() {
    try {
      const j = await api.get<Journey>(`/journeys/${id}`);
      setJourney(j);
      setGraph({
        nodes: Array.isArray(j.nodesJson) ? j.nodesJson : [],
        edges: Array.isArray(j.edgesJson) ? j.edgesJson : [],
      });
      setNameDraft(j.name);
      setDescDraft(j.description ?? "");
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  async function loadEnrollments() {
    try {
      setEnrollments(await api.get<Enrollment[]>(`/journeys/${id}/enrollments`));
    } catch {
      // Enrollments endpoint may 404 on empty journey — safe to swallow;
      // primary error surface is the journey load.
    }
  }

  useEffect(() => {
    loadJourney();
    loadEnrollments();
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Lead[]>("/leads").then(setLeads).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Called on every graph edit from the builder. Marks the draft as dirty so
  // Save + auto-save know something changed.
  const onGraphChange = useCallback(
    (nodes: JNode[], edges: JEdge[]) => {
      setGraph({ nodes, edges });
      setDirty(true);
    },
    [],
  );

  const onNameChange = useCallback((v: string) => {
    setNameDraft(v);
    setDirty(true);
  }, []);
  const onDescChange = useCallback((v: string) => {
    setDescDraft(v);
    setDirty(true);
  }, []);

  async function save(silent = false) {
    if (!journey || !graph) return;
    setBusy(true);
    try {
      await api.put(`/journeys/${journey.id}`, {
        name: nameDraft.trim() || journey.name,
        description: descDraft.trim() || undefined,
        nodesJson: graph.nodes,
        edgesJson: graph.edges,
      });
      setDirty(false);
      if (!silent) setToast({ kind: "success", message: "Journey saved" });
      // Refresh core fields without disturbing the local graph.
      const j = await api.get<Journey>(`/journeys/${journey.id}`);
      setJourney(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  // Throttled auto-save. Runs at most once per 5s while dirty. We debounce
  // via a trailing timer that re-arms on each dirty edit so a burst of drags
  // collapses into a single write.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save(true);
    }, 5000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, graph, nameDraft, descDraft]);

  async function activate() {
    if (!journey || !graph) return;
    const errs = validateJourneyGraph(graph.nodes, graph.edges);
    if (errs.length) {
      setToast({ kind: "error", message: `Cannot activate: ${errs.join(" ")}` });
      return;
    }
    // Save any pending edits before flipping state.
    if (dirty) await save(true);
    setBusy(true);
    try {
      await api.post(`/journeys/${journey.id}/activate`, {});
      setToast({ kind: "success", message: "Journey activated" });
      await loadJourney();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate");
    } finally {
      setBusy(false);
    }
  }
  async function pause() {
    if (!journey) return;
    setBusy(true);
    try {
      await api.post(`/journeys/${journey.id}/pause`, {});
      setToast({ kind: "info", message: "Journey paused" });
      await loadJourney();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pause");
    } finally {
      setBusy(false);
    }
  }
  async function resume() {
    // Backend uses /activate to resume from Paused too.
    await activate();
  }

  async function testEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (!journey || !enrollContactId) return;
    setBusy(true);
    try {
      await api.post(`/journeys/${journey.id}/enroll`, {
        contactType: enrollType,
        contactId: enrollContactId,
      });
      setShowEnroll(false);
      setEnrollContactId("");
      setToast({ kind: "success", message: "Contact enrolled — check the enrollments table below." });
      await Promise.all([loadJourney(), loadEnrollments()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enroll");
    } finally {
      setBusy(false);
    }
  }

  const contactOptions = useMemo(() => {
    if (enrollType === "Customer") {
      return [...customers]
        .sort((a, b) => a.customerName.localeCompare(b.customerName))
        .map((c) => ({ id: c.id, label: c.customerName }));
    }
    return [...leads]
      .sort((a, b) => a.leadName.localeCompare(b.leadName))
      .map((l) => ({
        id: l.id,
        label: `${l.leadName}${l.email ? ` (${l.email})` : ""}`,
      }));
  }, [enrollType, customers, leads]);

  const filteredEnrollments = useMemo(() => {
    if (enrollFilter === "all") return enrollments;
    return enrollments.filter((e) => e.status === enrollFilter);
  }, [enrollments, enrollFilter]);

  const enrollmentColumns: Column<Enrollment>[] = [
    {
      header: "Type",
      cell: (r) => (
        <span className={r.contactType === "Customer" ? "badge-green" : "badge-blue"}>
          {r.contactType}
        </span>
      ),
    },
    {
      header: "Contact",
      cell: (r) => (
        <span className="font-mono text-xs text-ink-soft">
          {r.contactId.slice(0, 8)}…
        </span>
      ),
    },
    {
      header: "To",
      cell: (r) => <span className="text-sm text-ink">{r.emailTo ?? "—"}</span>,
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "Enrolled",
      cell: (r) => <span className="text-xs text-ink-muted">{relativeTime(r.enrolledAt)}</span>,
    },
    {
      header: "Next tick",
      cell: (r) => <span className="text-xs text-ink-muted">{dateShort(r.nextTickAt)}</span>,
    },
    {
      header: "Error",
      cell: (r) =>
        r.lastError ? (
          <span className="text-xs text-red-700 truncate max-w-[240px] inline-block" title={r.lastError}>
            {r.lastError}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        ),
    },
  ];

  const validationErrors = useMemo(
    () => (graph ? validateJourneyGraph(graph.nodes, graph.edges) : []),
    [graph],
  );

  // ── Loading / error shells ───────────────────────────────────────────

  if (error && !journey) {
    return (
      <>
        <PageHeader
          title="Journey"
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Journeys", href: "/crm/journeys" },
          ]}
          actions={
            <Button variant="secondary" type="button" onClick={() => history.back()}>
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </>
    );
  }
  if (!journey) {
    return (
      <>
        <PageHeader
          title="Loading…"
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Journeys", href: "/crm/journeys" },
          ]}
        />
        <Skeleton className="h-24" rounded="rounded-lg" />
      </>
    );
  }

  // ── Actions by status ────────────────────────────────────────────────

  const actions = (
    <>
      <Button variant="secondary" type="button" onClick={() => history.back()}>
        ← Back
      </Button>
      <Button variant="secondary" type="button" onClick={() => setShowEnroll(true)}>
        Test enroll
      </Button>
      <Button
        variant="primary"
        type="button"
        onClick={() => save(false)}
        disabled={busy || !dirty}
      >
        {dirty ? (busy ? "Saving…" : "Save") : "Saved"}
      </Button>
      {journey.status === "Draft" && (
        <Button
          variant="danger"
          type="button"
          onClick={activate}
          disabled={busy || validationErrors.length > 0}
          title={validationErrors.length ? validationErrors.join(" ") : "Activate this journey"}
        >
          Activate
        </Button>
      )}
      {journey.status === "Active" && (
        <Button variant="secondary" type="button" onClick={pause} disabled={busy}>
          Pause
        </Button>
      )}
      {journey.status === "Paused" && (
        <Button variant="brand" type="button" onClick={resume} disabled={busy}>
          Resume
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title={journey.name}
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Journeys", href: "/crm/journeys" },
          { label: journey.name },
        ]}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={journey.status} />
            <span className="text-ink-muted">·</span>
            <span>{TRIGGER_LABEL[journey.triggerType] ?? journey.triggerType}</span>
            <span className="text-ink-muted">·</span>
            <span>{journey.totalEnrolled} enrolled</span>
            {journey.totalFailed > 0 && (
              <>
                <span className="text-ink-muted">·</span>
                <span className="text-red-700">{journey.totalFailed} failed</span>
              </>
            )}
          </span>
        }
        actions={actions}
      />

      {toast && (
        <div className="mb-4">
          <Toast kind={toast.kind} message={toast.message} onDismiss={() => setToast(null)} />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {validationErrors.length > 0 && journey.status === "Draft" && (
        <Card className="mb-4 p-3 text-xs text-amber-800 bg-amber-50 border-amber-200">
          <div className="font-semibold mb-1">Fix these before activating:</div>
          <ul className="list-disc ps-4 space-y-0.5">
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Name">
            <input
              className="input"
              value={nameDraft}
              onChange={(e) => onNameChange(e.target.value)}
              disabled={journey.status !== "Draft"}
            />
          </FormField>
          <FormField label="Description">
            <input
              className="input"
              value={descDraft}
              onChange={(e) => onDescChange(e.target.value)}
              disabled={journey.status !== "Draft"}
            />
          </FormField>
        </div>
      </Card>

      {graph && (
        <JourneyBuilder
          initialNodes={graph.nodes}
          initialEdges={graph.edges}
          onChange={onGraphChange}
          readOnly={journey.status !== "Draft"}
        />
      )}

      <section className="mt-8">
        <SectionHeader
          title="Enrollments"
          actions={
            <Segmented
              value={enrollFilter}
              onChange={setEnrollFilter}
              options={[
                { value: "all", label: "All", count: enrollments.length },
                { value: "Active", label: "Active", count: enrollments.filter((e) => e.status === "Active").length },
                { value: "Completed", label: "Done", count: enrollments.filter((e) => e.status === "Completed").length },
                { value: "Failed", label: "Failed", count: enrollments.filter((e) => e.status === "Failed").length },
                { value: "Paused", label: "Paused", count: enrollments.filter((e) => e.status === "Paused").length },
              ]}
            />
          }
        />
        <div className="hidden md:block">
          <DataTable
            columns={enrollmentColumns}
            rows={filteredEnrollments}
            rowKey={(r) => r.id}
            empty={{
              icon: Icon.users,
              title:
                journey.status === "Draft"
                  ? "No one enrolled yet"
                  : "No matching enrollments",
              description:
                journey.status === "Draft"
                  ? "Activate the journey or use Test enroll to see it in action."
                  : "Try changing the status filter.",
            }}
          />
        </div>
        {filteredEnrollments.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            {journey.status === "Draft" ? "No one enrolled yet" : "No matching enrollments"}
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {filteredEnrollments.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{r.emailTo ?? r.contactId}</div>
                    <div className="text-xs text-ink-muted">{r.contactType}</div>
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {r.status}
                  </span>
                </div>
                {r.lastError && (
                  <div className="mt-1 text-xs text-red-600 truncate">{r.lastError}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title="Test enroll"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowEnroll(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => testEnroll(e as unknown as React.FormEvent)}
              disabled={busy || !enrollContactId}
            >
              {busy ? "Enrolling…" : "Enroll"}
            </Button>
          </>
        }
      >
        <form onSubmit={testEnroll} className="space-y-4">
          <FormField label="Contact type">
            <select
              className="input"
              value={enrollType}
              onChange={(e) => {
                setEnrollType(e.target.value as "Customer" | "Lead");
                setEnrollContactId("");
              }}
            >
              <option value="Customer">Customer</option>
              <option value="Lead">Lead</option>
            </select>
          </FormField>
          <FormField label={enrollType} required>
            <select
              required
              className="input"
              value={enrollContactId}
              onChange={(e) => setEnrollContactId(e.target.value)}
            >
              <option value="">Select a {enrollType.toLowerCase()}…</option>
              {contactOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <p className="text-[11px] text-ink-muted">
            The contact will be dropped into the trigger node and the scheduler
            will advance them through the journey on its next tick.
          </p>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Journey" docId={params.id} />
      </div>
    </>
  );
}
