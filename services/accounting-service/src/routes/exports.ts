import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  REPORTABLE_DOCTYPES,
  prisma,
  runReport,
  toCsvRow,
  type ReportDefinition,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// J6 + J7: Export Presets — saved column/filter/sort layouts for repeated
// exports. `POST /exports/run` triggers a CSV/JSON download either from a
// preset or an ad-hoc definition. Uses runReport under the hood (same
// whitelist as the Report Builder).

export const exportRouter = Router();

const p = perms("ExportPreset");

const filterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"]),
  value: z.unknown(),
});
const sortSchema = z.object({
  field: z.string().min(1),
  dir: z.enum(["asc", "desc"]),
});
const definitionSchema = z.object({
  columns: z.array(z.string()).min(1),
  filters: z.array(filterSchema).default([]),
  sortBy: z.array(sortSchema).default([]),
});

const upsertSchema = z.object({
  doctype: z.enum(REPORTABLE_DOCTYPES as unknown as [string, ...string[]]),
  name: z.string().min(1),
  isShared: z.boolean().default(false),
  columns: z.array(z.string()).min(1),
  filters: z.array(filterSchema).optional().nullable(),
  sortBy: z.array(sortSchema).optional().nullable(),
});

exportRouter.get("/", p.read, async (req, res) => {
  const auth = req.auth!;
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const rows = await prisma.exportPreset.findMany({
    where: {
      tenantId: auth.tenantId,
      ...(doctype ? { doctype } : {}),
      OR: [{ ownerUserId: auth.userId }, { isShared: true }],
    },
    orderBy: [{ doctype: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

exportRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  try {
    const row = await prisma.exportPreset.create({
      data: {
        tenantId: auth.tenantId,
        ownerUserId: auth.userId,
        doctype: parsed.data.doctype,
        name: parsed.data.name,
        isShared: parsed.data.isShared,
        columns: parsed.data.columns as unknown as Prisma.InputJsonValue,
        filters: (parsed.data.filters ?? []) as unknown as Prisma.InputJsonValue,
        sortBy: (parsed.data.sortBy ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Preset name already exists" });
    throw e;
  }
});

exportRouter.delete("/:id", p.delete, async (req, res) => {
  const auth = req.auth!;
  const existing = await prisma.exportPreset.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== auth.userId)
    return res.status(403).json({ error: "Only the owner can delete this preset" });
  await prisma.exportPreset.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Run an export — either by preset id or an ad-hoc definition. Format via
// ?format=csv|json (default csv). Streams as `attachment`.
const runSchema = z
  .object({
    doctype: z.enum(REPORTABLE_DOCTYPES as unknown as [string, ...string[]]).optional(),
    presetId: z.string().optional(),
    definition: definitionSchema.optional(),
  })
  .refine(
    (b) => (b.presetId != null) !== (b.doctype != null && b.definition != null),
    { message: "Provide either presetId OR (doctype + definition)" },
  );

exportRouter.post("/run", perms("Report").read, async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const format = (req.query.format === "json" ? "json" : "csv") as "csv" | "json";

  let doctype: string;
  let def: ReportDefinition;
  let filename: string;
  if (parsed.data.presetId) {
    const preset = await prisma.exportPreset.findFirst({
      where: {
        id: parsed.data.presetId,
        tenantId: auth.tenantId,
        OR: [{ ownerUserId: auth.userId }, { isShared: true }],
      },
    });
    if (!preset) return res.status(404).json({ error: "Preset not found" });
    doctype = preset.doctype;
    def = {
      columns: preset.columns as unknown as string[],
      filters: (preset.filters as unknown as ReportDefinition["filters"]) ?? [],
      sortBy: (preset.sortBy as unknown as ReportDefinition["sortBy"]) ?? [],
    };
    filename = preset.name;
  } else {
    doctype = parsed.data.doctype!;
    def = parsed.data.definition as ReportDefinition;
    filename = `${doctype}-${Date.now()}`;
  }

  try {
    const result = await runReport(prisma, auth.tenantId, doctype, def);
    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}.json"`,
      );
      return res.send(JSON.stringify(result, null, 2));
    }
    const header = toCsvRow(result.columns.map((c) => c.label));
    const rows = result.rows.map((r) =>
      toCsvRow(
        result.columns.map((c) => r[c.key] as string | number | null | undefined),
      ),
    );
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}.csv"`,
    );
    res.send(csv);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});
