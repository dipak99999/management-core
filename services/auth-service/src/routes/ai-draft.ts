import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  resolveChatProvider,
  NoChatProviderError,
} from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const aiDraftRouter = Router();
aiDraftRouter.use(requireAuth);

/**
 * POST /ai/draft
 *
 * Takes a slash-command sentence + the shape of the form being filled,
 * returns a structured diff the UI can preview + apply.
 *
 * Request:
 *   {
 *     prompt: "3× SKU-ABC for Acme Industries, due in 15 days",
 *     scope: "sales-invoice-draft",
 *     // Optional: current form values the user has typed so far — the
 *     //   AI treats these as `before` and only proposes `after` deltas.
 *     before?: Record<string, unknown>,
 *     // Optional: fields the form supports; the AI is told to stick to
 *     //   this allowlist and ignore everything else.
 *     fields?: string[],
 *   }
 *
 * Response:
 *   {
 *     summary: "Draft invoice to Acme Industries, 3 line items, net 15 days",
 *     rows: [
 *       { field: "customerName", before: null, after: "Acme Industries", editable: true },
 *       { field: "dueDate",      before: null, after: "2026-10-20", editable: true },
 *       …
 *     ],
 *     model: "claude-3-5-sonnet-latest",
 *     costUsd: 0.0012,
 *   }
 *
 * Cost tracking: writes one AgentStep so /ai-budget's day-aggregate picks
 * it up alongside AgentTask spend.
 */

const schema = z.object({
  prompt: z.string().min(1).max(2000),
  scope: z.string().min(1).max(100),
  before: z.record(z.unknown()).optional().nullable(),
  fields: z.array(z.string()).optional().nullable(),
  /** Optional short description of the doctype so the prompt is grounded. */
  doctypeHint: z.string().max(400).optional().nullable(),
});

aiDraftRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  let provider;
  try {
    provider = await resolveChatProvider(tenantId);
  } catch (e) {
    if (e instanceof NoChatProviderError) {
      return res.status(503).json({
        error: "AI not configured — set an AI provider in Settings → AI providers",
        code: "AI_NOT_CONFIGURED",
      });
    }
    throw e;
  }

  const fieldsBlock = parsed.data.fields?.length
    ? `Only these fields are allowed in \`rows\`:\n${parsed.data.fields.map((f) => `- ${f}`).join("\n")}`
    : `Infer sensible fields from the prompt.`;

  const beforeBlock =
    parsed.data.before && Object.keys(parsed.data.before).length > 0
      ? `Current form values (treat as \`before\`):\n${JSON.stringify(parsed.data.before, null, 2)}`
      : `The form is empty — treat all \`before\` values as null.`;

  const system = `You turn user intent into a structured form draft.

Return STRICT JSON matching this schema:
{
  "summary": "<one sentence human description of the change>",
  "rows": [
    { "field": "<fieldName>", "before": <value or null>, "after": <value or null>, "editable": true }
  ]
}

Rules:
- Return ONLY the JSON object, no code fences, no commentary.
- Keep "after" values concrete and typed sensibly (strings for names, YYYY-MM-DD for dates, numbers for amounts).
- Omit fields you don't have confidence about rather than hallucinating.
- Mark "editable": true for every row the user may want to tweak.
${parsed.data.doctypeHint ? `\nContext: ${parsed.data.doctypeHint}` : ""}

${fieldsBlock}

${beforeBlock}`;

  const user = parsed.data.prompt;

  let result;
  try {
    result = await provider.chat(system, [{ role: "user", content: user }]);
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : "AI provider failed",
    });
  }

  // Trim to JSON braces defensively — some providers wrap in prose.
  const text = result.text.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) {
    return res.status(502).json({ error: "AI returned non-JSON output", raw: text.slice(0, 500) });
  }
  let diff: {
    summary: string;
    rows: Array<{ field: string; before?: unknown; after?: unknown; editable?: boolean }>;
  };
  try {
    diff = JSON.parse(text.slice(start, end + 1));
  } catch {
    return res.status(502).json({ error: "AI returned malformed JSON", raw: text.slice(0, 500) });
  }

  // Record cost against an AgentTask so /ai-budget sees it.
  const now = new Date();
  try {
    const task = await prisma.agentTask.create({
      data: {
        tenantId,
        name: `draft-${now.toISOString()}`,
        agentKind: "SlashDraft",
        goal: parsed.data.prompt.slice(0, 200),
        status: "Completed",
        startedByUserId: userId,
        startedAt: now,
        completedAt: now,
      },
    });
    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const costUsd = estimateCostUsd(result.model, inputTokens, outputTokens);
    await prisma.agentStep.create({
      data: {
        tenantId,
        taskId: task.id,
        ordinal: 1,
        kind: "Think",
        status: "Succeeded",
        provider: result.provider,
        model: result.model,
        inputTokens,
        outputTokens,
        costUsd: new Prisma.Decimal(costUsd.toFixed(6)),
        startedAt: now,
        finishedAt: now,
      },
    });
    res.json({ ...diff, model: result.model, costUsd });
  } catch {
    // If accounting fails, still return the diff — cost tracking is best-effort.
    res.json({ ...diff, model: result.model });
  }
});

/**
 * Rough per-million-token cost estimate for budget tracking. Not pricing
 * truth — just a signal for the /ai-budget pill. Override via env for
 * local calibration.
 */
function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const inPrice = Number(process.env.AI_PRICE_INPUT_PER_M ?? guessPrice(model, "in"));
  const outPrice = Number(process.env.AI_PRICE_OUTPUT_PER_M ?? guessPrice(model, "out"));
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

function guessPrice(model: string, side: "in" | "out"): number {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return side === "in" ? 0.8 : 4;
  if (m.includes("opus")) return side === "in" ? 15 : 75;
  if (m.includes("sonnet")) return side === "in" ? 3 : 15;
  if (m.includes("gpt-4o-mini")) return side === "in" ? 0.15 : 0.6;
  if (m.includes("gpt-4o")) return side === "in" ? 2.5 : 10;
  return side === "in" ? 3 : 15;
}
