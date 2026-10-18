import { Prisma, type PrismaClient } from "@prisma/client";

// M57 deferred fix — Auto-reversing JournalEntry.
//
// Any JE flagged `isReversing=true` with `reverseOnDate <= today` gets
// a mirror JE posted with DR/CR swapped, dated the reverseOnDate. The
// original JE is marked `reversedByJournalId=<newJE.id>` so re-runs
// are idempotent.
//
// Use cases:
//   * FX Revaluation JEs (M57) that reverse next period so the "real"
//     FX gain/loss at settlement doesn't double-count.
//   * Period-end accruals (unbilled revenue, prepaid expense, salary
//     accruals) that should flip next period.
//
// Design decisions:
//   * The reversal JE posts through the SAME `postGLEntries` pipeline
//     as the original — meaning it inherits all the guards (period
//     close, cross-company detection, invariants). Kept pure here to
//     avoid a services→services import; the scheduler tick calls this
//     with an injected `postFn` callback.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export interface AutoReverseResult {
  jeId: string;
  jeName: string;
  reversalJeId: string;
  reversalJeName: string;
}

// Callback signature for posting GL entries — kept as a param so the
// helper stays dependency-free from services.
export type PostGLFn = (params: {
  tenantId: string;
  postingDate: Date;
  voucherType: "JournalEntry";
  voucherId: string;
  voucherName: string;
  companyId?: string | null;
  lines: Array<{ accountId: string; debit: number; credit: number; remarks?: string | null }>;
}) => Promise<void>;

export type NextNameFn = (
  db: AnyClient,
  tenantId: string,
  prefix: string,
  width?: number,
) => Promise<string>;

// Fetches all reversing JEs due on-or-before `asOfDate`, posts the
// mirror, marks original. Returns per-JE outcomes.
export async function runAutoReverse(
  db: AnyClient,
  asOfDate: Date,
  nextName: NextNameFn,
  postFn: PostGLFn,
): Promise<AutoReverseResult[]> {
  const due = await db.journalEntry.findMany({
    where: {
      isReversing: true,
      reversedByJournalId: null, // idempotent — skip already-reversed
      reverseOnDate: { lte: asOfDate },
      status: "Submitted", // don't reverse Draft or Cancelled
    },
    include: { accounts: true },
    take: 200, // cap so a huge backlog doesn't hog the tick
  });

  const results: AutoReverseResult[] = [];
  for (const je of due) {
    // Build reversal lines: swap DR ↔ CR.
    const lines = je.accounts.map((a) => ({
      accountId: a.accountId,
      debit: Number(a.credit),
      credit: Number(a.debit),
      remarks: a.remarks ? `Reversal: ${a.remarks}` : `Reversal of ${je.name}`,
    }));
    if (lines.length === 0) continue;

    const revName = await nextName(db, je.tenantId, "JV-");
    const postingDate = je.reverseOnDate ?? asOfDate;

    // Create JE header + lines.
    const rev = await db.journalEntry.create({
      data: {
        tenantId: je.tenantId,
        name: revName,
        postingDate,
        currency: je.currency,
        remarks: `Auto-reversal of ${je.name}`,
        status: "Submitted",
        companyId: je.companyId,
        accounts: {
          create: lines.map((l) => ({
            account: { connect: { id: l.accountId } },
            debit: new Prisma.Decimal(l.debit),
            credit: new Prisma.Decimal(l.credit),
            remarks: l.remarks,
          })),
        },
      },
    });
    // Post to GL through the caller's post function.
    await postFn({
      tenantId: je.tenantId,
      postingDate,
      voucherType: "JournalEntry",
      voucherId: rev.id,
      voucherName: rev.name,
      companyId: je.companyId,
      lines,
    });
    // Mark original as reversed.
    await db.journalEntry.update({
      where: { id: je.id },
      data: {
        reversedByJournalId: rev.id,
        reversedAt: new Date(),
      },
    });
    results.push({
      jeId: je.id,
      jeName: je.name,
      reversalJeId: rev.id,
      reversalJeName: rev.name,
    });
  }
  return results;
}

// Utility: compute the first-of-next-month for a given date. Used by
// FX Reval commit to default `reverseOnDate` to next period.
export function firstOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
