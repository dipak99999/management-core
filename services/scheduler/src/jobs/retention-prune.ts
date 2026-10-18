// Retention sweeper — deletes AuditLog + ErrorLog rows older than the
// configured retention window. These tables grow forever by design (they
// capture every mutation + every uncaught error for forensics) and will
// eventually dominate storage + slow queries unless pruned.
//
// Retention windows (env-overridable, days):
//   AUDIT_LOG_RETENTION_DAYS   default 365  — compliance-friendly default
//   ERROR_LOG_RETENTION_DAYS   default 90   — devs rarely care past 3 mo
//   WEBHOOK_LOG_RETENTION_DAYS default 30   — retries exhausted within hours
//
// Deletes are tenant-aware: we walk tenants + prune per-tenant with a cap
// per sweep so one giant tenant can't block the others. The scheduler
// runs this once a day — size the per-sweep caps so a day's worth of
// log churn is prunable in ~5 minutes (soft target).
//
// Set *_RETENTION_DAYS=0 to disable pruning for that log class.

import { prisma } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("scheduler:retention-prune");

const AUDIT_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 365);
const ERROR_DAYS = Number(process.env.ERROR_LOG_RETENTION_DAYS ?? 90);
const WEBHOOK_DAYS = Number(process.env.WEBHOOK_LOG_RETENTION_DAYS ?? 30);

// Hard cap per sweep. Prevents one huge tenant from monopolizing the job
// and blocking others. Any remaining rows get picked up on the next tick.
const BATCH_LIMIT = Number(process.env.RETENTION_BATCH_LIMIT ?? 50_000);

export interface RetentionResult {
  auditDeleted: number;
  errorDeleted: number;
  webhookDeleted: number;
  tenantPolicyDeleted: number;
  durMs: number;
}

// Per-tenant retention via the DataRetentionPolicy model. Lets a tenant
// opt into shorter retention than the global env defaults (e.g. GDPR
// Article 17 right-to-erasure for a tenant on a 30-day email retention).
//
// The policy's `doctype` maps to a Prisma table name here. Only a safe
// allowlist is pruned — business-critical doctypes (SalesInvoice, GLEntry,
// Customer) are deliberately excluded; those are governed by legal/
// accounting retention rules, not an operator-set policy.
const TENANT_PRUNABLE_DOCTYPES: Record<string, { table: string; dateColumn: string }> = {
  AuditLog:          { table: "audit_logs",          dateColumn: "createdAt" },
  ErrorLog:          { table: "error_logs",          dateColumn: "createdAt" },
  EmailMessage:      { table: "email_messages",      dateColumn: "createdAt" },
  TrackingEvent:     { table: "tracking_events",     dateColumn: "createdAt" },
  WebhookDelivery:   { table: "webhook_deliveries",  dateColumn: "createdAt" },
  Notification:      { table: "notifications",       dateColumn: "createdAt" },
  SmsMessage:        { table: "sms_messages",        dateColumn: "createdAt" },
  SiqChatSession:    { table: "siq_chat_sessions",   dateColumn: "createdAt" },
};

async function prunePerTenantPolicies(): Promise<number> {
  const policies = await prisma.dataRetentionPolicy.findMany({
    where: { enabled: true, retainDays: { gt: 0 } },
  });
  let totalDeleted = 0;
  for (const p of policies) {
    const spec = TENANT_PRUNABLE_DOCTYPES[p.doctype];
    if (!spec) {
      // Tenant configured a retention policy for a doctype we don't
      // prune. Log once, skip. Operators should PR an allowlist
      // extension or ignore if the policy is informational.
      log.warn("retention policy for unsupported doctype — skipping", {
        tenantId: p.tenantId,
        doctype: p.doctype,
      });
      continue;
    }
    const cutoff = new Date(Date.now() - p.retainDays * 24 * 60 * 60 * 1000);
    // Only `delete` strategy is honored here. `anonymize` + `archive`
    // require shape-specific logic (which columns are PII, where the
    // archive goes); those happen in a per-doctype handler on write,
    // not in this bulk-prune. The policy row still records the intent.
    if (p.strategy !== "delete") {
      log.info("retention policy skipped (strategy ≠ delete)", {
        tenantId: p.tenantId,
        doctype: p.doctype,
        strategy: p.strategy,
      });
      continue;
    }
    const started = Date.now();
    try {
      const count = await prisma.$executeRawUnsafe(
        `DELETE FROM "${spec.table}" WHERE ctid IN (
           SELECT ctid FROM "${spec.table}"
           WHERE "tenantId" = $1 AND "${spec.dateColumn}" < $2
           LIMIT ${BATCH_LIMIT}
         )`,
        p.tenantId,
        cutoff,
      );
      const n = Number(count);
      totalDeleted += n;
      if (n > 0) {
        log.info("per-tenant retention prune", {
          tenantId: p.tenantId,
          doctype: p.doctype,
          retainDays: p.retainDays,
          deleted: n,
          durMs: Date.now() - started,
        });
      }
      await prisma.dataRetentionPolicy.update({
        where: { id: p.id },
        data: { lastRunAt: new Date() },
      });
    } catch (e) {
      log.error("per-tenant retention prune failed", {
        tenantId: p.tenantId,
        doctype: p.doctype,
        err: e instanceof Error ? e : new Error(String(e)),
      });
    }
  }
  return totalDeleted;
}

async function pruneTable(
  label: string,
  days: number,
  deleteFn: (cutoff: Date) => Promise<{ count: number }>,
): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const started = Date.now();
  // Loop until a sweep removes less than the batch cap — that means we've
  // caught up and there are no more expired rows this tick.
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await deleteFn(cutoff);
    total += r.count;
    if (r.count < BATCH_LIMIT) break;
    // Safety: never loop more than 20 times per sweep (~1M rows at the
    // 50k batch default). Catching up a huge backlog is OK across multiple
    // ticks rather than monopolizing one.
    if (total >= BATCH_LIMIT * 20) break;
  }
  if (total > 0) {
    log.info("pruned", { label, days, deleted: total, durMs: Date.now() - started });
  }
  return total;
}

export async function runRetentionPruneTick(): Promise<RetentionResult> {
  const started = Date.now();
  const auditDeleted = await pruneTable("audit_logs", AUDIT_DAYS, async (cutoff) => {
    // DELETE ... WHERE ... LIMIT isn't valid in standard Postgres — use a
    // CTE with ctid to cap the batch. Prisma $executeRaw returns the row
    // count. Tenant-wide prune; RLS is bypassed here because scheduler
    // runs as the postgres role (or lumaara_app with bypass policy).
    const count = await prisma.$executeRawUnsafe(
      `DELETE FROM "audit_logs" WHERE ctid IN (
         SELECT ctid FROM "audit_logs" WHERE "createdAt" < $1 LIMIT ${BATCH_LIMIT}
       )`,
      cutoff,
    );
    return { count: Number(count) };
  });
  const errorDeleted = await pruneTable("error_logs", ERROR_DAYS, async (cutoff) => {
    const count = await prisma.$executeRawUnsafe(
      `DELETE FROM "error_logs" WHERE ctid IN (
         SELECT ctid FROM "error_logs" WHERE "createdAt" < $1 LIMIT ${BATCH_LIMIT}
       )`,
      cutoff,
    );
    return { count: Number(count) };
  });
  const webhookDeleted = await pruneTable(
    "webhook_deliveries",
    WEBHOOK_DAYS,
    async (cutoff) => {
      const count = await prisma.$executeRawUnsafe(
        `DELETE FROM "webhook_deliveries" WHERE ctid IN (
           SELECT ctid FROM "webhook_deliveries" WHERE "createdAt" < $1 AND status IN ('Succeeded','Failed') LIMIT ${BATCH_LIMIT}
         )`,
        cutoff,
      );
      return { count: Number(count) };
    },
  );
  const tenantPolicyDeleted = await prunePerTenantPolicies();
  return {
    auditDeleted,
    errorDeleted,
    webhookDeleted,
    tenantPolicyDeleted,
    durMs: Date.now() - started,
  };
}
