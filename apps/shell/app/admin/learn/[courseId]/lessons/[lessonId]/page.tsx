"use client";

// Lesson viewer. Renders the block-based body (text / checklist / divider),
// then either a Mark-complete button (text-only lessons) or a quiz form
// with radio options + submit + per-question review.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../../lib/api";
import { AppShell } from "../../../../../../components/app-shell";
import { SHELL_NAV } from "../../../../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  Toast,
} from "../../../../../../components/ui";

type Block =
  | { type: "text"; text: string }
  | { type: "checklist"; text: string; done: boolean }
  | { type: "divider" };

interface QuizQuestion {
  q: string;
  options: string[];
  correctIndex?: number;
  explanation?: string;
}
interface Quiz {
  passingScore: number;
  questions: QuizQuestion[];
}

interface LessonFull {
  id: string;
  title: string;
  body: Block[];
  quiz: Quiz | null;
  durationMinutes: number | null;
  course: {
    id: string;
    name: string;
    ownerUserId: string;
    isPublished: boolean;
  };
}

interface EnrollmentSummary {
  id: string;
  courseId: string;
  progressPercent: number;
  completedAt: string | null;
  currentLessonId: string | null;
  progress: { lessonId: string; completedAt: string | null; quizPassed: boolean | null }[];
}

interface CourseLessonRow {
  id: string;
  title: string;
  sortOrder: number;
}
interface CourseWithLessons {
  id: string;
  lessons: CourseLessonRow[];
}

interface QuizDetail {
  question: string;
  correctIndex: number;
  submittedIndex: number;
  correct: boolean;
  explanation?: string;
}
interface QuizResult {
  score: number;
  passed: boolean;
  passingScore: number;
  correctCount: number;
  total: number;
  details: QuizDetail[];
  enrollment: EnrollmentSummary;
}

export default function LessonViewerPage() {
  const params = useParams<{ courseId: string; lessonId: string }>();
  const router = useRouter();

  const [lesson, setLesson] = useState<LessonFull | null>(null);
  const [course, setCourse] = useState<CourseWithLessons | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, c, enrolls] = await Promise.all([
        api.get<LessonFull>(`/learn/lessons/${params.lessonId}`),
        api.get<CourseWithLessons>(`/learn/courses/${params.courseId}`),
        api.get<EnrollmentSummary[]>("/learn/enrollments"),
      ]);
      setLesson(l);
      setCourse(c);
      setEnrollment(enrolls.find((e) => e.courseId === params.courseId) ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load lesson");
    }
  }, [params.courseId, params.lessonId]);

  useEffect(() => {
    void load();
    setAnswers({});
    setResult(null);
  }, [load]);

  const orderedLessons = useMemo(
    () => (course ? [...course.lessons].sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [course],
  );
  const currentIdx = orderedLessons.findIndex((l) => l.id === params.lessonId);
  const nextLesson = currentIdx >= 0 ? orderedLessons[currentIdx + 1] : undefined;

  const myProgressRow = enrollment?.progress.find((p) => p.lessonId === params.lessonId);
  const alreadyCompleted = myProgressRow?.completedAt != null;
  const alreadyPassed = myProgressRow?.quizPassed === true;

  const markComplete = async () => {
    if (!lesson) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/learn/lessons/${lesson.id}/complete`, {});
      if (nextLesson) {
        router.push(`/admin/learn/${params.courseId}/lessons/${nextLesson.id}`);
      } else {
        router.push(`/admin/learn/${params.courseId}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const submitQuiz = async () => {
    if (!lesson?.quiz) return;
    const total = lesson.quiz.questions.length;
    const list: number[] = [];
    for (let i = 0; i < total; i++) {
      const a = answers[i];
      if (a === undefined) return;
      list.push(a);
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<QuizResult>(`/learn/lessons/${lesson.id}/quiz-submit`, {
        answers: list,
      });
      setResult(r);
      setEnrollment(r.enrollment);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to submit quiz");
    } finally {
      setBusy(false);
    }
  };

  const resetQuiz = () => {
    setAnswers({});
    setResult(null);
  };

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Learn", href: "/admin/learn" },
    ...(lesson
      ? [
          { label: lesson.course.name, href: `/admin/learn/${params.courseId}` },
          { label: lesson.title },
        ]
      : [{ label: "Lesson" }]),
  ];

  if (!lesson) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading lesson…" />
        {err ? (
          <Card className="p-4 text-red-700 border-red-200 bg-red-50">{err}</Card>
        ) : (
          <Skeleton className="h-96" rounded="rounded-lg" />
        )}
      </AppShell>
    );
  }

  const total = lesson.quiz?.questions.length ?? 0;
  const allAnswered = total > 0 && Object.keys(answers).length === total;

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={lesson.title}
        subtitle={
          orderedLessons.length > 0 && currentIdx >= 0
            ? `Lesson ${currentIdx + 1} of ${orderedLessons.length} · ${lesson.course.name}`
            : lesson.course.name
        }
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {err && (
        <div className="mb-4">
          <Toast kind="error" message={err} onDismiss={() => setErr(null)} />
        </div>
      )}

      <div className="max-w-3xl">
        <Card className="p-6">
          <div className="space-y-3 mb-6">
            {lesson.body.map((b, i) => {
              if (b.type === "text") {
                return (
                  <div key={i} className="whitespace-pre-wrap text-sm text-ink">
                    {b.text}
                  </div>
                );
              }
              if (b.type === "checklist") {
                return (
                  <label key={i} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={b.done} readOnly className="mt-1" />
                    <span className={b.done ? "line-through text-ink-muted" : "text-ink"}>
                      {b.text}
                    </span>
                  </label>
                );
              }
              return <hr key={i} className="border-ink-muted/20" />;
            })}
          </div>

          {!lesson.quiz ? (
            <div className="pt-4 border-t border-ink-muted/10">
              {alreadyCompleted ? (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-emerald-700 font-semibold">
                    ✓ You've completed this lesson
                  </div>
                  {nextLesson ? (
                    <a href={`/admin/learn/${params.courseId}/lessons/${nextLesson.id}`}>
                      <Button variant="brand" type="button">
                        Next lesson →
                      </Button>
                    </a>
                  ) : (
                    <a href={`/admin/learn/${params.courseId}`}>
                      <Button variant="secondary" type="button">
                        Back to course
                      </Button>
                    </a>
                  )}
                </div>
              ) : (
                <Button variant="brand" onClick={markComplete} disabled={busy} type="button">
                  {busy ? "Saving…" : "Mark as complete →"}
                </Button>
              )}
            </div>
          ) : (
            <div className="pt-4 border-t border-ink-muted/10">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-ink">Quiz</h2>
                <div className="text-xs text-ink-muted">
                  Passing score: {lesson.quiz.passingScore}%
                </div>
              </div>

              {result ? (
                <QuizResultPanel
                  result={result}
                  nextHref={
                    nextLesson
                      ? `/admin/learn/${params.courseId}/lessons/${nextLesson.id}`
                      : `/admin/learn/${params.courseId}`
                  }
                  onRetry={resetQuiz}
                />
              ) : (
                <div className="space-y-4">
                  {alreadyPassed && (
                    <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-2 rounded text-sm">
                      You've already passed this quiz. Retaking will overwrite your score.
                    </div>
                  )}
                  {lesson.quiz.questions.map((q, qIdx) => (
                    <div key={qIdx} className="border border-ink-muted/10 rounded p-3">
                      <div className="text-sm font-medium text-ink mb-2">
                        <span className="font-mono text-xs text-ink-muted me-2">
                          Q{qIdx + 1}
                        </span>
                        {q.q}
                      </div>
                      <div className="space-y-1.5">
                        {q.options.map((o, oIdx) => (
                          <label
                            key={oIdx}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-surface-sunken rounded px-2 py-1"
                          >
                            <input
                              type="radio"
                              name={`q-${qIdx}`}
                              checked={answers[qIdx] === oIdx}
                              onChange={() =>
                                setAnswers((a) => ({ ...a, [qIdx]: oIdx }))
                              }
                            />
                            <span className="text-ink">{o}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2">
                    <div className="text-xs text-ink-muted">
                      {Object.keys(answers).length} / {total} answered
                    </div>
                    <Button
                      variant="brand"
                      onClick={submitQuiz}
                      disabled={busy || !allAnswered}
                      type="button"
                    >
                      {busy ? "Submitting…" : "Submit quiz"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function QuizResultPanel({
  result,
  nextHref,
  onRetry,
}: {
  result: QuizResult;
  nextHref: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <div
        className={`rounded p-4 border ${
          result.passed
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}
      >
        <div className="text-lg font-semibold">
          {result.passed ? "Passed!" : "Not quite — try again"}
        </div>
        <div className="text-sm mt-1">
          Score {result.score}% ({result.correctCount} of {result.total}) · Passing{" "}
          {result.passingScore}%
        </div>
      </div>

      <div className="space-y-2">
        {result.details.map((d, i) => (
          <div
            key={i}
            className={`border rounded p-3 text-sm ${
              d.correct ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"
            }`}
          >
            <div className="flex items-start gap-2">
              <span
                className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white ${
                  d.correct ? "bg-emerald-500" : "bg-red-500"
                }`}
              >
                {d.correct ? "✓" : "✗"}
              </span>
              <div className="flex-1">
                <div className="font-medium text-ink">{d.question}</div>
                {!d.correct && (
                  <div className="text-xs text-ink-soft mt-1">
                    Correct answer index: {d.correctIndex}
                    {" · "}Your answer: {d.submittedIndex}
                  </div>
                )}
                {d.explanation && (
                  <div className="text-xs text-ink-soft mt-1 italic">{d.explanation}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        {result.passed ? (
          <a href={nextHref}>
            <Button variant="brand" type="button">
              Continue →
            </Button>
          </a>
        ) : (
          <Button variant="brand" onClick={onRetry} type="button">
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
