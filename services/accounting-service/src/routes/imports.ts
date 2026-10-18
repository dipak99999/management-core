import { Router } from "express";
import { z } from "zod";
import {
  IMPORTABLE_DOCTYPES,
  IMPORTERS,
  Prisma,
  nextName,
  parseXlsxToRows,
  prisma,
  runImport,
  runImportFromBuffer,
  toCsvRow,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { QUEUE_IMPORTS, enqueue, isQueueReal } from "@lumaara/queue";

// J3-J5: Generic CSV importer. Wraps runImport() from packages/db with an
// ImportJob row that persists row-level status for later review.
//
// Flow:
//   GET /imports/doctypes                    → list of importable doctypes + templates
//   GET /imports/template/:doctype           → sample CSV with headers
//   POST /imports                            → { doctype, csv, mode, keyField, dryRun }
//   GET /imports                             → list of past jobs
//   GET /imports/:id                         → job + row-level results

export const importRouter = Router();

const p = perms("ImportJob");

const importSchema = z
  .object({
    doctype: z.enum(IMPORTABLE_DOCTYPES as unknown as [string, ...string[]]),
    csv: z.string().max(2_000_000).optional(),
    xlsxBase64: z.string().max(6_000_000).optional(), // ~4.5MB after base64 decode
    mode: z.enum(["create", "upsert", "update"]).default("create"),
    keyField: z.string().optional().nullable(),
    dryRun: z.boolean().default(true),
    fileName: z.string().optional().nullable(),
    // { srcHeader → templateKey } from the mapping wizard.
    columnMap: z.record(z.string()).optional(),
  })
  .refine((v) => !!v.csv || !!v.xlsxBase64, {
    message: "csv or xlsxBase64 is required",
  });

importRouter.get("/doctypes", p.read, (_req, res) => {
  res.json({
    doctypes: IMPORTABLE_DOCTYPES.map((d) => {
      const def = IMPORTERS[d];
      const parentCols = def.template.map((c) => ({
        key: c.key,
        label: c.label ?? c.key,
        type: c.type ?? "string",
        required: c.required ?? false,
        scope: "parent" as const,
      }));
      const lineCols = (def.lineFields ?? []).map((c) => ({
        key: c.key,
        label: c.label ?? c.key,
        type: c.type ?? "string",
        required: c.required ?? false,
        scope: "line" as const,
      }));
      return {
        doctype: d,
        supportedKeys: def.supportedKeys,
        parentKey: def.parentKey ?? null,
        columns: [...parentCols, ...lineCols],
      };
    }),
  });
});

importRouter.get("/template/:doctype", p.read, (req, res) => {
  const def = IMPORTERS[req.params.doctype];
  if (!def) return res.status(404).json({ error: "Doctype not importable" });
  // Template includes both parent + line columns. For line-item importers
  // we emit 2 sample rows so the "leave parent blank on continuation rows"
  // convention is visually obvious. Otherwise 1 blank sample row.
  const allCols = [...def.template, ...(def.lineFields ?? [])];
  const header = toCsvRow(allCols.map((c) => c.key));
  const sample1 = toCsvRow(allCols.map(() => ""));
  const rows = def.parentKey && def.lineFields
    ? [header, sample1, toCsvRow(allCols.map(() => ""))]
    : [header, sample1];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${req.params.doctype}-template.csv"`,
  );
  res.send(`${rows.join("\n")}\n`);
});

importRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.importJob.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { rows: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(rows);
});

importRouter.get("/:id", p.read, async (req, res) => {
  const job = await prisma.importJob.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!job) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.importJobRow.findMany({
    where: { importJobId: job.id },
    orderBy: { rowNumber: "asc" },
    take: 500,
  });
  res.json({ ...job, rows });
});

// Wizard step 2: parse the uploaded file locally, return headers + first
// 5 preview rows. No writes. Wizard uses this to render the mapping grid
// (source header ↔ template key) before the actual import call.
importRouter.post("/detect-headers", p.create, async (req, res) => {
  const parsed = z
    .object({
      csv: z.string().max(2_000_000).optional(),
      xlsxBase64: z.string().max(6_000_000).optional(),
    })
    .refine((v) => !!v.csv || !!v.xlsxBase64, {
      message: "csv or xlsxBase64 is required",
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    let rows: string[][];
    if (parsed.data.xlsxBase64) {
      rows = parseXlsxToRows(Buffer.from(parsed.data.xlsxBase64, "base64"));
    } else {
      const { parseCsv } = await import("@lumaara/db");
      rows = parseCsv(parsed.data.csv!);
    }
    const header = (rows[0] ?? []).map((h) => (h ?? "").trim());
    const previewRows = rows.slice(1, 6).map((r) => r.map((c) => c ?? ""));
    res.json({ header, previewRows, rowCount: Math.max(0, rows.length - 1) });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

importRouter.post("/", p.create, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { doctype, csv, xlsxBase64, mode, keyField, dryRun, fileName, columnMap } =
    parsed.data;

  const name = await nextName(prisma, tenantId, "IMP-");

  // L7: when a BullMQ worker is available we enqueue the actual import and
  // return 202 immediately so a 10k-row upload doesn't hold the HTTP thread
  // for minutes. The scheduler service owns the worker + finalizes the row.
  // Fallback (no REDIS_URL) runs synchronously — preserves previous behavior
  // for local dev + tests that don't spin up Redis.
  if (isQueueReal()) {
    const job = await prisma.importJob.create({
      data: {
        tenantId,
        name,
        doctype,
        ownerUserId: req.auth!.userId,
        fileName: fileName ?? null,
        mode,
        keyField: keyField ?? null,
        dryRun,
        status: "Queued",
      },
    });
    await enqueue(
      QUEUE_IMPORTS,
      {
        importJobId: job.id,
        tenantId,
        doctype,
        csv,
        xlsxBase64,
        mode,
        keyField,
        dryRun,
        columnMap,
      },
      { jobName: "import", attempts: 2, backoffMs: 30_000, jobId: job.id },
    );
    return res.status(202).json({ job, queued: true });
  }

  // Synchronous fallback path.
  const job = await prisma.importJob.create({
    data: {
      tenantId,
      name,
      doctype,
      ownerUserId: req.auth!.userId,
      fileName: fileName ?? null,
      mode,
      keyField: keyField ?? null,
      dryRun,
      status: "Running",
      startedAt: new Date(),
    },
  });

  try {
    const result = xlsxBase64
      ? await runImportFromBuffer(
          prisma,
          tenantId,
          doctype,
          Buffer.from(xlsxBase64, "base64"),
          {
            format: "xlsx",
            mode,
            keyField: keyField ?? undefined,
            commit: !dryRun,
            columnMap,
          },
        )
      : await runImport(prisma, tenantId, doctype, csv!, {
          mode,
          keyField: keyField ?? undefined,
          commit: !dryRun,
          columnMap,
        });
    // Persist per-row status.
    await prisma.importJobRow.createMany({
      data: result.rowResults.map((r) => ({
        importJobId: job.id,
        rowNumber: r.rowNumber,
        status: r.status,
        action: r.action ?? null,
        targetId: r.targetId ?? null,
        errorMessage: r.error ?? null,
        rawJson: r.raw as unknown as Prisma.InputJsonValue,
      })),
    });
    const finalStatus =
      result.failed === 0
        ? "Completed"
        : result.succeeded === 0
          ? "Failed"
          : "Completed";
    const updated = await prisma.importJob.update({
      where: { id: job.id },
      data: {
        totalRows: result.totalRows,
        succeededRows: result.succeeded,
        failedRows: result.failed,
        status: finalStatus,
        finishedAt: new Date(),
      },
    });
    res.json({ job: updated, rowResults: result.rowResults });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "Failed", finishedAt: new Date() },
    });
    res.status(400).json({ error: msg });
  }
});
