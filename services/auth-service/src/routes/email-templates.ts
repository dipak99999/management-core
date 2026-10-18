import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// F1: EmailTemplate CRUD. Rendering happens on send (see email-messages).

export const emailTemplateRouter = Router();
emailTemplateRouter.use(requireAuth);

const p = perms("EmailTemplate");

const upsertSchema = z.object({
  name: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  category: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
});

emailTemplateRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.emailTemplate.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

emailTemplateRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.emailTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

emailTemplateRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.emailTemplate.create({
      data: {
        tenantId: req.auth!.tenantId,
        ...parsed.data,
        category: parsed.data.category ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Template name already exists" });
    throw e;
  }
});

emailTemplateRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.emailTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.emailTemplate.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

emailTemplateRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.emailTemplate.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.emailTemplate.delete({ where: { id: existing.id } });
  res.status(204).send();
});
