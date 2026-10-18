import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// H1: Letterhead CRUD. Setting isDefault=true clears the flag on any prior
// default in the same tenant so exactly one default exists at a time.

export const letterheadRouter = Router();

const p = perms("Letterhead");

const upsertSchema = z.object({
  name: z.string().min(1),
  logoBase64: z.string().optional().nullable(),
  addressText: z.string().optional().nullable(),
  footerText: z.string().optional().nullable(),
  isDefault: z.boolean().default(false),
  appliesToDoctypes: z.array(z.string()).default([]),
});

letterheadRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.letterhead.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

letterheadRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.letterhead.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

letterheadRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.letterhead.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.letterhead.create({
        data: { tenantId, ...parsed.data },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Letterhead name already exists" });
    throw e;
  }
});

letterheadRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.letterhead.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.letterhead.updateMany({
        where: { tenantId, isDefault: true, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }
    return tx.letterhead.update({
      where: { id: existing.id },
      data: parsed.data,
    });
  });
  res.json(row);
});

letterheadRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.letterhead.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.letterhead.delete({ where: { id: existing.id } });
  res.status(204).send();
});
