"use client";

// Zoho-Learn-style LMS UI. One page with tabbed views: Catalog (published
// courses), My Learning (my enrollments + progress), Certificates (earned),
// and Authoring (courses I own with CRUD). Tab state lives in the URL via
// ?tab=… so links, refresh, and back button all work.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { loadSession } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

type CoverColor = "violet" | "blue" | "green" | "amber" | "rose" | "slate";

const COVER_COLORS: CoverColor[] = ["violet", "blue", "green", "amber", "rose", "slate"];

const coverSwatch: Record<string, string> = {
  violet: "bg-brand-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
};

const coverBar: Record<string, string> = {
  violet: "bg-gradient-to-br from-brand-400 to-brand-700",
  blue: "bg-gradient-to-br from-blue-400 to-blue-700",
  green: "bg-gradient-to-br from-emerald-400 to-emerald-700",
  amber: "bg-gradient-to-br from-amber-400 to-amber-700",
  rose: "bg-gradient-to-br from-rose-400 to-rose-700",
  slate: "bg-gradient-to-br from-slate-400 to-slate-700",
};

interface LessonSummary {
  id: string;
  title: string;
  sortOrder: number;
  durationMinutes: number | null;
  hasQuiz: boolean;
}

interface ProgressRow {
  lessonId: string;
  completedAt: string | null;
  quizPassed: boolean | null;
}

interface EnrollmentSummary {
  id: string;
  progressPercent: number;
  completedAt: string | null;
  currentLessonId: string | null;
}

interface CourseListItem {
  id: string;
  name: string;
  description: string | null;
  coverColor: string;
  category: string | null;
  estimatedMinutes: number | null;
  isPublished: boolean;
  ownerUserId: string;
  _count: { lessons: number; enrollments: number };
  enrollments?: EnrollmentSummary[];
  lessons?: LessonSummary[];
}

interface EnrollmentDetail {
  id: string;
  courseId: string;
  progressPercent: number;
  completedAt: string | null;
  currentLessonId: string | null;
  course: CourseListItem & { lessons?: LessonSummary[] };
  progress: ProgressRow[];
}

interface CertificateListItem {
  id: string;
  certificateNumber: string;
  issuedAt: string;
  course: {
    id: string;
    name: string;
    coverColor: string;
    estimatedMinutes: number | null;
  };
}

type Tab = "catalog" | "learning" | "certs" | "authoring";

function isTab(v: string | null): v is Tab {
  return v === "catalog" || v === "learning" || v === "certs" || v === "authoring";
}

function fmtDuration(mins: number | null | undefined): string {
  if (!mins || mins <= 0) return "";
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

function InnerLearnPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "catalog";

  const [catalog, setCatalog] = useState<CourseListItem[]>([]);
  const [myEnrollments, setMyEnrollments] = useState<EnrollmentDetail[]>([]);
  const [myCerts, setMyCerts] = useState<CertificateListItem[]>([]);
  const [myCourses, setMyCourses] = useState<CourseListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [loading, setLoading] = useState(false);

  const session = useMemo(() => loadSession(), []);
  const userId = session?.user.id;

  const setTab = useCallback(
    (next: Tab) => {
      const p = new URLSearchParams(params.toString());
      p.set("tab", next);
      router.replace(`/admin/learn?${p.toString()}`);
    },
    [router, params],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [pub, mine, enrolls, certs] = await Promise.all([
        api.get<CourseListItem[]>("/learn/courses?published=true"),
        api.get<CourseListItem[]>("/learn/courses?mine=true"),
        api.get<EnrollmentDetail[]>("/learn/enrollments"),
        api.get<CertificateListItem[]>("/learn/certificates"),
      ]);
      setCatalog(pub);
      setMyCourses(mine);
      setMyEnrollments(enrolls);
      setMyCerts(certs);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const deleteCourse = async (id: string, name: string) => {
    if (!window.confirm(`Delete course "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/learn/courses/${id}`);
      say("Course deleted");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Learn" }]}
        title="Courses & training"
        subtitle="Catalog, my learning, certificates, and course authoring."
        actions={
          tab === "authoring" ? (
            <Button variant="brand" onClick={() => setShowNewCourse(true)} type="button">
              + New course
            </Button>
          ) : undefined
        }
      />

      {err && (
        <div className="mb-3">
          <Toast kind="error" message={err} onDismiss={() => setErr(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-3">
          <Toast kind="success" message={toast} />
        </div>
      )}

      <div className="border-b flex items-center gap-1 mb-4">
        {(
          [
            ["catalog", `Catalog (${catalog.length})`],
            ["learning", `My learning (${myEnrollments.length})`],
            ["certs", `Certificates (${myCerts.length})`],
            ["authoring", `Authoring (${myCourses.length})`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === id
                ? "border-brand-600 text-brand-700 font-semibold"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500 py-4">Loading…</div>}

      {tab === "catalog" && (
        <CatalogGrid courses={catalog} currentUserId={userId} />
      )}

      {tab === "learning" && (
        <MyLearningGrid enrollments={myEnrollments} />
      )}

      {tab === "certs" && <CertificatesGrid certs={myCerts} />}

      {tab === "authoring" && (
        <AuthoringGrid
          courses={myCourses}
          onDelete={deleteCourse}
        />
      )}

      {showNewCourse && (
        <NewCourseDrawer
          onClose={() => setShowNewCourse(false)}
          onCreated={(id) => {
            setShowNewCourse(false);
            router.push(`/admin/learn/${id}?authoring=1`);
          }}
        />
      )}
    </AppShell>
  );
}

function CatalogGrid({
  courses,
  currentUserId,
}: {
  courses: CourseListItem[];
  currentUserId: string | undefined;
}) {
  if (courses.length === 0) {
    return (
      <div className="bg-white rounded shadow p-10 text-center text-sm text-gray-500">
        No published courses yet.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {courses.map((c) => (
        <Link
          key={c.id}
          href={`/admin/learn/${c.id}`}
          className="bg-white rounded shadow border hover:border-brand-300 hover:shadow-md transition flex flex-col overflow-hidden"
        >
          <div className={`h-20 ${coverBar[c.coverColor] ?? coverBar.violet}`} />
          <div className="p-4 flex flex-col gap-2 flex-1">
            <div className="flex items-start gap-2">
              <div className="font-semibold text-base flex-1 leading-snug">{c.name}</div>
              {currentUserId && c.ownerUserId === currentUserId && (
                <span className="text-[10px] bg-brand-50 text-brand-700 border border-brand-200 px-1.5 py-0.5 rounded uppercase tracking-wide">
                  Owner
                </span>
              )}
            </div>
            {c.category && (
              <div>
                <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded uppercase tracking-wide">
                  {c.category}
                </span>
              </div>
            )}
            {c.description && (
              <p className="text-xs text-gray-600 line-clamp-3">{c.description}</p>
            )}
            <div className="mt-auto flex items-center gap-3 text-[11px] text-gray-500 pt-2 border-t">
              <span>{c._count.lessons} lesson{c._count.lessons === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{c._count.enrollments} enrolled</span>
              {c.estimatedMinutes && (
                <>
                  <span>·</span>
                  <span>{fmtDuration(c.estimatedMinutes)}</span>
                </>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function MyLearningGrid({ enrollments }: { enrollments: EnrollmentDetail[] }) {
  if (enrollments.length === 0) {
    return (
      <div className="bg-white rounded shadow p-10 text-center text-sm text-gray-500">
        You are not enrolled in any courses yet. Browse the <b>Catalog</b> to start learning.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {enrollments.map((e) => {
        const currentLesson =
          e.currentLessonId && e.course.lessons
            ? e.course.lessons.find((l) => l.id === e.currentLessonId)
            : undefined;
        const isDone = e.completedAt != null;
        return (
          <div
            key={e.id}
            className="bg-white rounded shadow border overflow-hidden flex flex-col"
          >
            <div className={`h-16 ${coverBar[e.course.coverColor] ?? coverBar.violet}`} />
            <div className="p-4 flex-1 flex flex-col gap-2">
              <div className="font-semibold text-base leading-snug">{e.course.name}</div>
              {e.course.category && (
                <div>
                  <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded uppercase tracking-wide">
                    {e.course.category}
                  </span>
                </div>
              )}
              <div className="mt-1">
                <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                  <span>Progress</span>
                  <span className="font-mono">{e.progressPercent}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full ${isDone ? "bg-emerald-500" : "bg-brand-500"}`}
                    style={{ width: `${e.progressPercent}%` }}
                  />
                </div>
              </div>
              {!isDone && currentLesson && (
                <div className="text-xs text-gray-600">
                  Next: <span className="font-medium">{currentLesson.title}</span>
                </div>
              )}
              <div className="mt-auto pt-3 border-t">
                {isDone ? (
                  <div className="text-sm text-emerald-700 font-semibold">✓ Completed</div>
                ) : currentLesson ? (
                  <Link
                    href={`/admin/learn/${e.courseId}/lessons/${currentLesson.id}`}
                    className="text-sm text-brand-600 font-semibold hover:underline"
                  >
                    Continue →
                  </Link>
                ) : (
                  <Link
                    href={`/admin/learn/${e.courseId}`}
                    className="text-sm text-brand-600 font-semibold hover:underline"
                  >
                    Open course →
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CertificatesGrid({ certs }: { certs: CertificateListItem[] }) {
  if (certs.length === 0) {
    return (
      <div className="bg-white rounded shadow p-10 text-center text-sm text-gray-500">
        Complete a course to earn your first certificate.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {certs.map((c) => (
        <div
          key={c.id}
          className="bg-white rounded shadow border overflow-hidden flex flex-col"
        >
          <div className={`h-3 ${coverBar[c.course.coverColor] ?? coverBar.violet}`} />
          <div className="p-4 flex-1 flex flex-col gap-2">
            <div className="text-[10px] uppercase text-emerald-700 font-semibold tracking-wide">
              Certificate of completion
            </div>
            <div className="font-semibold text-base leading-snug">{c.course.name}</div>
            <div className="text-xs text-gray-500">
              Issued {new Date(c.issuedAt).toLocaleDateString()}
            </div>
            <div className="text-[11px] text-gray-500 font-mono break-all">
              {c.certificateNumber}
            </div>
            <div className="mt-auto pt-2">
              <Link
                href={`/admin/learn/certificates/${c.id}`}
                className="inline-block bg-brand-600 text-white text-sm px-3 py-1.5 rounded hover:bg-brand-700"
              >
                View
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuthoringGrid({
  courses,
  onDelete,
}: {
  courses: CourseListItem[];
  onDelete: (id: string, name: string) => void;
}) {
  if (courses.length === 0) {
    return (
      <div className="bg-white rounded shadow p-10 text-center text-sm text-gray-500">
        You haven’t authored any courses yet. Click <b>+ New course</b> to get started.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {courses.map((c) => (
        <div
          key={c.id}
          className="bg-white rounded shadow border overflow-hidden flex flex-col"
        >
          <div className={`h-16 ${coverBar[c.coverColor] ?? coverBar.violet}`} />
          <div className="p-4 flex-1 flex flex-col gap-2">
            <div className="flex items-start gap-2">
              <div className="font-semibold text-base flex-1 leading-snug">{c.name}</div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
                  c.isPublished
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-gray-100 text-gray-600 border border-gray-200"
                }`}
              >
                {c.isPublished ? "Published" : "Draft"}
              </span>
            </div>
            {c.category && (
              <div>
                <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded uppercase tracking-wide">
                  {c.category}
                </span>
              </div>
            )}
            {c.description && (
              <p className="text-xs text-gray-600 line-clamp-2">{c.description}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-gray-500 pt-2 border-t">
              <span>{c._count.lessons} lesson{c._count.lessons === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{c._count.enrollments} enrolled</span>
            </div>
            <div className="mt-auto pt-2 flex gap-2 text-sm">
              <Link
                href={`/admin/learn/${c.id}?authoring=1`}
                className="text-brand-600 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => onDelete(c.id, c.name)}
                className="text-red-600 hover:underline ms-auto"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function NewCourseDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [coverColor, setCoverColor] = useState<CoverColor>("violet");
  const [isPublished, setIsPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await api.post<{ id: string }>("/learn/courses", {
        name: name.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        coverColor,
        isPublished,
      });
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">New course</div>
          <button onClick={onClose} className="text-xl text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm"
              placeholder="e.g. Onboarding for Sales"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm"
              rows={4}
              placeholder="What will learners get out of it?"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-sm"
              placeholder="e.g. Product, Compliance"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Cover color</label>
            <div className="flex gap-2">
              {COVER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCoverColor(c)}
                  className={`w-8 h-8 rounded-full ${coverSwatch[c]} ${
                    coverColor === c ? "ring-2 ring-offset-2 ring-brand-600" : ""
                  }`}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />
            Publish immediately
          </label>
        </div>
        <div className="p-4 border-t flex items-center justify-end gap-2">
          {err && <span className="text-red-600 text-xs me-auto">{err}</span>}
          <button
            onClick={onClose}
            className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="bg-brand-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Create course"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LearnPage() {
  return (
    <Suspense fallback={null}>
      <InnerLearnPage />
    </Suspense>
  );
}
