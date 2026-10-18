"use client";

// Course detail page. Two modes: learner (default) and author (?authoring=1
// AND ownerUserId matches). Author mode surfaces add/edit/delete lesson
// controls, publish toggle, and reorder buttons.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { loadSession } from "../../../../lib/auth";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  Drawer,
  PageHeader,
  Skeleton,
  Toast,
} from "../../../../components/ui";

type Block =
  | { type: "text"; text: string }
  | { type: "checklist"; text: string; done: boolean }
  | { type: "divider" };

interface QuizQuestion {
  q: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface Quiz {
  passingScore: number;
  questions: QuizQuestion[];
}

interface LessonRow {
  id: string;
  title: string;
  sortOrder: number;
  durationMinutes: number | null;
  hasQuiz: boolean;
  quiz?: Quiz;
}

interface EnrollmentSummary {
  id: string;
  progressPercent: number;
  completedAt: string | null;
  currentLessonId: string | null;
}

interface CourseDetail {
  id: string;
  name: string;
  description: string | null;
  coverColor: string;
  category: string | null;
  estimatedMinutes: number | null;
  isPublished: boolean;
  ownerUserId: string;
  _count: { lessons: number; enrollments: number };
  lessons: LessonRow[];
  enrollments?: EnrollmentSummary[];
}

interface EnrollmentDetail {
  id: string;
  courseId: string;
  progressPercent: number;
  completedAt: string | null;
  currentLessonId: string | null;
  progress: { lessonId: string; completedAt: string | null; quizPassed: boolean | null }[];
}

const coverBar: Record<string, string> = {
  violet: "bg-gradient-to-br from-brand-400 to-brand-700",
  blue: "bg-gradient-to-br from-blue-400 to-blue-700",
  green: "bg-gradient-to-br from-emerald-400 to-emerald-700",
  amber: "bg-gradient-to-br from-amber-400 to-amber-700",
  rose: "bg-gradient-to-br from-rose-400 to-rose-700",
  slate: "bg-gradient-to-br from-slate-400 to-slate-700",
};

function InnerCourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const qp = useSearchParams();
  const authoringFlag = qp.get("authoring") === "1";

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonRow | "new" | null>(null);

  const session = useMemo(() => loadSession(), []);
  const userId = session?.user.id;

  const isOwner = course != null && userId != null && course.ownerUserId === userId;
  const authoring = authoringFlag && isOwner;

  const load = useCallback(async () => {
    try {
      const [c, myEnrolls] = await Promise.all([
        api.get<CourseDetail>(`/learn/courses/${params.courseId}`),
        api.get<EnrollmentDetail[]>("/learn/enrollments"),
      ]);
      setCourse(c);
      const mine = myEnrolls.find((e) => e.courseId === params.courseId);
      setEnrollment(mine ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, [params.courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const enroll = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/learn/courses/${params.courseId}/enroll`, {});
      await load();
      say("You're enrolled");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async () => {
    if (!course) return;
    setBusy(true);
    setErr(null);
    try {
      await api.put(`/learn/courses/${course.id}`, { isPublished: !course.isPublished });
      await load();
      say(course.isPublished ? "Unpublished" : "Published");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteLesson = async (lesson: LessonRow) => {
    if (!window.confirm(`Delete lesson "${lesson.title}"?`)) return;
    try {
      await api.delete(`/learn/lessons/${lesson.id}`);
      await load();
      say("Lesson deleted");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  };

  const moveLesson = async (lesson: LessonRow, direction: -1 | 1) => {
    if (!course) return;
    const ordered = [...course.lessons].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = ordered.findIndex((l) => l.id === lesson.id);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= ordered.length) return;
    const other = ordered[targetIdx];
    if (!other) return;
    try {
      await api.put(`/learn/lessons/${lesson.id}`, { sortOrder: other.sortOrder });
      await api.put(`/learn/lessons/${other.id}`, { sortOrder: lesson.sortOrder });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reorder");
    }
  };

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Learn", href: "/admin/learn" },
    { label: course?.name ?? "Course" },
  ];

  if (!course) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading course…" />
        {err ? (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{err}</Card>
        ) : (
          <Skeleton className="h-64" rounded="rounded-lg" />
        )}
      </AppShell>
    );
  }

  const orderedLessons = [...course.lessons].sort((a, b) => a.sortOrder - b.sortOrder);
  const doneIds = new Set(
    (enrollment?.progress ?? [])
      .filter((p) => p.completedAt != null)
      .map((p) => p.lessonId),
  );
  const passedIds = new Set(
    (enrollment?.progress ?? []).filter((p) => p.quizPassed === true).map((p) => p.lessonId),
  );

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={course.name}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            {course.category && <span className="badge-gray">{course.category}</span>}
            <span className={course.isPublished ? "badge-green" : "badge-gray"}>
              {course.isPublished ? "Published" : "Draft"}
            </span>
            {authoring && <span className="badge-amber">Author mode</span>}
            <span className="text-ink-muted">·</span>
            <span>
              {course._count.lessons} lesson{course._count.lessons === 1 ? "" : "s"}
            </span>
            <span className="text-ink-muted">·</span>
            <span>{course._count.enrollments} enrolled</span>
            {course.estimatedMinutes && (
              <>
                <span className="text-ink-muted">·</span>
                <span>~{course.estimatedMinutes} min</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {!enrollment && (
              <Button
                variant="brand"
                onClick={enroll}
                disabled={busy || !course.isPublished}
                type="button"
              >
                {busy ? "Enrolling…" : course.isPublished ? "Enroll" : "Not published"}
              </Button>
            )}
            {authoring && (
              <Button
                variant="secondary"
                onClick={togglePublish}
                disabled={busy}
                type="button"
              >
                {course.isPublished ? "Unpublish" : "Publish"}
              </Button>
            )}
          </>
        }
      />

      {err && (
        <div className="mb-4">
          <Toast kind="error" message={err} onDismiss={() => setErr(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast kind="success" message={toast} />
        </div>
      )}

      <div className="max-w-5xl space-y-4">
        <Card className="p-0 overflow-hidden">
          <div className={`h-24 ${coverBar[course.coverColor] ?? coverBar.violet}`} />
          <div className="p-6">
            {course.description && (
              <p className="text-sm text-ink whitespace-pre-wrap">{course.description}</p>
            )}
            {enrollment && (
              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-ink-muted mb-1">
                  <span>Your progress</span>
                  <span className="font-mono tabular-nums">
                    {enrollment.progressPercent}%
                  </span>
                </div>
                <div className="h-2 bg-surface-sunken rounded overflow-hidden">
                  <div
                    className={`h-full ${
                      enrollment.completedAt ? "bg-emerald-500" : "bg-brand-500"
                    }`}
                    style={{ width: `${enrollment.progressPercent}%` }}
                  />
                </div>
                {enrollment.completedAt && (
                  <div className="mt-3 text-sm text-emerald-700 font-semibold">
                    ✓ Course completed
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-0">
          <div className="p-4 border-b border-ink-muted/10 flex items-center justify-between">
            <div className="font-semibold text-ink">Lessons</div>
            {authoring && (
              <Button
                variant="brand"
                size="sm"
                onClick={() => setEditingLesson("new")}
                type="button"
              >
                + Add lesson
              </Button>
            )}
          </div>
          {orderedLessons.length === 0 ? (
            <div className="p-10 text-center text-sm text-ink-muted">
              No lessons yet.
              {authoring && " Click + Add lesson to get started."}
            </div>
          ) : (
            <ul className="divide-y divide-ink-muted/10">
              {orderedLessons.map((l, idx) => {
                const isDone = doneIds.has(l.id);
                const passed = passedIds.has(l.id);
                return (
                  <li key={l.id} className="p-3 flex items-center gap-3">
                    <div className="w-6 text-center text-xs font-mono text-ink-muted">
                      {idx + 1}
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] ${
                        isDone
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "border-ink-muted/30 text-transparent"
                      }`}
                    >
                      ✓
                    </div>
                    <Link
                      href={`/admin/learn/${course.id}/lessons/${l.id}${
                        authoring ? "?authoring=1" : ""
                      }`}
                      className="flex-1 hover:underline text-sm text-ink font-medium"
                    >
                      {l.title}
                    </Link>
                    {l.hasQuiz && (
                      <span className={passed ? "badge-green" : "badge-brand"}>
                        {passed ? "Quiz passed" : "Quiz"}
                      </span>
                    )}
                    {l.durationMinutes != null && l.durationMinutes > 0 && (
                      <span className="text-xs text-ink-muted tabular-nums">
                        {l.durationMinutes} min
                      </span>
                    )}
                    {authoring && (
                      <div className="flex items-center gap-1 ms-2 text-xs">
                        <button
                          onClick={() => moveLesson(l, -1)}
                          disabled={idx === 0}
                          className="px-1.5 py-0.5 border border-ink-muted/20 rounded hover:bg-surface-sunken disabled:opacity-30"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveLesson(l, 1)}
                          disabled={idx === orderedLessons.length - 1}
                          className="px-1.5 py-0.5 border border-ink-muted/20 rounded hover:bg-surface-sunken disabled:opacity-30"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => setEditingLesson(l)}
                          className="text-brand-600 hover:underline ms-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteLesson(l)}
                          className="text-red-600 hover:underline ms-1"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {editingLesson && authoring && (
        <LessonEditorDrawer
          courseId={course.id}
          lesson={editingLesson}
          nextSortOrder={
            orderedLessons.length > 0
              ? Math.max(...orderedLessons.map((l) => l.sortOrder)) + 1
              : 1
          }
          onClose={() => setEditingLesson(null)}
          onSaved={async () => {
            setEditingLesson(null);
            await load();
            router.replace(`/admin/learn/${course.id}?authoring=1`);
          }}
        />
      )}
    </AppShell>
  );
}

interface LessonEditDraft {
  title: string;
  durationMinutes: number | null;
  body: Block[];
  hasQuiz: boolean;
  quiz: Quiz;
}

const EMPTY_QUIZ: Quiz = {
  passingScore: 70,
  questions: [],
};

function LessonEditorDrawer({
  courseId,
  lesson,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  courseId: string;
  lesson: LessonRow | "new";
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = lesson === "new";
  const [draft, setDraft] = useState<LessonEditDraft>(() => {
    if (isNew) {
      return {
        title: "",
        durationMinutes: 5,
        body: [{ type: "text", text: "" }],
        hasQuiz: false,
        quiz: { ...EMPTY_QUIZ, questions: [] },
      };
    }
    return {
      title: "",
      durationMinutes: lesson.durationMinutes ?? 5,
      body: [{ type: "text", text: "" }],
      hasQuiz: lesson.hasQuiz,
      quiz: lesson.quiz ?? { ...EMPTY_QUIZ, questions: [] },
    };
  });
  const [loading, setLoading] = useState(!isNew);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const full = await api.get<{
          id: string;
          title: string;
          body: Block[];
          durationMinutes: number | null;
          quiz: Quiz | null;
        }>(`/learn/lessons/${lesson.id}`);
        setDraft({
          title: full.title,
          durationMinutes: full.durationMinutes,
          body: full.body.length > 0 ? full.body : [{ type: "text", text: "" }],
          hasQuiz: full.quiz != null,
          quiz: full.quiz ?? { ...EMPTY_QUIZ, questions: [] },
        });
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load lesson");
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, lesson]);

  const setBlock = (i: number, next: Block) =>
    setDraft((d) => ({ ...d, body: d.body.map((b, idx) => (idx === i ? next : b)) }));
  const insertBlock = (kind: "text" | "checklist" | "divider") => {
    const nb: Block =
      kind === "text"
        ? { type: "text", text: "" }
        : kind === "checklist"
          ? { type: "checklist", text: "", done: false }
          : { type: "divider" };
    setDraft((d) => ({ ...d, body: [...d.body, nb] }));
  };
  const deleteBlock = (i: number) =>
    setDraft((d) => ({ ...d, body: d.body.filter((_, idx) => idx !== i) }));

  const addQuestion = () =>
    setDraft((d) => ({
      ...d,
      quiz: {
        ...d.quiz,
        questions: [
          ...d.quiz.questions,
          { q: "", options: ["", ""], correctIndex: 0, explanation: "" },
        ],
      },
    }));
  const removeQuestion = (i: number) =>
    setDraft((d) => ({
      ...d,
      quiz: { ...d.quiz, questions: d.quiz.questions.filter((_, idx) => idx !== i) },
    }));
  const patchQuestion = (i: number, patch: Partial<QuizQuestion>) =>
    setDraft((d) => ({
      ...d,
      quiz: {
        ...d.quiz,
        questions: d.quiz.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)),
      },
    }));
  const addOption = (qIdx: number) =>
    setDraft((d) => ({
      ...d,
      quiz: {
        ...d.quiz,
        questions: d.quiz.questions.map((q, idx) =>
          idx === qIdx && q.options.length < 6 ? { ...q, options: [...q.options, ""] } : q,
        ),
      },
    }));
  const removeOption = (qIdx: number, oIdx: number) =>
    setDraft((d) => ({
      ...d,
      quiz: {
        ...d.quiz,
        questions: d.quiz.questions.map((q, idx) => {
          if (idx !== qIdx) return q;
          if (q.options.length <= 2) return q;
          const nextOpts = q.options.filter((_, o) => o !== oIdx);
          let nextCorrect = q.correctIndex;
          if (oIdx === q.correctIndex) nextCorrect = 0;
          else if (oIdx < q.correctIndex) nextCorrect = q.correctIndex - 1;
          return { ...q, options: nextOpts, correctIndex: nextCorrect };
        }),
      },
    }));
  const setOption = (qIdx: number, oIdx: number, value: string) =>
    setDraft((d) => ({
      ...d,
      quiz: {
        ...d.quiz,
        questions: d.quiz.questions.map((q, idx) =>
          idx === qIdx
            ? { ...q, options: q.options.map((o, i) => (i === oIdx ? value : o)) }
            : q,
        ),
      },
    }));

  const save = async () => {
    if (!draft.title.trim()) {
      setErr("Title is required");
      return;
    }
    if (draft.hasQuiz) {
      if (draft.quiz.questions.length === 0) {
        setErr("Add at least one question or turn quiz off");
        return;
      }
      for (const q of draft.quiz.questions) {
        if (!q.q.trim()) {
          setErr("Every question needs text");
          return;
        }
        if (q.options.some((o) => !o.trim())) {
          setErr("Every option needs text");
          return;
        }
        if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
          setErr("Pick a valid correct answer for every question");
          return;
        }
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const quizPayload = draft.hasQuiz
        ? {
            passingScore: Math.max(0, Math.min(100, draft.quiz.passingScore)),
            questions: draft.quiz.questions.map((q) => ({
              q: q.q.trim(),
              options: q.options.map((o) => o.trim()),
              correctIndex: q.correctIndex,
              explanation: q.explanation?.trim() || undefined,
            })),
          }
        : null;
      const body = draft.body;
      if (isNew) {
        await api.post(`/learn/courses/${courseId}/lessons`, {
          title: draft.title.trim(),
          body,
          quiz: quizPayload ?? undefined,
          sortOrder: nextSortOrder,
          durationMinutes: draft.durationMinutes ?? undefined,
        });
      } else {
        await api.put(`/learn/lessons/${lesson.id}`, {
          title: draft.title.trim(),
          body,
          quiz: quizPayload,
          durationMinutes: draft.durationMinutes ?? undefined,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? "New lesson" : "Edit lesson"}
      width="w-[640px]"
      footer={
        <>
          {err && <span className="text-red-600 text-xs me-auto">{err}</span>}
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={save}
            disabled={busy || loading}
            type="button"
          >
            {busy ? "Saving…" : "Save lesson"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="text-ink-muted text-sm">Loading lesson…</div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label block">Title</label>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label block">Duration (min)</label>
              <input
                type="number"
                min={0}
                value={draft.durationMinutes ?? 0}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    durationMinutes: Number(e.target.value) || 0,
                  })
                }
                className="input"
              />
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2 font-semibold">
              Body
            </div>
            <div className="space-y-2">
              {draft.body.map((b, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1">
                    {b.type === "text" && (
                      <textarea
                        value={b.text}
                        onChange={(e) =>
                          setBlock(i, { type: "text", text: e.target.value })
                        }
                        className="input"
                        rows={3}
                        placeholder="Lesson text…"
                      />
                    )}
                    {b.type === "checklist" && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={b.done}
                          onChange={(e) =>
                            setBlock(i, {
                              type: "checklist",
                              text: b.text,
                              done: e.target.checked,
                            })
                          }
                        />
                        <input
                          value={b.text}
                          onChange={(e) =>
                            setBlock(i, {
                              type: "checklist",
                              text: e.target.value,
                              done: b.done,
                            })
                          }
                          className={`input flex-1 ${
                            b.done ? "line-through text-ink-muted" : ""
                          }`}
                          placeholder="Checklist item"
                        />
                      </div>
                    )}
                    {b.type === "divider" && <hr className="border-ink-muted/30" />}
                  </div>
                  <button
                    onClick={() => deleteBlock(i)}
                    className="text-red-500 text-xs hover:underline"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => insertBlock("text")}
                  className="border border-ink-muted/20 rounded px-2 py-0.5 hover:bg-surface-sunken"
                >
                  + Text
                </button>
                <button
                  type="button"
                  onClick={() => insertBlock("checklist")}
                  className="border border-ink-muted/20 rounded px-2 py-0.5 hover:bg-surface-sunken"
                >
                  + Checklist
                </button>
                <button
                  type="button"
                  onClick={() => insertBlock("divider")}
                  className="border border-ink-muted/20 rounded px-2 py-0.5 hover:bg-surface-sunken"
                >
                  + Divider
                </button>
              </div>
            </div>
          </div>

          <div className="border border-ink-muted/10 rounded p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input
                type="checkbox"
                checked={draft.hasQuiz}
                onChange={(e) => setDraft({ ...draft, hasQuiz: e.target.checked })}
              />
              Include a quiz
            </label>
            {draft.hasQuiz && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <label className="text-ink-muted">Passing score</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.quiz.passingScore}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        quiz: {
                          ...d.quiz,
                          passingScore: Number(e.target.value) || 0,
                        },
                      }))
                    }
                    className="input w-20"
                  />
                  <span>%</span>
                </div>
                {draft.quiz.questions.map((q, qIdx) => (
                  <div
                    key={qIdx}
                    className="border border-ink-muted/10 rounded p-3 space-y-2 bg-surface-sunken"
                  >
                    <div className="flex items-start gap-2">
                      <div className="text-xs font-mono text-ink-muted pt-2">
                        Q{qIdx + 1}
                      </div>
                      <textarea
                        value={q.q}
                        onChange={(e) => patchQuestion(qIdx, { q: e.target.value })}
                        className="input flex-1"
                        rows={2}
                        placeholder="Question"
                      />
                      <button
                        type="button"
                        onClick={() => removeQuestion(qIdx)}
                        className="text-red-500 text-xs hover:underline"
                      >
                        ×
                      </button>
                    </div>
                    <div className="space-y-1 ps-6">
                      {q.options.map((o, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`correct-${qIdx}`}
                            checked={q.correctIndex === oIdx}
                            onChange={() => patchQuestion(qIdx, { correctIndex: oIdx })}
                            title="Correct answer"
                          />
                          <input
                            value={o}
                            onChange={(e) => setOption(qIdx, oIdx, e.target.value)}
                            className="input flex-1"
                            placeholder={`Option ${oIdx + 1}`}
                          />
                          {q.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeOption(qIdx, oIdx)}
                              className="text-red-500 text-xs hover:underline"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      {q.options.length < 6 && (
                        <button
                          type="button"
                          onClick={() => addOption(qIdx)}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          + Option
                        </button>
                      )}
                      <input
                        value={q.explanation ?? ""}
                        onChange={(e) =>
                          patchQuestion(qIdx, { explanation: e.target.value })
                        }
                        className="input w-full mt-2"
                        placeholder="Explanation (shown after submit, optional)"
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addQuestion}
                  className="text-xs text-brand-600 hover:underline"
                >
                  + Add question
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function CourseDetailPage() {
  return (
    <Suspense fallback={null}>
      <InnerCourseDetailPage />
    </Suspense>
  );
}
