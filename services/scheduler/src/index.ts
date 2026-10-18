// MUST be the very first import — sets TENANT_GUARD_MODE before
// anything else reads it. tsx/esbuild hoists imports to the top of the
// file so inline env assignments between imports don't actually run
// first. See env-setup.ts for the full rationale.
import "./env-setup";

import { initOtel } from "@lumaara/service-auth";
initOtel("scheduler");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("scheduler");

import { randomUUID } from "node:crypto";
import express from "express";
import { prisma, processWebhookDeliveries } from "@lumaara/db";
import {
  corsMiddleware,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  apiLimiter,
  requestLogger,
  requireAuth,
  securityHeaders,
  validateEnv,
} from "@lumaara/service-auth";
import { runReorderCheck, summarizeReorderResult } from "./jobs/reorder-check";
import { runRecurringInvoicesTick } from "./jobs/recurring-invoices";
import { runPaymentRemindersTick } from "./jobs/payment-reminders";
import { runLoyaltyExpiryTick } from "./jobs/loyalty-expiry";
import { runBatchExpiryTick } from "./jobs/batch-expiry";
import { runAssetDepreciationTick } from "./jobs/asset-depreciation";
import { runDeferredRevenueTick } from "./jobs/deferred-revenue";
import { runStockRepostTick } from "./jobs/stock-repost";
import { runSupplierScorecardTick } from "./jobs/supplier-scorecard";
import { runJeAutoReverseTick } from "./jobs/je-auto-reverse";
import { runBookingRemindersTick } from "./jobs/booking-reminders";
import { runEmailSyncTick } from "./jobs/email-sync";
import { runEmbeddingRefreshTick } from "./jobs/embedding-refresh";
import { runEmailSequenceTick } from "./jobs/email-sequences";
import { runDeskSlaCheck } from "./jobs/desk-sla";
import { runSocialPublishTick } from "./jobs/social-publish";
import { runSocialEngagementTick } from "./jobs/social-engagement";
import { runScheduledReportsTick } from "./jobs/scheduled-reports";
import { runErrorRateCheck } from "./jobs/error-rate-alert";
import { runAutoBackupsTick } from "./jobs/backup-auto";
import { runBackupVerifyTick } from "./jobs/backup-verify";
import { runAiInboxScanTick } from "./jobs/ai-inbox-scan";
import { runAiInboxDigestTick } from "./jobs/ai-inbox-digest";
import { runAbWinnerTick } from "./jobs/ab-winner";
import { runJourneyTick } from "./jobs/journeys";
import { runIdempotencySweepTick } from "./jobs/idempotency-sweep";
import { runAuditHeadSnapshotTick } from "./jobs/audit-head-snapshot";
import { runRetentionPruneTick } from "./jobs/retention-prune";
import { runSubscriptionExpiryTick } from "./jobs/subscription-expiry";
import { runWithLeaderLock, isLeader } from "./lib/leader-lock";
import { startImportWorker } from "./jobs/import-worker";
import {
  ALL_QUEUE_NAMES,
  getQueueStats,
  isQueueReal,
  scheduleRepeatable,
  stopAllRepeatables,
} from "@lumaara/queue";

validateEnv({
  required: ["DATABASE_URL", "MASTER_SECRET_KEY"],
  optional: { PORT: "4009" },
});
installCrashHandlers("scheduler");
const log = getLogger("scheduler");

// L6b: In-process cron scheduler. Two classes of jobs:
//   1. Direct jobs — run library functions against the shared prisma client
//      inline. Fast, no auth required, primary use case is webhook drains.
//   2. HTTP jobs — POST to internal endpoints in other services with a
//      SCHEDULER_API_TOKEN (an ApiToken with SystemManager permissions).
//      Configured via env var CRON_HTTP_JOBS as a JSON array. Empty by
//      default so the scheduler can start with no config and just tick the
//      direct jobs.
//
// Health surface (/health, /health/ready, /metrics) mirrors the other
// services so ops / kubelets can probe it consistently.

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("scheduler"));
app.use(apiLimiter);
app.use(express.json());
app.use(normalizeBody);
mountBasicOps(app, "scheduler");

// Diagnostic surface: last-tick timestamp per job, cumulative counts. Kept
// in-memory since the scheduler is a singleton.
type JobStats = {
  runs: number;
  lastRun: string | null;
  lastResult: string | null;
  lastError: string | null;
  // Consecutive failures since the last successful run. Reset to 0 on
  // success. Hitting SCHEDULER_FAILURE_ALERT_THRESHOLD (default 3) fires
  // a FATAL log line + bumps the scheduler_job_failures_total metric so
  // Prometheus alert rules can page on it.
  consecutiveFailures: number;
};
const stats: Record<string, JobStats> = {};

function recordStart(job: string): void {
  stats[job] ??= {
    runs: 0,
    lastRun: null,
    lastResult: null,
    lastError: null,
    consecutiveFailures: 0,
  };
}
function recordOk(job: string, summary: string): void {
  const s = stats[job]!;
  s.runs += 1;
  s.lastRun = new Date().toISOString();
  s.lastResult = summary;
  s.lastError = null;
  s.consecutiveFailures = 0;
}

const FAILURE_ALERT_THRESHOLD = Number(
  process.env.SCHEDULER_FAILURE_ALERT_THRESHOLD ?? 3,
);

function recordErr(job: string, err: unknown): void {
  const s = stats[job]!;
  s.runs += 1;
  s.lastRun = new Date().toISOString();
  s.lastResult = "error";
  s.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  s.consecutiveFailures += 1;
  // Fire a FATAL log once per threshold crossing. Keep firing on each
  // subsequent failure past the threshold so the alert rule can "page
  // again if still failing after N min" without any state in the
  // scheduler. The log's `event` field is the dedupe/routing key.
  if (s.consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
    log.fatal("scheduler job failing repeatedly", {
      event: "scheduler_job_failing_repeatedly",
      job,
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError,
    });
  }
}

app.get("/jobs", (_req, res) => res.json(stats));

// Prometheus-scrapable scheduler-specific metrics. mountBasicOps already
// serves the generic http_* counters at /metrics; this additional path
// surfaces per-job state so operators can alert on
// `scheduler_consecutive_failures{job="X"} >= 3`. Prometheus scrape
// config lists both targets.
app.get("/metrics-scheduler", (_req, res) => {
  const lines: string[] = [
    "# HELP scheduler_consecutive_failures Consecutive failures for a job since its last success",
    "# TYPE scheduler_consecutive_failures gauge",
  ];
  for (const [job, s] of Object.entries(stats)) {
    const safeJob = job.replace(/[\\"\n]/g, "");
    lines.push(
      `scheduler_consecutive_failures{job="${safeJob}"} ${s.consecutiveFailures}`,
    );
  }
  lines.push("# HELP scheduler_runs_total Total tick invocations per job");
  lines.push("# TYPE scheduler_runs_total counter");
  for (const [job, s] of Object.entries(stats)) {
    const safeJob = job.replace(/[\\"\n]/g, "");
    lines.push(`scheduler_runs_total{job="${safeJob}"} ${s.runs}`);
  }
  res.setHeader("content-type", "text/plain; version=0.0.4");
  res.send(lines.join("\n") + "\n");
});

// Leader-election status. `leader: true` means this replica is running the
// tick loops; standbys return `leader: false` and hold empty stats.
app.get("/leader", (_req, res) => {
  res.json({
    leader: isLeader(),
    electionEnabled: process.env.LEADER_ELECTION !== "0",
  });
});

// L7: async work queues (BullMQ). /queues surfaces per-queue depth + mode
// (real vs inline fallback). Public — no auth — same as /jobs, since this
// service is not exposed to end users.
app.get("/queues", async (_req, res) => {
  try {
    const queues = await getQueueStats(ALL_QUEUE_NAMES as unknown as string[]);
    res.json({ redis: isQueueReal() ? "connected" : "inline-fallback", queues });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "queue stats failed",
    });
  }
});

// ---------- Direct in-process jobs ----------

async function tickWebhookDrain(): Promise<void> {
  recordStart("webhook-drain");
  try {
    const r = await processWebhookDeliveries(prisma, { limit: 100 });
    recordOk(
      "webhook-drain",
      `processed=${r.processed} delivered=${r.delivered} retrying=${r.retrying} failed=${r.failed}`,
    );
  } catch (e) {
    recordErr("webhook-drain", e);
  }
}

async function tickReorderCheck(): Promise<void> {
  recordStart("reorder-check");
  try {
    const r = await runReorderCheck();
    recordOk("reorder-check", summarizeReorderResult(r));
  } catch (e) {
    recordErr("reorder-check", e);
  }
}

async function tickRecurringInvoices(): Promise<void> {
  recordStart("recurring-invoices");
  try {
    const r = await runRecurringInvoicesTick();
    recordOk(
      "recurring-invoices",
      `checked=${r.templatesChecked} created=${r.invoicesCreated} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("recurring-invoices", e);
  }
}

async function tickPaymentReminders(): Promise<void> {
  recordStart("payment-reminders");
  try {
    const r = await runPaymentRemindersTick();
    recordOk(
      "payment-reminders",
      `checked=${r.invoicesChecked} sent=${r.remindersSent} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("payment-reminders", e);
  }
}

async function tickLoyaltyExpiry(): Promise<void> {
  recordStart("loyalty-expiry");
  try {
    const r = await runLoyaltyExpiryTick();
    recordOk(
      "loyalty-expiry",
      `checked=${r.entriesChecked} expired=${r.entriesExpired} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("loyalty-expiry", e);
  }
}

async function tickIdempotencySweep(): Promise<void> {
  recordStart("idempotency-sweep");
  try {
    const r = await runIdempotencySweepTick();
    recordOk("idempotency-sweep", `deleted=${r.deleted}`);
  } catch (e) {
    recordErr("idempotency-sweep", e);
  }
}

async function tickAuditHeadSnapshot(): Promise<void> {
  recordStart("audit-head-snapshot");
  try {
    const r = await runAuditHeadSnapshotTick();
    recordOk("audit-head-snapshot", `tenants=${r.tenantsSnapshotted} path=${r.path}`);
  } catch (e) {
    recordErr("audit-head-snapshot", e);
  }
}

async function tickRetentionPrune(): Promise<void> {
  recordStart("retention-prune");
  try {
    const r = await runRetentionPruneTick();
    recordOk(
      "retention-prune",
      `audit=${r.auditDeleted} errors=${r.errorDeleted} webhooks=${r.webhookDeleted}`,
    );
  } catch (e) {
    recordErr("retention-prune", e);
  }
}

async function tickSubscriptionExpiry(): Promise<void> {
  recordStart("subscription-expiry");
  try {
    const r = await runSubscriptionExpiryTick();
    recordOk(
      "subscription-expiry",
      `cancelled=${r.cancelled} overdue=${r.overdueFlagged} deactivated=${r.deactivatedPastGrace}`,
    );
  } catch (e) {
    recordErr("subscription-expiry", e);
  }
}

async function tickBatchExpiry(): Promise<void> {
  recordStart("batch-expiry");
  try {
    const r = await runBatchExpiryTick();
    recordOk(
      "batch-expiry",
      `tenants=${r.tenantsChecked} batches=${r.batchesChecked} alerts=${r.alertsEmitted} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("batch-expiry", e);
  }
}

async function tickAssetDepreciation(): Promise<void> {
  recordStart("asset-depreciation");
  try {
    const r = await runAssetDepreciationTick();
    recordOk(
      "asset-depreciation",
      `assets=${r.assetsChecked} booked=${r.installmentsBooked} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("asset-depreciation", e);
  }
}

async function tickDeferredRevenue(): Promise<void> {
  recordStart("deferred-revenue");
  try {
    const r = await runDeferredRevenueTick();
    recordOk(
      "deferred-revenue",
      `rows=${r.rowsChecked} booked=${r.installmentsBooked} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("deferred-revenue", e);
  }
}

async function tickStockRepost(): Promise<void> {
  recordStart("stock-repost");
  try {
    const r = await runStockRepostTick();
    recordOk(
      "stock-repost",
      `jobs=${r.jobsChecked} done=${r.jobsProcessed} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("stock-repost", e);
  }
}

async function tickSupplierScorecard(): Promise<void> {
  recordStart("supplier-scorecard");
  try {
    const r = await runSupplierScorecardTick();
    recordOk(
      "supplier-scorecard",
      `checked=${r.scorecardsChecked} scored=${r.scorecardsScored} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("supplier-scorecard", e);
  }
}

async function tickJeAutoReverse(): Promise<void> {
  recordStart("je-auto-reverse");
  try {
    const r = await runJeAutoReverseTick();
    recordOk("je-auto-reverse", `reversed=${r.reversed}`);
  } catch (e) {
    recordErr("je-auto-reverse", e);
  }
}

async function tickBookingReminders(): Promise<void> {
  recordStart("booking-reminders");
  try {
    const r = await runBookingRemindersTick();
    recordOk("booking-reminders", `reminded=${r.reminded}`);
  } catch (e) {
    recordErr("booking-reminders", e);
  }
}

async function tickEmailSync(): Promise<void> {
  recordStart("email-sync");
  try {
    const r = await runEmailSyncTick();
    recordOk(
      "email-sync",
      `polled=${r.integrationsPolled} fetched=${r.messagesFetched} activities=${r.activitiesCreated} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("email-sync", e);
  }
}

async function tickEmbeddingRefresh(): Promise<void> {
  recordStart("embedding-refresh");
  try {
    const r = await runEmbeddingRefreshTick();
    recordOk(
      "embedding-refresh",
      `tenants=${r.tenantsScanned} embedded=${r.rowsEmbedded} skipped=${r.rowsSkipped} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("embedding-refresh", e);
  }
}

async function tickEmailSequences(): Promise<void> {
  recordStart("email-sequences");
  try {
    const r = await runEmailSequenceTick();
    recordOk(
      "email-sequences",
      `processed=${r.processed} advanced=${r.advanced} completed=${r.completed} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("email-sequences", e);
  }
}

async function tickDeskSla(): Promise<void> {
  recordStart("desk-sla");
  try {
    const r = await runDeskSlaCheck();
    recordOk(
      "desk-sla",
      `checked=${r.checked} firstResponse=${r.firstResponseBreached} resolution=${r.resolutionBreached}`,
    );
  } catch (e) {
    recordErr("desk-sla", e);
  }
}

async function tickSocialPublish(): Promise<void> {
  recordStart("social-publish");
  try {
    const r = await runSocialPublishTick();
    recordOk(
      "social-publish",
      `mode=${r.mode} processed=${r.processed} published=${r.published} failed=${r.failed}`,
    );
  } catch (e) {
    recordErr("social-publish", e);
  }
}

// Marketing P3 — Social engagement refresh. Cheap no-op when
// SOCIAL_ENGAGEMENT_ENABLE is unset (early-returns inside the tick), so we
// register the interval unconditionally.
async function tickSocialEngagement(): Promise<void> {
  recordStart("social-engagement");
  try {
    const r = await runSocialEngagementTick();
    recordOk(
      "social-engagement",
      `mode=${r.mode} scanned=${r.scanned} refreshed=${r.refreshed} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("social-engagement", e);
  }
}

async function tickScheduledReports(): Promise<void> {
  recordStart("scheduled-reports");
  try {
    const r = await runScheduledReportsTick();
    recordOk(
      "scheduled-reports",
      `checked=${r.checked} fired=${r.fired} emails=${r.emailsQueued} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("scheduled-reports", e);
  }
}

async function tickErrorRateAlert(): Promise<void> {
  recordStart("error-rate-alert");
  try {
    const r = await runErrorRateCheck();
    recordOk(
      "error-rate-alert",
      `tenants=${r.tenantsChecked} alerts=${r.alertsFired} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("error-rate-alert", e);
  }
}

async function tickAutoBackups(): Promise<void> {
  recordStart("auto-backups");
  try {
    const r = await runAutoBackupsTick();
    recordOk(
      "auto-backups",
      `scanned=${r.scanned} triggered=${r.triggered} succeeded=${r.succeeded} failed=${r.failed} skipped=${r.skipped}`,
    );
  } catch (e) {
    recordErr("auto-backups", e);
  }
}

async function tickBackupVerify(): Promise<void> {
  recordStart("backup-verify");
  try {
    const r = await runBackupVerifyTick();
    recordOk(
      "backup-verify",
      `scanned=${r.scanned} verified=${r.verified} succeeded=${r.succeeded} failed=${r.failed} skipped=${r.skipped}`,
    );
  } catch (e) {
    recordErr("backup-verify", e);
  }
}

// AI Inbox — scan every active tenant and refresh noteworthy findings.
async function tickAiInboxScan(): Promise<void> {
  recordStart("ai-inbox-scan");
  try {
    const r = await runAiInboxScanTick();
    recordOk(
      "ai-inbox-scan",
      `tenants=${r.scannedTenants} inserted=${r.totalInserted} refreshed=${r.totalRefreshed} errors=${r.errors.length}`,
    );
  } catch (e) {
    recordErr("ai-inbox-scan", e);
  }
}

// Daily digest — fires only in the configured UTC hour (default 13:00 UTC).
async function tickAiInboxDigest(): Promise<void> {
  recordStart("ai-inbox-digest");
  try {
    const r = await runAiInboxDigestTick();
    recordOk(
      "ai-inbox-digest",
      `recipients=${r.recipients} sent=${r.sent} empty=${r.skippedEmpty} errors=${r.errors.length}`,
    );
  } catch (e) {
    recordErr("ai-inbox-digest", e);
  }
}

// Marketing P2 — A/B winner-picker tick. Off unless AB_WINNER_ENABLE=1;
// see services/scheduler/src/jobs/ab-winner.ts for the promotion policy.
async function tickAbWinner(): Promise<void> {
  recordStart("ab-winner");
  try {
    const r = await runAbWinnerTick();
    recordOk(
      "ab-winner",
      `scanned=${r.scanned} promoted=${r.promoted} skipped=${r.skipped} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("ab-winner", e);
  }
}

// Marketing P2 — Journey engine tick. Advances up to JOURNEY_TICK_BATCH
// enrollments per tick (default 100). Opt-in via JOURNEY_TICK_ENABLE=1 so
// the runner never fires in environments that don't want marketing side
// effects (some CI, some sandbox tenants).
async function tickJourneys(): Promise<void> {
  recordStart("journeys");
  try {
    const r = await runJourneyTick();
    recordOk(
      "journeys",
      `processed=${r.processed} advanced=${r.advanced} waiting=${r.waiting} completed=${r.completed} failed=${r.failed} errors=${r.errors}`,
    );
  } catch (e) {
    recordErr("journeys", e);
  }
}

// ---------- HTTP-fanout jobs ----------

interface HttpJob {
  name: string;
  url: string;
  intervalSec: number;
  method?: "POST" | "GET";
}

function parseHttpJobs(): HttpJob[] {
  const raw = process.env.CRON_HTTP_JOBS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HttpJob[];
    return parsed.filter((j) => j && j.name && j.url && j.intervalSec > 0);
  } catch (e) {
    log.warn("CRON_HTTP_JOBS parse failed", {
      err: e instanceof Error ? e : new Error(String(e)),
    });
    return [];
  }
}

async function tickHttpJob(job: HttpJob): Promise<void> {
  recordStart(job.name);
  const token = process.env.SCHEDULER_API_TOKEN;
  if (!token) {
    recordErr(job.name, "SCHEDULER_API_TOKEN not set");
    return;
  }
  // Fresh request-id per invocation — cron ticks have no inbound request to
  // inherit from, so downstream logs would otherwise show an anonymous call.
  const requestId = `sched-${randomUUID()}`;
  try {
    const r = await fetch(job.url, {
      method: job.method ?? "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await r.text()).slice(0, 400);
    if (!r.ok) {
      recordErr(job.name, `HTTP ${r.status}: ${body}`);
    } else {
      recordOk(job.name, `HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
  } catch (e) {
    recordErr(job.name, e);
  }
}

// ---------- Scheduler loop ----------

const WEBHOOK_INTERVAL_MS = Number(process.env.WEBHOOK_TICK_MS ?? 30_000);
// Reorder-check defaults to hourly; overridable via env for tests / demos.
const REORDER_CHECK_INTERVAL_MS = Number(
  process.env.REORDER_CHECK_TICK_MS ?? 60 * 60 * 1000,
);
// Recurring-invoice tick — hourly by default. Cheap query so this is fine to
// run often; catches server-clock drift + late-firing.
const RECURRING_INVOICE_INTERVAL_MS = Number(
  process.env.RECURRING_INVOICE_TICK_MS ?? 60 * 60 * 1000,
);
// Payment-reminders tick — hourly by default matches recurring-invoices.
// Ticks emit to the EmailMessage outbox; actual send cadence is bounded
// by the mail-provider dispatcher, so more-frequent ticking here doesn't
// spam customers (pickReminderKind + the 24h same-kind guard prevent it).
const PAYMENT_REMINDERS_INTERVAL_MS = Number(
  process.env.PAYMENT_REMINDERS_TICK_MS ?? 60 * 60 * 1000,
);
// Loyalty expiry sweep — every 6 hours by default. Cheaper than daily
// because the balance calc is authoritative anyway; this just persists the
// Expired counter-entries so exports/BI tools see a consistent ledger.
const LOYALTY_EXPIRY_INTERVAL_MS = Number(
  process.env.LOYALTY_EXPIRY_TICK_MS ?? 6 * 60 * 60 * 1000,
);
// Batch-expiry alerts — every 12h by default. Notification writes are
// bounded per tick and dedup'd via Batch.lastExpiryAlertAt so bumping
// this cadence up is safe.
const BATCH_EXPIRY_INTERVAL_MS = Number(
  process.env.BATCH_EXPIRY_TICK_MS ?? 12 * 60 * 60 * 1000,
);
// Asset depreciation auto-book — daily is fine (schedules are monthly).
// isBooked flag dedups so more-frequent ticks are safe but wasteful.
const ASSET_DEPRECIATION_INTERVAL_MS = Number(
  process.env.ASSET_DEPRECIATION_TICK_MS ?? 24 * 60 * 60 * 1000,
);
// Deferred revenue recognition — daily is fine (installments are monthly).
// isBooked flag dedups so more-frequent ticks are safe but wasteful.
const DEFERRED_REVENUE_INTERVAL_MS = Number(
  process.env.DEFERRED_REVENUE_TICK_MS ?? 24 * 60 * 60 * 1000,
);
// Stock repost — pick up queued repost jobs one at a time. Cadence is
// aggressive-ish (2 min) so an operator who fires a repost gets prompt
// results; only one job runs per tick regardless.
const STOCK_REPOST_INTERVAL_MS = Number(
  process.env.STOCK_REPOST_TICK_MS ?? 2 * 60 * 1000,
);
// Supplier scorecard recompute — daily by default. Scores only change
// when new POs/PRs/SQs land, and the compute is cheap (few queries per
// scorecard). Daily gives operators a fresh number without hammering
// the DB.
const SUPPLIER_SCORECARD_INTERVAL_MS = Number(
  process.env.SUPPLIER_SCORECARD_TICK_MS ?? 24 * 60 * 60 * 1000,
);
// JE auto-reverse tick — daily. Flips reversing JEs whose
// reverseOnDate has arrived. Idempotent (helper checks
// reversedByJournalId=null).
const BOOKING_REMINDERS_INTERVAL_MS = Number(
  process.env.BOOKING_REMINDERS_TICK_MS ?? 60 * 60 * 1000, // hourly
);
const EMAIL_SYNC_INTERVAL_MS = Number(
  process.env.EMAIL_SYNC_TICK_MS ?? 5 * 60 * 1000, // every 5 minutes
);
const EMBEDDING_REFRESH_INTERVAL_MS = Number(
  process.env.EMBEDDING_REFRESH_TICK_MS ?? 2 * 60 * 1000, // every 2 minutes
);
const JE_AUTO_REVERSE_INTERVAL_MS = Number(
  process.env.JE_AUTO_REVERSE_TICK_MS ?? 24 * 60 * 60 * 1000,
);
// Email-sequence tick — hourly by default. Cheap query, so bumps in
// resolution are fine.
const EMAIL_SEQUENCE_INTERVAL_MS = Number(
  process.env.EMAIL_SEQUENCE_TICK_MS ?? 60 * 60 * 1000,
);
// Desk SLA breach check — every 5 min so breach flags appear promptly in
// the agent inbox red-highlight column.
const DESK_SLA_INTERVAL_MS = Number(process.env.DESK_SLA_TICK_MS ?? 5 * 60 * 1000);
// Social-publish tick — every minute so scheduled posts fire close to their
// intended time (mock path is cheap; real path is opt-in via
// SOCIAL_PUBLISH_ENABLE=1 and batched at 50/tick).
const SOCIAL_PUBLISH_INTERVAL_MS = Number(process.env.SOCIAL_PUBLISH_TICK_MS ?? 60 * 1000);
// Social-engagement tick — every 30 min by default. Opt-in via
// SOCIAL_ENGAGEMENT_ENABLE=1; the tick early-returns when disabled so the
// interval is safe to register unconditionally.
const SOCIAL_ENGAGEMENT_INTERVAL_MS = Number(
  process.env.SOCIAL_ENGAGEMENT_TICK_MS ?? 30 * 60 * 1000,
);
// Scheduled reports — hourly; each ScheduledReport row has its own cadence.
const SCHEDULED_REPORTS_INTERVAL_MS = Number(
  process.env.SCHEDULED_REPORTS_TICK_MS ?? 60 * 60 * 1000,
);
// Error-rate alert — every 5 min. Cheap groupBy, in-memory cooldown de-dupes
// alerts per tenant.
const ERROR_RATE_INTERVAL_MS = Number(
  process.env.ERROR_RATE_TICK_MS ?? 5 * 60 * 1000,
);
// Auto-backup — hourly tick. Per-tenant cadence is enforced inside the tick
// via BACKUP_AUTO_INTERVAL_HOURS (default 24). No-op when BACKUP_AUTO_ENABLE
// is unset.
const AUTO_BACKUP_INTERVAL_MS = Number(
  process.env.AUTO_BACKUP_TICK_MS ?? 60 * 60 * 1000,
);
// Backup-verify — 6-hourly tick. Per-tenant cadence enforced inside tick
// via BACKUP_VERIFY_INTERVAL_HOURS (default 168 = weekly). No-op when
// BACKUP_VERIFY_ENABLE is unset.
const BACKUP_VERIFY_INTERVAL_MS = Number(
  process.env.BACKUP_VERIFY_TICK_MS ?? 6 * 60 * 60 * 1000,
);
// AI Inbox scan tick. Fires hourly by default (the generator respects
// AI_INBOX_SCAN_INTERVAL_HOURS per-tenant cadence), so this is just the
// outer wake-up — all enforcement is inside the generator.
const AI_INBOX_SCAN_INTERVAL_MS = Number(
  process.env.AI_INBOX_SCAN_TICK_MS ?? 60 * 60 * 1000,
);
// Digest wake-up tick. The job itself only sends during the configured UTC
// hour, so this just needs to fire often enough during that window.
const AI_INBOX_DIGEST_INTERVAL_MS = Number(
  process.env.AI_INBOX_DIGEST_TICK_MS ?? 30 * 60 * 1000,
);
// Marketing P2 — A/B winner-picker tick. Default 15 min. Off unless
// AB_WINNER_ENABLE=1 (the tick itself early-returns when disabled, but the
// interval still fires — cheap no-op).
const AB_WINNER_INTERVAL_MS = Number(
  process.env.AB_WINNER_TICK_MS ?? 15 * 60 * 1000,
);
// Marketing P2 — Journey engine tick. Default 30 s so waits + branches
// feel snappy. Opt-in via JOURNEY_TICK_ENABLE=1; when disabled we don't
// even schedule the interval (keeps the log clean).
const JOURNEY_TICK_INTERVAL_MS = Number(
  process.env.JOURNEY_TICK_MS ?? 30_000,
);
const JOURNEY_TICK_ENABLED = process.env.JOURNEY_TICK_ENABLE === "1";

// Idempotency-key sweep — hourly. TTL is 24h so anything more frequent is
// wasted; anything much less frequent lets the table grow between sweeps.
const IDEMPOTENCY_SWEEP_INTERVAL_MS = Number(
  process.env.IDEMPOTENCY_SWEEP_TICK_MS ?? 60 * 60 * 1000,
);

// Audit-chain head snapshot — daily. Ships off-box (see infra/systemd
// backup DR section in docs/DEPLOY-BAREMETAL.md) so a DB-level tamper of the
// audit chain becomes detectable against the offsite record.
const AUDIT_HEAD_SNAPSHOT_INTERVAL_MS = Number(
  process.env.AUDIT_HEAD_SNAPSHOT_TICK_MS ?? 24 * 60 * 60 * 1000,
);

// Retention prune — daily sweep deletes AuditLog + ErrorLog + stale
// webhook_deliveries past their retention window. See retention-prune.ts
// for the per-table windows (env-overridable).
const RETENTION_PRUNE_INTERVAL_MS = Number(
  process.env.RETENTION_PRUNE_TICK_MS ?? 24 * 60 * 60 * 1000,
);

// Subscription expiry — daily sweep flips planned-cancellation + past-
// grace subscriptions to inactive; flags overdue ones for operator review.
const SUBSCRIPTION_EXPIRY_INTERVAL_MS = Number(
  process.env.SUBSCRIPTION_EXPIRY_TICK_MS ?? 6 * 60 * 60 * 1000,
);

function startScheduler(): void {
  const httpJobs = parseHttpJobs();
  log.info("scheduler starting", {
    webhookIntervalMs: WEBHOOK_INTERVAL_MS,
    reorderCheckIntervalMs: REORDER_CHECK_INTERVAL_MS,
    httpJobCount: httpJobs.length,
    queueMode: isQueueReal() ? "bullmq" : "inline",
  });

  // BullMQ workers. Started before the tick loops so any inline-mode
  // handlers are registered before enqueue() calls fire.
  startImportWorker();

  // Direct jobs — every tick now goes through scheduleRepeatable which:
  //   - When REDIS_URL is set: registers a BullMQ repeatable job (durable
  //     across restarts, distributed-safe if multiple schedulers run).
  //   - When REDIS_URL is unset: falls back to setInterval (dev-friendly).
  //
  // Every call auto-registers a stop hook via stopAllRepeatables() which
  // installGracefulShutdown drains on SIGTERM.
  scheduleRepeatable("webhook-drain",         tickWebhookDrain,       WEBHOOK_INTERVAL_MS);
  scheduleRepeatable("reorder-check",         tickReorderCheck,       REORDER_CHECK_INTERVAL_MS);
  scheduleRepeatable("recurring-invoices",    tickRecurringInvoices,  RECURRING_INVOICE_INTERVAL_MS);
  scheduleRepeatable("payment-reminders",     tickPaymentReminders,   PAYMENT_REMINDERS_INTERVAL_MS);
  scheduleRepeatable("loyalty-expiry",        tickLoyaltyExpiry,      LOYALTY_EXPIRY_INTERVAL_MS);
  scheduleRepeatable("batch-expiry",          tickBatchExpiry,        BATCH_EXPIRY_INTERVAL_MS);
  scheduleRepeatable("asset-depreciation",    tickAssetDepreciation,  ASSET_DEPRECIATION_INTERVAL_MS);
  scheduleRepeatable("deferred-revenue",      tickDeferredRevenue,    DEFERRED_REVENUE_INTERVAL_MS);
  scheduleRepeatable("stock-repost",          tickStockRepost,        STOCK_REPOST_INTERVAL_MS);
  scheduleRepeatable("supplier-scorecard",    tickSupplierScorecard,  SUPPLIER_SCORECARD_INTERVAL_MS);
  scheduleRepeatable("je-auto-reverse",       tickJeAutoReverse,      JE_AUTO_REVERSE_INTERVAL_MS);
  scheduleRepeatable("booking-reminders",     tickBookingReminders,   BOOKING_REMINDERS_INTERVAL_MS);
  scheduleRepeatable("email-sync",            tickEmailSync,          EMAIL_SYNC_INTERVAL_MS);
  scheduleRepeatable("embedding-refresh",     tickEmbeddingRefresh,   EMBEDDING_REFRESH_INTERVAL_MS);
  scheduleRepeatable("email-sequences",       tickEmailSequences,     EMAIL_SEQUENCE_INTERVAL_MS);
  scheduleRepeatable("desk-sla",              tickDeskSla,            DESK_SLA_INTERVAL_MS);
  scheduleRepeatable("social-publish",        tickSocialPublish,      SOCIAL_PUBLISH_INTERVAL_MS);
  scheduleRepeatable("social-engagement",     tickSocialEngagement,   SOCIAL_ENGAGEMENT_INTERVAL_MS);
  scheduleRepeatable("scheduled-reports",     tickScheduledReports,   SCHEDULED_REPORTS_INTERVAL_MS);
  scheduleRepeatable("error-rate-alert",      tickErrorRateAlert,     ERROR_RATE_INTERVAL_MS);
  scheduleRepeatable("auto-backups",          tickAutoBackups,        AUTO_BACKUP_INTERVAL_MS);
  scheduleRepeatable("backup-verify",         tickBackupVerify,       BACKUP_VERIFY_INTERVAL_MS);
  scheduleRepeatable("ai-inbox-scan",         tickAiInboxScan,        AI_INBOX_SCAN_INTERVAL_MS);
  scheduleRepeatable("ai-inbox-digest",       tickAiInboxDigest,      AI_INBOX_DIGEST_INTERVAL_MS);
  scheduleRepeatable("ab-winner",             tickAbWinner,           AB_WINNER_INTERVAL_MS);
  scheduleRepeatable("idempotency-sweep",     tickIdempotencySweep,   IDEMPOTENCY_SWEEP_INTERVAL_MS);
  scheduleRepeatable("audit-head-snapshot",   tickAuditHeadSnapshot,  AUDIT_HEAD_SNAPSHOT_INTERVAL_MS);
  scheduleRepeatable("retention-prune",       tickRetentionPrune,     RETENTION_PRUNE_INTERVAL_MS);
  scheduleRepeatable("subscription-expiry",   tickSubscriptionExpiry, SUBSCRIPTION_EXPIRY_INTERVAL_MS);
  if (JOURNEY_TICK_ENABLED) {
    scheduleRepeatable("journeys",            tickJourneys,           JOURNEY_TICK_INTERVAL_MS);
  }

  // Tenant-configured HTTP jobs — one repeatable per row. Uses the row's
  // primary key as the job name so add/remove of a job through the admin
  // UI cleanly maps to add/remove of a BullMQ job.
  for (const job of httpJobs) {
    scheduleRepeatable(`http.${job.name}`, () => tickHttpJob(job), job.intervalSec * 1000);
  }
}

// Manual trigger — SystemManager-only (or legacy admin). Callers hit this
// with an API token or JWT; useful for ops runbooks and integration tests.
app.post("/jobs/reorder-check", requireAuth, async (req, res) => {
  const auth = req.auth;
  const isAdmin =
    !!auth && (auth.roles.includes("SystemManager") || auth.role === "admin");
  if (!isAdmin) return res.status(403).json({ error: "SystemManager role required" });
  try {
    const result = await runReorderCheck();
    recordStart("reorder-check");
    recordOk("reorder-check", summarizeReorderResult(result));
    res.json(result);
  } catch (e) {
    recordErr("reorder-check", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "reorder-check failed",
    });
  }
});

app.use(jsonErrorHandler("scheduler"));

const port = Number(process.env.PORT) || 4009;
const server = app.listen(port, () => {
  log.info("service listening", { port });
  // Postgres advisory-lock leader election. Multiple scheduler replicas
  // can be started safely — only the one that acquires the lock actually
  // starts the tick loops. Standbys poll every 30s so a leader crash
  // transitions in ≤ 30s of downtime. Opt-out with LEADER_ELECTION=0
  // when running a single-instance deploy that doesn't need HA.
  const leaderElection = process.env.LEADER_ELECTION !== "0";
  if (!leaderElection) {
    log.info("leader election disabled — starting scheduler directly");
    startScheduler();
  } else {
    void runWithLeaderLock({
      heartbeatMs: Number(process.env.LEADER_HEARTBEAT_MS ?? 30_000),
      onBecomeLeader: () => {
        log.info("acquired scheduler leader lock — starting jobs");
        startScheduler();
      },
      logStandby: () => {
        log.debug("scheduler standby — another instance holds the leader lock");
      },
    });
  }
});
// Drain repeatable workers on SIGTERM/SIGINT before installGracefulShutdown
// closes the HTTP server. This flushes any in-flight tick jobs cleanly.
process.once("SIGTERM", () => void stopAllRepeatables());
process.once("SIGINT", () => void stopAllRepeatables());
installGracefulShutdown(server, "scheduler");
