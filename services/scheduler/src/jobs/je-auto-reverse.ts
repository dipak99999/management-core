// M57 deferred fix — Auto-reverse tick.
//
// Runs daily. Finds every reversing JE with reverseOnDate <= today
// that hasn't been reversed yet, posts the mirror flip, marks the
// original as reversed. Cross-tenant scan (like other GL ticks).
//
// Idempotency: the helper checks reversedByJournalId=null before
// posting, so a re-run for the same day is a no-op.

import { nextName, prisma, runAutoReverse } from "@lumaara/db";
import { postGLEntries } from "@lumaara/db";

export interface JeAutoReverseTickResult {
  reversed: number;
}

export async function runJeAutoReverseTick(
  now: Date = new Date(),
): Promise<JeAutoReverseTickResult> {
  // Normalize to end-of-day UTC so a JE with reverseOnDate=today
  // (00:00 UTC) matches.
  const asOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));

  const results = await runAutoReverse(prisma, asOf, nextName, (params) =>
    prisma.$transaction((tx) =>
      postGLEntries(tx, {
        tenantId: params.tenantId,
        postingDate: params.postingDate,
        voucherType: params.voucherType,
        voucherId: params.voucherId,
        voucherName: params.voucherName,
        companyId: params.companyId ?? undefined,
        lines: params.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          remarks: l.remarks ?? undefined,
        })),
      }),
    ),
  );
  return { reversed: results.length };
}
