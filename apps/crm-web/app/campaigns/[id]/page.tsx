"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  StatusBadge,
  Toast,
  dateShort,
  money,
  relativeTime,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// ── Types ───────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  budget: string;
  expectedRevenue: string;
  channel: string | null;
  subject: string | null;
  bodyHtml: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  trackOpens: boolean;
  trackClicks: boolean;
  scheduledFor: string | null;
  sentAt: string | null;
  totalRecipients: number;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalBounced: number;
  totalUnsubs: number;
  archiveEnabled?: boolean;
  archiveSlug?: string | null;
  rateLimitPerMin?: number | null;
  testSentAt?: string | null;
}

interface LinkedList {
  id: string;
  name: string;
  memberCount: number;
  isDynamic: boolean;
}

interface ContactList {
  id: string;
  name: string;
  memberCount: number;
  isDynamic: boolean;
}

// P2: A/B test variant.
interface Variant {
  id: string;
  variantKey: string; // "A" | "B" | "C"
  weightPercent: number;
  subject: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  fromName: string | null;
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalBounced: number;
  isWinner: boolean;
}

interface VariantStats {
  variants: (Variant & {
    openRate: number;
    clickRate: number;
    metricRate: number;
  })[];
  significance: {
    metric: string;
    leaderKey: string;
    runnerUpKey: string;
    z: number;
    pValue: number;
    isSignificant: boolean;
  } | null;
}

interface Recipient {
  id: string;
  emailTo: string;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  bouncedAt: string | null;
  complainedAt?: string | null;
  unsubscribedAt?: string | null;
  deliveredAt?: string | null;
}

interface Analytics {
  campaign: Campaign;
  total: number;
  sent: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubs: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  unsubRate: number;
  delivered?: number;
  complaints?: number;
}

interface Attribution {
  leads: number;
  converted: number;
  opportunities: number;
  won: number;
  invoices: number;
  attributedRevenue: number;
  roi: number | null;
}

// P3 (approvals): tenant flag drives whether the send-time gate applies;
// approval is the latest MarketingApproval row for this campaign (may be
// null when nothing's been requested yet).
interface TenantApprovalConfig {
  requireMarketingApproval: boolean;
}
interface CampaignApproval {
  id: string;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn";
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
}

type ChannelValue = "Email" | "SMS" | "Push" | "Other";

// Same shape as list page so the edit drawer can reuse it.
const emptyEdit = {
  name: "",
  description: "",
  startDate: "",
  endDate: "",
  budget: 0,
  expectedRevenue: 0,
  // Accept both legacy (Planned/Active/Completed) and P1 (Draft/Scheduled/…)
  // values — the state machine on crm-service accepts either.
  status: "Draft" as
    | "Draft"
    | "Scheduled"
    | "Sending"
    | "Paused"
    | "Sent"
    | "Cancelled"
    | "Planned"
    | "Active"
    | "Completed",
  channel: "Email" as ChannelValue,
  subject: "",
  bodyHtml: "",
  fromName: "",
  fromEmail: "",
  replyTo: "",
  trackOpens: true,
  trackClicks: true,
  scheduledFor: "",
};

// Public archive URL base — defaults to the crm-service origin. The public
// archive router is mounted at /a on crm-service.
const ARCHIVE_BASE =
  process.env.NEXT_PUBLIC_CRM_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ??
  "/api/crm";

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pctText(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

// Route CampaignRecipient.status values through the shared StatusBadge palette.
function RecipientStatusBadge({ status }: { status: string }) {
  if (status === "Bounced") return <span className="badge-red">Bounced</span>;
  if (status === "Unsubscribed")
    return <span className="badge-gray">Unsub</span>;
  if (status === "Complained")
    return <span className="badge-red">Complaint</span>;
  if (status === "Delivered")
    return <span className="badge-green">Delivered</span>;
  if (status === "Pending") return <span className="badge-amber">Pending</span>;
  return <StatusBadge status={status} />;
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [linked, setLinked] = useState<LinkedList[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [showRecipients, setShowRecipients] = useState(false);
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  // ── Drawers ─────────────────────────────────────────────────────────
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState(emptyEdit);

  const [showAddList, setShowAddList] = useState(false);
  const [listToAdd, setListToAdd] = useState<string>("");

  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>("");

  const [showTest, setShowTest] = useState(false);
  const [testEmails, setTestEmails] = useState<string[]>([""]);

  const [showPreview, setShowPreview] = useState(false);

  const [showPublish, setShowPublish] = useState(false);
  const [publishSlug, setPublishSlug] = useState<string>("");

  // ── P3: AI content assist (subject lines / write-from-brief / rewrite) ──
  const [showAi, setShowAi] = useState(false);
  const [aiMode, setAiMode] = useState<"subject" | "write" | "rewrite">(
    "subject",
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTone, setAiTone] = useState<
    "professional" | "casual" | "urgent" | "friendly" | "formal" | "shorter" | "longer"
  >("professional");
  const [aiBrief, setAiBrief] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiLength, setAiLength] = useState<"short" | "medium" | "long">("medium");
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiRewrite, setAiRewrite] = useState<string>("");

  // ── P3: Marketing approvals ─────────────────────────────────────────
  // Latest MarketingApproval for THIS campaign (null when nothing on file).
  // Tenant config comes from the same crm-service /approvals surface — a
  // single small round-trip so the page knows whether to render the gate.
  const [approvalConfig, setApprovalConfig] = useState<TenantApprovalConfig | null>(
    null,
  );
  const [approval, setApproval] = useState<CampaignApproval | null>(null);
  const [showRequestApproval, setShowRequestApproval] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");

  // ── P2: A/B variants ────────────────────────────────────────────────
  const [variantStats, setVariantStats] = useState<VariantStats | null>(null);
  const [showVariant, setShowVariant] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const emptyVariantForm = {
    variantKey: "B" as "A" | "B" | "C",
    weightPercent: 50,
    subject: "",
    bodyHtml: "",
    fromEmail: "",
    fromName: "",
  };
  const [variantForm, setVariantForm] = useState(emptyVariantForm);

  // ── Loaders ──────────────────────────────────────────────────────────
  const loadCore = useCallback(async () => {
    try {
      const [a, ls, atr, vs, appr, cfg] = await Promise.all([
        api.get<Analytics>(`/campaigns/${id}/analytics`),
        api.get<LinkedList[]>(`/campaigns/${id}/lists`),
        api
          .get<Attribution>(`/campaigns/${id}/attribution`)
          .catch(() => null), // attribution is optional
        api
          .get<VariantStats>(`/campaigns/${id}/variants/stats`)
          .catch(() => null), // variants are optional
        // P3: latest MarketingApproval for this campaign. Server returns
        // 204/null when nothing on file — swallow errors so a missing
        // approvals surface never breaks the detail page.
        api
          .get<CampaignApproval | null>(`/approvals/for/Campaign/${id}`)
          .catch(() => null),
        api
          .get<TenantApprovalConfig>(`/approvals/config/tenant`)
          .catch(() => null),
      ]);
      setAnalytics(a);
      setLinked(ls);
      if (atr) setAttribution(atr);
      if (vs) setVariantStats(vs);
      setApproval(appr ?? null);
      if (cfg) setApprovalConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign");
    }
  }, [id]);

  const loadRecipients = useCallback(async () => {
    try {
      setRecipients(await api.get<Recipient[]>(`/campaigns/${id}/recipients`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipients");
    }
  }, [id]);

  const loadContactLists = useCallback(async () => {
    try {
      setContactLists(await api.get<ContactList[]>(`/contact-lists`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contact lists");
    }
  }, []);

  // Poll analytics: fast (5s) while Sending, slower (15s) otherwise.
  useEffect(() => {
    loadCore();
    const intervalMs = analytics?.campaign.status === "Sending" ? 5000 : 15000;
    const t = setInterval(loadCore, intervalMs);
    return () => clearInterval(t);
  }, [loadCore, analytics?.campaign.status]);

  useEffect(() => {
    if (showRecipients) loadRecipients();
  }, [showRecipients, loadRecipients]);

  // Refresh recipients every 5s while Sending — the per-recipient breakdown
  // is otherwise stale on the live-monitoring surface.
  useEffect(() => {
    if (!showRecipients) return;
    if (analytics?.campaign.status !== "Sending") return;
    const t = setInterval(loadRecipients, 5000);
    return () => clearInterval(t);
  }, [showRecipients, analytics?.campaign.status, loadRecipients]);

  // ── Actions ──────────────────────────────────────────────────────────
  function openEdit() {
    if (!analytics) return;
    const c = analytics.campaign;
    setForm({
      name: c.name,
      description: c.description ?? "",
      startDate: c.startDate ? c.startDate.slice(0, 10) : "",
      endDate: c.endDate ? c.endDate.slice(0, 10) : "",
      budget: Number(c.budget),
      expectedRevenue: Number(c.expectedRevenue),
      status: c.status as typeof emptyEdit.status,
      channel: (c.channel as ChannelValue) ?? "Email",
      subject: c.subject ?? "",
      bodyHtml: c.bodyHtml ?? "",
      fromName: c.fromName ?? "",
      fromEmail: c.fromEmail ?? "",
      replyTo: c.replyTo ?? "",
      trackOpens: c.trackOpens ?? true,
      trackClicks: c.trackClicks ?? true,
      scheduledFor: toLocalInput(c.scheduledFor),
    });
    setShowEdit(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.put(`/campaigns/${id}`, {
        ...form,
        description: form.description || null,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        subject: form.subject || null,
        bodyHtml: form.bodyHtml || null,
        fromName: form.fromName || null,
        fromEmail: form.fromEmail || null,
        replyTo: form.replyTo || null,
        scheduledFor: form.scheduledFor
          ? new Date(form.scheduledFor).toISOString()
          : null,
      });
      setShowEdit(false);
      await loadCore();
      setToast({ kind: "success", message: "Campaign updated" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCampaign() {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    try {
      await api.del(`/campaigns/${id}`);
      window.location.href = "/crm/campaigns";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function addList(e: React.FormEvent) {
    e.preventDefault();
    if (!listToAdd || busy) return;
    setBusy(true);
    try {
      await api.post(`/campaigns/${id}/link-list`, { listId: listToAdd });
      setShowAddList(false);
      setListToAdd("");
      await loadCore();
      setToast({ kind: "success", message: "List linked" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link list");
    } finally {
      setBusy(false);
    }
  }

  async function removeList(listId: string) {
    if (!confirm("Remove this contact list from the campaign?")) return;
    try {
      await api.post(`/campaigns/${id}/unlink-list`, { listId });
      await loadCore();
      setToast({ kind: "info", message: "List removed" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlink list");
    }
  }

  async function materialize() {
    try {
      const { totalContacts, newRecipients } = await api.post<{
        totalContacts: number;
        newRecipients: number;
      }>(`/campaigns/${id}/materialize-recipients`, {});
      await loadCore();
      if (showRecipients) await loadRecipients();
      setToast({
        kind: "success",
        message: `Materialized ${totalContacts.toLocaleString()} contacts (${newRecipients.toLocaleString()} new).`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to materialize");
    }
  }

  // ── P2: A/B variant actions ─────────────────────────────────────────
  function openNewVariant() {
    // Suggest next unused key (A → B → C).
    const used = new Set((variantStats?.variants ?? []).map((v) => v.variantKey));
    const nextKey = (["A", "B", "C"] as const).find((k) => !used.has(k)) ?? "C";
    // Suggest weight that still leaves the sum ≤ 100.
    const usedWeight = (variantStats?.variants ?? []).reduce(
      (s, v) => s + v.weightPercent,
      0,
    );
    const remaining = Math.max(1, 100 - usedWeight);
    setEditingVariantId(null);
    setVariantForm({
      ...emptyVariantForm,
      variantKey: nextKey,
      weightPercent: Math.min(50, remaining),
    });
    setShowVariant(true);
  }

  function openEditVariant(v: Variant) {
    setEditingVariantId(v.id);
    setVariantForm({
      variantKey: v.variantKey as "A" | "B" | "C",
      weightPercent: v.weightPercent,
      subject: v.subject ?? "",
      bodyHtml: v.bodyHtml ?? "",
      fromEmail: v.fromEmail ?? "",
      fromName: v.fromName ?? "",
    });
    setShowVariant(true);
  }

  async function saveVariant(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = {
        variantKey: variantForm.variantKey,
        weightPercent: variantForm.weightPercent,
        subject: variantForm.subject || null,
        bodyHtml: variantForm.bodyHtml || null,
        fromEmail: variantForm.fromEmail || null,
        fromName: variantForm.fromName || null,
      };
      if (editingVariantId) {
        await api.patch(`/campaigns/variants/${editingVariantId}`, body);
      } else {
        await api.post(`/campaigns/${id}/variants`, body);
      }
      setShowVariant(false);
      await loadCore();
      setToast({ kind: "success", message: editingVariantId ? "Variant updated" : "Variant added" });
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to save variant",
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteVariant(v: Variant) {
    if (!confirm(`Delete variant ${v.variantKey}?`)) return;
    try {
      await api.del(`/campaigns/variants/${v.id}`);
      await loadCore();
      setToast({ kind: "info", message: `Variant ${v.variantKey} removed` });
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to delete variant",
      });
    }
  }

  async function pickVariantWinner() {
    if (!confirm("Pick the winning variant now? All new recipients will get the winner going forward.")) return;
    setBusy(true);
    try {
      await api.post(`/campaigns/${id}/variants/pick-winner`, {});
      await loadCore();
      setToast({ kind: "success", message: "Winner promoted" });
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to pick winner",
      });
    } finally {
      setBusy(false);
    }
  }

  // ── P3: AI content assist actions ───────────────────────────────────
  function openAi(mode: "subject" | "write" | "rewrite") {
    setAiMode(mode);
    setAiSuggestions([]);
    setAiRewrite("");
    // Reset tone to the sensible default for each mode.
    setAiTone(mode === "rewrite" ? "casual" : "professional");
    setShowAi(true);
  }

  async function runAi() {
    if (!analytics || aiBusy) return;
    setAiBusy(true);
    setAiSuggestions([]);
    setAiRewrite("");
    try {
      if (aiMode === "subject") {
        const body = analytics.campaign.bodyHtml ?? "";
        if (!body.trim()) {
          setToast({
            kind: "error",
            message: "Add some body copy first so the AI has something to base subjects on.",
          });
          return;
        }
        const r = await api.post<{ subjects: string[] }>(
          "/ai-assist/subject-line",
          { bodyHtml: body, count: 5, tone: aiTone },
        );
        setAiSuggestions(r.subjects);
      } else if (aiMode === "write") {
        if (!aiBrief.trim()) {
          setToast({ kind: "error", message: "Enter a brief first." });
          return;
        }
        const r = await api.post<{ subject: string; body: string }>(
          "/ai-assist/write-email",
          {
            brief: aiBrief,
            tone: aiTone,
            audience: aiAudience || null,
            length: aiLength,
          },
        );
        // Apply directly to the edit form + open the edit drawer so the user
        // can review before saving.
        setForm((f) => ({
          ...f,
          subject: r.subject || f.subject,
          bodyHtml: r.body || f.bodyHtml,
        }));
        setShowAi(false);
        setShowEdit(true);
        setToast({ kind: "success", message: "AI draft loaded into the editor." });
      } else if (aiMode === "rewrite") {
        const body = analytics.campaign.bodyHtml ?? "";
        if (!body.trim()) {
          setToast({
            kind: "error",
            message: "Add some body copy first, then rewrite it.",
          });
          return;
        }
        const r = await api.post<{ rewritten: string }>("/ai-assist/rewrite", {
          text: body,
          tone: aiTone,
        });
        setAiRewrite(r.rewritten);
      }
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "AI request failed",
      });
    } finally {
      setAiBusy(false);
    }
  }

  function applySubjectSuggestion(subject: string) {
    setForm((f) => ({ ...f, subject }));
    setShowAi(false);
    setShowEdit(true);
    setToast({ kind: "success", message: "Subject line applied to the editor." });
  }

  function applyRewrite() {
    if (!aiRewrite) return;
    setForm((f) => ({ ...f, bodyHtml: aiRewrite }));
    setShowAi(false);
    setShowEdit(true);
    setToast({ kind: "success", message: "Rewritten body loaded into the editor." });
  }

  // ── State machine actions (P1) ───────────────────────────────────────
  // Each hits the corresponding POST /campaigns/:id/<verb>. We only enable a
  // given button when the current status permits the transition.
  async function transition(
    verb:
      | "start"
      | "pause"
      | "resume"
      | "cancel"
      | "schedule"
      | "unschedule"
      | "archive-publish"
      | "archive-unpublish",
    body: unknown = {},
    successMsg?: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(`/campaigns/${id}/${verb}`, body);
      await loadCore();
      setToast({
        kind: "success",
        message: successMsg ?? `Campaign ${verb.replace("-", " ")} — ok`,
      });
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : `Failed to ${verb}`,
      });
    } finally {
      setBusy(false);
    }
  }

  // ── P3: Marketing approval actions ─────────────────────────────────
  async function submitApprovalRequest(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const created = await api.post<CampaignApproval>(`/approvals/request`, {
        doctype: "Campaign",
        docId: id,
        notes: approvalNotes || null,
      });
      setApproval(created);
      setShowRequestApproval(false);
      setApprovalNotes("");
      setToast({
        kind: "success",
        message: "Approval requested — reviewers have been notified.",
      });
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to request approval",
      });
    } finally {
      setBusy(false);
    }
  }

  async function withdrawApproval() {
    if (!approval) return;
    if (!confirm("Withdraw this approval request?")) return;
    setBusy(true);
    try {
      const updated = await api.post<CampaignApproval>(
        `/approvals/${approval.id}/withdraw`,
        {},
      );
      setApproval(updated);
      setToast({ kind: "info", message: "Approval withdrawn" });
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to withdraw",
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduleAt) return;
    await transition(
      "schedule",
      { scheduledFor: new Date(scheduleAt).toISOString() },
      "Campaign scheduled",
    );
    setShowSchedule(false);
  }

  async function submitTest(e: React.FormEvent) {
    e.preventDefault();
    const emails = testEmails.map((s) => s.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setBusy(true);
    try {
      const r = await api.post<{ queued: number }>(`/campaigns/${id}/test`, {
        emails,
      });
      setShowTest(false);
      setTestEmails([""]);
      setToast({
        kind: "success",
        message: `Queued test send to ${r.queued} address${r.queued === 1 ? "" : "es"}`,
      });
      await loadCore();
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to send test",
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitPublish(e: React.FormEvent) {
    e.preventDefault();
    const slug = publishSlug.trim();
    if (!slug) return;
    await transition(
      "archive-publish",
      { slug },
      "Archive published",
    );
    setShowPublish(false);
  }

  async function copyPublicUrl() {
    if (!analytics?.campaign.archiveSlug) return;
    const url = `${ARCHIVE_BASE.replace(/\/+$/, "")}/a/${analytics.campaign.archiveSlug}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast({ kind: "success", message: "Public URL copied" });
    } catch {
      setToast({ kind: "info", message: url });
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const status = analytics?.campaign.status ?? "";
  const isDraft = status === "Draft" || status === "Planned";
  const isScheduled = status === "Scheduled";
  const isSending = status === "Sending" || status === "Active";
  const isPaused = status === "Paused";
  const isSent = status === "Sent" || status === "Completed";
  const isArchived = analytics?.campaign.archiveEnabled === true;
  const canCancel = isSending || isScheduled || isPaused;

  // ── P3: Approval gate derivation ──────────────────────────────────────
  // approvalRequired: tenant flag ON — the "Send"/"Schedule" buttons are
  // guarded and the "Request approval" card renders.
  // approvalActive: latest approval is Approved AND ≤30 days old — mirrors
  // the server-side checkApprovalRequired logic so the button state matches
  // what a submit will actually do.
  const approvalRequired = approvalConfig?.requireMarketingApproval === true;
  const approvedAtMs = approval?.approvedAt
    ? new Date(approval.approvedAt).getTime()
    : 0;
  const APPROVAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const approvalActive =
    approval?.status === "Approved" &&
    approvedAtMs > 0 &&
    Date.now() - approvedAtMs <= APPROVAL_MAX_AGE_MS;
  // Sends are blocked only when the tenant requires the gate AND the current
  // approval isn't active. Paused → resume is allowed regardless (mirrors
  // the server which skips the check on resume so an in-flight campaign is
  // never bricked mid-run by a policy flip).
  const sendBlocked = approvalRequired && !approvalActive;

  const availableLists = useMemo(() => {
    const linkedIds = new Set(linked.map((l) => l.id));
    return contactLists.filter((l) => !linkedIds.has(l.id));
  }, [contactLists, linked]);

  // ── Per-recipient breakdown (aggregate counts) ───────────────────────
  const breakdown = useMemo(() => {
    if (!analytics) return null;
    return {
      delivered: analytics.delivered ?? analytics.sent,
      bounced: analytics.bounced,
      opened: analytics.opened,
      clicked: analytics.clicked,
      complaints: analytics.complaints ?? 0,
      unsubscribed: analytics.unsubs,
    };
  }, [analytics]);

  // ── Recipients table columns ─────────────────────────────────────────
  const recipientColumns: Column<Recipient>[] = [
    {
      header: "Recipient",
      cell: (r) => <span className="text-sm text-ink">{r.emailTo}</span>,
    },
    {
      header: "Status",
      cell: (r) => <RecipientStatusBadge status={r.status} />,
    },
    {
      header: "Opens",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">{r.openCount}</span>
      ),
    },
    {
      header: "Clicks",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">{r.clickCount}</span>
      ),
    },
    {
      header: "Sent",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{relativeTime(r.sentAt)}</span>
      ),
    },
    {
      header: "Bounced",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {relativeTime(r.bouncedAt)}
        </span>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────
  if (error && !analytics) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Campaigns", href: "/crm/campaigns" },
          ]}
          title="Campaign"
          actions={
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 mt-4">
          {error}
        </Card>
      </>
    );
  }
  if (!analytics) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Campaigns", href: "/crm/campaigns" },
          ]}
          title="Loading…"
        />
      </>
    );
  }
  const c = analytics.campaign;
  const publicUrl = c.archiveSlug
    ? `${ARCHIVE_BASE.replace(/\/+$/, "")}/a/${c.archiveSlug}`
    : "";

  return (
    <>
      <PageHeader
        title={c.name}
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Campaigns", href: "/crm/campaigns" },
          { label: c.name },
        ]}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.status} />
            {c.channel && (
              <span className="text-xs text-ink-muted">· {c.channel}</span>
            )}
            {c.sentAt ? (
              <span className="text-xs text-ink-muted">
                · Sent {relativeTime(c.sentAt)}
              </span>
            ) : c.scheduledFor ? (
              <span className="text-xs text-ink-muted">
                · Scheduled {dateShort(c.scheduledFor)}
              </span>
            ) : null}
            {isSending && (
              <span className="text-xs text-brand-700 animate-pulse">
                · Live · refreshing every 5s
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => loadCore()}>
              Refresh
            </Button>
            <Button variant="secondary" onClick={() => setShowPreview(true)}>
              Preview
            </Button>
            <Button variant="secondary" onClick={() => setShowTest(true)}>
              Test send
            </Button>
            <Button variant="secondary" onClick={() => openAi("subject")}>
              ✨ AI Assist
            </Button>
            <Button variant="secondary" onClick={openEdit}>
              Edit
            </Button>

            {/* State-machine actions ------------------------------------ */}
            {isDraft && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setScheduleAt(toLocalInput(c.scheduledFor));
                    setShowSchedule(true);
                  }}
                  disabled={busy || sendBlocked}
                  title={sendBlocked ? "Approval required before scheduling" : undefined}
                >
                  Schedule
                </Button>
                <Button
                  variant="brand"
                  icon={Icon.send}
                  onClick={() =>
                    confirm(`Send "${c.name}" now?`) &&
                    transition("start", {}, "Campaign started")
                  }
                  disabled={busy || sendBlocked}
                  title={sendBlocked ? "Approval required before sending" : undefined}
                >
                  Send now
                </Button>
              </>
            )}

            {isScheduled && (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    transition("unschedule", {}, "Campaign unscheduled")
                  }
                  disabled={busy}
                >
                  Unschedule
                </Button>
                <Button
                  variant="brand"
                  icon={Icon.send}
                  onClick={() => transition("start", {}, "Campaign started")}
                  disabled={busy || sendBlocked}
                  title={sendBlocked ? "Approval required before starting" : undefined}
                >
                  Start now
                </Button>
              </>
            )}

            {isSending && (
              <Button
                variant="secondary"
                onClick={() => transition("pause", {}, "Campaign paused")}
                disabled={busy}
              >
                Pause
              </Button>
            )}

            {isPaused && (
              <Button
                variant="brand"
                onClick={() => transition("resume", {}, "Campaign resumed")}
                disabled={busy}
              >
                Resume
              </Button>
            )}

            {canCancel && (
              <Button
                variant="danger"
                onClick={() =>
                  confirm(
                    "Cancel this campaign? Any un-sent recipients will be marked cancelled.",
                  ) && transition("cancel", {}, "Campaign cancelled")
                }
                disabled={busy}
              >
                Cancel
              </Button>
            )}

            {isSent && !isArchived && (
              <Button
                variant="secondary"
                onClick={() => {
                  const suggested = (c.archiveSlug ?? c.name)
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "");
                  setPublishSlug(suggested);
                  setShowPublish(true);
                }}
                disabled={busy}
              >
                Publish archive
              </Button>
            )}

            {isArchived && (
              <>
                <Button
                  variant="secondary"
                  onClick={copyPublicUrl}
                  disabled={busy}
                >
                  Copy public URL
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    confirm("Unpublish the public archive? The URL will 404.") &&
                    transition(
                      "archive-unpublish",
                      {},
                      "Archive unpublished",
                    )
                  }
                  disabled={busy}
                >
                  Unpublish archive
                </Button>
              </>
            )}

            <Button variant="danger" onClick={deleteCampaign}>
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
      {toast && (
        <div className="mb-4">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className="space-y-6">
        {/* ── P3: Marketing approval status ───────────────────────── */}
        {approvalRequired && (
          <Card
            className={
              approvalActive
                ? "p-4 border-green-200 bg-green-50"
                : approval?.status === "Rejected"
                  ? "p-4 border-red-200 bg-red-50"
                  : approval?.status === "Pending"
                    ? "p-4 border-amber-200 bg-amber-50"
                    : "p-4 border-brand-200 bg-brand-50"
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-ink">
                    {approvalActive
                      ? "Approved"
                      : approval?.status === "Pending"
                        ? "Awaiting approval"
                        : approval?.status === "Rejected"
                          ? "Approval rejected"
                          : approval?.status === "Withdrawn"
                            ? "Approval withdrawn"
                            : "Approval required"}
                  </span>
                  {approval && <StatusBadge status={approval.status} />}
                </div>
                {!approval && (
                  <p className="text-sm text-ink-soft">
                    This tenant requires an approval before a campaign can be
                    scheduled or sent. Submit for review to unlock the Send /
                    Schedule actions.
                  </p>
                )}
                {approval?.status === "Pending" && (
                  <p className="text-sm text-ink-soft">
                    Submitted {relativeTime(approval.requestedAt)}. Reviewers
                    have been notified. You can withdraw the request at any time
                    before a decision is made.
                  </p>
                )}
                {approval?.status === "Approved" && (
                  <p className="text-sm text-ink-soft">
                    Approved {relativeTime(approval.approvedAt ?? approval.requestedAt)}
                    {approval.approvedBy ? ` by ${approval.approvedBy}` : ""}.
                    {!approvalActive && (
                      <span className="ms-1 text-red-700">
                        This approval is older than 30 days — a fresh review is
                        needed before sending.
                      </span>
                    )}
                  </p>
                )}
                {approval?.status === "Rejected" && (
                  <div className="text-sm text-ink-soft">
                    <p>
                      Rejected {relativeTime(approval.rejectedAt ?? approval.requestedAt)}
                      {approval.rejectedBy ? ` by ${approval.rejectedBy}` : ""}.
                    </p>
                    {approval.rejectionReason && (
                      <p className="mt-1">
                        <span className="font-medium text-ink">Reason: </span>
                        {approval.rejectionReason}
                      </p>
                    )}
                  </div>
                )}
                {approval?.status === "Withdrawn" && (
                  <p className="text-sm text-ink-soft">
                    Withdrawn {relativeTime(approval.requestedAt)}. Submit a
                    fresh request when the copy is ready for review.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {(!approval ||
                  approval.status === "Rejected" ||
                  approval.status === "Withdrawn" ||
                  !approvalActive) && (
                  <Button
                    variant="brand"
                    onClick={() => setShowRequestApproval(true)}
                    disabled={busy}
                  >
                    Request approval
                  </Button>
                )}
                {approval?.status === "Pending" && (
                  <Button
                    variant="secondary"
                    onClick={withdrawApproval}
                    disabled={busy}
                  >
                    Withdraw
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* ── Overview ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader title="Overview" />
          <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Subject" value={c.subject ?? "—"} />
            <Field label="Channel" value={c.channel ?? "—"} />
            <Field
              label="From"
              value={
                c.fromEmail
                  ? `${c.fromName ? `${c.fromName} <${c.fromEmail}>` : c.fromEmail}`
                  : "—"
              }
            />
            <Field label="Reply-to" value={c.replyTo ?? "—"} />
            <Field label="Scheduled" value={dateShort(c.scheduledFor)} />
            <Field label="Sent at" value={dateShort(c.sentAt)} />
            <Field
              label="Track opens"
              value={c.trackOpens ? "Enabled" : "Disabled"}
            />
            <Field
              label="Track clicks"
              value={c.trackClicks ? "Enabled" : "Disabled"}
            />
            <Field label="Budget" value={money(Number(c.budget))} />
            {c.rateLimitPerMin != null && (
              <Field
                label="Rate limit"
                value={`${c.rateLimitPerMin.toLocaleString()} / min`}
              />
            )}
            {c.testSentAt && (
              <Field
                label="Last test"
                value={relativeTime(c.testSentAt)}
              />
            )}
          </div>
          {c.description && (
            <div className="px-4 pb-4 text-sm text-ink-soft whitespace-pre-wrap">
              {c.description}
            </div>
          )}
        </Card>

        {/* ── P2: A/B Variants ─────────────────────────────────────── */}
        {(isDraft ||
          isScheduled ||
          (variantStats && variantStats.variants.length > 0)) && (
          <div>
            <SectionHeader
              title="A/B Variants"
              actions={
                <>
                  {variantStats && variantStats.variants.length >= 2 && analytics.sent >= 500 && (
                    <Button
                      variant="brand"
                      onClick={pickVariantWinner}
                      disabled={busy}
                    >
                      Pick winner
                    </Button>
                  )}
                  {(!variantStats || variantStats.variants.length < 3) && (
                    <Button variant="secondary" onClick={openNewVariant}>
                      + Add variant
                    </Button>
                  )}
                </>
              }
            />
            <Card>
              {!variantStats || variantStats.variants.length === 0 ? (
                <div className="p-6 text-sm text-ink-muted text-center">
                  No A/B variants yet. Add up to 3 variants (A/B/C) with weights
                  that sum to 100 to split-test subject lines, bodies, or from
                  addresses.
                </div>
              ) : (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Variant</th>
                        <th className="text-end">Weight</th>
                        <th className="text-end">Sent</th>
                        <th className="text-end">Opens</th>
                        <th className="text-end">Open %</th>
                        <th className="text-end">Clicks</th>
                        <th className="text-end">Click %</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {variantStats.variants.map((v) => (
                        <tr key={v.id}>
                          <td className="font-medium">
                            <span className="me-2">Variant {v.variantKey}</span>
                            {v.isWinner && (
                              <span
                                className="badge-amber"
                                style={{ backgroundColor: "#FFF7CC", color: "#8A6D0B" }}
                              >
                                Winner
                              </span>
                            )}
                            {v.subject && (
                              <div className="text-xs text-ink-muted mt-1">
                                {v.subject}
                              </div>
                            )}
                          </td>
                          <td className="text-end tabular-nums">
                            {v.weightPercent}%
                          </td>
                          <td className="text-end tabular-nums">
                            {v.totalSent.toLocaleString()}
                          </td>
                          <td className="text-end tabular-nums">
                            {v.totalOpened.toLocaleString()}
                          </td>
                          <td className="text-end tabular-nums text-ink-muted">
                            {(v.openRate * 100).toFixed(1)}%
                          </td>
                          <td className="text-end tabular-nums">
                            {v.totalClicked.toLocaleString()}
                          </td>
                          <td className="text-end tabular-nums text-ink-muted">
                            {(v.clickRate * 100).toFixed(1)}%
                          </td>
                          <td className="text-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                openEditVariant({
                                  id: v.id,
                                  variantKey: v.variantKey,
                                  weightPercent: v.weightPercent,
                                  subject: v.subject,
                                  bodyHtml: v.bodyHtml,
                                  fromEmail: v.fromEmail,
                                  fromName: v.fromName,
                                  totalSent: v.totalSent,
                                  totalOpened: v.totalOpened,
                                  totalClicked: v.totalClicked,
                                  totalBounced: v.totalBounced,
                                  isWinner: v.isWinner,
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                deleteVariant({
                                  id: v.id,
                                  variantKey: v.variantKey,
                                  weightPercent: v.weightPercent,
                                  subject: v.subject,
                                  bodyHtml: v.bodyHtml,
                                  fromEmail: v.fromEmail,
                                  fromName: v.fromName,
                                  totalSent: v.totalSent,
                                  totalOpened: v.totalOpened,
                                  totalClicked: v.totalClicked,
                                  totalBounced: v.totalBounced,
                                  isWinner: v.isWinner,
                                })
                              }
                            >
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {variantStats.significance && (
                    <div className="p-3 text-xs text-ink-soft border-t border-ink-muted/10">
                      Significance ({variantStats.significance.metric}): variant{" "}
                      <span className="font-semibold">
                        {variantStats.significance.leaderKey}
                      </span>{" "}
                      vs {variantStats.significance.runnerUpKey} — z ={" "}
                      {variantStats.significance.z}, p ={" "}
                      {variantStats.significance.pValue}{" "}
                      {variantStats.significance.isSignificant ? (
                        <span className="text-green-700 font-medium">
                          (significant at p&lt;0.05)
                        </span>
                      ) : (
                        <span className="text-ink-muted">(not yet significant)</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}

        {/* ── Audience ─────────────────────────────────────────────── */}
        <div>
          <SectionHeader
            title="Audience"
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    loadContactLists();
                    setShowAddList(true);
                  }}
                >
                  + Add list
                </Button>
                <Button
                  variant="primary"
                  onClick={materialize}
                  disabled={linked.length === 0}
                >
                  Materialize recipients
                </Button>
              </>
            }
          />
          <Card>
            {linked.length === 0 ? (
              <div className="p-6 text-sm text-ink-muted text-center">
                No contact lists linked yet. Add a list, then materialize to
                build the recipient set.
              </div>
            ) : (
              <ul className="divide-y divide-ink-muted/10">
                {linked.map((l) => (
                  <li
                    key={l.id}
                    className="p-3 flex items-center justify-between"
                  >
                    <div>
                      <a
                        href={`/crm/contact-lists/${l.id}`}
                        className="font-medium text-ink hover:text-brand-700"
                      >
                        {l.name}
                      </a>
                      <div className="text-xs text-ink-muted">
                        {l.memberCount.toLocaleString()} member
                        {l.memberCount === 1 ? "" : "s"}
                        {l.isDynamic ? " · dynamic" : ""}
                      </div>
                    </div>
                    <button
                      className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                      onClick={() => removeList(l.id)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ── Analytics ────────────────────────────────────────────── */}
        <div>
          <SectionHeader
            title={isSending ? "Analytics · live" : "Analytics"}
          />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <div className="p-4">
                <div className="stat-label">Total</div>
                <div className="stat-value mt-1">
                  {analytics.total.toLocaleString()}
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="stat-label">Sent</div>
                <div className="stat-value mt-1">
                  {analytics.sent.toLocaleString()}
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="stat-label">Opened</div>
                <div className="stat-value mt-1">
                  {analytics.opened.toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {pctText(analytics.openRate)} open rate
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="stat-label">Clicked</div>
                <div className="stat-value mt-1">
                  {analytics.clicked.toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {pctText(analytics.clickRate)} click rate
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="stat-label">Bounced</div>
                <div className="stat-value mt-1">
                  {analytics.bounced.toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {pctText(analytics.bounceRate)} bounce rate
                </div>
              </div>
            </Card>
            <Card>
              <div className="p-4">
                <div className="stat-label">Unsubscribed</div>
                <div className="stat-value mt-1">
                  {analytics.unsubs.toLocaleString()}
                </div>
                <div className="text-xs text-ink-muted mt-1">
                  {pctText(analytics.unsubRate)} unsub rate
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* ── Per-recipient breakdown table ────────────────────────── */}
        {breakdown && (
          <Card>
            <CardHeader
              title="Per-recipient breakdown"
              subtitle="Aggregate counts across the recipient set"
            />
            <div className="p-4">
              <table className="table">
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th className="text-end">Count</th>
                    <th className="text-end">% of sent</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Delivered", value: breakdown.delivered, tone: "text-green-700" },
                    { label: "Bounced", value: breakdown.bounced, tone: "text-red-700" },
                    { label: "Opened", value: breakdown.opened, tone: "text-brand-700" },
                    { label: "Clicked", value: breakdown.clicked, tone: "text-brand-700" },
                    { label: "Complaint", value: breakdown.complaints, tone: "text-red-700" },
                    { label: "Unsubscribed", value: breakdown.unsubscribed, tone: "text-ink-soft" },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td className={`font-medium ${row.tone}`}>{row.label}</td>
                      <td className="text-end tabular-nums">
                        {row.value.toLocaleString()}
                      </td>
                      <td className="text-end tabular-nums text-ink-muted">
                        {analytics.sent > 0
                          ? `${((row.value / analytics.sent) * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Attribution (existing report, kept intact) ───────────── */}
        {attribution && (
          <div>
            <SectionHeader title="Revenue attribution" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <div className="p-4">
                  <div className="stat-label">Leads</div>
                  <div className="stat-value mt-1">{attribution.leads}</div>
                </div>
              </Card>
              <Card>
                <div className="p-4">
                  <div className="stat-label">Converted</div>
                  <div className="stat-value mt-1">{attribution.converted}</div>
                </div>
              </Card>
              <Card>
                <div className="p-4">
                  <div className="stat-label">Opportunities won</div>
                  <div className="stat-value mt-1">{attribution.won}</div>
                  <div className="text-xs text-ink-muted mt-1">
                    of {attribution.opportunities} total
                  </div>
                </div>
              </Card>
              <Card>
                <div className="p-4">
                  <div className="stat-label">Attributed revenue</div>
                  <div className="stat-value mt-1">
                    {money(attribution.attributedRevenue)}
                  </div>
                  <div className="text-xs text-ink-muted mt-1">
                    ROI{" "}
                    {attribution.roi == null
                      ? "—"
                      : `${(attribution.roi * 100).toFixed(1)}%`}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── Recipients (collapsible) ─────────────────────────────── */}
        <div>
          <SectionHeader
            title="Recipients"
            actions={
              <Button
                variant="secondary"
                onClick={() => setShowRecipients((s) => !s)}
              >
                {showRecipients
                  ? "Hide"
                  : `Show recipients (${analytics.total.toLocaleString()})`}
              </Button>
            }
          />
          {showRecipients && (
            <>
              <div className="hidden md:block">
                <DataTable
                  columns={recipientColumns}
                  rows={recipients}
                  rowKey={(r) => r.id}
                  empty={{
                    icon: Icon.users,
                    title: "No recipients yet",
                    description:
                      "Link at least one contact list and click Materialize recipients.",
                  }}
                />
              </div>
              {recipients.length === 0 ? (
                <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
                  No recipients yet
                </div>
              ) : (
                <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
                  {recipients.map((r) => (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink truncate">{r.emailTo}</div>
                          <div className="text-xs text-ink-muted">{r.status}</div>
                        </div>
                        <div className="text-end text-xs text-ink-muted tabular-nums">
                          {r.openCount > 0 && <div>{r.openCount} open{r.openCount === 1 ? "" : "s"}</div>}
                          {r.clickCount > 0 && <div>{r.clickCount} click{r.clickCount === 1 ? "" : "s"}</div>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* ── Public archive ───────────────────────────────────────── */}
        {isArchived && (
          <div>
            <SectionHeader title="Public archive" />
            <Card>
              <div className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-muted mb-1">
                    Public URL
                  </div>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-sm text-brand-600 hover:text-brand-700"
                  >
                    {publicUrl}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={copyPublicUrl}>
                    Copy URL
                  </Button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <Button variant="secondary">Open</Button>
                  </a>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ── Edit drawer ───────────────────────────────────────────── */}
      <Drawer
        open={showEdit}
        onClose={() => setShowEdit(false)}
        width="w-[720px]"
        title="Edit campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={busy}
              onClick={(e) => saveEdit(e as unknown as React.FormEvent)}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <form onSubmit={saveEdit} className="space-y-6">
          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Basics
            </h4>
            <FormField label="Name" required>
              <input
                required
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </FormField>
            <FormField label="Description">
              <textarea
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Channel">
                <select
                  className="input"
                  value={form.channel}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      channel: e.target.value as ChannelValue,
                    })
                  }
                >
                  <option>Email</option>
                  <option>SMS</option>
                  <option>Push</option>
                  <option>Other</option>
                </select>
              </FormField>
              <FormField label="Status">
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as typeof emptyEdit.status,
                    })
                  }
                >
                  <option>Draft</option>
                  <option>Scheduled</option>
                  <option>Sending</option>
                  <option>Paused</option>
                  <option>Sent</option>
                  <option>Cancelled</option>
                  {/* Legacy values kept for backward compat with older rows. */}
                  <option>Planned</option>
                  <option>Active</option>
                  <option>Completed</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Start date">
                <input
                  type="date"
                  className="input"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </FormField>
              <FormField label="End date">
                <input
                  type="date"
                  className="input"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Budget">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input"
                  value={form.budget}
                  onChange={(e) =>
                    setForm({ ...form, budget: Number(e.target.value) })
                  }
                />
              </FormField>
              <FormField label="Expected revenue">
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="input"
                  value={form.expectedRevenue}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      expectedRevenue: Number(e.target.value),
                    })
                  }
                />
              </FormField>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Email content
            </h4>
            <FormField label="Subject line">
              <input
                className="input"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </FormField>
            <FormField label="Body (HTML)">
              <textarea
                className="input font-mono text-xs"
                rows={10}
                value={form.bodyHtml}
                onChange={(e) =>
                  setForm({ ...form, bodyHtml: e.target.value })
                }
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Sender
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From name">
                <input
                  className="input"
                  value={form.fromName}
                  onChange={(e) =>
                    setForm({ ...form, fromName: e.target.value })
                  }
                />
              </FormField>
              <FormField label="From email">
                <input
                  type="email"
                  className="input"
                  value={form.fromEmail}
                  onChange={(e) =>
                    setForm({ ...form, fromEmail: e.target.value })
                  }
                />
              </FormField>
            </div>
            <FormField label="Reply-to">
              <input
                type="email"
                className="input"
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
              />
            </FormField>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
              Delivery & tracking
            </h4>
            <FormField label="Scheduled for">
              <input
                type="datetime-local"
                className="input"
                value={form.scheduledFor}
                onChange={(e) =>
                  setForm({ ...form, scheduledFor: e.target.value })
                }
              />
            </FormField>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.trackOpens}
                  onChange={(e) =>
                    setForm({ ...form, trackOpens: e.target.checked })
                  }
                />
                <span>Track opens</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.trackClicks}
                  onChange={(e) =>
                    setForm({ ...form, trackClicks: e.target.checked })
                  }
                />
                <span>Track clicks</span>
              </label>
            </div>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Add-list drawer ───────────────────────────────────────── */}
      <Drawer
        open={showAddList}
        onClose={() => setShowAddList(false)}
        title="Add contact list"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAddList(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => addList(e as unknown as React.FormEvent)}
              disabled={!listToAdd || busy}
            >
              {busy ? "Linking…" : "Link list"}
            </Button>
          </>
        }
      >
        <form onSubmit={addList} className="space-y-4">
          <FormField
            label="Contact list"
            required
            hint={
              availableLists.length === 0
                ? "All available lists are already linked."
                : undefined
            }
          >
            <select
              className="input"
              value={listToAdd}
              onChange={(e) => setListToAdd(e.target.value)}
              required
            >
              <option value="">Select a list…</option>
              {availableLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.memberCount.toLocaleString()})
                </option>
              ))}
            </select>
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Schedule drawer ───────────────────────────────────────── */}
      <Drawer
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        title="Schedule campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowSchedule(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => submitSchedule(e as unknown as React.FormEvent)}
              disabled={!scheduleAt || busy}
            >
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitSchedule} className="space-y-4">
          <FormField
            label="Send at"
            required
            hint="Local time. Campaign moves to Scheduled and starts sending at this moment."
          >
            <input
              type="datetime-local"
              className="input"
              required
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Test-send drawer ──────────────────────────────────────── */}
      <Drawer
        open={showTest}
        onClose={() => setShowTest(false)}
        title="Test send"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowTest(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => submitTest(e as unknown as React.FormEvent)}
              disabled={busy || testEmails.every((s) => !s.trim())}
            >
              {busy ? "Queuing…" : "Send test"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitTest} className="space-y-4">
          <p className="text-xs text-ink-soft">
            Sends a <code className="font-mono">[TEST]</code>-prefixed copy to
            up to 5 addresses. Sample merge variables are used.
          </p>
          {testEmails.map((email, i) => (
            <FormField key={i} label={`Recipient ${i + 1}`}>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  className="input"
                  value={email}
                  onChange={(e) => {
                    const next = [...testEmails];
                    next[i] = e.target.value;
                    setTestEmails(next);
                  }}
                  placeholder="you@example.com"
                />
                {testEmails.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setTestEmails(testEmails.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>
            </FormField>
          ))}
          {testEmails.length < 5 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setTestEmails([...testEmails, ""])}
            >
              + Add recipient
            </Button>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── Preview drawer ────────────────────────────────────────── */}
      <Drawer
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Preview"
        width="w-[820px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPreview(false)}>
              Close
            </Button>
            <a
              href={`${process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm"}/campaigns/${id}/preview`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Button variant="secondary">Open in new tab</Button>
            </a>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-xs text-ink-soft">
            Rendered with sample merge variables{" "}
            <code className="font-mono">first_name</code>,{" "}
            <code className="font-mono">last_name</code>,{" "}
            <code className="font-mono">email</code>.
          </p>
          <iframe
            title="Campaign preview"
            src={`${process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm"}/campaigns/${id}/preview`}
            className="w-full h-[520px] border rounded bg-white"
          />
        </div>
      </Drawer>

      {/* ── P2: Variant editor drawer ─────────────────────────────── */}
      <Drawer
        open={showVariant}
        onClose={() => setShowVariant(false)}
        width="w-[640px]"
        title={editingVariantId ? "Edit variant" : "Add variant"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowVariant(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={busy}
              onClick={(e) => saveVariant(e as unknown as React.FormEvent)}
            >
              {busy ? "Saving…" : editingVariantId ? "Save changes" : "Add variant"}
            </Button>
          </>
        }
      >
        <form onSubmit={saveVariant} className="space-y-4">
          <p className="text-xs text-ink-soft">
            Overrides fall back to the campaign defaults when left blank. Weights across all variants must sum to 100 or less.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Variant key" required>
              <select
                className="input"
                value={variantForm.variantKey}
                onChange={(e) =>
                  setVariantForm({
                    ...variantForm,
                    variantKey: e.target.value as "A" | "B" | "C",
                  })
                }
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </select>
            </FormField>
            <FormField label="Weight (%)" required>
              <input
                type="number"
                min={1}
                max={100}
                required
                className="input"
                value={variantForm.weightPercent}
                onChange={(e) =>
                  setVariantForm({
                    ...variantForm,
                    weightPercent: Number(e.target.value),
                  })
                }
              />
            </FormField>
          </div>
          <FormField
            label="Subject override"
            hint="Leave blank to use the campaign subject."
          >
            <input
              className="input"
              value={variantForm.subject}
              onChange={(e) =>
                setVariantForm({ ...variantForm, subject: e.target.value })
              }
            />
          </FormField>
          <FormField
            label="Body override (HTML)"
            hint="Leave blank to use the campaign body."
          >
            <textarea
              className="input font-mono text-xs"
              rows={8}
              value={variantForm.bodyHtml}
              onChange={(e) =>
                setVariantForm({ ...variantForm, bodyHtml: e.target.value })
              }
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From name override">
              <input
                className="input"
                value={variantForm.fromName}
                onChange={(e) =>
                  setVariantForm({ ...variantForm, fromName: e.target.value })
                }
              />
            </FormField>
            <FormField label="From email override">
              <input
                type="email"
                className="input"
                value={variantForm.fromEmail}
                onChange={(e) =>
                  setVariantForm({ ...variantForm, fromEmail: e.target.value })
                }
              />
            </FormField>
          </div>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── P3: AI Assist drawer ──────────────────────────────────── */}
      <Drawer
        open={showAi}
        onClose={() => setShowAi(false)}
        width="w-[640px]"
        title="✨ AI Content Assist"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAi(false)}>
              Close
            </Button>
            <Button
              variant="brand"
              onClick={runAi}
              disabled={aiBusy}
            >
              {aiBusy
                ? "Thinking…"
                : aiMode === "subject"
                ? "Suggest subject lines"
                : aiMode === "write"
                ? "Write email"
                : "Rewrite body"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={aiMode === "subject" ? "brand" : "secondary"}
              onClick={() => openAi("subject")}
            >
              Suggest subject lines
            </Button>
            <Button
              size="sm"
              variant={aiMode === "write" ? "brand" : "secondary"}
              onClick={() => openAi("write")}
            >
              Write from brief
            </Button>
            <Button
              size="sm"
              variant={aiMode === "rewrite" ? "brand" : "secondary"}
              onClick={() => openAi("rewrite")}
            >
              Rewrite body
            </Button>
          </div>

          {aiMode === "subject" && (
            <>
              <p className="text-xs text-ink-soft">
                Generates 5 subject-line options from the current campaign
                body. Click one to apply it to the editor.
              </p>
              <FormField label="Tone">
                <select
                  className="input"
                  value={aiTone}
                  onChange={(e) =>
                    setAiTone(e.target.value as typeof aiTone)
                  }
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="urgent">Urgent</option>
                </select>
              </FormField>
              {aiSuggestions.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                    Suggestions
                  </div>
                  <ul className="space-y-2">
                    {aiSuggestions.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 p-3 rounded-lg border border-ink-muted/10 bg-surface-sunken"
                      >
                        <span className="text-sm text-ink flex-1">{s}</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => applySubjectSuggestion(s)}
                        >
                          Use
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {aiMode === "write" && (
            <>
              <p className="text-xs text-ink-soft">
                Describe what you want the email to accomplish. The AI will
                generate a subject + body draft that you can review before
                saving.
              </p>
              <FormField label="Brief" required>
                <textarea
                  className="input"
                  rows={5}
                  placeholder="Announce our Q4 sale, 20% off all plans, ends Friday. Push urgency without being pushy."
                  value={aiBrief}
                  onChange={(e) => setAiBrief(e.target.value)}
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Tone">
                  <select
                    className="input"
                    value={aiTone}
                    onChange={(e) =>
                      setAiTone(e.target.value as typeof aiTone)
                    }
                  >
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="friendly">Friendly</option>
                    <option value="urgent">Urgent</option>
                    <option value="formal">Formal</option>
                  </select>
                </FormField>
                <FormField label="Length">
                  <select
                    className="input"
                    value={aiLength}
                    onChange={(e) =>
                      setAiLength(e.target.value as typeof aiLength)
                    }
                  >
                    <option value="short">Short (~120 words)</option>
                    <option value="medium">Medium (~250 words)</option>
                    <option value="long">Long (~500 words)</option>
                  </select>
                </FormField>
              </div>
              <FormField
                label="Audience (optional)"
                hint="e.g. 'engineering leaders at mid-market SaaS companies'"
              >
                <input
                  className="input"
                  value={aiAudience}
                  onChange={(e) => setAiAudience(e.target.value)}
                />
              </FormField>
            </>
          )}

          {aiMode === "rewrite" && (
            <>
              <p className="text-xs text-ink-soft">
                Rewrites the current campaign body in a different tone or
                length. Review before applying.
              </p>
              <FormField label="Rewrite as">
                <select
                  className="input"
                  value={aiTone}
                  onChange={(e) =>
                    setAiTone(e.target.value as typeof aiTone)
                  }
                >
                  <option value="casual">More casual</option>
                  <option value="formal">More formal</option>
                  <option value="friendly">More friendly</option>
                  <option value="urgent">More urgent</option>
                  <option value="shorter">Shorter</option>
                  <option value="longer">Longer</option>
                </select>
              </FormField>
              {aiRewrite && (
                <>
                  <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
                    Rewritten body
                  </div>
                  <Card>
                    <div
                      className="p-4 text-sm text-ink prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: aiRewrite }}
                    />
                  </Card>
                  <Button variant="brand" onClick={applyRewrite}>
                    Apply to editor
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </Drawer>

      {/* ── Publish-archive drawer ────────────────────────────────── */}
      <Drawer
        open={showPublish}
        onClose={() => setShowPublish(false)}
        title="Publish public archive"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowPublish(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => submitPublish(e as unknown as React.FormEvent)}
              disabled={!publishSlug.trim() || busy}
            >
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitPublish} className="space-y-4">
          <FormField
            label="Slug"
            required
            hint="Lowercase letters, digits, and dashes. Globally unique across all tenants."
          >
            <input
              className="input font-mono text-sm"
              required
              value={publishSlug}
              onChange={(e) => setPublishSlug(e.target.value)}
              pattern="[a-z0-9-]+"
            />
          </FormField>
          <Card className="p-3 text-xs text-ink-soft">
            The public URL will be:{" "}
            <span className="font-mono text-brand-700">
              {ARCHIVE_BASE.replace(/\/+$/, "")}/a/{publishSlug || "<slug>"}
            </span>
          </Card>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      {/* ── P3: Request-approval drawer ───────────────────────────── */}
      <Drawer
        open={showRequestApproval}
        onClose={() => setShowRequestApproval(false)}
        title="Request approval"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setShowRequestApproval(false)}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={busy}
              onClick={(e) =>
                submitApprovalRequest(e as unknown as React.FormEvent)
              }
            >
              {busy ? "Submitting…" : "Submit for review"}
            </Button>
          </>
        }
      >
        <form onSubmit={submitApprovalRequest} className="space-y-4">
          <p className="text-sm text-ink-soft">
            The request goes to everyone with the{" "}
            <code className="font-mono">MarketingApprover</code> role in this
            tenant. They&apos;ll get an in-app notification and email. You can
            withdraw at any time before they decide.
          </p>
          <FormField
            label="Notes for reviewer"
            hint="Optional. E.g. context, deadline, whether tracking is on, or specific things you want them to look at."
          >
            <textarea
              className="input"
              rows={6}
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
              placeholder="Any context that helps the reviewer decide."
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Campaign" docId={params.id} />
      </div>
    </>
  );
}
