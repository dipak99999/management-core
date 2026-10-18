import {
  Prisma,
  prisma,
  runImport,
  runImportFromBuffer,
} from "@lumaara/db";
import {
  QUEUE_IMPORTS,
  startWorker,
  type ImportJobPayload,
} from "@lumaara/queue";
import { getLogger } from "@lumaara/service-auth";

// BullMQ worker for the ImportJob queue. The accounting-service enqueues
// jobs from POST /imports; this worker picks them up, runs the import
// pipeline against packages/db, and persists row-level results.
//
// Contract with the enqueuer:
//   * The ImportJob row already exists (status="Queued") when we receive
//     the job. Worker moves it to Running → Completed | Failed.
//   * On BullMQ retry (transient failures like DB blips), the whole handler
//     re-runs. runImport is idempotent when commit=false (dry-run) but has
//     side effects when commit=true. To avoid duplicate writes on retry we
//     skip if the job has already reached a terminal status.

const log = getLogger("scheduler");

export function startImportWorker() {
  return startWorker<ImportJobPayload>(QUEUE_IMPORTS, async (job) => {
    const d = job.data as ImportJobPayload;
    const existing = await prisma.importJob.findUnique({
      where: { id: d.importJobId },
      select: { status: true },
    });
    if (!existing) {
      log.warn("import worker: missing ImportJob row", {
        importJobId: d.importJobId,
      });
      return { skipped: true };
    }
    if (existing.status === "Completed" || existing.status === "Failed") {
      // Retry after the previous attempt already finalized the row — bail
      // out to avoid double-processing.
      log.info("import worker: already terminal, skipping retry", {
        importJobId: d.importJobId,
        status: existing.status,
      });
      return { skipped: true };
    }

    await prisma.importJob.update({
      where: { id: d.importJobId },
      data: { status: "Running", startedAt: new Date() },
    });

    try {
      const result = d.xlsxBase64
        ? await runImportFromBuffer(
            prisma,
            d.tenantId,
            d.doctype,
            Buffer.from(d.xlsxBase64, "base64"),
            {
              format: "xlsx",
              mode: d.mode,
              keyField: d.keyField ?? undefined,
              commit: !d.dryRun,
              columnMap: d.columnMap,
            },
          )
        : await runImport(prisma, d.tenantId, d.doctype, d.csv!, {
            mode: d.mode,
            keyField: d.keyField ?? undefined,
            commit: !d.dryRun,
            columnMap: d.columnMap,
          });

      await prisma.importJobRow.createMany({
        data: result.rowResults.map((r) => ({
          importJobId: d.importJobId,
          rowNumber: r.rowNumber,
          status: r.status,
          action: r.action ?? null,
          targetId: r.targetId ?? null,
          errorMessage: r.error ?? null,
          rawJson: r.raw as unknown as Prisma.InputJsonValue,
        })),
      });

      const finalStatus = result.failed === 0 ? "Completed" : "Completed";
      await prisma.importJob.update({
        where: { id: d.importJobId },
        data: {
          totalRows: result.totalRows,
          succeededRows: result.succeeded,
          failedRows: result.failed,
          status: finalStatus,
          finishedAt: new Date(),
        },
      });

      return {
        totalRows: result.totalRows,
        succeeded: result.succeeded,
        failed: result.failed,
      };
    } catch (e) {
      await prisma.importJob.update({
        where: { id: d.importJobId },
        data: {
          status: "Failed",
          finishedAt: new Date(),
        },
      });
      throw e; // Let BullMQ record the failure + retry per queue policy.
    }
  });
}

