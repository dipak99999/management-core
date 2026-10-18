// Audit-chain head-hash snapshot job — SOC 2 tamper-evidence.
//
// Threat: an operator with DB access rewrites AuditLog rows AND recomputes
// entryHash forward. The chain still verifies internally, but the recomputed
// head diverges from what it was yesterday. If yesterday's head-hash was
// captured OUTSIDE the DB, we can detect the tampering.
//
// This job runs daily. For every tenant it reads the latest AuditLog row,
// writes {tenantId, sequence, entryHash, snapshotAt, hmac} to a JSON-lines
// file under $AUDIT_SNAPSHOT_DIR (default /var/lumaara/backups/audit-head).
// The line is HMAC'd with MASTER_SECRET_KEY so a compromise of the file
// alone (without the key) can't produce a valid forged line.
//
// Ops ships this directory off-box via the same rsync path that carries
// pg_dump — the offsite copy is the durable tamper-evidence anchor.

import { promises as fs } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { prisma, withCrossTenant } from "@lumaara/db";

export interface AuditHeadSnapshotResult {
  tenantsSnapshotted: number;
  path: string;
}

function loadHmacKey(): string {
  const key = process.env.MASTER_SECRET_KEY ?? "";
  if (!key)
    throw new Error(
      "MASTER_SECRET_KEY not set — audit-head snapshot cannot sign lines",
    );
  return key;
}

function signLine(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

export async function runAuditHeadSnapshotTick(): Promise<AuditHeadSnapshotResult> {
  const dir = process.env.AUDIT_SNAPSHOT_DIR ?? "/var/lumaara/backups/audit-head";
  await fs.mkdir(dir, { recursive: true });
  const key = loadHmacKey();

  const now = new Date();
  const outfile = path.join(dir, `${now.toISOString().slice(0, 10)}.jsonl`);

  // withCrossTenant() — this is an ops job that reads every tenant's audit
  // head. There is no req.auth to key against, so we bypass tenant-guard.
  const tenants = await prisma.tenant.findMany(
    withCrossTenant({ select: { id: true, slug: true } }),
  );

  const lines: string[] = [];
  for (const t of tenants) {
    const head = await prisma.auditLog.findFirst({
      where: { tenantId: t.id },
      orderBy: { sequence: "desc" },
      select: { entryHash: true, sequence: true, createdAt: true },
    });
    if (!head) continue; // no audit rows yet for this tenant
    const payload = {
      tenantId: t.id,
      tenantSlug: t.slug,
      sequence: head.sequence,
      entryHash: head.entryHash,
      lastEntryAt: head.createdAt.toISOString(),
      snapshotAt: now.toISOString(),
    };
    const body = JSON.stringify(payload);
    lines.push(JSON.stringify({ ...payload, hmac: signLine(body, key) }));
  }

  if (lines.length > 0) {
    await fs.appendFile(outfile, lines.join("\n") + "\n", { mode: 0o600 });
  }

  return { tenantsSnapshotted: lines.length, path: outfile };
}
