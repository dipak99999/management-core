"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

interface Step {
  stepOrder: number;
  delayDays: number;
  subject: string;
  bodyHtml: string;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  triggerType: "Manual" | "OnListAdd" | "OnLeadCreated";
  triggerListId: string | null;
  triggerList: { id: string; name: string } | null;
  isActive: boolean;
  totalEnrolled: number;
  totalCompleted: number;
  updatedAt: string;
  steps: Step[];
}

interface Enrollment {
  id: string;
  contactType: "Customer" | "Lead";
  contactId: string;
  emailTo: string;
  currentStep: number;
  status: string;
  enrolledAt: string;
  nextSendAt: string | null;
}

interface Customer {
  id: string;
  customerName: string;
}
interface Lead {
  id: string;
  name: string;
  leadName: string;
  email: string | null;
}

const TRIGGER_LABEL: Record<Sequence["triggerType"], string> = {
  Manual: "Manual",
  OnListAdd: "On list add",
  OnLeadCreated: "On lead created",
};

const emptyStep: Step = {
  stepOrder: 1,
  delayDays: 0,
  subject: "",
  bodyHtml: "",
};

export default function SequenceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [seq, setSeq] = useState<Sequence | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step editor state — index === null means we're not editing.
  const [editingStepIdx, setEditingStepIdx] = useState<number | null>(null);
  const [stepDraft, setStepDraft] = useState<Step>(emptyStep);

  // Enroll drawer state.
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollType, setEnrollType] = useState<"Customer" | "Lead">("Customer");
  const [enrollContactId, setEnrollContactId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);

  async function loadSeq() {
    try {
      const s = await api.get<Sequence>(`/email-sequences/${id}`);
      // Sort steps by order so inserts stay stable.
      s.steps = [...(s.steps ?? [])].sort((a, b) => a.stepOrder - b.stepOrder);
      setSeq(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }
  async function loadEnrollments() {
    try {
      setEnrollments(
        await api.get<Enrollment[]>(`/email-sequences/${id}/enrollments`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    loadSeq();
    loadEnrollments();
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Lead[]>("/leads").then(setLeads).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Persist the full steps[] array via PUT. Renumbers stepOrder so it stays
  // 1..N regardless of where the user inserted/removed rows.
  async function saveSteps(nextSteps: Step[]) {
    if (!seq) return;
    setBusy(true);
    try {
      const normalized = nextSteps.map((s, i) => ({ ...s, stepOrder: i + 1 }));
      await api.put(`/email-sequences/${seq.id}`, {
        name: seq.name,
        description: seq.description ?? undefined,
        triggerType: seq.triggerType,
        triggerListId: seq.triggerListId ?? undefined,
        isActive: seq.isActive,
        steps: normalized,
      });
      await loadSeq();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  function openInsert(afterIdx: number) {
    if (!seq) return;
    const prev = seq.steps[afterIdx];
    setStepDraft({
      // stepOrder is display-only in the drawer; saveSteps() renumbers.
      stepOrder: (prev?.stepOrder ?? 0) + 1,
      delayDays: 1,
      subject: "",
      bodyHtml: "",
    });
    // Sentinel value: insert-after index encoded as -(idx + 1) - 1 so we
    // can distinguish from editing. Simpler: use a separate insert index.
    setInsertAfter(afterIdx);
    setEditingStepIdx(null);
  }
  function openEdit(idx: number) {
    if (!seq) return;
    setStepDraft({ ...seq.steps[idx] });
    setEditingStepIdx(idx);
    setInsertAfter(null);
  }
  function closeStep() {
    setEditingStepIdx(null);
    setInsertAfter(null);
    setStepDraft(emptyStep);
  }

  const [insertAfter, setInsertAfter] = useState<number | null>(null);

  async function commitStep() {
    if (!seq) return;
    if (!stepDraft.subject.trim()) {
      setError("Step needs a subject");
      return;
    }
    const next = [...seq.steps];
    if (editingStepIdx != null) {
      next[editingStepIdx] = stepDraft;
    } else if (insertAfter != null) {
      // Insert after the given index (insertAfter === -1 means prepend).
      next.splice(insertAfter + 1, 0, stepDraft);
    } else {
      next.push(stepDraft);
    }
    closeStep();
    await saveSteps(next);
  }

  async function removeStep(idx: number) {
    if (!seq) return;
    if (!confirm("Remove this step?")) return;
    const next = seq.steps.filter((_, i) => i !== idx);
    await saveSteps(next);
  }

  async function toggleActive() {
    if (!seq) return;
    setBusy(true);
    try {
      await api.post(
        `/email-sequences/${seq.id}/${seq.isActive ? "pause" : "activate"}`,
        {},
      );
      await loadSeq();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeSequence() {
    if (!seq) return;
    if (!confirm("Delete this sequence? Enrollments will be lost.")) return;
    try {
      await api.del(`/email-sequences/${seq.id}`);
      window.location.href = "/crm/sequences";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function enroll(e: React.FormEvent) {
    e.preventDefault();
    if (!seq || !enrollContactId) return;
    setBusy(true);
    try {
      await api.post(`/email-sequences/${seq.id}/enroll`, {
        contactType: enrollType,
        contactId: enrollContactId,
      });
      setShowEnroll(false);
      setEnrollContactId("");
      await Promise.all([loadSeq(), loadEnrollments()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enroll");
    } finally {
      setBusy(false);
    }
  }

  const enrollmentColumns: Column<Enrollment>[] = [
    {
      header: "Type",
      cell: (r) => (
        <span
          className={
            r.contactType === "Customer" ? "badge-green" : "badge-blue"
          }
        >
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
      header: "Email",
      cell: (r) => <span className="text-sm text-ink">{r.emailTo}</span>,
    },
    {
      header: "Step",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">
          {r.currentStep} / {seq?.steps.length ?? 0}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "Next send",
      cell: (r) => (
        <span className="text-sm text-ink-soft">{dateShort(r.nextSendAt)}</span>
      ),
    },
  ];

  const showStepDrawer = editingStepIdx != null || insertAfter != null;

  // Sorted contact options for the enroll dropdown — customers and leads
  // share a shape (id + label + email) so the select can just switch source.
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

  if (!seq) {
    return (
      <>
        <PageHeader
          title="Email sequence"
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Email Sequences", href: "/crm/sequences" },
          ]}
        />
        {error ? (
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        ) : (
          <div className="text-sm text-ink-muted">Loading…</div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={seq.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={seq.isActive ? "Active" : "Draft"} />
            <span className="text-ink-muted">·</span>
            <span>{TRIGGER_LABEL[seq.triggerType]}</span>
            {seq.triggerList && (
              <>
                <span className="text-ink-muted">·</span>
                <span>list: {seq.triggerList.name}</span>
              </>
            )}
            <span className="text-ink-muted">·</span>
            <span>
              {seq.steps.length} step{seq.steps.length === 1 ? "" : "s"}
            </span>
          </span>
        }
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Email Sequences", href: "/crm/sequences" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button
              variant={seq.isActive ? "secondary" : "brand"}
              onClick={toggleActive}
              disabled={busy}
            >
              {seq.isActive ? "Pause" : "Activate"}
            </Button>
            <Button variant="danger" onClick={removeSequence} disabled={busy}>
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

      {seq.description && (
        <p className="text-sm text-ink-soft mb-4 max-w-3xl">{seq.description}</p>
      )}

      <section className="mb-8">
        <SectionHeader
          title="Steps"
          actions={
            seq.steps.length === 0 && (
              <Button
                variant="brand"
                size="sm"
                onClick={() => openInsert(-1)}
              >
                + Add first step
              </Button>
            )
          }
        />
        {seq.steps.length === 0 ? (
          <Card className="p-6 text-center text-sm text-ink-muted">
            No steps yet. Add a first step to define what gets sent and when.
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Zero-index insert row so users can prepend before step 1. */}
            <div className="flex justify-center">
              <button
                onClick={() => openInsert(-1)}
                className="btn-ghost btn-sm text-brand-600"
              >
                + Insert step at start
              </button>
            </div>
            {seq.steps.map((s, i) => (
              <div key={i}>
                <Card className="p-4 flex items-start gap-4">
                  <div className="h-9 w-9 rounded-full bg-brand-50 text-brand-700 grid place-items-center text-sm font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      <span className="w-3.5 h-3.5">{Icon.clock}</span>
                      <span>
                        {i === 0 && s.delayDays === 0
                          ? "Sent immediately on enrollment"
                          : `${s.delayDays} day${s.delayDays === 1 ? "" : "s"} after ${i === 0 ? "enrollment" : "previous step"}`}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-ink truncate">
                      {s.subject || (
                        <span className="italic text-ink-muted">
                          (no subject)
                        </span>
                      )}
                    </div>
                    {s.bodyHtml && (
                      <div className="mt-1 text-xs text-ink-muted line-clamp-2">
                        {s.bodyHtml.replace(/<[^>]+>/g, " ").slice(0, 140)}
                        {s.bodyHtml.length > 140 ? "…" : ""}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(i)}
                      className="btn-ghost btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeStep(i)}
                      className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </Card>
                <div className="flex justify-center py-1">
                  <button
                    onClick={() => openInsert(i)}
                    className="btn-ghost btn-sm text-brand-600"
                    aria-label="Insert step after"
                  >
                    + Insert step
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title="Enrollments"
          actions={
            <Button
              variant="brand"
              size="sm"
              onClick={() => setShowEnroll(true)}
            >
              + Enroll contact
            </Button>
          }
        />
        <div className="hidden md:block">
          <DataTable
            columns={enrollmentColumns}
            rows={enrollments}
            rowKey={(r) => r.id}
            empty={{
              icon: Icon.users,
              title: "No one enrolled yet",
              description:
                seq.triggerType === "Manual"
                  ? "Enroll a customer or lead to start the drip."
                  : "Contacts will be auto-enrolled once the trigger fires.",
            }}
          />
        </div>
        {enrollments.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No one enrolled yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {enrollments.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{r.emailTo}</div>
                    <div className="text-xs text-ink-muted">
                      {r.contactType} · Step {r.currentStep}
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {r.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer
        open={showStepDrawer}
        onClose={closeStep}
        title={editingStepIdx != null ? "Edit step" : "New step"}
        width="w-[640px]"
        footer={
          <>
            <Button variant="secondary" onClick={closeStep} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={commitStep}
              disabled={busy || !stepDraft.subject.trim()}
            >
              {editingStepIdx != null ? "Save step" : "Add step"}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commitStep();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Step" hint="Auto-numbered on save">
              <input
                readOnly
                className="input bg-surface-sunken text-ink-muted"
                value={
                  editingStepIdx != null
                    ? editingStepIdx + 1
                    : insertAfter != null
                      ? insertAfter + 2
                      : (seq?.steps.length ?? 0) + 1
                }
              />
            </FormField>
            <FormField
              label="Delay"
              hint="Days after the previous step (or enrollment for step 1)"
            >
              <input
                type="number"
                min={0}
                className="input"
                value={stepDraft.delayDays}
                onChange={(e) =>
                  setStepDraft({
                    ...stepDraft,
                    delayDays: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </FormField>
          </div>
          <FormField label="Subject" required>
            <input
              required
              autoFocus
              className="input"
              placeholder="Welcome to Lumaara"
              value={stepDraft.subject}
              onChange={(e) =>
                setStepDraft({ ...stepDraft, subject: e.target.value })
              }
            />
          </FormField>
          <FormField
            label="Body (HTML)"
            hint="Raw HTML — supports variables like {{firstName}}"
          >
            <textarea
              className="input font-mono text-xs"
              rows={12}
              placeholder="<p>Hi {{firstName}},</p><p>…</p>"
              value={stepDraft.bodyHtml}
              onChange={(e) =>
                setStepDraft({ ...stepDraft, bodyHtml: e.target.value })
              }
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <Drawer
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title="Enroll contact"
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
              onClick={(e) => enroll(e as unknown as React.FormEvent)}
              disabled={busy || !enrollContactId}
            >
              {busy ? "Enrolling…" : "Enroll"}
            </Button>
          </>
        }
      >
        <form onSubmit={enroll} className="space-y-4">
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
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Sequence" docId={params.id} />
      </div>
    </>
  );
}
