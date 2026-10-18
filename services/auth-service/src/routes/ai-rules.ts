import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

/**
 * "Save as rule" snippets backing `useSaveAsRule` from @lumaara/web-ui.
 * When a user corrects AI output, the before/after pair is stored under
 * a scope so the next similar prompt can be templated — this is a
 * learn-from-corrections surface, not an inference endpoint.
 */
export const aiRuleRouter = Router();
aiRuleRouter.use(requireAuth);

const createSchema = z.object({
  scope: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  before: z.unknown(),
  after: z.unknown(),
});

aiRuleRouter.get("/", async (req, res) => {
  const auth = req.auth!;
  const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;
  const rows = await prisma.aiRule.findMany({
    where: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      ...(scope ? { scope } : {}),
    },
    orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
  res.json(rows);
});

aiRuleRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const row = await prisma.aiRule.create({
    data: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      scope: parsed.data.scope,
      name: parsed.data.name,
      before: parsed.data.before as Prisma.InputJsonValue,
      after: parsed.data.after as Prisma.InputJsonValue,
    },
  });
  res.status(201).json(row);
});

aiRuleRouter.post("/:id/bump", async (req, res) => {
  const auth = req.auth!;
  const row = await prisma.aiRule.updateMany({
    where: { id: req.params.id, tenantId: auth.tenantId, userId: auth.userId },
    data: { usageCount: { increment: 1 } },
  });
  if (row.count === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});

aiRuleRouter.delete("/:id", async (req, res) => {
  const auth = req.auth!;
  const result = await prisma.aiRule.deleteMany({
    where: { id: req.params.id, tenantId: auth.tenantId, userId: auth.userId },
  });
  if (result.count === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).send();
});
