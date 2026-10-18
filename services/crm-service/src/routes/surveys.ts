import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Zoho-Survey-style. Two mount points:
//   /surveys         (JWT — operator CRUD + analytics)
//   /public/surveys  (no auth — render + submit)

export const surveyRouter = Router();
export const surveyPublicRouter = Router();
const p = perms("Survey");

const QUESTION_TYPES = [
  "text", "textarea", "rating", "nps",
  "choice_single", "choice_multi", "dropdown", "yes_no", "matrix",
] as const;

const questionSchema = z.object({
  order: z.number().int().nonnegative(),
  type: z.enum(QUESTION_TYPES),
  label: z.string().min(1),
  description: z.string().nullable().optional(),
  required: z.boolean().default(false),
  optionsJson: z.array(z.string()).nullable().optional(),
  configJson: z.record(z.any()).nullable().optional(),
});

const surveySchema = z.object({
  name: z.string().min(1),
  publicSlug: z.string().min(1).regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric + dashes"),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  thankYouMessage: z.string().default("Thanks for your feedback!"),
  isActive: z.boolean().optional(),
  closeAt: z.string().datetime().nullable().optional(),
  responseCap: z.number().int().positive().nullable().optional(),
  settingsJson: z.record(z.any()).nullable().optional(),
  questions: z.array(questionSchema).optional(),
});

// ── Operator CRUD ─────────────────────────────────────────────────────

surveyRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.survey.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { questions: true, responses: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

surveyRouter.get("/:id", p.read, async (req, res) => {
  const s = await prisma.survey.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      questions: { orderBy: { order: "asc" } },
      _count: { select: { responses: true } },
    },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json(s);
});

surveyRouter.post("/", p.create, async (req, res) => {
  const parsed = surveySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  try {
    const survey = await prisma.survey.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: d.name,
        publicSlug: d.publicSlug,
        title: d.title,
        description: d.description ?? null,
        thankYouMessage: d.thankYouMessage,
        isActive: d.isActive ?? false,
        closeAt: d.closeAt ? new Date(d.closeAt) : null,
        responseCap: d.responseCap ?? null,
        settingsJson: d.settingsJson ?? undefined,
        questions: d.questions
          ? {
              create: d.questions.map((q) => ({
                order: q.order,
                type: q.type,
                label: q.label,
                description: q.description ?? null,
                required: q.required,
                optionsJson: q.optionsJson ?? undefined,
                configJson: q.configJson ?? undefined,
              })),
            }
          : undefined,
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
    res.status(201).json(survey);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name or slug already exists" });
    throw e;
  }
});

surveyRouter.put("/:id", p.write, async (req, res) => {
  const parsed = surveySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.survey.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const d = parsed.data;

  const survey = await prisma.$transaction(async (tx) => {
    if (d.questions) {
      // Replace all questions wholesale — simpler than diffing.
      await tx.surveyQuestion.deleteMany({ where: { surveyId: existing.id } });
    }
    return tx.survey.update({
      where: { id: existing.id },
      data: {
        name: d.name,
        publicSlug: d.publicSlug,
        title: d.title,
        description: d.description ?? null,
        thankYouMessage: d.thankYouMessage,
        isActive: d.isActive ?? existing.isActive,
        closeAt: d.closeAt === undefined
          ? existing.closeAt
          : d.closeAt === null ? null : new Date(d.closeAt),
        responseCap: d.responseCap ?? null,
        settingsJson: d.settingsJson ?? undefined,
        ...(d.questions && {
          questions: {
            create: d.questions.map((q) => ({
              order: q.order,
              type: q.type,
              label: q.label,
              description: q.description ?? null,
              required: q.required,
              optionsJson: q.optionsJson ?? undefined,
              configJson: q.configJson ?? undefined,
            })),
          },
        }),
      },
      include: { questions: { orderBy: { order: "asc" } } },
    });
  });
  res.json(survey);
});

surveyRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.survey.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// Bulk response export as JSON — one row per response with the values keyed
// by question label for downstream spreadsheet-friendliness.
surveyRouter.get("/:id/responses", p.read, async (req, res) => {
  const s = await prisma.survey.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!s) return res.status(404).json({ error: "Not found" });
  const responses = await prisma.surveyResponse.findMany({
    where: { surveyId: s.id },
    include: { answers: true },
    orderBy: { submittedAt: "desc" },
    take: 500,
  });
  res.json(
    responses.map((r) => {
      const byQ = new Map(r.answers.map((a) => [a.questionId, a.value]));
      return {
        id: r.id,
        submittedAt: r.submittedAt,
        respondentEmail: r.respondentEmail,
        respondentName: r.respondentName,
        answers: s.questions.map((q) => ({
          questionId: q.id,
          label: q.label,
          type: q.type,
          value: byQ.get(q.id) ?? null,
        })),
      };
    }),
  );
});

// Per-question analytics — averages, distributions, NPS breakdown.
surveyRouter.get("/:id/analytics", p.read, async (req, res) => {
  const s = await prisma.survey.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!s) return res.status(404).json({ error: "Not found" });

  const answers = await prisma.surveyAnswer.findMany({
    where: { question: { surveyId: s.id } },
  });
  const grouped = new Map<string, unknown[]>();
  for (const a of answers) {
    const arr = grouped.get(a.questionId) ?? [];
    arr.push(a.value);
    grouped.set(a.questionId, arr);
  }

  const totalResponses = await prisma.surveyResponse.count({ where: { surveyId: s.id } });

  const results = s.questions.map((q) => {
    const vals = grouped.get(q.id) ?? [];
    return {
      questionId: q.id,
      label: q.label,
      type: q.type,
      count: vals.length,
      analytics: analyzeAnswers(q.type, vals, q.optionsJson as string[] | null),
    };
  });

  res.json({
    surveyId: s.id,
    title: s.title,
    isActive: s.isActive,
    totalResponses,
    questions: results,
  });
});

function analyzeAnswers(
  type: string,
  vals: unknown[],
  options: string[] | null,
): Record<string, unknown> {
  if (vals.length === 0) return { empty: true };

  if (type === "rating" || type === "nps") {
    const nums = vals
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const avg = nums.reduce((s, n) => s + n, 0) / (nums.length || 1);
    // Distribution buckets 0..10 for NPS, 1..5 for rating.
    const dist: Record<string, number> = {};
    for (const n of nums) dist[String(n)] = (dist[String(n)] ?? 0) + 1;
    if (type === "nps") {
      const total = nums.length;
      const promoters  = nums.filter((n) => n >= 9).length;
      const detractors = nums.filter((n) => n <= 6).length;
      const passives   = total - promoters - detractors;
      const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;
      return {
        average: Math.round(avg * 10) / 10,
        distribution: dist,
        promoters, passives, detractors,
        promoterPct:  total ? Math.round((promoters / total) * 100)  : 0,
        passivePct:   total ? Math.round((passives / total) * 100)   : 0,
        detractorPct: total ? Math.round((detractors / total) * 100) : 0,
        nps,
      };
    }
    return { average: Math.round(avg * 10) / 10, distribution: dist };
  }

  if (type === "choice_single" || type === "dropdown" || type === "yes_no") {
    const counts: Record<string, number> = {};
    for (const v of vals) {
      const k = String(v ?? "");
      counts[k] = (counts[k] ?? 0) + 1;
    }
    // Seed all options at 0 for consistent bar charts.
    if (options) for (const o of options) if (!(o in counts)) counts[o] = 0;
    return { counts };
  }

  if (type === "choice_multi") {
    const counts: Record<string, number> = {};
    for (const v of vals) {
      const arr = Array.isArray(v) ? v : [];
      for (const item of arr) counts[String(item)] = (counts[String(item)] ?? 0) + 1;
    }
    if (options) for (const o of options) if (!(o in counts)) counts[o] = 0;
    return { counts };
  }

  // text/textarea/matrix: return the last-25 answers verbatim for a "recent
  // responses" panel — client can page through the full list via /responses.
  return { recent: vals.slice(-25) };
}

// ── Public ────────────────────────────────────────────────────────────

surveyPublicRouter.get("/:slug", async (req, res) => {
  const s = await prisma.survey.findUnique({
    where: { publicSlug: req.params.slug },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!s || !s.isActive) return res.status(404).json({ error: "Not found" });
  if (s.closeAt && s.closeAt < new Date()) return res.status(410).json({ error: "Survey closed" });
  if (s.responseCap && s.responseCount >= s.responseCap)
    return res.status(410).json({ error: "Response cap reached" });
  res.json({
    id: s.id,
    title: s.title,
    description: s.description,
    thankYouMessage: s.thankYouMessage,
    questions: s.questions,
  });
});

surveyPublicRouter.get("/:slug/render", async (req, res) => {
  const s = await prisma.survey.findUnique({
    where: { publicSlug: req.params.slug },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!s || !s.isActive) return res.status(404).send("<h1>404 — survey not found</h1>");
  if (s.closeAt && s.closeAt < new Date()) return res.status(410).send("<h1>Survey closed</h1>");

  const submitUrl = `${req.protocol}://${req.get("host")}/public/surveys/${s.publicSlug}/submit`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(s.title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 40px 20px; background: #fafaf9; color: #1c1917; }
  .sv-card { max-width: 640px; margin: 0 auto; background: white; border-radius: 16px; box-shadow: 0 12px 40px -12px rgba(28,25,23,.15); padding: 36px; }
  .sv-title { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
  .sv-desc { color: #78716c; font-size: 15px; margin: 0 0 24px; }
  .sv-q { border-top: 1px solid #f5f5f4; padding: 20px 0; }
  .sv-q:first-of-type { border-top: 0; padding-top: 0; }
  .sv-label { display: block; font-size: 15px; font-weight: 500; margin-bottom: 4px; }
  .sv-req { color: #dc2626; margin-left: 4px; }
  .sv-hint { color: #78716c; font-size: 13px; margin-bottom: 10px; }
  .sv-input, .sv-textarea, .sv-select { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 8px; font-size: 14px; font-family: inherit; outline: none; box-sizing: border-box; }
  .sv-input:focus, .sv-textarea:focus, .sv-select:focus { border-color: #7C3AED; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
  .sv-choices { display: flex; flex-direction: column; gap: 8px; }
  .sv-choice { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 8px 12px; border: 1px solid #e7e5e4; border-radius: 8px; cursor: pointer; }
  .sv-choice:hover { border-color: #7C3AED; background: #faf5ff; }
  .sv-rating, .sv-nps { display: flex; gap: 6px; }
  .sv-rating button, .sv-nps button { flex: 1; padding: 10px 4px; border: 1px solid #e7e5e4; border-radius: 8px; background: white; cursor: pointer; font-size: 14px; font-weight: 500; }
  .sv-rating button:hover, .sv-nps button:hover { border-color: #7C3AED; color: #7C3AED; }
  .sv-rating button.active, .sv-nps button.active { background: linear-gradient(135deg, #7C3AED, #8B5CF6); color: white; border-color: #7C3AED; }
  .sv-btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 14px; background: linear-gradient(135deg, #7C3AED, #8B5CF6); color: white; border: 0; border-radius: 10px; font-weight: 500; cursor: pointer; margin-top: 20px; font-size: 15px; }
  .sv-btn[disabled] { opacity: .6; cursor: not-allowed; }
  .sv-ok { padding: 32px; text-align: center; }
  .sv-ok h2 { color: #14532d; font-size: 20px; margin: 8px 0; }
  .sv-err { padding: 12px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 13px; margin-bottom: 12px; }
</style>
</head><body>
<div class="sv-card" id="sv-root">
  <h1 class="sv-title">${escapeHtml(s.title)}</h1>
  ${s.description ? `<p class="sv-desc">${escapeHtml(s.description)}</p>` : ""}
  <div id="sv-error" class="sv-err" style="display:none"></div>
  <form id="sv-form" onsubmit="return false;">
    ${s.questions.map((q, i) => renderQuestion(q, i)).join("")}
    <button class="sv-btn" type="button" onclick="submitSurvey()">Submit</button>
  </form>
</div>
<script>
const ANSWERS = {};
function setChoice(qid, val) {
  ANSWERS[qid] = val;
  document.querySelectorAll('[data-q="' + qid + '"] button').forEach(function(b) {
    b.classList.toggle('active', b.dataset.val === String(val));
  });
}
function setMulti(qid, val, checked) {
  ANSWERS[qid] = ANSWERS[qid] || [];
  if (checked) { if (!ANSWERS[qid].includes(val)) ANSWERS[qid].push(val); }
  else { ANSWERS[qid] = ANSWERS[qid].filter(function(x) { return x !== val; }); }
}
function submitSurvey() {
  const err = document.getElementById("sv-error");
  err.style.display = "none";
  const form = document.getElementById("sv-form");
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox" || el.type === "radio") continue;
    ANSWERS[el.name] = el.value;
  }
  fetch(${JSON.stringify(submitUrl)}, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: ANSWERS }),
  }).then(function(r) {
    if (!r.ok) return r.json().then(function(j) { throw new Error(j.error || "Submit failed"); });
    return r.json();
  }).then(function() {
    document.getElementById("sv-root").innerHTML =
      '<div class="sv-ok"><h2>✓ ' + ${JSON.stringify(escapeHtml(s.thankYouMessage))} + '</h2></div>';
  }).catch(function(ex) {
    err.textContent = ex.message || "Submit failed";
    err.style.display = "block";
  });
}
</script>
</body></html>`);
});

function renderQuestion(q: {
  id: string; type: string; label: string; description: string | null;
  required: boolean; optionsJson: unknown; configJson: unknown;
}, idx: number): string {
  const label = `<label class="sv-label">${idx + 1}. ${escapeHtml(q.label)}${q.required ? '<span class="sv-req">*</span>' : ""}</label>`;
  const hint = q.description ? `<div class="sv-hint">${escapeHtml(q.description)}</div>` : "";

  if (q.type === "text") {
    return `<div class="sv-q">${label}${hint}<input class="sv-input" name="${q.id}" /></div>`;
  }
  if (q.type === "textarea") {
    return `<div class="sv-q">${label}${hint}<textarea class="sv-textarea" name="${q.id}" rows="4"></textarea></div>`;
  }
  if (q.type === "rating") {
    const nums = [1, 2, 3, 4, 5];
    return `<div class="sv-q">${label}${hint}<div class="sv-rating" data-q="${q.id}">${nums.map((n) => `<button type="button" data-val="${n}" onclick="setChoice('${q.id}',${n})">${n}</button>`).join("")}</div></div>`;
  }
  if (q.type === "nps") {
    const nums = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    return `<div class="sv-q">${label}${hint}<div class="sv-nps" data-q="${q.id}">${nums.map((n) => `<button type="button" data-val="${n}" onclick="setChoice('${q.id}',${n})">${n}</button>`).join("")}</div><div class="sv-hint" style="display:flex;justify-content:space-between;margin-top:6px;"><span>Not likely</span><span>Extremely likely</span></div></div>`;
  }
  if (q.type === "choice_single") {
    const opts = Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [];
    return `<div class="sv-q">${label}${hint}<div class="sv-choices">${opts.map((o) => `<label class="sv-choice"><input type="radio" name="__r_${q.id}" onclick="setChoice('${q.id}','${escapeAttr(o)}')" />${escapeHtml(o)}</label>`).join("")}</div></div>`;
  }
  if (q.type === "choice_multi") {
    const opts = Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [];
    return `<div class="sv-q">${label}${hint}<div class="sv-choices">${opts.map((o) => `<label class="sv-choice"><input type="checkbox" onclick="setMulti('${q.id}','${escapeAttr(o)}',this.checked)" />${escapeHtml(o)}</label>`).join("")}</div></div>`;
  }
  if (q.type === "dropdown") {
    const opts = Array.isArray(q.optionsJson) ? (q.optionsJson as string[]) : [];
    return `<div class="sv-q">${label}${hint}<select class="sv-select" name="${q.id}"><option value="">Select…</option>${opts.map((o) => `<option>${escapeHtml(o)}</option>`).join("")}</select></div>`;
  }
  if (q.type === "yes_no") {
    return `<div class="sv-q">${label}${hint}<div class="sv-choices" style="flex-direction:row;gap:12px;">${["Yes", "No"].map((o) => `<label class="sv-choice" style="flex:1;"><input type="radio" name="__yn_${q.id}" onclick="setChoice('${q.id}','${o}')" />${o}</label>`).join("")}</div></div>`;
  }
  return `<div class="sv-q">${label}${hint}<input class="sv-input" name="${q.id}" /></div>`;
}

surveyPublicRouter.post("/:slug/submit", async (req, res) => {
  const s = await prisma.survey.findUnique({
    where: { publicSlug: req.params.slug },
    include: { questions: true },
  });
  if (!s || !s.isActive) return res.status(404).json({ error: "Not found" });
  if (s.closeAt && s.closeAt < new Date()) return res.status(410).json({ error: "Survey closed" });
  if (s.responseCap && s.responseCount >= s.responseCap)
    return res.status(410).json({ error: "Response cap reached" });

  const parsed = z
    .object({
      answers: z.record(z.any()),
      respondentEmail: z.string().email().nullable().optional(),
      respondentName: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  // Validate required questions.
  for (const q of s.questions) {
    if (q.required) {
      const v = parsed.data.answers[q.id];
      const missing =
        v === undefined || v === null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0);
      if (missing) return res.status(400).json({ error: `Missing answer for "${q.label}"` });
    }
  }

  const ipAddress = (req.ip ?? req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  const response = await prisma.$transaction(async (tx) => {
    const r = await tx.surveyResponse.create({
      data: {
        surveyId: s.id,
        tenantId: s.tenantId,
        respondentEmail: parsed.data.respondentEmail ?? null,
        respondentName: parsed.data.respondentName ?? null,
        ipAddress,
        userAgent: req.header("user-agent") ?? null,
      },
    });
    await tx.surveyAnswer.createMany({
      data: s.questions
        .filter((q) => parsed.data.answers[q.id] !== undefined)
        .map((q) => ({
          responseId: r.id,
          questionId: q.id,
          value: parsed.data.answers[q.id] as never,
        })),
    });
    await tx.survey.update({
      where: { id: s.id },
      data: { responseCount: { increment: 1 } },
    });
    return r;
  });

  res.json({ ok: true, responseId: response.id, thankYouMessage: s.thankYouMessage });
});

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}
function escapeAttr(s: string): string {
  return s.replace(/'/g, "\\'").replace(/"/g, "&quot;");
}
