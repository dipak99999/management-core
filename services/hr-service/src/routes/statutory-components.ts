import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// E9: Statutory Component (PF/ESI/PT/TDS). Payroll Entry auto-appends these
// as deductions on generated slips — see computeStatutoryDeductions used by
// payroll-entries submit.

export const statutoryComponentRouter = Router();

const p = perms("StatutoryComponent");

const upsertSchema = z.object({
  name: z.string().min(1),
  slipComponentName: z.string().min(1),
  employeeSharePercent: z.coerce.number().min(0).max(100).default(0),
  employerSharePercent: z.coerce.number().min(0).max(100).default(0),
  monthlyGrossCeiling: z.coerce.number().nonnegative().optional().nullable(),
  flatAmount: z.coerce.number().nonnegative().optional().nullable(),
  applicableFrom: z.string().datetime(),
  applicableTo: z.string().datetime().optional().nullable(),
  enabled: z.boolean().default(true),
});

statutoryComponentRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.statutoryComponent.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { name: "asc" },
  });
  res.json(rows);
});

statutoryComponentRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.statutoryComponent.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        slipComponentName: parsed.data.slipComponentName,
        employeeSharePercent: new Prisma.Decimal(parsed.data.employeeSharePercent),
        employerSharePercent: new Prisma.Decimal(parsed.data.employerSharePercent),
        monthlyGrossCeiling:
          parsed.data.monthlyGrossCeiling != null
            ? new Prisma.Decimal(parsed.data.monthlyGrossCeiling)
            : null,
        flatAmount:
          parsed.data.flatAmount != null ? new Prisma.Decimal(parsed.data.flatAmount) : null,
        applicableFrom: new Date(parsed.data.applicableFrom),
        applicableTo: parsed.data.applicableTo ? new Date(parsed.data.applicableTo) : null,
        enabled: parsed.data.enabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Component name already exists" });
    throw e;
  }
});

statutoryComponentRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.statutoryComponent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const b = parsed.data;
  const row = await prisma.statutoryComponent.update({
    where: { id: existing.id },
    data: {
      name: b.name ?? existing.name,
      slipComponentName: b.slipComponentName ?? existing.slipComponentName,
      employeeSharePercent:
        b.employeeSharePercent != null
          ? new Prisma.Decimal(b.employeeSharePercent)
          : undefined,
      employerSharePercent:
        b.employerSharePercent != null
          ? new Prisma.Decimal(b.employerSharePercent)
          : undefined,
      monthlyGrossCeiling:
        b.monthlyGrossCeiling !== undefined
          ? b.monthlyGrossCeiling != null
            ? new Prisma.Decimal(b.monthlyGrossCeiling)
            : null
          : undefined,
      flatAmount:
        b.flatAmount !== undefined
          ? b.flatAmount != null
            ? new Prisma.Decimal(b.flatAmount)
            : null
          : undefined,
      applicableFrom: b.applicableFrom ? new Date(b.applicableFrom) : undefined,
      applicableTo:
        b.applicableTo !== undefined
          ? b.applicableTo != null
            ? new Date(b.applicableTo)
            : null
          : undefined,
      enabled: b.enabled ?? existing.enabled,
    },
  });
  res.json(row);
});

statutoryComponentRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.statutoryComponent.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.statutoryComponent.delete({ where: { id: existing.id } });
  res.status(204).send();
});
