import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildFromLines,
  buildToLines,
  companyPrefix,
  computeICSide,
  nextName,
  prisma,
} from "@lumaara/db";
import { cancelGLEntries, postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { assertCompanyAccess, idempotency, perms } from "@lumaara/service-auth";

// Multi-company Phase 4: Intercompany Journal Entry helper.
//
// A single call to POST /intercompany-journals atomically creates TWO
// mirror JournalEntries — one in `fromCompanyId`, one in `toCompanyId` —
// and links them via the IntercompanyJournalEntry wrapper row. Both JEs
// are submitted immediately (each balanced within its own company).
//
// Payload shape:
//   fromCompanyId, toCompanyId  — must be distinct Companies in the tenant
//   amount                     — positive base-currency amount moving A→B
//   fromDebitAccountId         — the DR side of the from-company JE
//                                (typically an IC Receivable OR a Bank/Cash acc)
//   fromCreditAccountId        — the CR side of the from-company JE
//                                (typically the same as fromDebitAccountId's
//                                counterpart — cash out or IC payable)
//   toDebitAccountId           — the DR side of the to-company JE
//   toCreditAccountId          — the CR side of the to-company JE
//   narrative                  — human description, copied to both JE remarks
//   postingDate                — same date on both mirror JEs
//
// Convention: use Account.isIntercompany=true on the two "IC" accounts
// (IC Receivable + IC Payable) so the /consolidation report auto-
// eliminates them. Cash/Bank accounts don't need the flag — they cancel
// naturally because the same amount leaves one company and enters the
// other on the same date.

export const intercompanyJournalRouter = Router();

const p = perms("JournalEntry");

// Multi-currency IC (Phase 5): each side may specify its own native
// currency + conversionRate for the CASH/BANK leg. When omitted, the
// side is treated as base-currency (rate=1, nativeAmount=amount).
// FX gain/loss is auto-computed and posted to the tenant's default
// FX account when native*rate differs from the canonical `amount`.
const sideSchema = z.object({
  debitAccountId: z.string().min(1),
  creditAccountId: z.string().min(1),
  currency: z.string().min(3).max(3).default("INR"),
  conversionRate: z.coerce.number().positive().default(1),
  // Native amount on this side's cash/bank leg. When omitted the side
  // reads as base-currency (nativeAmount = amount / rate = amount when
  // rate=1). Explicitly settable so users can pin the exact native
  // amount (avoids tiny rounding differences on the FX line).
  nativeAmount: z.coerce.number().positive().optional(),
});

const createSchema = z.object({
  fromCompanyId: z.string().min(1),
  toCompanyId: z.string().min(1),
  // Canonical inter-company amount in tenant baseCurrency. Both sides'
  // IC leg posts for exactly this value; native amounts convert to this
  // (with FX residual booked as gain/loss).
  amount: z.coerce.number().positive(),
  from: sideSchema,
  to: sideSchema,
  narrative: z.string().max(500).optional().nullable(),
  postingDate: z.string().datetime().optional(),
});

intercompanyJournalRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.intercompanyJournalEntry.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      fromCompany: { select: { name: true, code: true } },
      toCompany: { select: { name: true, code: true } },
      fromJournal: { select: { name: true, status: true } },
      toJournal: { select: { name: true, status: true } },
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

intercompanyJournalRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.intercompanyJournalEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      fromCompany: true,
      toCompany: true,
      fromJournal: { include: { accounts: true } },
      toJournal: { include: { accounts: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

intercompanyJournalRouter.post("/", p.create, idempotency("POST /intercompany-journals"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (b.fromCompanyId === b.toCompanyId) {
    return res.status(400).json({ error: "fromCompanyId and toCompanyId must differ" });
  }

  // Multi-company Phase 6: user must have access to BOTH sides.
  try {
    await assertCompanyAccess(req.auth!, b.fromCompanyId);
    await assertCompanyAccess(req.auth!, b.toCompanyId);
  } catch (e) {
    return res.status(403).json({ error: e instanceof Error ? e.message : "Forbidden" });
  }

  const companies = await prisma.company.findMany({
    where: { id: { in: [b.fromCompanyId, b.toCompanyId] }, tenantId, disabled: false },
    select: { id: true, code: true },
  });
  if (companies.length !== 2) {
    return res.status(400).json({ error: "One or both companies invalid or disabled" });
  }
  const fromCo = companies.find((c) => c.id === b.fromCompanyId)!;
  const toCo = companies.find((c) => c.id === b.toCompanyId)!;

  const accIds = [
    b.from.debitAccountId,
    b.from.creditAccountId,
    b.to.debitAccountId,
    b.to.creditAccountId,
  ];
  const accs = await prisma.account.findMany({
    where: { id: { in: accIds }, tenantId, isGroup: false },
    select: { id: true, companyId: true, accountName: true },
  });
  if (accs.length !== new Set(accIds).size) {
    return res.status(400).json({ error: "One or more accounts invalid or are groups" });
  }
  const byId = new Map(accs.map((a) => [a.id, a]));
  function ownedBy(accountId: string, expectedCoId: string): boolean {
    const acc = byId.get(accountId);
    if (!acc) return false;
    return acc.companyId === null || acc.companyId === expectedCoId;
  }
  const fromSideBadIds = [b.from.debitAccountId, b.from.creditAccountId].filter(
    (id) => !ownedBy(id, fromCo.id),
  );
  const toSideBadIds = [b.to.debitAccountId, b.to.creditAccountId].filter(
    (id) => !ownedBy(id, toCo.id),
  );
  if (fromSideBadIds.length > 0 || toSideBadIds.length > 0) {
    const bad = [...fromSideBadIds, ...toSideBadIds]
      .map((id) => byId.get(id)?.accountName ?? id)
      .join(", ");
    return res.status(400).json({
      error: `Account(s) on wrong company side: ${bad}. Each side's accounts must belong to that company (or be shared).`,
    });
  }

  // Multi-currency Phase 5: compute the base-currency amount for each
  // side's CASH/BANK leg. The IC receivable/payable leg is always the
  // canonical `amount`. FX residual = |cashLegBase - amount|, booked
  // to defaultFxGainLossAccountId to keep each mirror JE balanced.
  //
  // Sign convention:
  //   FROM side (cash going OUT): DR IC Receivable amount, CR Cash cashBase.
  //     If cashBase > amount → CR extra as FX gain (from company gave up
  //       more base than the IC amount, so recognized loss on the far side
  //       but actually it's ambiguous — we book to fx gain/loss, sign flips
  //       based on which side had the higher base). Simpler framing:
  //       balancing plug goes to fx account; sign is whatever makes it
  //       balance.
  //   TO side (cash coming IN): DR Cash cashBase, CR IC Payable amount.
  //     Same balancing plug logic on the other side.
  const fromSide = computeICSide(b.amount, b.from);
  const toSide = computeICSide(b.amount, b.to);
  const needsFxAccount =
    Math.abs(fromSide.fxDelta) > 0.0001 || Math.abs(toSide.fxDelta) > 0.0001;

  const postingDate = b.postingDate ? new Date(b.postingDate) : new Date();
  const amount = new Prisma.Decimal(b.amount);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Resolve FX gain/loss account per-side (Company override → Tenant).
      let fromFxAccountId: string | null = null;
      let toFxAccountId: string | null = null;
      if (needsFxAccount) {
        const [fromDefaults, toDefaults] = await Promise.all([
          requireTenantDefaults(tx, tenantId, ["defaultFxGainLossAccountId"], fromCo.id),
          requireTenantDefaults(tx, tenantId, ["defaultFxGainLossAccountId"], toCo.id),
        ]);
        fromFxAccountId = fromDefaults.defaultFxGainLossAccountId;
        toFxAccountId = toDefaults.defaultFxGainLossAccountId;
      }

      const fromName = await nextName(tx, tenantId, companyPrefix("ICJV-", fromCo.code));
      const toName = await nextName(tx, tenantId, companyPrefix("ICJV-", toCo.code));

      const fromLines = buildFromLines({
        amount: b.amount,
        fxDelta: fromSide.fxDelta,
        cashBase: fromSide.cashBase,
        icAccountId: b.from.debitAccountId,
        cashAccountId: b.from.creditAccountId,
        fxAccountId: fromFxAccountId,
      });
      const toLines = buildToLines({
        amount: b.amount,
        fxDelta: toSide.fxDelta,
        cashBase: toSide.cashBase,
        icAccountId: b.to.creditAccountId,
        cashAccountId: b.to.debitAccountId,
        fxAccountId: toFxAccountId,
      });

      const fromJE = await tx.journalEntry.create({
        data: {
          tenantId,
          name: fromName,
          postingDate,
          currency: b.from.currency,
          remarks: `IC ${fromCo.code}→${toCo.code}: ${b.narrative ?? ""}`.trim(),
          status: "Submitted",
          companyId: fromCo.id,
          accounts: {
            create: fromLines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
            })),
          },
        },
      });
      const toJE = await tx.journalEntry.create({
        data: {
          tenantId,
          name: toName,
          postingDate,
          currency: b.to.currency,
          remarks: `IC ${fromCo.code}→${toCo.code}: ${b.narrative ?? ""}`.trim(),
          status: "Submitted",
          companyId: toCo.id,
          accounts: {
            create: toLines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
            })),
          },
        },
      });

      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "JournalEntry",
        voucherId: fromJE.id,
        voucherName: fromJE.name,
        companyId: fromCo.id,
        lines: fromLines,
      });
      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "JournalEntry",
        voucherId: toJE.id,
        voucherName: toJE.name,
        companyId: toCo.id,
        lines: toLines,
      });

      return tx.intercompanyJournalEntry.create({
        data: {
          tenantId,
          fromCompanyId: fromCo.id,
          toCompanyId: toCo.id,
          fromJournalId: fromJE.id,
          toJournalId: toJE.id,
          amount,
          narrative: b.narrative ?? null,
          postingDate,
          fromCurrency: fromSide.currency,
          fromConversionRate: new Prisma.Decimal(fromSide.conversionRate),
          fromNativeAmount: new Prisma.Decimal(fromSide.nativeAmount),
          fromFxGainLoss: new Prisma.Decimal(fromSide.fxDelta),
          toCurrency: toSide.currency,
          toConversionRate: new Prisma.Decimal(toSide.conversionRate),
          toNativeAmount: new Prisma.Decimal(toSide.nativeAmount),
          toFxGainLoss: new Prisma.Decimal(toSide.fxDelta),
        },
        include: { fromJournal: true, toJournal: true },
      });
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});

// Multi-company Phase 6: reverse an ICJE.
//
// Creates a NEW ICJE that mirrors the original with debit/credit sides
// SWAPPED on both mirror JEs. Original stays intact — its GL entries
// are NOT touched — so audit trails preserve both the original and the
// correction. Rules:
//   * Can't reverse an already-reversed or cancelled entry.
//   * The reversal's postingDate defaults to today (accounting practice
//     is to book the correction in the current period, not backdate).
//     Callers can pass an explicit postingDate to override.
//   * Currency + rate fields on the reversal mirror the original so the
//     FX gain/loss on the correction cancels the FX on the original at
//     the ledger level.
//   * Links `original.reversedById -> reversal.id` and
//     `reversal.reversesId -> original.id` so the UI can render the
//     reversal chain.
const reverseSchema = z.object({
  postingDate: z.string().datetime().optional(),
  narrative: z.string().max(500).optional().nullable(),
});
intercompanyJournalRouter.post("/:id/reverse", p.create, async (req, res) => {
  const parsed = reverseSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const original = await prisma.intercompanyJournalEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      fromJournal: { include: { accounts: true } },
      toJournal: { include: { accounts: true } },
      fromCompany: { select: { code: true } },
      toCompany: { select: { code: true } },
    },
  });
  if (!original) return res.status(404).json({ error: "Not found" });
  if (original.status !== "Active") {
    return res.status(400).json({
      error: `Cannot reverse an entry in status ${original.status}`,
    });
  }

  try {
    await assertCompanyAccess(req.auth!, original.fromCompanyId);
    await assertCompanyAccess(req.auth!, original.toCompanyId);
  } catch (e) {
    return res.status(403).json({ error: e instanceof Error ? e.message : "Forbidden" });
  }

  const postingDate = parsed.data.postingDate ? new Date(parsed.data.postingDate) : new Date();
  const baseNarrative = parsed.data.narrative ?? `Reversal of ${original.fromJournal.name}/${original.toJournal.name}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Build swapped-line arrays from the ORIGINAL JEs. Each account
      // that had DR becomes CR and vice versa. This includes any FX
      // gain/loss line, so the reversal fully cancels the original's
      // GL impact.
      function swap(lines: { accountId: string; debit: unknown; credit: unknown }[]) {
        return lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.credit),
          credit: Number(l.debit),
        }));
      }
      const fromLines = swap(original.fromJournal.accounts);
      const toLines = swap(original.toJournal.accounts);

      const fromName = await nextName(
        tx,
        tenantId,
        companyPrefix("ICJV-", original.fromCompany.code),
      );
      const toName = await nextName(
        tx,
        tenantId,
        companyPrefix("ICJV-", original.toCompany.code),
      );

      const fromJE = await tx.journalEntry.create({
        data: {
          tenantId,
          name: fromName,
          postingDate,
          currency: original.fromCurrency,
          remarks: baseNarrative,
          status: "Submitted",
          companyId: original.fromCompanyId,
          accounts: {
            create: fromLines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
            })),
          },
        },
      });
      const toJE = await tx.journalEntry.create({
        data: {
          tenantId,
          name: toName,
          postingDate,
          currency: original.toCurrency,
          remarks: baseNarrative,
          status: "Submitted",
          companyId: original.toCompanyId,
          accounts: {
            create: toLines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
            })),
          },
        },
      });

      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "JournalEntry",
        voucherId: fromJE.id,
        voucherName: fromJE.name,
        companyId: original.fromCompanyId,
        lines: fromLines,
      });
      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "JournalEntry",
        voucherId: toJE.id,
        voucherName: toJE.name,
        companyId: original.toCompanyId,
        lines: toLines,
      });

      const reversal = await tx.intercompanyJournalEntry.create({
        data: {
          tenantId,
          fromCompanyId: original.fromCompanyId,
          toCompanyId: original.toCompanyId,
          fromJournalId: fromJE.id,
          toJournalId: toJE.id,
          amount: original.amount,
          narrative: baseNarrative,
          postingDate,
          fromCurrency: original.fromCurrency,
          fromConversionRate: original.fromConversionRate,
          fromNativeAmount: original.fromNativeAmount,
          // FX signs flip when we swap DR/CR — mirror in the wrapper too.
          fromFxGainLoss: new Prisma.Decimal(-Number(original.fromFxGainLoss)),
          toCurrency: original.toCurrency,
          toConversionRate: original.toConversionRate,
          toNativeAmount: original.toNativeAmount,
          toFxGainLoss: new Prisma.Decimal(-Number(original.toFxGainLoss)),
          reversesId: original.id,
        },
        include: { fromJournal: true, toJournal: true },
      });

      await tx.intercompanyJournalEntry.update({
        where: { id: original.id },
        data: {
          status: "Reversed",
          reversedById: reversal.id,
          reversedByUserId: req.auth!.userId,
          reversedAt: new Date(),
        },
      });

      return reversal;
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});

// Multi-company Phase 6: cancel an ICJE.
//
// Voids the original by flipping both mirror JEs' GLEntries to
// isCancelled=true (the standard GL cancel path). Marks the ICJE
// status=Cancelled with a cancelledAt timestamp + cancelledBy user id
// for audit. UNLIKE reverse, this destroys the ledger impact of the
// original — reports won't include the cancelled GL entries. Right
// choice when the entry was posted by mistake and shouldn't have any
// audit-visible ledger impact.
//
// Cannot cancel a reversed entry (must undo the reversal chain first).
intercompanyJournalRouter.post("/:id/cancel", p.cancel, idempotency("POST /intercompany-journals/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const original = await prisma.intercompanyJournalEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: { fromJournal: { select: { id: true } }, toJournal: { select: { id: true } } },
  });
  if (!original) return res.status(404).json({ error: "Not found" });
  if (original.status === "Cancelled") {
    return res.status(400).json({ error: "Already cancelled" });
  }
  if (original.status === "Reversed") {
    return res.status(400).json({
      error: "Cannot cancel a reversed entry. Reverse the reversal first, then cancel.",
    });
  }

  try {
    await assertCompanyAccess(req.auth!, original.fromCompanyId);
    await assertCompanyAccess(req.auth!, original.toCompanyId);
  } catch (e) {
    return res.status(403).json({ error: e instanceof Error ? e.message : "Forbidden" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Cancel GL entries for both mirror JEs.
      await cancelGLEntries(tx, {
        tenantId,
        voucherType: "JournalEntry",
        voucherId: original.fromJournal.id,
      });
      await cancelGLEntries(tx, {
        tenantId,
        voucherType: "JournalEntry",
        voucherId: original.toJournal.id,
      });
      // Flip the JEs to Cancelled so they don't appear in "active" JE
      // listings either.
      await tx.journalEntry.updateMany({
        where: {
          id: { in: [original.fromJournal.id, original.toJournal.id] },
          tenantId,
        },
        data: { status: "Cancelled" },
      });
      return tx.intercompanyJournalEntry.update({
        where: { id: original.id },
        data: {
          status: "Cancelled",
          cancelledAt: new Date(),
          cancelledBy: req.auth!.userId,
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});
