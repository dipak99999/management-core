import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  REPORT_DOCTYPE_META,
  REPORTABLE_DOCTYPES,
  getDoctypeMeta,
  prisma,
  runReport,
  type ReportDefinition,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Report Builder API — configurable queries over a whitelisted set of
// doctypes. Also wraps SavedReport CRUD (persisted definitions) and the
// per-doctype meta endpoint used by the frontend to render the builder UI.

export const reportsBuilderRouter = Router();

const reportPerms = perms("Report");
const savedPerms = perms("SavedReport");

// Public within tenant: meta reveals the doctype list + column catalog, no
// data. Anyone building a report needs this.
reportsBuilderRouter.get("/meta", (_req, res) => {
  res.json({
    doctypes: Object.values(REPORT_DOCTYPE_META).map((m) => ({
      doctype: m.doctype,
      label: m.label,
      columns: m.columns,
      filterableFields: m.filterableFields,
      sortableFields: m.sortableFields,
      defaultColumns: m.defaultColumns,
    })),
  });
});

reportsBuilderRouter.get("/meta/:doctype", (req, res) => {
  const meta = getDoctypeMeta(req.params.doctype);
  if (!meta) return res.status(404).json({ error: "Doctype not reportable" });
  res.json(meta);
});

// Execute a report definition without saving. Gated on Report:read + per-
// doctype read (so a user can't run a Report over a doctype they can't see).
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
  limit: z.coerce.number().int().positive().max(1000).optional(),
});
const runSchema = definitionSchema.extend({
  doctype: z.enum(REPORTABLE_DOCTYPES as unknown as [string, ...string[]]),
});

reportsBuilderRouter.post("/run", reportPerms.read, async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Per-doctype read gate. Manually check because the doctype isn't statically
  // known at route-definition time.
  const auth = req.auth!;
  const isAdmin =
    auth.roles.includes("SystemManager") || auth.role === "admin";
  if (!isAdmin) {
    const rows = await prisma.rolePermission.findMany({
      where: {
        tenantId: auth.tenantId,
        doctype: parsed.data.doctype,
        action: "read",
        role: { userRoles: { some: { userId: auth.userId } } },
      },
      select: { id: true },
      take: 1,
    });
    if (rows.length === 0)
      return res.status(403).json({
        error: `Forbidden: read on ${parsed.data.doctype} required to run this report`,
      });
  }

  try {
    const { doctype, ...def } = parsed.data;
    const result = await runReport(prisma, auth.tenantId, doctype, def as ReportDefinition);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// ---------- Saved Reports ----------

const createSavedSchema = z.object({
  name: z.string().min(1).max(80),
  doctype: z.enum(REPORTABLE_DOCTYPES as unknown as [string, ...string[]]),
  isShared: z.boolean().default(false),
  sharedRoles: z.array(z.string()).default([]),
  description: z.string().optional().nullable(),
  definition: definitionSchema,
});

// List: owner's own + all fully shared + role-scoped shares that intersect
// the caller's roles.
reportsBuilderRouter.get("/saved", savedPerms.read, async (req, res) => {
  const auth = req.auth!;
  const rows = await prisma.savedReport.findMany({
    where: {
      tenantId: auth.tenantId,
      OR: [
        { ownerUserId: auth.userId },
        { isShared: true },
        auth.roles.length > 0
          ? { sharedRoles: { hasSome: auth.roles } }
          : { id: "__never__" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  // Attach bookmark flags for this user in one shot.
  const bookmarks = await prisma.reportBookmark.findMany({
    where: { tenantId: auth.tenantId, userId: auth.userId },
    select: { savedReportId: true },
  });
  const bookmarked = new Set(bookmarks.map((b) => b.savedReportId));
  res.json(rows.map((r) => ({ ...r, isBookmarked: bookmarked.has(r.id) })));
});

reportsBuilderRouter.get("/saved/:id", savedPerms.read, async (req, res) => {
  const auth = req.auth!;
  const row = await prisma.savedReport.findFirst({
    where: {
      id: req.params.id,
      tenantId: auth.tenantId,
      OR: [
        { ownerUserId: auth.userId },
        { isShared: true },
        auth.roles.length > 0
          ? { sharedRoles: { hasSome: auth.roles } }
          : { id: "__never__" },
      ],
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

reportsBuilderRouter.post("/saved", savedPerms.create, async (req, res) => {
  const parsed = createSavedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.savedReport.create({
      data: {
        tenantId: req.auth!.tenantId,
        ownerUserId: req.auth!.userId,
        name: parsed.data.name,
        doctype: parsed.data.doctype,
        isShared: parsed.data.isShared,
        sharedRoles: parsed.data.sharedRoles,
        description: parsed.data.description ?? null,
        definition:
          parsed.data.definition as unknown as Prisma.InputJsonValue,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "A saved report with this name already exists" });
    }
    throw e;
  }
});

// Update: only the owner can change definition/isShared/name.
const updateSavedSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isShared: z.boolean().optional(),
  sharedRoles: z.array(z.string()).optional(),
  description: z.string().optional().nullable(),
  definition: definitionSchema.optional(),
});

reportsBuilderRouter.put("/saved/:id", savedPerms.write, async (req, res) => {
  const parsed = updateSavedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.savedReport.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== req.auth!.userId)
    return res.status(403).json({ error: "Only the owner can modify this saved report" });
  const { definition, ...rest } = parsed.data;
  const row = await prisma.savedReport.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(definition !== undefined
        ? {
            definition: definition as unknown as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
  res.json(row);
});

reportsBuilderRouter.delete("/saved/:id", savedPerms.delete, async (req, res) => {
  const existing = await prisma.savedReport.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.ownerUserId !== req.auth!.userId)
    return res.status(403).json({ error: "Only the owner can delete this saved report" });
  await prisma.savedReport.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- G6: Bookmarks ----------

reportsBuilderRouter.post("/saved/:id/bookmark", savedPerms.write, async (req, res) => {
  const auth = req.auth!;
  const saved = await prisma.savedReport.findFirst({
    where: { id: req.params.id, tenantId: auth.tenantId },
  });
  if (!saved) return res.status(404).json({ error: "Not found" });
  try {
    await prisma.reportBookmark.create({
      data: { tenantId: auth.tenantId, userId: auth.userId, savedReportId: saved.id },
    });
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(200).json({ ok: true, already: true });
    throw e;
  }
});

reportsBuilderRouter.delete("/saved/:id/bookmark", savedPerms.write, async (req, res) => {
  await prisma.reportBookmark.deleteMany({
    where: {
      tenantId: req.auth!.tenantId,
      userId: req.auth!.userId,
      savedReportId: req.params.id,
    },
  });
  res.status(204).send();
});

// ---------- G9: Export ----------

function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      if (c == null) return "";
      const s = String(c);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(",");
}

reportsBuilderRouter.post("/run/export", reportPerms.read, async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const format = (req.query.format === "json" ? "json" : "csv") as "csv" | "json";

  try {
    const { doctype, ...def } = parsed.data;
    const result = await runReport(prisma, req.auth!.tenantId, doctype, def as ReportDefinition);
    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${doctype}-${Date.now()}.json"`,
      );
      return res.send(JSON.stringify(result, null, 2));
    }
    const header = toCsvRow(result.columns.map((c) => c.label));
    const rows = result.rows.map((r) =>
      toCsvRow(result.columns.map((c) => r[c.key] as string | number | null | undefined)),
    );
    const csv = [header, ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${doctype}-${Date.now()}.csv"`,
    );
    res.send(csv);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

reportsBuilderRouter.get(
  "/saved/:id/export",
  reportPerms.read,
  async (req, res) => {
    const auth = req.auth!;
    const saved = await prisma.savedReport.findFirst({
      where: {
        id: req.params.id,
        tenantId: auth.tenantId,
        OR: [
          { ownerUserId: auth.userId },
          { isShared: true },
          auth.roles.length > 0
            ? { sharedRoles: { hasSome: auth.roles } }
            : { id: "__never__" },
        ],
      },
    });
    if (!saved) return res.status(404).json({ error: "Not found" });
    const format = (req.query.format === "json" ? "json" : "csv") as "csv" | "json";
    try {
      const result = await runReport(
        prisma,
        auth.tenantId,
        saved.doctype,
        saved.definition as unknown as ReportDefinition,
      );
      if (format === "json") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${saved.name}.json"`,
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
        `attachment; filename="${saved.name}.csv"`,
      );
      res.send(csv);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  },
);
