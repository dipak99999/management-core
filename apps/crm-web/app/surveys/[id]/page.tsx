"use client";

import { useEffect, useMemo, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  SectionHeader,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// Survey builder + analytics + responses. Single page with a Segmented tab
// switcher. All four tabs share the same top-of-page action strip (preview,
// copy URL, activate/pause, delete).

const CRM_SERVICE_URL =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

type QType =
  | "text"
  | "textarea"
  | "rating"
  | "nps"
  | "choice_single"
  | "choice_multi"
  | "dropdown"
  | "yes_no"
  | "matrix";

const Q_TYPES: { value: QType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "rating", label: "Rating (1–5)" },
  { value: "nps", label: "NPS (0–10)" },
  { value: "choice_single", label: "Single choice" },
  { value: "choice_multi", label: "Multiple choice" },
  { value: "dropdown", label: "Dropdown" },
  { value: "yes_no", label: "Yes / No" },
  { value: "matrix", label: "Matrix" },
];

interface Question {
  id?: string;
  order: number;
  type: QType;
  label: string;
  description: string | null;
  required: boolean;
  optionsJson: string[] | null;
  configJson: Record<string, unknown> | null;
}

interface Survey {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  description: string | null;
  thankYouMessage: string | null;
  isActive: boolean;
  closeAt: string | null;
  responseCap: number | null;
  responseCount: number;
  updatedAt: string;
  questions: Question[];
}

interface Answer {
  questionId: string;
  label: string;
  type: QType;
  value: unknown;
}
interface Response {
  id: string;
  submittedAt: string;
  respondentEmail: string | null;
  respondentName: string | null;
  answers: Answer[];
}

interface QuestionAnalytics {
  questionId: string;
  label: string;
  type: QType;
  count: number;
  analytics: Record<string, unknown>;
}
interface SurveyAnalytics {
  surveyId: string;
  title: string;
  isActive: boolean;
  totalResponses: number;
  questions: QuestionAnalytics[];
}

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/surveys/${slug}/render`;
}

// ── Type badge — one color per question type ─────────────────────────────
function TypeBadge({ type }: { type: QType }) {
  const cls =
    type === "text" || type === "textarea"
      ? "badge-gray"
      : type === "rating"
        ? "badge-amber"
        : type === "nps" || type === "matrix"
          ? "badge-violet"
          : type === "yes_no"
            ? "badge-brand"
            : "badge-blue";
  const label = Q_TYPES.find((t) => t.value === type)?.label ?? type;
  return <span className={cls}>{label}</span>;
}

// ── HorizontalBar — a single row of a bar chart ──────────────────────────
function HBar({
  label,
  count,
  total,
}: {
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-24 shrink-0 text-ink-soft truncate" title={label}>
        {label}
      </div>
      <div className="flex-1 relative h-6 rounded-md bg-surface-sunken overflow-hidden">
        <div
          className="absolute inset-y-0 start-0 bg-gradient-to-r from-brand-400 to-violet-500 rounded-md transition-all"
          style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
        />
        <div className="absolute inset-0 flex items-center px-2 justify-between text-[11px] font-medium">
          <span className="text-ink drop-shadow-sm tabular-nums">{count}</span>
          <span className="text-ink-soft tabular-nums">{pct}%</span>
        </div>
      </div>
    </div>
  );
}

// Format an arbitrary answer value for display in a Responses row.
function formatAnswer(a: Answer): string {
  if (a.value == null) return "—";
  if (Array.isArray(a.value)) return a.value.map(String).join(", ");
  if (typeof a.value === "object") return JSON.stringify(a.value);
  return String(a.value);
}

// Turn a Responses[] into a CSV string. First column = submittedAt, then
// respondent info, then one column per question (matched by label). Matrix
// answers get flattened to JSON strings; anything array-like is joined.
function toCsv(rows: Response[]): string {
  const labels = new Map<string, string>();
  for (const r of rows) {
    for (const a of r.answers) {
      if (!labels.has(a.questionId)) labels.set(a.questionId, a.label);
    }
  }
  const qids = [...labels.keys()];
  const header = [
    "submittedAt",
    "respondentEmail",
    "respondentName",
    ...qids.map((id) => labels.get(id) ?? id),
  ];
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.map(escape).join(",")];
  for (const r of rows) {
    const byQ = new Map<string, Answer>();
    for (const a of r.answers) byQ.set(a.questionId, a);
    const row = [
      r.submittedAt,
      r.respondentEmail ?? "",
      r.respondentName ?? "",
      ...qids.map((id) => {
        const a = byQ.get(id);
        if (!a) return "";
        if (Array.isArray(a.value)) return a.value.map(String).join("; ");
        if (typeof a.value === "object" && a.value != null) return JSON.stringify(a.value);
        return a.value == null ? "" : String(a.value);
      }),
    ];
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\n");
}

function emptyQuestion(order: number): Question {
  return {
    order,
    type: "text",
    label: "",
    description: null,
    required: false,
    optionsJson: null,
    configJson: null,
  };
}

type Tab = "questions" | "analytics" | "responses" | "settings";

export default function SurveyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  // Local, dirty-tracked copy of questions so the user can edit + reorder
  // freely and then explicitly Save via the PUT-wholesale endpoint.
  const [localQuestions, setLocalQuestions] = useState<Question[]>([]);
  const [dirty, setDirty] = useState(false);

  // Question drawer state.
  const [qDrawerIdx, setQDrawerIdx] = useState<number | null>(null);
  const [qDraft, setQDraft] = useState<Question>(emptyQuestion(1));
  const [optionsRaw, setOptionsRaw] = useState<string[]>([]);
  const [matrixRowsRaw, setMatrixRowsRaw] = useState("");
  const [matrixColsRaw, setMatrixColsRaw] = useState("");

  // Settings tab draft (mirrors survey settings until saved).
  const [settingsDraft, setSettingsDraft] = useState({
    title: "",
    description: "",
    thankYouMessage: "",
    closeAt: "",
    responseCap: "",
  });

  const [tab, setTab] = useState<Tab>("questions");
  const [expandedRespId, setExpandedRespId] = useState<string | null>(null);

  async function loadSurvey() {
    try {
      const s = await api.get<Survey>(`/surveys/${id}`);
      s.questions = [...(s.questions ?? [])].sort((a, b) => a.order - b.order);
      setSurvey(s);
      setLocalQuestions(s.questions.map((q) => ({ ...q })));
      setDirty(false);
      setSettingsDraft({
        title: s.title,
        description: s.description ?? "",
        thankYouMessage: s.thankYouMessage ?? "",
        closeAt: s.closeAt ? new Date(s.closeAt).toISOString().slice(0, 16) : "",
        responseCap: s.responseCap != null ? String(s.responseCap) : "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }

  async function loadAnalytics() {
    setLoadingAnalytics(true);
    try {
      setAnalytics(await api.get<SurveyAnalytics>(`/surveys/${id}/analytics`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function loadResponses() {
    setLoadingResponses(true);
    try {
      setResponses(await api.get<Response[]>(`/surveys/${id}/responses`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load responses");
    } finally {
      setLoadingResponses(false);
    }
  }

  useEffect(() => {
    loadSurvey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Lazy-load analytics/responses only when their tab is first visited.
  useEffect(() => {
    if (tab === "analytics" && !analytics) loadAnalytics();
    if (tab === "responses" && responses.length === 0) loadResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── Question builder helpers ───────────────────────────────────────────

  function openAddQuestion() {
    const nextOrder = localQuestions.length + 1;
    setQDrawerIdx(-1);
    setQDraft(emptyQuestion(nextOrder));
    setOptionsRaw([]);
    setMatrixRowsRaw("");
    setMatrixColsRaw("");
  }
  function openEditQuestion(idx: number) {
    const q = localQuestions[idx];
    setQDrawerIdx(idx);
    setQDraft({ ...q });
    setOptionsRaw([...(q.optionsJson ?? [])]);
    if (q.type === "matrix" && q.configJson) {
      const cfg = q.configJson as { rows?: string[]; cols?: string[] };
      setMatrixRowsRaw((cfg.rows ?? []).join("\n"));
      setMatrixColsRaw((cfg.cols ?? []).join("\n"));
    } else {
      setMatrixRowsRaw("");
      setMatrixColsRaw("");
    }
  }
  function closeQuestion() {
    setQDrawerIdx(null);
    setOptionsRaw([]);
    setMatrixRowsRaw("");
    setMatrixColsRaw("");
  }

  function commitQuestion() {
    if (!qDraft.label.trim()) {
      setError("Question label is required");
      return;
    }
    const needsOptions =
      qDraft.type === "choice_single" ||
      qDraft.type === "choice_multi" ||
      qDraft.type === "dropdown";
    const cleanOptions = needsOptions
      ? optionsRaw.map((s) => s.trim()).filter(Boolean)
      : null;
    if (needsOptions && (!cleanOptions || cleanOptions.length < 2)) {
      setError("Choice questions need at least 2 options");
      return;
    }

    let configJson: Record<string, unknown> | null = null;
    if (qDraft.type === "matrix") {
      const rows = matrixRowsRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const cols = matrixColsRaw
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (rows.length === 0 || cols.length === 0) {
        setError("Matrix questions need at least one row and one column");
        return;
      }
      configJson = { rows, cols };
    } else if (qDraft.type === "rating") {
      configJson = { scale: 5 };
    }

    const next: Question = {
      ...qDraft,
      label: qDraft.label.trim(),
      description: qDraft.description?.trim() || null,
      optionsJson: cleanOptions,
      configJson,
    };

    const arr = [...localQuestions];
    if (qDrawerIdx == null || qDrawerIdx < 0) arr.push(next);
    else arr[qDrawerIdx] = next;

    // Renumber to stay 1..N.
    const renumbered = arr.map((q, i) => ({ ...q, order: i + 1 }));
    setLocalQuestions(renumbered);
    setDirty(true);
    closeQuestion();
  }

  function removeQuestion(idx: number) {
    if (!confirm(`Remove question "${localQuestions[idx].label}"?`)) return;
    const arr = localQuestions
      .filter((_, i) => i !== idx)
      .map((q, i) => ({ ...q, order: i + 1 }));
    setLocalQuestions(arr);
    setDirty(true);
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= localQuestions.length) return;
    const arr = [...localQuestions];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setLocalQuestions(arr.map((q, i) => ({ ...q, order: i + 1 })));
    setDirty(true);
  }

  async function saveQuestions() {
    if (!survey) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/surveys/${survey.id}`, {
        name: survey.name,
        publicSlug: survey.publicSlug,
        title: survey.title,
        description: survey.description ?? undefined,
        thankYouMessage: survey.thankYouMessage ?? undefined,
        isActive: survey.isActive,
        closeAt: survey.closeAt ?? undefined,
        responseCap: survey.responseCap ?? undefined,
        questions: localQuestions.map((q, i) => ({
          order: i + 1,
          type: q.type,
          label: q.label,
          description: q.description ?? undefined,
          required: q.required,
          optionsJson: q.optionsJson ?? undefined,
          configJson: q.configJson ?? undefined,
        })),
      });
      await loadSurvey();
      // Analytics is now stale — drop cache so next tab-switch refetches.
      setAnalytics(null);
      setToast({ kind: "success", message: "Questions saved" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  // ── Top-of-page actions ────────────────────────────────────────────────

  async function toggleActive() {
    if (!survey) return;
    if (survey.isActive) {
      if (!confirm("Pause this survey? The public URL will return 404 until you re-activate."))
        return;
    }
    setBusy(true);
    try {
      await api.put(`/surveys/${survey.id}`, {
        name: survey.name,
        publicSlug: survey.publicSlug,
        title: survey.title,
        description: survey.description ?? undefined,
        thankYouMessage: survey.thankYouMessage ?? undefined,
        isActive: !survey.isActive,
        closeAt: survey.closeAt ?? undefined,
        responseCap: survey.responseCap ?? undefined,
      });
      await loadSurvey();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    } finally {
      setBusy(false);
    }
  }

  async function removeSurvey() {
    if (!survey) return;
    if (!confirm("Delete this survey? All responses will be permanently removed."))
      return;
    try {
      await api.del(`/surveys/${survey.id}`);
      window.location.href = "/crm/surveys";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function copyUrl() {
    if (!survey) return;
    try {
      await navigator.clipboard.writeText(publicUrl(survey.publicSlug));
      setToast({ kind: "success", message: "Copied public URL" });
    } catch {
      setToast({ kind: "error", message: "Copy failed" });
    }
  }

  async function saveSettings() {
    if (!survey) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/surveys/${survey.id}`, {
        name: survey.name,
        publicSlug: survey.publicSlug,
        title: settingsDraft.title,
        description: settingsDraft.description || undefined,
        thankYouMessage: settingsDraft.thankYouMessage || undefined,
        isActive: survey.isActive,
        closeAt: settingsDraft.closeAt
          ? new Date(settingsDraft.closeAt).toISOString()
          : undefined,
        responseCap: settingsDraft.responseCap
          ? Number(settingsDraft.responseCap)
          : undefined,
      });
      await loadSurvey();
      setToast({ kind: "success", message: "Settings saved" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (responses.length === 0) return;
    const csv = toCsv(responses);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `${survey?.publicSlug ?? "survey"}-responses-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const responseColumns: Column<Response>[] = [
    {
      header: "Submitted",
      cell: (r) => (
        <span className="text-sm text-ink-soft">{dateShort(r.submittedAt)}</span>
      ),
    },
    {
      header: "Email",
      cell: (r) => (
        <span className="text-sm text-ink">
          {r.respondentEmail || (
            <span className="italic text-ink-muted">Anonymous</span>
          )}
        </span>
      ),
    },
    {
      header: "Name",
      cell: (r) => (
        <span className="text-sm text-ink-soft">
          {r.respondentName || "—"}
        </span>
      ),
    },
    {
      header: "Answers",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-ink-soft">{r.answers.length}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpandedRespId((x) => (x === r.id ? null : r.id));
          }}
          className="btn-ghost btn-sm"
        >
          {expandedRespId === r.id ? "Hide" : "View"}
        </button>
      ),
    },
  ];

  const currentStatus = useMemo(() => {
    if (!survey) return "Draft";
    if (survey.closeAt && new Date(survey.closeAt).getTime() < Date.now())
      return "Closed";
    if (
      survey.responseCap != null &&
      survey.responseCount >= survey.responseCap
    )
      return "Closed";
    return survey.isActive ? "Active" : "Draft";
  }, [survey]);

  if (!survey) {
    return (
      <>
        <PageHeader
          title="Survey"
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Surveys", href: "/crm/surveys" },
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

  const needsOptionsInDrawer =
    qDraft.type === "choice_single" ||
    qDraft.type === "choice_multi" ||
    qDraft.type === "dropdown";

  return (
    <>
      <PageHeader
        title={survey.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={currentStatus} />
            <span className="text-ink-muted">·</span>
            <code className="font-mono text-xs">{survey.publicSlug}</code>
            <span className="text-ink-muted">·</span>
            <span>
              {localQuestions.length} question
              {localQuestions.length === 1 ? "" : "s"}
            </span>
            <span className="text-ink-muted">·</span>
            <span>
              {survey.responseCount} response
              {survey.responseCount === 1 ? "" : "s"}
            </span>
          </span>
        }
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Surveys", href: "/crm/surveys" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <a
              href={publicUrl(survey.publicSlug)}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm"
            >
              Preview
            </a>
            <Button variant="secondary" size="sm" onClick={copyUrl}>
              Copy URL
            </Button>
            <Button
              variant={survey.isActive ? "secondary" : "brand"}
              size="sm"
              onClick={toggleActive}
              disabled={busy}
            >
              {survey.isActive ? "Pause" : "Activate"}
            </Button>
            <Button variant="danger" size="sm" onClick={removeSurvey} disabled={busy}>
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

      <div className="mb-4">
        <Segmented<Tab>
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { value: "questions", label: "Questions", count: localQuestions.length },
            { value: "analytics", label: "Analytics" },
            { value: "responses", label: "Responses", count: survey.responseCount },
            { value: "settings", label: "Settings" },
          ]}
        />
      </div>

      {/* ─── Questions tab ─────────────────────────────────────────────── */}
      {tab === "questions" && (
        <>
          {localQuestions.length === 0 ? (
            <Card className="p-10 text-center">
              <div className="text-sm text-ink-muted mb-3">
                No questions yet. Add your first question to start collecting responses.
              </div>
              <Button variant="brand" onClick={openAddQuestion}>
                + Add question
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {localQuestions.map((q, i) => (
                <Card key={q.id ?? `new-${i}`} className="p-4 flex items-start gap-4">
                  <div className="h-9 w-9 rounded-full bg-brand-50 text-brand-700 grid place-items-center text-sm font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <TypeBadge type={q.type} />
                      {q.required && <span className="badge-amber">required</span>}
                    </div>
                    <div className="text-sm font-medium text-ink">
                      {q.label || (
                        <span className="italic text-ink-muted">(no label)</span>
                      )}
                    </div>
                    {q.description && (
                      <div className="mt-0.5 text-xs text-ink-muted">
                        {q.description}
                      </div>
                    )}
                    {q.optionsJson && q.optionsJson.length > 0 && (
                      <div className="mt-2 text-xs text-ink-muted truncate">
                        Options: {q.optionsJson.join(", ")}
                      </div>
                    )}
                    {q.type === "matrix" && q.configJson && (
                      <div className="mt-2 text-xs text-ink-muted">
                        {((q.configJson as { rows?: string[] }).rows ?? []).length} rows ×{" "}
                        {((q.configJson as { cols?: string[] }).cols ?? []).length} columns
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => moveQuestion(i, -1)}
                      disabled={i === 0}
                      className="btn-ghost btn-sm disabled:opacity-30"
                      aria-label="Move up"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveQuestion(i, 1)}
                      disabled={i === localQuestions.length - 1}
                      className="btn-ghost btn-sm disabled:opacity-30"
                      aria-label="Move down"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button onClick={() => openEditQuestion(i)} className="btn-ghost btn-sm">
                      Edit
                    </button>
                    <button
                      onClick={() => removeQuestion(i)}
                      className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </Card>
              ))}
              <div className="flex items-center justify-between pt-2">
                <Button variant="secondary" onClick={openAddQuestion}>
                  + Add question
                </Button>
                <Button
                  variant="brand"
                  onClick={saveQuestions}
                  disabled={busy || !dirty}
                >
                  {busy ? "Saving…" : dirty ? "Save changes" : "No changes"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── Analytics tab ─────────────────────────────────────────────── */}
      {tab === "analytics" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="badge-brand">
                {analytics?.totalResponses ?? 0} total response
                {(analytics?.totalResponses ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            <Button variant="secondary" size="sm" onClick={loadAnalytics} disabled={loadingAnalytics}>
              {loadingAnalytics ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {loadingAnalytics && !analytics ? (
            <Card className="p-6 text-center text-sm text-ink-muted">
              Loading analytics…
            </Card>
          ) : !analytics || analytics.questions.length === 0 ? (
            <Card className="p-6 text-center text-sm text-ink-muted">
              No questions to analyse yet.
            </Card>
          ) : (
            analytics.questions.map((q) => (
              <AnalyticsCard key={q.questionId} q={q} />
            ))
          )}
        </div>
      )}

      {/* ─── Responses tab ─────────────────────────────────────────────── */}
      {tab === "responses" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              {responses.length} response{responses.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadResponses}
                disabled={loadingResponses}
              >
                {loadingResponses ? "Refreshing…" : "Refresh"}
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={downloadCsv}
                disabled={responses.length === 0}
              >
                Export CSV
              </Button>
            </div>
          </div>

          <div className="hidden md:block">
            <DataTable
              columns={responseColumns}
              rows={responses}
              rowKey={(r) => r.id}
              loading={loadingResponses}
              empty={{
                icon: Icon.clipboard,
                title: "No responses yet",
                description: survey.isActive
                  ? "Share the public URL to start collecting responses."
                  : "Activate the survey to start collecting responses.",
              }}
            />
          </div>
          {responses.length === 0 ? (
            <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
              No responses yet
            </div>
          ) : (
            <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
              {responses.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedRespId((cur) => (cur === r.id ? null : r.id))}
                    className="block w-full text-start px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink truncate">
                          {r.respondentName ?? r.respondentEmail ?? "(anonymous)"}
                        </div>
                        {r.respondentName && r.respondentEmail && (
                          <div className="text-xs text-ink-muted truncate">{r.respondentEmail}</div>
                        )}
                      </div>
                      <div className="text-xs text-ink-muted">{dateShort(r.submittedAt)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {expandedRespId && (() => {
            const r = responses.find((x) => x.id === expandedRespId);
            if (!r) return null;
            return (
              <Card className="p-4">
                <CardHeader
                  title={`Response · ${dateShort(r.submittedAt)}`}
                  subtitle={r.respondentEmail || "Anonymous"}
                  actions={
                    <button
                      onClick={() => setExpandedRespId(null)}
                      className="btn-ghost btn-sm"
                    >
                      Close
                    </button>
                  }
                />
                <div className="space-y-3">
                  {r.answers.map((a) => (
                    <div key={a.questionId} className="border-s-2 border-brand-200 ps-3">
                      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                        {a.label}
                      </div>
                      <div className="text-sm text-ink mt-0.5 whitespace-pre-wrap break-words">
                        {formatAnswer(a)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </div>
      )}

      {/* ─── Settings tab ──────────────────────────────────────────────── */}
      {tab === "settings" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card className="p-5 space-y-4">
              <SectionHeader title="Content" />
              <FormField label="Public title" required>
                <input
                  className="input"
                  value={settingsDraft.title}
                  onChange={(e) =>
                    setSettingsDraft({ ...settingsDraft, title: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Description" hint="Shown above the questions.">
                <textarea
                  className="input"
                  rows={3}
                  value={settingsDraft.description}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      description: e.target.value,
                    })
                  }
                />
              </FormField>
              <FormField
                label="Thank-you message"
                hint="Shown after a respondent submits."
              >
                <textarea
                  className="input"
                  rows={3}
                  value={settingsDraft.thankYouMessage}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      thankYouMessage: e.target.value,
                    })
                  }
                />
              </FormField>
            </Card>

            <Card className="p-5 space-y-4">
              <SectionHeader title="Availability" />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Close at"
                  hint="Optional. Auto-closes after this timestamp."
                >
                  <input
                    type="datetime-local"
                    className="input"
                    value={settingsDraft.closeAt}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        closeAt: e.target.value,
                      })
                    }
                  />
                </FormField>
                <FormField
                  label="Response cap"
                  hint="Optional. Auto-closes after N responses."
                >
                  <input
                    type="number"
                    min={0}
                    className="input"
                    value={settingsDraft.responseCap}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        responseCap: e.target.value,
                      })
                    }
                  />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button variant="brand" onClick={saveSettings} disabled={busy}>
                  {busy ? "Saving…" : "Save settings"}
                </Button>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-5">
              <SectionHeader title="Publishing" />
              <div className="text-sm text-ink-soft mb-2">
                Current status: <StatusBadge status={currentStatus} />
              </div>
              <Button
                variant={survey.isActive ? "secondary" : "brand"}
                onClick={toggleActive}
                disabled={busy}
                className="w-full"
              >
                {survey.isActive ? "Pause survey" : "Activate survey"}
              </Button>
            </Card>

            <Card className="p-5 border-red-200">
              <SectionHeader title="Danger zone" />
              <div className="text-xs text-ink-muted mb-3">
                Deleting a survey removes all its questions and responses. This
                cannot be undone.
              </div>
              <Button variant="danger" onClick={removeSurvey} className="w-full">
                Delete survey
              </Button>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Question editor drawer ────────────────────────────────────── */}
      <Drawer
        open={qDrawerIdx != null}
        onClose={closeQuestion}
        width="w-[640px]"
        title={qDrawerIdx != null && qDrawerIdx >= 0 ? "Edit question" : "Add question"}
        footer={
          <>
            <Button variant="secondary" onClick={closeQuestion}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={commitQuestion}
              disabled={!qDraft.label.trim()}
            >
              {qDrawerIdx != null && qDrawerIdx >= 0 ? "Save question" : "Add question"}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commitQuestion();
          }}
          className="space-y-4"
        >
          <FormField label="Type" required>
            <select
              className="input"
              value={qDraft.type}
              onChange={(e) => {
                const t = e.target.value as QType;
                setQDraft({
                  ...qDraft,
                  type: t,
                  optionsJson:
                    t === "choice_single" || t === "choice_multi" || t === "dropdown"
                      ? qDraft.optionsJson ?? []
                      : null,
                });
                if (
                  (t === "choice_single" || t === "choice_multi" || t === "dropdown") &&
                  optionsRaw.length === 0
                ) {
                  setOptionsRaw(["", ""]);
                }
              }}
            >
              {Q_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Label" required>
            <input
              className="input"
              autoFocus
              value={qDraft.label}
              onChange={(e) => setQDraft({ ...qDraft, label: e.target.value })}
              placeholder="e.g. How likely are you to recommend us?"
            />
          </FormField>

          <FormField label="Description" hint="Optional helper text shown below the label.">
            <input
              className="input"
              value={qDraft.description ?? ""}
              onChange={(e) =>
                setQDraft({ ...qDraft, description: e.target.value })
              }
            />
          </FormField>

          <FormField label="Required">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={qDraft.required}
                onChange={(e) =>
                  setQDraft({ ...qDraft, required: e.target.checked })
                }
              />
              <span className="text-sm text-ink-soft">
                Respondent must answer before submitting
              </span>
            </label>
          </FormField>

          {needsOptionsInDrawer && (
            <FormField label="Options" required>
              <div className="space-y-2">
                {optionsRaw.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="input flex-1"
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const next = [...optionsRaw];
                        next[i] = e.target.value;
                        setOptionsRaw(next);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setOptionsRaw(optionsRaw.filter((_, j) => j !== i))
                      }
                      className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                      disabled={optionsRaw.length <= 2}
                      title={optionsRaw.length <= 2 ? "Need at least 2 options" : "Remove"}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setOptionsRaw([...optionsRaw, ""])}
                  className="btn-ghost btn-sm text-brand-600"
                >
                  + Add option
                </button>
              </div>
            </FormField>
          )}

          {qDraft.type === "rating" && (
            <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-3 text-xs text-ink-muted">
              Rating scale is fixed at 1–5.
            </div>
          )}
          {qDraft.type === "nps" && (
            <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-3 text-xs text-ink-muted">
              NPS scale is fixed at 0–10.
            </div>
          )}
          {qDraft.type === "yes_no" && (
            <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-3 text-xs text-ink-muted">
              Yes/No options are rendered automatically.
            </div>
          )}

          {qDraft.type === "matrix" && (
            <>
              <FormField label="Rows" required hint="One per line — these become the rows of the matrix.">
                <textarea
                  className="input"
                  rows={4}
                  value={matrixRowsRaw}
                  onChange={(e) => setMatrixRowsRaw(e.target.value)}
                  placeholder={"Speed\nQuality\nSupport"}
                />
              </FormField>
              <FormField label="Columns" required hint="One per line — these become the answer columns.">
                <textarea
                  className="input"
                  rows={4}
                  value={matrixColsRaw}
                  onChange={(e) => setMatrixColsRaw(e.target.value)}
                  placeholder={"Poor\nOK\nGreat"}
                />
              </FormField>
            </>
          )}

          <button type="submit" className="hidden" />
        </form>
      </Drawer>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Survey" docId={params.id} />
      </div>
    </>
  );
}

// ── Per-question analytics card ─────────────────────────────────────────

function AnalyticsCard({ q }: { q: QuestionAnalytics }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <TypeBadge type={q.type} />
            <span className="text-[11px] text-ink-muted">
              {q.count} response{q.count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-sm font-medium text-ink">{q.label}</div>
        </div>
      </div>
      <AnalyticsBody q={q} />
    </Card>
  );
}

function AnalyticsBody({ q }: { q: QuestionAnalytics }) {
  const a = q.analytics;

  if (q.type === "rating") {
    const avg = (a.average as number) ?? 0;
    const dist = (a.distribution as Record<string, number>) ?? {};
    const total = Object.values(dist).reduce((n, v) => n + v, 0);
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 flex flex-col items-center justify-center border border-ink-muted/10 rounded-lg p-4 bg-surface-sunken">
          <div className="stat-value">{avg.toFixed(1)}</div>
          <div className="text-[11px] uppercase tracking-wider text-ink-muted mt-1">
            Average
          </div>
        </div>
        <div className="md:col-span-2 space-y-2">
          {[5, 4, 3, 2, 1].map((n) => (
            <HBar
              key={n}
              label={`${n} ★`}
              count={dist[String(n)] ?? 0}
              total={total}
            />
          ))}
        </div>
      </div>
    );
  }

  if (q.type === "nps") {
    const nps = (a.nps as number) ?? 0;
    const promoters = (a.promoters as number) ?? 0;
    const passives = (a.passives as number) ?? 0;
    const detractors = (a.detractors as number) ?? 0;
    const promoterPct = (a.promoterPct as number) ?? 0;
    const passivePct = (a.passivePct as number) ?? 0;
    const detractorPct = (a.detractorPct as number) ?? 0;
    const avg = (a.average as number) ?? 0;
    const npsColor =
      nps > 30
        ? "text-green-600"
        : nps >= 0
          ? "text-amber-600"
          : "text-red-600";
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-stretch">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-red-700 font-medium">
            Detractors
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-red-700 tabular-nums">
              {detractorPct.toFixed(0)}%
            </span>
            <span className="text-xs text-red-600 tabular-nums">
              ({detractors})
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-amber-700 font-medium">
            Passives
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-amber-700 tabular-nums">
              {passivePct.toFixed(0)}%
            </span>
            <span className="text-xs text-amber-600 tabular-nums">
              ({passives})
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-green-700 font-medium">
            Promoters
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-green-700 tabular-nums">
              {promoterPct.toFixed(0)}%
            </span>
            <span className="text-xs text-green-600 tabular-nums">
              ({promoters})
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-ink-muted/10 bg-surface-sunken p-4 flex flex-col justify-center">
          <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
            NPS score
          </div>
          <div className={`text-3xl font-bold tabular-nums ${npsColor}`}>
            {nps.toFixed(0)}
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            avg {avg.toFixed(1)} / 10
          </div>
        </div>
      </div>
    );
  }

  if (
    q.type === "choice_single" ||
    q.type === "choice_multi" ||
    q.type === "dropdown" ||
    q.type === "yes_no"
  ) {
    const counts = (a.counts as Record<string, number>) ?? {};
    const entries = Object.entries(counts);
    const total = entries.reduce((n, [, v]) => n + v, 0);
    if (entries.length === 0) {
      return (
        <div className="text-sm text-ink-muted text-center py-4">
          No responses yet.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {entries.map(([label, count]) => (
          <HBar key={label} label={label} count={count} total={total} />
        ))}
      </div>
    );
  }

  if (q.type === "text" || q.type === "textarea") {
    const recent = (a.recent as string[]) ?? [];
    if (recent.length === 0) {
      return (
        <div className="text-sm text-ink-muted text-center py-4">
          No responses yet.
        </div>
      );
    }
    return (
      <div className="max-h-[400px] overflow-y-auto space-y-2">
        {recent.map((r, i) => (
          <div
            key={i}
            className="rounded-md border border-ink-muted/10 bg-surface-sunken p-3 text-sm text-ink whitespace-pre-wrap break-words"
          >
            {r}
          </div>
        ))}
      </div>
    );
  }

  if (q.type === "matrix") {
    // analytics shape for matrix isn't strictly defined; accept either
    // { counts: { row: { col: n } } } or { rows, cols, counts }.
    const cfg = a as {
      rows?: string[];
      cols?: string[];
      counts?: Record<string, Record<string, number>>;
    };
    const counts = cfg.counts ?? {};
    const rows = cfg.rows ?? Object.keys(counts);
    const cols =
      cfg.cols ??
      Array.from(
        new Set(rows.flatMap((r) => Object.keys(counts[r] ?? {}))),
      );

    if (rows.length === 0 || cols.length === 0) {
      return (
        <div className="text-sm text-ink-muted text-center py-4">
          No matrix data yet.
        </div>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              {cols.map((c) => (
                <th key={c} className="text-center">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td className="font-medium text-ink">{r}</td>
                {cols.map((c) => (
                  <td key={c} className="text-center tabular-nums">
                    {counts[r]?.[c] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="text-sm text-ink-muted text-center py-4">
      No preview available for this question type.
    </div>
  );
}
