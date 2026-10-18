import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// H2: PrintFormat CRUD. isDefault is scoped per (tenant, doctype) — setting
// true clears the flag on any prior default for the same doctype.

export const printFormatRouter = Router();

const p = perms("PrintFormat");

const upsertSchema = z.object({
  doctype: z.string().min(1),
  name: z.string().min(1),
  isDefault: z.boolean().default(false),
  headerText: z.string().optional().nullable(),
  footerText: z.string().optional().nullable(),
  thankYouNote: z.string().optional().nullable(),
  termsText: z.string().optional().nullable(),
  showItemDescription: z.boolean().default(true),
  showTaxBreakdown: z.boolean().default(true),
  showRemarks: z.boolean().default(true),
  paperSize: z.enum(["A4", "Letter", "Legal"]).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
});

printFormatRouter.get("/", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const rows = await prisma.printFormat.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(doctype ? { doctype } : {}),
    },
    orderBy: [{ doctype: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

printFormatRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.printFormat.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

printFormatRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.printFormat.updateMany({
          where: { tenantId, doctype: parsed.data.doctype, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.printFormat.create({
        data: { tenantId, ...parsed.data },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Print format name already exists for this doctype" });
    throw e;
  }
});

printFormatRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.printFormat.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const row = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.printFormat.updateMany({
        where: {
          tenantId,
          doctype: existing.doctype,
          isDefault: true,
          NOT: { id: existing.id },
        },
        data: { isDefault: false },
      });
    }
    return tx.printFormat.update({
      where: { id: existing.id },
      data: parsed.data,
    });
  });
  res.json(row);
});

printFormatRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.printFormat.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.printFormat.delete({ where: { id: existing.id } });
  res.status(204).send();
});
