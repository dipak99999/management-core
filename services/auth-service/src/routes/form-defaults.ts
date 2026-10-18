import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

/**
 * Per-user remembered form defaults backing `useSmartDefaults` from
 * @lumaara/web-ui. Each `formKey` has at most one row per user (upsert
 * semantics); on submit the client posts the latest value and the next
 * mount reads it back as the pre-filled default.
 */
export const formDefaultRouter = Router();
formDefaultRouter.use(requireAuth);

const upsertSchema = z.object({
  formKey: z.string().min(1).max(200),
  value: z.unknown(),
});

formDefaultRouter.get("/:formKey", async (req, res) => {
  const auth = req.auth!;
  const row = await prisma.userFormDefault.findUnique({
    where: {
      tenantId_userId_formKey: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        formKey: req.params.formKey,
      },
    },
  });
  res.json(row ?? null);
});

formDefaultRouter.put("/", async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const row = await prisma.userFormDefault.upsert({
    where: {
      tenantId_userId_formKey: {
        tenantId: auth.tenantId,
        userId: auth.userId,
        formKey: parsed.data.formKey,
      },
    },
    create: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      formKey: parsed.data.formKey,
      value: parsed.data.value as Prisma.InputJsonValue,
    },
    update: {
      value: parsed.data.value as Prisma.InputJsonValue,
    },
  });
  res.json(row);
});

formDefaultRouter.delete("/:formKey", async (req, res) => {
  const auth = req.auth!;
  await prisma.userFormDefault.deleteMany({
    where: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      formKey: req.params.formKey,
    },
  });
  res.status(204).send();
});
