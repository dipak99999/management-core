import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E5: Appraisal + Template. Templates define KRAs with weight%. Each Appraisal
// records per-goal score (0..5); finalScore = Σ(score × weight%) / 100 (so also
// 0..5). Submit locks the review + stamps submittedAt.

export const appraisalTemplateRouter = Router();
export const appraisalRouter = Router();

const pt = perms("AppraisalTemplate");
const pa = perms("Appraisal");

// ---------------- Templates ----------------

const goalSchema = z.object({
  kra: z.string().min(1),
  description: z.string().optional().nullable(),
  weightPercent: z.coerce.number().min(0).max(100),
  sortOrder: z.coerce.number().int().nonnegative().default(0),
});

const templateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  goals: z.array(goalSchema).min(1),
});

function assertWeightsSum100(goals: { weightPercent: number }[]): void {
  const sum = goals.reduce((s, g) => s + Number(g.weightPercent), 0);
  if (Math.abs(sum - 100) > 0.01)
    throw new Error(`Goal weights must sum to 100 (got ${sum})`);
}

appraisalTemplateRouter.get("/", pt.read, async (req, res) => {
  const rows = await prisma.appraisalTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { goals: true } } },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

appraisalTemplateRouter.get("/:id", pt.read, async (req, res) => {
  const row = await prisma.appraisalTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { goals: { orderBy: { sortOrder: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

appraisalTemplateRouter.post("/", pt.create, async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    assertWeightsSum100(parsed.data.goals);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  try {
    const row = await prisma.appraisalTemplate.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        goals: {
          create: parsed.data.goals.map((g, i) => ({
            kra: g.kra,
            description: g.description ?? null,
            weightPercent: new Prisma.Decimal(g.weightPercent),
            sortOrder: g.sortOrder || i,
          })),
        },
      },
      include: { goals: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

appraisalTemplateRouter.delete("/:id", pt.delete, async (req, res) => {
  const existing = await prisma.appraisalTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.appraisalTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------------- Appraisals ----------------

const createAppraisalSchema = z.object({
  employeeId: z.string().min(1),
  templateId: z.string().optional().nullable(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  appraiserId: z.string().optional().nullable(),
  employeeRemarks: z.string().optional().nullable(),
  goals: z.array(goalSchema).optional(), // required if templateId absent
});

const scoreSchema = z.object({
  goalId: z.string().min(1),
  score: z.coerce.number().min(0).max(5),
});

appraisalRouter.get("/", pa.read, async (req, res) => {
  const employeeId =
    typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const rows = await prisma.appraisal.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      template: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

appraisalRouter.get("/:id", pa.read, async (req, res) => {
  const row = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      template: { select: { id: true, name: true } },
      goals: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

appraisalRouter.post("/", pa.create, async (req, res) => {
  const parsed = createAppraisalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  const emp = await prisma.employee.findFirst({
    where: { id: body.employeeId, tenantId },
  });
  if (!emp) return res.status(400).json({ error: "Invalid employee" });

  let goals: { kra: string; description: string | null; weightPercent: number; sortOrder: number }[];
  if (body.templateId) {
    const tmpl = await prisma.appraisalTemplate.findFirst({
      where: { id: body.templateId, tenantId },
      include: { goals: { orderBy: { sortOrder: "asc" } } },
    });
    if (!tmpl) return res.status(400).json({ error: "Invalid template" });
    goals = tmpl.goals.map((g) => ({
      kra: g.kra,
      description: g.description,
      weightPercent: Number(g.weightPercent),
      sortOrder: g.sortOrder,
    }));
  } else if (body.goals?.length) {
    goals = body.goals.map((g, i) => ({
      kra: g.kra,
      description: g.description ?? null,
      weightPercent: Number(g.weightPercent),
      sortOrder: g.sortOrder || i,
    }));
    try {
      assertWeightsSum100(goals);
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  } else {
    return res.status(400).json({ error: "Provide templateId or goals" });
  }

  const name = await nextName(prisma, tenantId, "APP-");
  try {
    const row = await prisma.appraisal.create({
      data: {
        tenantId,
        name,
        employeeId: body.employeeId,
        templateId: body.templateId ?? null,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        appraiserId: body.appraiserId ?? null,
        employeeRemarks: body.employeeRemarks ?? null,
        goals: {
          create: goals.map((g) => ({
            kra: g.kra,
            description: g.description,
            weightPercent: new Prisma.Decimal(g.weightPercent),
            sortOrder: g.sortOrder,
          })),
        },
      },
      include: { goals: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Employee already has an appraisal for this period" });
    throw e;
  }
});

appraisalRouter.post("/:id/score", pa.write, async (req, res) => {
  const parsed = scoreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const appraisal = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId },
    include: { goals: true },
  });
  if (!appraisal) return res.status(404).json({ error: "Not found" });
  if (appraisal.status !== "Draft")
    return res
      .status(400)
      .json({ error: `Cannot score appraisal in status ${appraisal.status}` });

  const goal = appraisal.goals.find((g) => g.id === parsed.data.goalId);
  if (!goal) return res.status(400).json({ error: "Invalid goal" });

  const score = parsed.data.score;
  const weight = Number(goal.weightPercent);
  const weightedScore = (score * weight) / 100;

  await prisma.appraisalGoal.update({
    where: { id: goal.id },
    data: {
      score: new Prisma.Decimal(score),
      weightedScore: new Prisma.Decimal(weightedScore),
    },
  });

  // Recompute final score.
  const updated = await prisma.appraisalGoal.findMany({
    where: { appraisalId: appraisal.id },
  });
  const finalScore = updated.reduce((s, g) => s + Number(g.weightedScore), 0);
  await prisma.appraisal.update({
    where: { id: appraisal.id },
    data: { finalScore: new Prisma.Decimal(finalScore) },
  });

  const row = await prisma.appraisal.findFirst({
    where: { id: appraisal.id },
    include: { goals: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(row);
});

appraisalRouter.post("/:id/submit", pa.submit, idempotency("POST /appraisals/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId },
    include: { goals: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot submit ${existing.status}` });

  const parsed = z
    .object({ appraiserRemarks: z.string().optional().nullable() })
    .safeParse(req.body ?? {});
  const appraiserRemarks = parsed.success ? parsed.data.appraiserRemarks : null;

  const row = await prisma.appraisal.update({
    where: { id: existing.id },
    data: {
      status: "Completed",
      submittedAt: new Date(),
      appraiserRemarks: appraiserRemarks ?? existing.appraiserRemarks,
    },
    include: { goals: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(row);
});

appraisalRouter.post("/:id/cancel", pa.cancel, idempotency("POST /appraisals/:id/cancel"), async (req, res) => {
  const existing = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const row = await prisma.appraisal.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});

// ── 360° feedback ─────────────────────────────────────────────────────
// One round per audience (Self / Manager / Peer / Report / Client). Each
// round accepts responses with per-KRA scores + free-text comments.
// Anonymity is honoured — the manager sees respondent identity, the
// appraisee only sees the aggregate + comments.

const AUDIENCES = ["Self", "Manager", "Peer", "Report", "Client"] as const;

const openRoundSchema = z.object({
  audience: z.enum(AUDIENCES),
  dueDate: z.string().optional().nullable(),
});

appraisalRouter.post("/:id/feedback/rounds", pa.write, async (req, res) => {
  const parsed = openRoundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const appraisal = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!appraisal) return res.status(404).json({ error: "Not found" });
  const row = await prisma.appraisalFeedbackRound.create({
    data: {
      appraisalId: appraisal.id,
      audience: parsed.data.audience,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
    },
  });
  res.status(201).json(row);
});

appraisalRouter.post("/:id/feedback/rounds/:roundId/close", pa.write, async (req, res) => {
  const round = await prisma.appraisalFeedbackRound.findFirst({
    where: { id: req.params.roundId, appraisal: { id: req.params.id, tenantId: req.auth!.tenantId } },
  });
  if (!round) return res.status(404).json({ error: "Not found" });
  const row = await prisma.appraisalFeedbackRound.update({
    where: { id: round.id },
    data: { status: "Closed" },
  });
  res.json(row);
});

const respondSchema = z.object({
  respondentEmail: z.string().email(),
  respondentName: z.string().optional().nullable(),
  scoresJson: z.record(z.coerce.number().min(0).max(5)).default({}),
  comments: z.string().optional().nullable(),
  isAnonymous: z.boolean().default(false),
});

appraisalRouter.post("/:id/feedback/rounds/:roundId/respond", pa.write, async (req, res) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const round = await prisma.appraisalFeedbackRound.findFirst({
    where: { id: req.params.roundId, appraisal: { id: req.params.id, tenantId: req.auth!.tenantId } },
  });
  if (!round) return res.status(404).json({ error: "Not found" });
  if (round.status === "Closed") return res.status(400).json({ error: "Round closed" });
  const row = await prisma.appraisalFeedbackResponse.create({
    data: {
      roundId: round.id,
      respondentEmail: parsed.data.respondentEmail.toLowerCase(),
      respondentName: parsed.data.respondentName ?? null,
      scoresJson: parsed.data.scoresJson,
      comments: parsed.data.comments ?? null,
      isAnonymous: parsed.data.isAnonymous,
    },
  });
  res.status(201).json(row);
});

// Aggregate feedback across all rounds. Returns per-audience response
// count + per-KRA weighted mean + de-duplicated free-text comments.
appraisalRouter.get("/:id/feedback/summary", pa.read, async (req, res) => {
  const appraisal = await prisma.appraisal.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      feedbackRounds: { include: { responses: true } },
    },
  });
  if (!appraisal) return res.status(404).json({ error: "Not found" });
  const perAudience: Record<string, { responses: number; kraAverages: Record<string, number> }> = {};
  const allComments: Array<{ audience: string; anonymousName: string; comments: string }> = [];
  for (const round of appraisal.feedbackRounds) {
    const sums = new Map<string, { total: number; count: number }>();
    for (const r of round.responses) {
      const scores = r.scoresJson as Record<string, number>;
      for (const [kra, score] of Object.entries(scores)) {
        const prev = sums.get(kra) ?? { total: 0, count: 0 };
        prev.total += Number(score);
        prev.count += 1;
        sums.set(kra, prev);
      }
      if (r.comments) {
        allComments.push({
          audience: round.audience,
          anonymousName: r.isAnonymous ? "Anonymous" : (r.respondentName ?? r.respondentEmail),
          comments: r.comments,
        });
      }
    }
    const kraAverages: Record<string, number> = {};
    for (const [kra, v] of sums) {
      kraAverages[kra] = v.count > 0 ? v.total / v.count : 0;
    }
    perAudience[round.audience] = { responses: round.responses.length, kraAverages };
  }
  res.json({
    appraisalId: appraisal.id,
    perAudience,
    comments: allComments,
  });
});
