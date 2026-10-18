import type { Prisma, PrismaClient } from "@prisma/client";
import { withCrossTenant } from "./tenant-guard";

// Shared normalization + persistence helper used by every inbound ESP webhook
// receiver in services/crm-service/src/routes/webhooks-inbound.ts. Each
// provider's payload shape differs (SES SNS envelope vs Mailgun event-data vs
// SendGrid event array), but once the handler has extracted the fields below
// the downstream write is identical — insert a TrackingEvent row and, when the
// event indicates a hard bounce or a complaint, upsert a Suppression.
//
// This module is deliberately provider-agnostic: no SES/Mailgun/etc. types
// leak in. The handler is responsible for signature verification, shape
// decoding, and mapping provider strings to our normalized event vocabulary.
//
// Suppression rules (matching plan §P1.2):
//   - HardBounce  → upsert Suppression(reason="HardBounce", source=<provider>)
//   - Complaint   → upsert Suppression(reason="Complaint", source=<provider>)
//   - Soft bounce → TrackingEvent only, NO auto-suppression (transient failure)
//   - Everything else (Open/Click/Delivered/Unsubscribe) → TrackingEvent only
//
// Cross-tenant note: inbound webhook routes are unauthenticated (providers
// don't carry our JWT). We resolve tenantId via the URL slug, then wrap the
// upsert in withCrossTenant() so the tenant-guard doesn't warn. This is safe:
// tenantId is baked into every write below.

export type NormalizedEventType =
  | "Delivered"
  | "Bounce"
  | "Complaint"
  | "Unsubscribe"
  | "Open"
  | "Click"
  | "Deferred"
  | "Suppressed";

export type NormalizedSeverity = "hard" | "soft" | undefined;

export interface NormalizedEvent {
  provider: string;              // "ses" | "mailgun" | "postmark" | "sendgrid" | "webhook"
  email: string;                 // recipient — lowercased before insert
  event: NormalizedEventType;    // see union above
  severity?: NormalizedSeverity; // required for Bounce; undefined otherwise
  campaignId?: string | null;    // if inferable from provider metadata
  recipientId?: string | null;   // CampaignRecipient FK if known
  emailMessageId?: string | null;
  targetUrl?: string | null;     // for Click events
  detail?: string | null;        // provider-specific reason string
  meta?: Prisma.JsonValue;       // raw payload excerpt for audit
  occurredAt?: Date;             // provider-supplied timestamp; defaults to now
}

export interface NormalizeResult {
  trackingEventId: string;
  suppressionCreated: boolean;
  suppressionId: string | null;
}

/**
 * Insert one TrackingEvent + optionally upsert a Suppression for the given
 * tenant. All writes happen inside a single Prisma transaction so partial
 * failures don't leave a TrackingEvent without its paired Suppression row (or
 * vice versa).
 *
 * @param prisma   PrismaClient (or a tx client inside an outer transaction)
 * @param tenantId Resolved tenant — MUST be validated by the caller
 * @param evt      Normalized event payload from the provider handler
 */
export async function normalizeAndPersist(
  prisma: PrismaClient,
  tenantId: string,
  evt: NormalizedEvent,
): Promise<NormalizeResult> {
  const email = evt.email.toLowerCase().trim();
  const occurredAt = evt.occurredAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const te = await tx.trackingEvent.create({
      data: {
        tenantId,
        campaignId: evt.campaignId ?? null,
        recipientId: evt.recipientId ?? null,
        emailMessageId: evt.emailMessageId ?? null,
        type: evt.event,
        targetUrl: evt.targetUrl ?? null,
        meta: (evt.meta ?? undefined) as Prisma.InputJsonValue | undefined,
        occurredAt,
      },
    });

    const shouldSuppress =
      (evt.event === "Bounce" && evt.severity === "hard") ||
      evt.event === "Complaint";

    if (!shouldSuppress) {
      return { trackingEventId: te.id, suppressionCreated: false, suppressionId: null };
    }

    const reason = evt.event === "Complaint" ? "Complaint" : "HardBounce";

    // Upsert on the (tenantId, email) unique index — same address bouncing
    // twice OR bouncing then complaining collapses to a single row. First
    // write wins on reason; later hits refresh source/detail/campaignId so
    // the admin UI shows the most recent evidence.
    const sup = await tx.suppression.upsert(
      withCrossTenant({
        where: { tenantId_email: { tenantId, email } },
        create: {
          tenantId,
          email,
          reason,
          source: evt.provider,
          detail: evt.detail ?? null,
          campaignId: evt.campaignId ?? null,
        },
        update: {
          source: evt.provider,
          detail: evt.detail ?? null,
          campaignId: evt.campaignId ?? null,
        },
      }),
    );

    return { trackingEventId: te.id, suppressionCreated: true, suppressionId: sup.id };
  });
}
