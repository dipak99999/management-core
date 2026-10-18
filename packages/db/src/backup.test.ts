// The secrets-crypto module snapshots MASTER_SECRET_KEY at import time.
process.env.MASTER_SECRET_KEY = "c".repeat(64);

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pruneBackups, uploadBackupToS3, verifyBackupArchive } from "./backup";
import { encryptSecrets } from "./secrets-crypto";

// backup.ts is Node-only; here we exercise its behavior against a fake
// PrismaClient. pg_dump-spawning paths need a real environment so aren't
// tested here — that path is exercised by the E2E suite (which sets up
// postgres, then hits POST /backups). The interesting logic to unit-test
// is the S3 upload gating + the prune-includes-S3-delete flow.

describe("uploadBackupToS3", () => {
  let originalFetch: typeof globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      // Default: pretend S3 PUT succeeded. Individual tests can override.
      .mockResolvedValue(new Response("", { status: 200 }));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function fakePrisma(overrides: Record<string, unknown> = {}) {
    return {
      backupJob: {
        findUnique: vi.fn().mockResolvedValue({ id: "job-1", tenantId: "t1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      tenantIntegration: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("returns null (no-op) when tenant has no s3 integration", async () => {
    const prisma = fakePrisma();
    const r = await uploadBackupToS3(prisma, "job-1", "/tmp/dummy.sql");
    expect(r).toBeNull();
    expect(prisma.backupJob.update).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when secrets exist but are malformed", async () => {
    const prisma = fakePrisma({
      tenantIntegration: {
        findFirst: vi.fn().mockResolvedValue({
          // Missing region/bucket/etc — loadS3Config should throw
          secrets: encryptSecrets({ accessKeyId: "x" } as Record<string, unknown>),
        }),
      },
    });
    await expect(uploadBackupToS3(prisma, "job-1", "/tmp/dummy.sql")).rejects.toThrow(
      /s3 integration secrets invalid/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("pruneBackups", () => {
  it("delete rows past keepLast", async () => {
    const rows = [
      { id: "r1", outputPath: "/tmp/1.sql", s3Key: null, createdAt: new Date("2026-08-26") },
      { id: "r2", outputPath: "/tmp/2.sql", s3Key: null, createdAt: new Date("2026-08-25") },
      { id: "r3", outputPath: "/tmp/3.sql", s3Key: null, createdAt: new Date("2026-08-24") },
      { id: "r4", outputPath: "/tmp/4.sql", s3Key: null, createdAt: new Date("2026-08-23") },
    ];
    const del = vi.fn().mockResolvedValue({});
    const prisma = {
      backupJob: {
        findMany: vi.fn().mockResolvedValue(rows),
        delete: del,
      },
      tenantIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await pruneBackups(prisma, "t1", { keepLast: 2 });
    expect(r.deleted).toBe(2); // r3 + r4
    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls[0][0]).toEqual({ where: { id: "r3" } });
    expect(del.mock.calls[1][0]).toEqual({ where: { id: "r4" } });
    expect(r.s3Deleted).toBe(0);
  });

  it("delete rows older than keepDays", async () => {
    const now = Date.now();
    const rows = [
      {
        id: "r1",
        outputPath: null,
        s3Key: null,
        createdAt: new Date(now - 1 * 24 * 3600_000),
      },
      {
        id: "r2",
        outputPath: null,
        s3Key: null,
        createdAt: new Date(now - 100 * 24 * 3600_000), // > 30d
      },
    ];
    const del = vi.fn().mockResolvedValue({});
    const prisma = {
      backupJob: {
        findMany: vi.fn().mockResolvedValue(rows),
        delete: del,
      },
      tenantIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await pruneBackups(prisma, "t1", { keepDays: 30 });
    expect(r.deleted).toBe(1);
    expect(del.mock.calls[0][0]).toEqual({ where: { id: "r2" } });
  });

  it("attempts S3 delete when s3Key present + integration configured", async () => {
    const rows = [
      {
        id: "r-stale",
        outputPath: "/tmp/stale.sql",
        s3Key: "backups/t1/stale.sql",
        createdAt: new Date("2026-01-01"),
      },
    ];
    // Node's Response constructor rejects a body on 204 per fetch spec —
    // pass null body explicitly.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const prisma = {
      backupJob: {
        findMany: vi.fn().mockResolvedValue(rows),
        delete: vi.fn().mockResolvedValue({}),
      },
      tenantIntegration: {
        findFirst: vi.fn().mockResolvedValue({
          secrets: encryptSecrets({
            accessKeyId: "AK",
            secretAccessKey: "SK",
            region: "ap-south-1",
            bucket: "b",
          } as Record<string, unknown>),
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await pruneBackups(prisma, "t1", { keepDays: 30 });
    expect(r.deleted).toBe(1);
    expect(r.s3Deleted).toBe(1);
    // deleteObject presigns a DELETE URL and fetches it
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keepLast=0 and keepDays=0 → nothing pruned", async () => {
    const rows = [
      { id: "r1", outputPath: null, s3Key: null, createdAt: new Date() },
    ];
    const del = vi.fn().mockResolvedValue({});
    const prisma = {
      backupJob: {
        findMany: vi.fn().mockResolvedValue(rows),
        delete: del,
      },
      tenantIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await pruneBackups(prisma, "t1", { keepLast: 0, keepDays: 0 });
    expect(r.deleted).toBe(0);
    expect(del).not.toHaveBeenCalled();
  });
});

// verifyBackupArchive uses the LOCAL path (skipping S3) when the tenant
// has no s3 integration configured — perfect for unit-testing without
// mocking fetch. We write plain-SQL fixtures to a tmpdir + assert the
// header/trailer detection catches truncation.
describe("verifyBackupArchive", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "verify-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Enough length + real markers = valid plain-SQL dump.
  async function writeGoodDump(fileName: string): Promise<string> {
    const fp = path.join(dir, fileName);
    const body =
      "-- PostgreSQL database dump\n" +
      "-- Dumped by pg_dump version 16.0\n\n" +
      "SET statement_timeout = 0;\n" +
      "CREATE TABLE foo (id int);\n".repeat(20) +
      "-- PostgreSQL database dump complete\n";
    await writeFile(fp, body);
    return fp;
  }

  function fakePrismaForJob(job: {
    outputPath: string | null;
    s3Key?: string | null;
    status?: string;
  }) {
    return {
      backupJob: {
        findUnique: vi.fn().mockResolvedValue({
          id: "job-1",
          tenantId: "t1",
          outputPath: job.outputPath,
          s3Key: job.s3Key ?? null,
          status: job.status ?? "Succeeded",
        }),
      },
      backupVerification: { create: vi.fn().mockResolvedValue({}) },
      tenantIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("Succeeded when plain-SQL header + trailer both present", async () => {
    const fp = await writeGoodDump("good.sql");
    const prisma = fakePrismaForJob({ outputPath: fp });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Succeeded");
    expect(r.source).toBe("local");
    expect(prisma.backupVerification.create).toHaveBeenCalledOnce();
  });

  it("Failed when trailer is missing (truncated dump)", async () => {
    const fp = path.join(dir, "truncated.sql");
    await writeFile(
      fp,
      "-- PostgreSQL database dump\n" + "CREATE TABLE foo (id int);\n".repeat(30),
    );
    const prisma = fakePrismaForJob({ outputPath: fp });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/trailer missing/);
  });

  it("Failed when header magic is missing (not a pg_dump)", async () => {
    const fp = path.join(dir, "junk.sql");
    await writeFile(fp, "this is not a pg_dump file at all\n".repeat(30));
    const prisma = fakePrismaForJob({ outputPath: fp });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/header missing/);
  });

  it("Failed when file is 0 bytes", async () => {
    const fp = path.join(dir, "empty.sql");
    await writeFile(fp, "");
    const prisma = fakePrismaForJob({ outputPath: fp });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/0 bytes/);
  });

  it("Failed when file is too small (< 500B) even with valid markers", async () => {
    const fp = path.join(dir, "tiny.sql");
    await writeFile(
      fp,
      "-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n",
    );
    const prisma = fakePrismaForJob({ outputPath: fp });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/suspiciously small/);
  });

  it("Failed when BackupJob is in a non-Succeeded status", async () => {
    const prisma = fakePrismaForJob({
      outputPath: "/tmp/whatever",
      status: "Failed",
    });
    const r = await verifyBackupArchive(prisma, "job-1");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/only Succeeded jobs/);
  });

  it("Failed when BackupJob not found", async () => {
    const prisma = {
      backupJob: { findUnique: vi.fn().mockResolvedValue(null) },
      backupVerification: { create: vi.fn().mockResolvedValue({}) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const r = await verifyBackupArchive(prisma, "nope");
    expect(r.status).toBe("Failed");
    expect(r.error).toMatch(/not found/);
  });
});
