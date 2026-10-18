import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// Zoho-Learn-style LMS. Two personas share the same endpoints:
//   1. Author  — creates courses, adds lessons w/ optional quizzes, publishes.
//   2. Learner — browses the published catalog, enrolls, marks lessons
//      complete, submits quiz answers, earns a Certificate once every
//      quiz-bearing lesson has been passed.
// Progress % is derived from lesson-completion count. Quiz answers are
// graded server-side; the correct index never leaves the server for the
// learner-facing lesson fetch.

export const learnRouter = Router();
learnRouter.use(requireAuth);

const coursePerms  = perms("LearnCourse");
const lessonPerms  = perms("LearnLesson");
const enrollPerms  = perms("LearnEnrollment");

/* ─────────────────────────────── COURSES ──────────────────────────────── */

const courseUpsert = z.object({
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  coverColor: z.enum(["violet", "blue", "green", "amber", "rose", "slate"]).optional(),
  category: z.string().max(80).nullable().optional(),
  isPublished: z.boolean().optional(),
});

// List courses — operators see everything; learners see only published.
// `?mine=true` filters to just courses I've enrolled in (learner "My learning").
learnRouter.get("/courses", coursePerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const mine = req.query.mine === "true";
  const isPublished =
    req.query.published === "false"
      ? false
      : req.query.published === "true"
        ? true
        : undefined;

  const where: Prisma.LearnCourseWhereInput = { tenantId };
  if (isPublished !== undefined) where.isPublished = isPublished;
  if (mine) {
    where.enrollments = { some: { userId } };
  }

  const rows = await prisma.learnCourse.findMany({
    where,
    include: {
      _count: { select: { lessons: true, enrollments: true } },
      enrollments: mine
        ? {
            where: { userId },
            select: {
              id: true,
              progressPercent: true,
              completedAt: true,
              currentLessonId: true,
            },
            take: 1,
          }
        : false,
    },
    orderBy: [{ isPublished: "desc" }, { updatedAt: "desc" }],
  });
  res.json(rows);
});

learnRouter.get("/courses/:id", coursePerms.read, async (req, res) => {
  const row = await prisma.learnCourse.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      lessons: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          title: true,
          sortOrder: true,
          durationMinutes: true,
          quiz: true, // presence flag only — we mask correct answers below
        },
      },
      _count: { select: { enrollments: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  // Learners must not see correct indexes — expose only `hasQuiz`.
  const isOwner = row.ownerUserId === req.auth!.userId;
  const lessons = row.lessons.map((l) => ({
    ...l,
    hasQuiz: !!l.quiz,
    quiz: isOwner ? l.quiz : undefined,
  }));
  res.json({ ...row, lessons });
});

learnRouter.post("/courses", coursePerms.create, async (req, res) => {
  const parsed = courseUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.learnCourse.create({
    data: {
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      coverColor: parsed.data.coverColor ?? "violet",
      category: parsed.data.category ?? null,
      isPublished: parsed.data.isPublished ?? false,
    },
  });
  res.status(201).json(row);
});

learnRouter.put("/courses/:id", coursePerms.write, async (req, res) => {
  const parsed = courseUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.learnCourse.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.learnCourse.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

learnRouter.delete("/courses/:id", coursePerms.delete, async (req, res) => {
  const existing = await prisma.learnCourse.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      ownerUserId: req.auth!.userId,
    },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.enrollments > 0)
    return res.status(400).json({ error: "Course has enrollments" });
  await prisma.learnCourse.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ─────────────────────────────── LESSONS ──────────────────────────────── */

const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("checklist"), text: z.string(), done: z.boolean() }),
  z.object({ type: z.literal("divider") }),
]);

const quizSchema = z
  .object({
    passingScore: z.coerce.number().int().min(0).max(100).default(70),
    questions: z
      .array(
        z.object({
          q: z.string().min(1),
          options: z.array(z.string().min(1)).min(2).max(6),
          correctIndex: z.coerce.number().int().min(0),
          explanation: z.string().max(500).optional(),
        }),
      )
      .min(1),
  })
  .nullable();

const lessonUpsert = z.object({
  title: z.string().min(1).max(160),
  body: z.array(blockSchema).default([]),
  quiz: quizSchema.optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(600).default(5),
});

async function assertOwnedCourse(id: string, tenantId: string, userId: string) {
  const c = await prisma.learnCourse.findFirst({
    where: { id, tenantId, ownerUserId: userId },
  });
  if (!c) throw new Error("Course not found or not yours");
  return c;
}

async function recalcCourseDuration(courseId: string) {
  const agg = await prisma.learnLesson.aggregate({
    where: { courseId },
    _sum: { durationMinutes: true },
  });
  await prisma.learnCourse.update({
    where: { id: courseId },
    data: { estimatedMinutes: agg._sum.durationMinutes ?? 0 },
  });
}

learnRouter.post("/courses/:courseId/lessons", lessonPerms.create, async (req, res) => {
  const parsed = lessonUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    await assertOwnedCourse(req.params.courseId, req.auth!.tenantId, req.auth!.userId);
  } catch (e) {
    return res.status(404).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  // Auto sort — if unspecified, put at the end.
  let sortOrder = parsed.data.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.learnLesson.findFirst({
      where: { courseId: req.params.courseId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }
  const row = await prisma.learnLesson.create({
    data: {
      courseId: req.params.courseId,
      title: parsed.data.title,
      body: parsed.data.body as unknown as Prisma.InputJsonValue,
      quiz: (parsed.data.quiz ?? null) as unknown as Prisma.InputJsonValue,
      sortOrder,
      durationMinutes: parsed.data.durationMinutes,
    },
  });
  await recalcCourseDuration(req.params.courseId);
  res.status(201).json(row);
});

// Lesson content for the learner. Correct quiz indexes are stripped so the
// answer never leaves the server via this endpoint.
learnRouter.get("/lessons/:id", lessonPerms.read, async (req, res) => {
  const row = await prisma.learnLesson.findFirst({
    where: {
      id: req.params.id,
      course: { tenantId: req.auth!.tenantId },
    },
    include: {
      course: { select: { id: true, name: true, ownerUserId: true, isPublished: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const isOwner = row.course.ownerUserId === req.auth!.userId;
  const quiz = row.quiz as null | {
    passingScore: number;
    questions: { q: string; options: string[]; correctIndex: number; explanation?: string }[];
  };
  const publicQuiz = quiz
    ? {
        passingScore: quiz.passingScore,
        questions: quiz.questions.map((q) =>
          isOwner
            ? q
            : { q: q.q, options: q.options }, // strip correctIndex + explanation
        ),
      }
    : null;
  res.json({ ...row, quiz: publicQuiz });
});

learnRouter.put("/lessons/:id", lessonPerms.write, async (req, res) => {
  const parsed = lessonUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.learnLesson.findFirst({
    where: {
      id: req.params.id,
      course: { tenantId: req.auth!.tenantId, ownerUserId: req.auth!.userId },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Prisma.LearnLessonUpdateInput = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.body !== undefined)
    data.body = parsed.data.body as unknown as Prisma.InputJsonValue;
  if (parsed.data.quiz !== undefined)
    data.quiz = (parsed.data.quiz ?? null) as unknown as Prisma.InputJsonValue;
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder;
  if (parsed.data.durationMinutes !== undefined)
    data.durationMinutes = parsed.data.durationMinutes;
  const row = await prisma.learnLesson.update({ where: { id: existing.id }, data });
  if (parsed.data.durationMinutes !== undefined) {
    await recalcCourseDuration(existing.courseId);
  }
  res.json(row);
});

learnRouter.delete("/lessons/:id", lessonPerms.delete, async (req, res) => {
  const existing = await prisma.learnLesson.findFirst({
    where: {
      id: req.params.id,
      course: { tenantId: req.auth!.tenantId, ownerUserId: req.auth!.userId },
    },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.learnLesson.delete({ where: { id: existing.id } });
  await recalcCourseDuration(existing.courseId);
  res.status(204).send();
});

/* ────────────────────────── ENROLLMENTS + PROGRESS ────────────────────── */

learnRouter.post("/courses/:id/enroll", enrollPerms.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const course = await prisma.learnCourse.findFirst({
    where: { id: req.params.id, tenantId, isPublished: true },
    include: {
      lessons: { orderBy: { sortOrder: "asc" }, take: 1, select: { id: true } },
    },
  });
  if (!course) return res.status(404).json({ error: "Course not found or not published" });
  try {
    const row = await prisma.learnEnrollment.create({
      data: {
        tenantId,
        userId,
        courseId: course.id,
        currentLessonId: course.lessons[0]?.id ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.learnEnrollment.findFirst({
        where: { tenantId, userId, courseId: course.id },
      });
      return res.status(200).json({ ...existing, alreadyEnrolled: true });
    }
    throw e;
  }
});

learnRouter.get("/enrollments", enrollPerms.read, async (req, res) => {
  const rows = await prisma.learnEnrollment.findMany({
    where: { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
    include: {
      course: {
        select: {
          id: true,
          name: true,
          coverColor: true,
          category: true,
          estimatedMinutes: true,
          _count: { select: { lessons: true } },
        },
      },
      progress: { select: { lessonId: true, completedAt: true, quizPassed: true } },
    },
    orderBy: [{ completedAt: "asc" }, { enrolledAt: "desc" }],
  });
  res.json(rows);
});

async function refreshEnrollment(enrollmentId: string): Promise<void> {
  const enr = await prisma.learnEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      course: {
        select: {
          id: true,
          tenantId: true,
          lessons: { orderBy: { sortOrder: "asc" }, select: { id: true, quiz: true } },
        },
      },
      progress: true,
    },
  });
  if (!enr) return;
  const totalLessons = enr.course.lessons.length;
  const doneIds = new Set(enr.progress.map((p) => p.lessonId));
  const doneCount = enr.course.lessons.filter((l) => doneIds.has(l.id)).length;
  const percent = totalLessons === 0 ? 0 : Math.round((doneCount / totalLessons) * 100);
  // Course completion = every lesson has a progress row, and every
  // quiz-bearing lesson has quizPassed = true.
  const allDone = doneCount === totalLessons && totalLessons > 0;
  const quizzesRequired = enr.course.lessons.filter((l) => l.quiz);
  const quizzesPassed = quizzesRequired.every((l) => {
    const p = enr.progress.find((x) => x.lessonId === l.id);
    return p?.quizPassed === true;
  });
  const completed = allDone && quizzesPassed;

  // Advance current lesson to next incomplete one, if any.
  const nextLesson = enr.course.lessons.find((l) => !doneIds.has(l.id));

  const updated = await prisma.learnEnrollment.update({
    where: { id: enr.id },
    data: {
      progressPercent: percent,
      currentLessonId: nextLesson?.id ?? null,
      completedAt: completed ? (enr.completedAt ?? new Date()) : null,
    },
  });

  // Issue certificate on first-time completion.
  if (completed && !enr.completedAt) {
    const existing = await prisma.learnCertificate.findFirst({
      where: { tenantId: enr.tenantId, userId: enr.userId, courseId: enr.courseId },
    });
    if (!existing) {
      const year = new Date().getFullYear();
      const count = await prisma.learnCertificate.count({ where: { tenantId: enr.tenantId } });
      const certNumber = `LC-${year}-${String(count + 1).padStart(6, "0")}`;
      await prisma.learnCertificate.create({
        data: {
          tenantId: enr.tenantId,
          userId: enr.userId,
          courseId: enr.courseId,
          certificateNumber: certNumber,
        },
      });
    }
  }
  void updated;
}

// Mark a lesson complete (no quiz path — for text-only lessons).
learnRouter.post("/lessons/:id/complete", enrollPerms.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const lesson = await prisma.learnLesson.findFirst({
    where: { id: req.params.id, course: { tenantId } },
  });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });
  const enrollment = await prisma.learnEnrollment.findFirst({
    where: { tenantId, userId, courseId: lesson.courseId },
  });
  if (!enrollment) return res.status(400).json({ error: "Enroll before marking complete" });
  if (lesson.quiz) {
    return res
      .status(400)
      .json({ error: "This lesson has a quiz — submit answers via /quiz-submit" });
  }
  await prisma.learnLessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
    update: { completedAt: new Date(), quizScore: null, quizPassed: null },
    create: { enrollmentId: enrollment.id, lessonId: lesson.id },
  });
  await refreshEnrollment(enrollment.id);
  const refreshed = await prisma.learnEnrollment.findUnique({
    where: { id: enrollment.id },
    include: { progress: true },
  });
  res.json(refreshed);
});

// Submit quiz answers — indexes into the lesson's options array.
learnRouter.post("/lessons/:id/quiz-submit", enrollPerms.write, async (req, res) => {
  const parsed = z
    .object({ answers: z.array(z.coerce.number().int().min(0)) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const lesson = await prisma.learnLesson.findFirst({
    where: { id: req.params.id, course: { tenantId } },
  });
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });
  const quiz = lesson.quiz as null | {
    passingScore: number;
    questions: { q: string; options: string[]; correctIndex: number; explanation?: string }[];
  };
  if (!quiz) return res.status(400).json({ error: "This lesson has no quiz" });
  const enrollment = await prisma.learnEnrollment.findFirst({
    where: { tenantId, userId, courseId: lesson.courseId },
  });
  if (!enrollment) return res.status(400).json({ error: "Enroll before submitting" });

  const detailed = quiz.questions.map((q, i) => {
    const supplied = parsed.data.answers[i];
    return {
      question: q.q,
      correctIndex: q.correctIndex,
      submittedIndex: supplied,
      correct: supplied === q.correctIndex,
      explanation: q.explanation,
    };
  });
  const correctCount = detailed.filter((d) => d.correct).length;
  const score = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = score >= quiz.passingScore;

  await prisma.learnLessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId: lesson.id } },
    update: { completedAt: new Date(), quizScore: score, quizPassed: passed },
    create: {
      enrollmentId: enrollment.id,
      lessonId: lesson.id,
      quizScore: score,
      quizPassed: passed,
    },
  });
  await refreshEnrollment(enrollment.id);
  const refreshed = await prisma.learnEnrollment.findUnique({
    where: { id: enrollment.id },
    include: { progress: true },
  });
  res.json({
    score,
    passed,
    passingScore: quiz.passingScore,
    correctCount,
    total: quiz.questions.length,
    details: detailed,
    enrollment: refreshed,
  });
});

/* ─────────────────────────── CERTIFICATES ─────────────────────────────── */

learnRouter.get("/certificates", enrollPerms.read, async (req, res) => {
  const rows = await prisma.learnCertificate.findMany({
    where: { tenantId: req.auth!.tenantId, userId: req.auth!.userId },
    include: {
      course: { select: { id: true, name: true, coverColor: true, estimatedMinutes: true } },
    },
    orderBy: { issuedAt: "desc" },
  });
  res.json(rows);
});

learnRouter.get("/certificates/:id", enrollPerms.read, async (req, res) => {
  const row = await prisma.learnCertificate.findFirst({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
    },
    include: {
      course: { select: { id: true, name: true, description: true, estimatedMinutes: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
