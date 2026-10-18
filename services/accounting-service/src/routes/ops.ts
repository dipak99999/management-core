import { Router } from "express";
import { z } from "zod";
import {
  createBackupJob,
  prisma,
  pruneBackups as pruneBackupsDb,
  runBackupJob,
  verifyBackupArchive,
} from "@lumaara/db";
import { perms, renderMetrics } from "@lumaara/service-auth";

// M2 + M3 + M4 + M5 + M6 + M7: ops endpoints — health readiness, /metrics,
// system info, feature flags CRUD, backup runner, error log viewer.

export const opsPublicRouter = Router();  // no auth
export const opsAdminRouter = Router();   // requires staff auth
export const featureFlagRouter = Router();
export const backupRouter = Router();
export const errorLogRouter = Router();

const pF = perms("FeatureFlag");
const pB = perms("BackupJob");
const pE = perms("ErrorLog");

// ---------- M2: Health / readiness ----------

opsPublicRouter.get("/health/ready", async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: e instanceof Error ? e.message : "unknown" };
  }
  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks, service: "accounting-service" });
});

// ---------- M7: Prometheus metrics ----------

opsPublicRouter.get("/metrics", (_req, res) => {
  res.setHeader("content-type", "text/plain; version=0.0.4");
  res.send(renderMetrics("accounting-service"));
});

// ---------- M3: System info ----------

opsAdminRouter.get("/system-info", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [
    tenantCount,
    userCount,
    customerCount,
    supplierCount,
    itemCount,
    siCount,
    piCount,
    peCount,
    employeeCount,
    dbSize,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.user.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.item.count({ where: { tenantId } }),
    prisma.salesInvoice.count({ where: { tenantId } }),
    prisma.purchaseInvoice.count({ where: { tenantId } }),
    prisma.paymentEntry.count({ where: { tenantId } }),
    prisma.employee.count({ where: { tenantId } }),
    prisma.$queryRaw<{ size: string }[]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `.catch(() => [] as { size: string }[]),
  ]);
  res.json({
    version: process.env.APP_VERSION ?? "dev",
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    dbSize: dbSize[0]?.size ?? "unknown",
    counts: {
      tenants: tenantCount,
      users: userCount,
      customers: customerCount,
      suppliers: supplierCount,
      items: itemCount,
      salesInvoices: siCount,
      purchaseInvoices: piCount,
      paymentEntries: peCount,
      employees: employeeCount,
    },
  });
});

// ---------- M4: Feature flags CRUD ----------

const flagSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
  label: z.string().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(false),
  rolloutPercent: z.coerce.number().int().min(0).max(100).default(100),
});

featureFlagRouter.get("/", pF.read, async (req, res) => {
  const rows = await prisma.featureFlag.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { key: "asc" },
  });
  res.json(rows);
});

featureFlagRouter.post("/", pF.create, async (req, res) => {
  const parsed = flagSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.featureFlag.create({
      data: { tenantId: req.auth!.tenantId, ...parsed.data },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Flag key already exists" });
    throw e;
  }
});

featureFlagRouter.put("/:id", pF.write, async (req, res) => {
  const parsed = flagSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.featureFlag.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.featureFlag.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

featureFlagRouter.delete("/:id", pF.delete, async (req, res) => {
  const existing = await prisma.featureFlag.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.featureFlag.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ---------- M5: Backup runner ----------

backupRouter.get("/", pB.read, async (req, res) => {
  const rows = await prisma.backupJob.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      verifications: {
        orderBy: { verifiedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          source: true,
          verifiedAt: true,
          error: true,
        },
      },
    },
  });
  // Flatten the last verification onto the row for easier UI consumption.
  res.json(
    rows.map((r) => {
      const lastVerify = r.verifications[0] ?? null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { verifications: _drop, ...rest } = r;
      return { ...rest, lastVerify };
    }),
  );
});

// Manual verify — kick off verifyBackupArchive for a specific job.
// Returns the persisted BackupVerification row synchronously (verification
// is fast — bytes are already on disk / S3).
backupRouter.post("/:id/verify", pB.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const job = await prisma.backupJob.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!job) return res.status(404).json({ error: "Not found" });
  const r = await verifyBackupArchive(prisma, job.id);
  res.json(r);
});

backupRouter.post("/", pB.create, async (req, res) => {
  const parsed = z
    .object({
      kind: z.enum(["full", "schema-only", "data-only"]).default("full"),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const url = process.env.DATABASE_URL;
  if (!url) return res.status(500).json({ error: "DATABASE_URL not set" });

  const backupDir = process.env.BACKUP_DIR ?? "/tmp/lumaara-backups";
  const keepLast = Number(process.env.BACKUP_KEEP_LAST ?? 30);
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS ?? 90);

  // Two-phase: reserve the BackupJob row synchronously so we can hand its
  // id back to the client as a poll target, then fire-and-forget the actual
  // pg_dump + S3 upload + prune (they can take a few minutes on real data).
  const tenantId = req.auth!.tenantId;
  const kind = parsed.data.kind;

  const { id, outputPath } = await createBackupJob(prisma, {
    tenantId,
    kind,
    backupDir,
  });

  void runBackupJob(prisma, id, {
    databaseUrl: url,
    kind,
    outputPath,
    keepLast,
    keepDays,
  }).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[backup] runBackupJob threw for job ${id}:`, e);
  });

  const job = await prisma.backupJob.findUnique({ where: { id } });
  res.status(202).json(job);
});

backupRouter.post("/prune", pB.delete, async (req, res) => {
  const parsed = z
    .object({
      keepLast: z.coerce.number().int().min(0).optional(),
      keepDays: z.coerce.number().int().min(0).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { keepLast, keepDays } = parsed.data;
  if ((keepLast ?? 0) === 0 && (keepDays ?? 0) === 0)
    return res.status(400).json({ error: "keepLast or keepDays must be > 0" });
  const r = await pruneBackupsDb(prisma, req.auth!.tenantId, { keepLast, keepDays });
  res.json(r);
});

// ---------- M6: Error log viewer ----------

errorLogRouter.get("/", pE.read, async (req, res) => {
  const rows = await prisma.errorLog.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

errorLogRouter.delete("/", pE.delete, async (req, res) => {
  // Prune older than N days (default 30) — for retention hygiene.
  const days = Number(req.query.olderThanDays ?? 30);
  const cutoff = new Date(Date.now() - days * 24 * 3600_000);
  const r = await prisma.errorLog.deleteMany({
    where: { tenantId: req.auth!.tenantId, createdAt: { lt: cutoff } },
  });
  res.json({ deleted: r.count });
});
