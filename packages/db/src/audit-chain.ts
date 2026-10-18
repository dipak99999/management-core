// Hash-chained audit log — SOC 2 Type II immutability.
//
// Every AuditLog row hashes its own content together with the previous
// row's entryHash for its tenant. Tampering with any historical row
// breaks the chain, and any missing / inserted row breaks the sequence
// counter — both detectable with `verifyChainForTenant`.
//
// Threat model:
//   - Application bugs writing malformed audit entries (detected)
//   - Operator with DB access editing a row post-hoc (detected)
//   - Operator with DB access deleting rows (detected via sequence gaps)
//   - Operator with DB access who re-computes the entire tail (NOT
//     detected by this alone — pair with off-DB anchoring, e.g. daily
//     signed head-hash sent to an S3 write-once bucket or a public
//     blockchain notary. Future work — see docs/COMPLIANCE.md).

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

// Canonical string form of an entry — key order matters for hash
// stability. Any field change to AuditLog that should be covered by
// integrity must be added here (and only here) so historical entries
// can be verified against the same rule.
function canonicalize(entry: {
  prevHash: string;
  tenantId: string;
  userId: string | null;
  method: string;
  path: string;
  doctype: string | null;
  docId: string | null;
  statusCode: number;
  createdAt: Date;
  payload: unknown;
}): string {
  return [
    entry.prevHash,
    entry.tenantId,
    entry.userId ?? "",
    entry.method,
    entry.path,
    entry.doctype ?? "",
    entry.docId ?? "",
    String(entry.statusCode),
    entry.createdAt.toISOString(),
    JSON.stringify(entry.payload ?? null),
  ].join(""); // ASCII unit separator — never appears in a real payload
}

export function computeEntryHash(entry: Parameters<typeof canonicalize>[0]): string {
  return createHash("sha256").update(canonicalize(entry)).digest("hex");
}

// Given the tenant's latest chain-head row (or null on first write),
// return `{ prevHash, sequence }` for the entry we're about to insert.
export function nextChainHead(
  head: { entryHash: string | null; sequence: number | null } | null,
): { prevHash: string; sequence: number } {
  const prevHash = head?.entryHash ?? "GENESIS";
  const sequence = (head?.sequence ?? 0) + 1;
  return { prevHash, sequence };
}

// Wrap prisma.auditLog.create so every write is chained. Callers pass the
// same data they would to a raw create; this adds prevHash + entryHash +
// sequence transactionally.
//
// Uses an interactive transaction to serialise chain updates per tenant.
// A row-level advisory lock on tenantId prevents two concurrent writers
// from picking the same prevHash. Failure to acquire the lock fast is
// preferable to producing a divergent chain.
export async function writeChainedAuditEntry(
  prisma: PrismaClient,
  data: Omit<Prisma.AuditLogUncheckedCreateInput, "prevHash" | "entryHash" | "sequence">,
): Promise<{ id: string; entryHash: string; sequence: number }> {
  return prisma.$transaction(async (tx) => {
    // Advisory lock keyed by tenantId hash so writes to the same tenant
    // serialise but different tenants don't contend. `pg_advisory_xact_lock`
    // auto-releases at tx end.
    const tenantHashInt = tenantIdToLockKey(data.tenantId);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${tenantHashInt})`);

    const head = await tx.auditLog.findFirst({
      where: { tenantId: data.tenantId },
      orderBy: { sequence: "desc" },
      select: { entryHash: true, sequence: true },
    });
    const { prevHash, sequence } = nextChainHead(head);

    // The DB's server-side default `now()` fires after we compute the
    // hash. Set createdAt explicitly so the hash covers the exact
    // timestamp stored on the row.
    const createdAt = new Date();

    const entryHash = computeEntryHash({
      prevHash,
      tenantId: data.tenantId,
      userId: data.userId ?? null,
      method: data.method,
      path: data.path,
      doctype: data.doctype ?? null,
      docId: data.docId ?? null,
      statusCode: data.statusCode,
      createdAt,
      payload: data.payload,
    });

    const row = await tx.auditLog.create({
      data: {
        ...data,
        createdAt,
        prevHash,
        entryHash,
        sequence,
      },
      select: { id: true },
    });
    return { id: row.id, entryHash, sequence };
  });
}

// ── Super-admin chain ─────────────────────────────────────────────────
//
// SuperAdminAuditLog uses a single global chain (not per-tenant) because
// super-admin ops are platform-level. Serialised via a fixed advisory
// lock key (`SUPER_ADMIN_LOCK_KEY`) so concurrent writers don't diverge.
//
// Threat model + verification shape mirror AuditLog's chain. Reads via
// the super-admin UI (future endpoint) can call `verifySuperAdminChain`.

const SUPER_ADMIN_LOCK_KEY = 0xFEED_BEEFn; // arbitrary but stable

function canonicalizeSuperAdmin(entry: {
  prevHash: string;
  actorUserId: string | null;
  targetTenantId: string | null;
  operation: string;
  method: string;
  path: string;
  statusCode: number | null;
  createdAt: Date;
  payload: unknown;
  reason: string | null;
}): string {
  return [
    entry.prevHash,
    entry.actorUserId ?? "",
    entry.targetTenantId ?? "",
    entry.operation,
    entry.method,
    entry.path,
    entry.statusCode == null ? "" : String(entry.statusCode),
    entry.createdAt.toISOString(),
    JSON.stringify(entry.payload ?? null),
    entry.reason ?? "",
  ].join("");
}

export function computeSuperAdminEntryHash(
  entry: Parameters<typeof canonicalizeSuperAdmin>[0],
): string {
  return createHash("sha256").update(canonicalizeSuperAdmin(entry)).digest("hex");
}

export async function writeChainedSuperAdminEntry(
  prisma: PrismaClient,
  data: Omit<
    Prisma.SuperAdminAuditLogUncheckedCreateInput,
    "prevHash" | "entryHash" | "sequence"
  >,
): Promise<{ id: string; entryHash: string; sequence: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK_KEY})`,
    );
    const head = await tx.superAdminAuditLog.findFirst({
      orderBy: { sequence: "desc" },
      select: { entryHash: true, sequence: true },
    });
    const { prevHash, sequence } = nextChainHead(head);
    const createdAt = new Date();
    const entryHash = computeSuperAdminEntryHash({
      prevHash,
      actorUserId: data.actorUserId ?? null,
      targetTenantId: data.targetTenantId ?? null,
      operation: data.operation,
      method: data.method,
      path: data.path,
      statusCode: data.statusCode ?? null,
      createdAt,
      payload: data.payload,
      reason: data.reason ?? null,
    });
    const row = await tx.superAdminAuditLog.create({
      data: {
        ...data,
        createdAt,
        prevHash,
        entryHash,
        sequence,
      },
      select: { id: true },
    });
    return { id: row.id, entryHash, sequence };
  });
}

// Convert a cuid string into a bigint suitable for pg_advisory_xact_lock
// (signed 64-bit). We just fold the SHA-256 of the tenantId into 8 bytes.
function tenantIdToLockKey(tenantId: string): bigint {
  const hash = createHash("sha256").update(tenantId).digest();
  // Take the first 8 bytes as a signed big-endian bigint. Range is
  // [-2^63, 2^63-1] which is exactly what pg_advisory_xact_lock expects.
  const high = BigInt(hash.readInt32BE(0));
  const low = BigInt(hash.readUInt32BE(4));
  return (high << 32n) | low;
}

// ── Verification ──────────────────────────────────────────────────────

export interface ChainVerification {
  tenantId: string;
  ok: boolean;
  total: number;
  firstBrokenSequence: number | null;
  firstBrokenId: string | null;
  reason?: string;
}

// Walk every AuditLog row for a tenant in sequence order, recomputing the
// hash for each and comparing to the stored value. Stops at the first
// mismatch. Reports total rows verified + whether the chain is intact.
//
// Rows with `prevHash: null` are treated as unchained legacy entries and
// skipped from the verification (they exist for backward compat during
// the migration window). The first chained row's prevHash must be
// "GENESIS". Any gap in the sequence is a hard failure.
export async function verifyChainForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<ChainVerification> {
  let cursor: string | undefined;
  let prevSequence = 0;
  let prevEntryHash: string | null = null;
  let total = 0;

  // Page in 1k chunks to keep memory bounded on tenants with millions
  // of audit rows.
  while (true) {
    const page = await prisma.auditLog.findMany({
      where: { tenantId, entryHash: { not: null } },
      orderBy: { sequence: "asc" },
      take: 1000,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
    });
    if (page.length === 0) break;

    for (const row of page) {
      if (row.sequence == null || row.entryHash == null || row.prevHash == null) {
        return {
          tenantId,
          ok: false,
          total,
          firstBrokenSequence: row.sequence,
          firstBrokenId: row.id,
          reason: "Chain row missing sequence/entryHash/prevHash",
        };
      }
      const expectedSequence = prevSequence + 1;
      if (row.sequence !== expectedSequence) {
        return {
          tenantId,
          ok: false,
          total,
          firstBrokenSequence: row.sequence,
          firstBrokenId: row.id,
          reason: `Sequence gap: expected ${expectedSequence}, got ${row.sequence}`,
        };
      }
      const expectedPrev = prevEntryHash ?? "GENESIS";
      if (row.prevHash !== expectedPrev) {
        return {
          tenantId,
          ok: false,
          total,
          firstBrokenSequence: row.sequence,
          firstBrokenId: row.id,
          reason: `prevHash mismatch: stored ${row.prevHash.slice(0, 12)}… expected ${expectedPrev.slice(0, 12)}…`,
        };
      }
      const recomputed = computeEntryHash({
        prevHash: row.prevHash,
        tenantId: row.tenantId,
        userId: row.userId,
        method: row.method,
        path: row.path,
        doctype: row.doctype,
        docId: row.docId,
        statusCode: row.statusCode,
        createdAt: row.createdAt,
        payload: row.payload as unknown,
      });
      if (recomputed !== row.entryHash) {
        return {
          tenantId,
          ok: false,
          total,
          firstBrokenSequence: row.sequence,
          firstBrokenId: row.id,
          reason: "entryHash mismatch — row content differs from what was signed",
        };
      }

      prevSequence = row.sequence;
      prevEntryHash = row.entryHash;
      total++;
    }
    cursor = page[page.length - 1].id;
  }

  return {
    tenantId,
    ok: true,
    total,
    firstBrokenSequence: null,
    firstBrokenId: null,
  };
}
