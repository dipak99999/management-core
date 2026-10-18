// Marketing P3 — Revenue attribution engine.
//
// Data model
// ----------
//   AttributionTouchpoint { id, tenantId, contactType, contactId,
//     sourceType(Campaign|Journey|WebForm|Webinar|SocialPost),
//     sourceId, event(Open|Click|Enrolled|Completed|Submitted|
//     Registered|Attended), occurredAt,
//     attributedRevenue, attributedInvoiceId? }
//
// Write path
// ----------
// Every marketing interaction that could influence a sale writes one row via
// `recordTouchpoint`. Callers are:
//   - email tracking pixel/click (Open, Click)                    — auth-service
//   - web-form public submit (Submitted)                          — crm-service
//   - journey enrollment create (Enrolled)                        — packages/db/journey.ts
//   - journey enrollment mark Completed (Completed)               — packages/db/journey.ts
//   - webinar register / mark attended (Registered / Attended)    — crm-service
//
// Read / compute path
// -------------------
// When a SalesInvoice is submitted for a Customer, `attributeInvoice` scans
// touchpoints in the attribution window (default 90 days) for that customer
// and splits the invoice revenue across them per the chosen model:
//   - LastTouch  — 100% to the most recent touchpoint
//   - FirstTouch — 100% to the earliest touchpoint
//   - Linear     — equal split (amount / N) across all touchpoints
// Each touched row is updated with its share of the revenue + the invoice id.
// Idempotent-per-invoice: touchpoints already tagged with this invoiceId are
// re-computed against the fresh split so re-runs (backfill / model change)
// converge on the correct numbers.
//
// Dashboard reads
// ---------------
// `getRoiBySource` groups touchpoints by (sourceType, sourceId), sums
// attributedRevenue, and enriches with the source's display name via a
// per-type lookup. Used by the /attribution/roi endpoint.

import type { PrismaClient } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────────────

export type AttributionModel = "LastTouch" | "FirstTouch" | "Linear";

export type AttributionSourceType =
  | "Campaign"
  | "Journey"
  | "WebForm"
  | "Webinar"
  | "SocialPost";

export type AttributionEvent =
  | "Open"
  | "Click"
  | "Enrolled"
  | "Completed"
  | "Submitted"
  | "Registered"
  | "Attended";

export type ContactType = "Customer" | "Lead";

export interface RecordTouchpointInput {
  tenantId: string;
  contactType: ContactType | string;
  contactId: string;
  sourceType: AttributionSourceType | string;
  sourceId: string;
  event: AttributionEvent | string;
  occurredAt?: Date;
}

export interface AttributeInvoiceInput {
  tenantId: string;
  invoiceId: string;
  customerId: string;
  amount: number | string; // net revenue attributed
  postingDate: Date | string;
  windowDays?: number; // default 90
  model?: AttributionModel; // default "LastTouch"
}

export interface RoiRowRaw {
  sourceType: string;
  sourceId: string;
  touchpointCount: number;
  uniqueContacts: number;
  attributedRevenue: number;
}

export interface RoiRow extends RoiRowRaw {
  sourceName: string;
}

export interface GetRoiInput {
  from: Date | string;
  to: Date | string;
  model?: AttributionModel; // reserved for future — current impl reads persisted
                            // attributedRevenue which was written under whatever
                            // model attributeInvoice used at SI submit time.
  sourceType?: string;
}

interface TouchpointRow {
  id: string;
  tenantId: string;
  contactType: string;
  contactId: string;
  sourceType: string;
  sourceId: string;
  event: string;
  occurredAt: Date;
  attributedRevenue: unknown; // Decimal
  attributedInvoiceId: string | null;
}

// Prisma has no `attributionTouchpoint` in the generated types until a
// `prisma generate` runs against this schema in every consumer. We access it
// via a permissive cast to keep this module compilable even in envs that
// haven't regenerated yet.
type PrismaAny = PrismaClient & Record<string, any>;

// ─── Write path ────────────────────────────────────────────────────────

/**
 * Insert a single AttributionTouchpoint row. Callers should treat failures as
 * non-fatal — attribution must never block the primary user action (email
 * pixel response, form submit, journey enroll, etc.). Wrap this in a
 * try/catch at the call site + log warn on failure.
 */
export async function recordTouchpoint(
  prisma: PrismaClient,
  input: RecordTouchpointInput,
): Promise<TouchpointRow> {
  const p = prisma as PrismaAny;
  const row = (await p.attributionTouchpoint.create({
    data: {
      tenantId: input.tenantId,
      contactType: input.contactType,
      contactId: input.contactId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      event: input.event,
      occurredAt: input.occurredAt ?? new Date(),
    },
  })) as TouchpointRow;
  return row;
}

// ─── Attribution computation ───────────────────────────────────────────

/**
 * Split `amount` across `touchpoints` per the chosen model. Returns a map of
 * touchpointId → assigned share. Rounding: shares are computed at full JS
 * precision; the caller persists them as Decimal(18,4) which effectively
 * truncates to 4 dp. For Linear splits we deliberately do NOT try to reconcile
 * rounding drift across N shares — a stray ≤ 4e-4 delta on the sum is
 * acceptable for dashboards.
 */
export function splitByModel(
  touchpoints: Array<Pick<TouchpointRow, "id" | "occurredAt">>,
  amount: number,
  model: AttributionModel,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (touchpoints.length === 0) return out;

  if (model === "LastTouch") {
    // Newest first — occurredAt DESC.
    const sorted = [...touchpoints].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
    );
    out[sorted[0]!.id] = amount;
    return out;
  }

  if (model === "FirstTouch") {
    // Oldest first — occurredAt ASC.
    const sorted = [...touchpoints].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    out[sorted[0]!.id] = amount;
    return out;
  }

  // Linear — equal split.
  const share = amount / touchpoints.length;
  for (const t of touchpoints) out[t.id] = share;
  return out;
}

/**
 * When a SalesInvoice is submitted for a Customer, attribute its revenue
 * across recent touchpoints. Best-effort — a customer with no marketing
 * touchpoints in the window returns an empty splits map (no error).
 *
 * Idempotency: any touchpoints already tagged with this invoiceId are
 * cleared before re-computation so re-runs converge. This makes
 * `POST /attribution/recompute?invoiceId=` safe.
 */
export async function attributeInvoice(
  prisma: PrismaClient,
  input: AttributeInvoiceInput,
): Promise<{ touchpoints: TouchpointRow[]; splits: Record<string, number> }> {
  const p = prisma as PrismaAny;
  const windowDays = input.windowDays ?? 90;
  const model: AttributionModel = input.model ?? "LastTouch";
  const amount = Number(input.amount) || 0;
  const postingDate =
    input.postingDate instanceof Date
      ? input.postingDate
      : new Date(input.postingDate);
  const windowStart = new Date(postingDate.getTime() - windowDays * 86_400_000);

  // 1. Reset any prior attribution against this invoice (so re-runs are safe).
  //    We keep the row (touchpoints are the source of truth) — just zero the
  //    revenue + drop the FK.
  await p.attributionTouchpoint.updateMany({
    where: { tenantId: input.tenantId, attributedInvoiceId: input.invoiceId },
    data: { attributedRevenue: 0, attributedInvoiceId: null },
  });

  // 2. Find candidate touchpoints in the window for this customer.
  const rows = (await p.attributionTouchpoint.findMany({
    where: {
      tenantId: input.tenantId,
      contactType: "Customer",
      contactId: input.customerId,
      occurredAt: { gte: windowStart, lte: postingDate },
    },
    orderBy: { occurredAt: "asc" },
  })) as TouchpointRow[];

  if (rows.length === 0 || amount <= 0) {
    return { touchpoints: rows, splits: {} };
  }

  // 3. Split + persist.
  const splits = splitByModel(rows, amount, model);
  const updates: Promise<unknown>[] = [];
  for (const [id, share] of Object.entries(splits)) {
    if (share === 0) continue;
    updates.push(
      p.attributionTouchpoint.update({
        where: { id },
        data: {
          attributedRevenue: share,
          attributedInvoiceId: input.invoiceId,
        },
      }),
    );
  }
  await Promise.all(updates);

  return { touchpoints: rows, splits };
}

// ─── Dashboard reads ───────────────────────────────────────────────────

/**
 * Per-source revenue rollup for the ROI dashboard. Groups
 * AttributionTouchpoint rows by (sourceType, sourceId) inside the given
 * window, sums attributedRevenue, and looks up a display name per source.
 *
 * Note: `model` is presently informational — the persisted attributedRevenue
 * was computed by `attributeInvoice` at SI-submit time under whatever model
 * was active then. To switch models globally, run the recompute admin route
 * across all recent invoices. Callers may still pass model to keep API
 * shape stable for a future in-place recomputation.
 */
export async function getRoiBySource(
  prisma: PrismaClient,
  tenantId: string,
  input: GetRoiInput,
): Promise<RoiRow[]> {
  const p = prisma as PrismaAny;
  const from = input.from instanceof Date ? input.from : new Date(input.from);
  const to = input.to instanceof Date ? input.to : new Date(input.to);

  const where: Record<string, unknown> = {
    tenantId,
    occurredAt: { gte: from, lte: to },
  };
  if (input.sourceType) where.sourceType = input.sourceType;

  // Pull the raw rows and group in memory. The touchpoint table is bounded
  // by (tenant × window) which is small in practice — a 90-day window
  // typically holds thousands of rows, not millions. If this ever hurts we
  // can push down to raw SQL with a GROUP BY.
  const rows = (await p.attributionTouchpoint.findMany({
    where,
    select: {
      sourceType: true,
      sourceId: true,
      contactType: true,
      contactId: true,
      attributedRevenue: true,
    },
  })) as Array<{
    sourceType: string;
    sourceId: string;
    contactType: string;
    contactId: string;
    attributedRevenue: unknown;
  }>;

  const byKey = new Map<string, RoiRowRaw & { _contacts: Set<string> }>();
  for (const r of rows) {
    const key = `${r.sourceType}::${r.sourceId}`;
    let e = byKey.get(key);
    if (!e) {
      e = {
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        touchpointCount: 0,
        uniqueContacts: 0,
        attributedRevenue: 0,
        _contacts: new Set<string>(),
      };
      byKey.set(key, e);
    }
    e.touchpointCount += 1;
    e._contacts.add(`${r.contactType}::${r.contactId}`);
    e.attributedRevenue += Number(r.attributedRevenue) || 0;
  }

  // Resolve source names.
  const raw = [...byKey.values()].map((e) => ({
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    touchpointCount: e.touchpointCount,
    uniqueContacts: e._contacts.size,
    attributedRevenue: e.attributedRevenue,
  }));

  const names = await resolveSourceNames(p, tenantId, raw);
  const out: RoiRow[] = raw
    .map((r) => ({
      ...r,
      sourceName: names.get(`${r.sourceType}::${r.sourceId}`) ?? r.sourceId,
    }))
    // Sort by revenue DESC then touchpoints DESC — the "who's winning" view.
    .sort((a, b) => {
      if (b.attributedRevenue !== a.attributedRevenue)
        return b.attributedRevenue - a.attributedRevenue;
      return b.touchpointCount - a.touchpointCount;
    });

  return out;
}

/**
 * Look up display names for a batch of (sourceType, sourceId) pairs.
 * Returns a Map keyed by "sourceType::sourceId" → display name (falls back
 * to the id when a source row is missing / deleted).
 */
async function resolveSourceNames(
  p: PrismaAny,
  tenantId: string,
  rows: Array<{ sourceType: string; sourceId: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    const arr = byType.get(r.sourceType) ?? [];
    arr.push(r.sourceId);
    byType.set(r.sourceType, arr);
  }

  // Per-source-type lookup. All models have `name` (Campaign / Journey /
  // WebForm / WebinarEvent) except SocialPost which uses `content` — for
  // that we pick the first 60 chars as the display label.
  async function loadNames(
    ids: string[],
    delegate: string,
    labelField: "name" | "content",
  ): Promise<Array<{ id: string; label: string }>> {
    if (ids.length === 0) return [];
    const items = (await (p[delegate] as any).findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, [labelField]: true },
    })) as Array<Record<string, unknown>>;
    return items.map((i) => ({
      id: String(i.id),
      label:
        labelField === "content"
          ? truncate(String(i[labelField] ?? ""), 60)
          : String(i[labelField] ?? ""),
    }));
  }

  const jobs: Promise<void>[] = [];
  const push = (
    sourceType: string,
    delegate: string,
    field: "name" | "content",
  ) => {
    const ids = byType.get(sourceType);
    if (!ids || ids.length === 0) return;
    jobs.push(
      loadNames(ids, delegate, field)
        .then((rows) => {
          for (const r of rows) map.set(`${sourceType}::${r.id}`, r.label);
        })
        // Swallow lookup failures — falls back to id in the caller.
        .catch(() => undefined),
    );
  };
  push("Campaign", "campaign", "name");
  push("Journey", "marketingJourney", "name");
  push("WebForm", "webForm", "name");
  push("Webinar", "webinarEvent", "name");
  push("SocialPost", "socialPost", "content");
  await Promise.all(jobs);

  return map;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
