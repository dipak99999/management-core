import type { PrismaClient, Suppression } from "@prisma/client";

// Marketing P1 — Suppression list helpers.
//
// The `Suppression` table is a per-tenant blocklist keyed on `(tenantId, email)`.
// Anything present here MUST be skipped by the send pipeline (both marketing
// campaigns and transactional / EmailMessage). Rows land here via:
//   - Provider webhooks (hard bounce, complaint) — one hit is enough
//   - Manual admin action (spam-folder report, GDPR erase, support case)
//   - CSV import
//
// Email addresses are always stored lowercased. All lookups are case-insensitive
// so a user typing "Alice@Example.COM" still hits an existing "alice@example.com"
// row.

export interface AddSuppressionInput {
  email: string;
  reason: string; // HardBounce | Complaint | Manual | GdprErase | SpamFolder | Import
  source?: string | null; // ses | mailgun | postmark | sendgrid | manual | api | import
  detail?: string | null;
  campaignId?: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Case-insensitive lookup on `(tenantId, email)`. Returns the Suppression row
 * when the address is blocked, otherwise `null`.
 *
 * The stored `email` column is already lowercased on insert (see
 * `addSuppression`) so we normalize here and hit the unique index directly.
 */
export async function isSuppressed(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
): Promise<Suppression | null> {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return prisma.suppression.findUnique({
    where: { tenantId_email: { tenantId, email: normalized } },
  });
}

/**
 * Upsert a suppression row. Idempotent — calling twice for the same
 * `(tenantId, email)` returns the existing row with (optionally) refreshed
 * reason/source/detail/campaignId.
 *
 * The unique constraint on `(tenantId, email)` means concurrent inserts from
 * two webhook workers are safely resolved by Prisma to a single row.
 */
export async function addSuppression(
  prisma: PrismaClient,
  tenantId: string,
  input: AddSuppressionInput,
): Promise<Suppression> {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw new Error("addSuppression: email is required");
  }
  return prisma.suppression.upsert({
    where: { tenantId_email: { tenantId, email } },
    create: {
      tenantId,
      email,
      reason: input.reason,
      source: input.source ?? null,
      detail: input.detail ?? null,
      campaignId: input.campaignId ?? null,
    },
    update: {
      reason: input.reason,
      source: input.source ?? null,
      detail: input.detail ?? null,
      campaignId: input.campaignId ?? null,
    },
  });
}

/**
 * Manual removal (admin UI, GDPR export re-consent, etc). Case-insensitive.
 * No-op when the row doesn't exist — callers shouldn't have to check first.
 */
export async function removeSuppression(
  prisma: PrismaClient,
  tenantId: string,
  email: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await prisma.suppression
    .delete({
      where: { tenantId_email: { tenantId, email: normalized } },
    })
    .catch((e: unknown) => {
      // Ignore "record not found" (P2025) — makes the API idempotent.
      const code = (e as { code?: string } | null)?.code;
      if (code === "P2025") return;
      throw e;
    });
}
