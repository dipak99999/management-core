import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  decryptSecrets,
  fetchPlaidTransactions,
  getAnthropicClient,
  NoApiKeyError,
  nextName,
  prisma,
  rankCandidates,
  validatePlaidCreds,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { takeToken } from "@lumaara/queue";
import { headerMap, normalizeHeader, parseCsv } from "../lib/csv";

export const bankReconciliationRouter = Router();

// Reads / imports gated by Report role (broad access for accountants);
// write actions gated by Account write (bank recon is really account admin).
const p = perms("Report");
const pWrite = perms("Account");

// ---------- List statements ----------

bankReconciliationRouter.get("/statements", p.read, async (req, res) => {
  const rows = await prisma.bankStatement.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      account: { select: { accountName: true } },
      _count: { select: { transactions: true } },
    },
    orderBy: { fromDate: "desc" },
  });
  // Compute reconciliation progress per statement.
  const summaries = await Promise.all(
    rows.map(async (s) => {
      const counts = await prisma.bankTransaction.groupBy({
        by: ["matchStatus"],
        where: { statementId: s.id, tenantId: req.auth!.tenantId },
        _count: true,
      });
      const total = s._count.transactions;
      const matched = counts
        .filter((c) => c.matchStatus === "Matched" || c.matchStatus === "Ignored")
        .reduce((n, c) => n + c._count, 0);
      return {
        id: s.id,
        accountId: s.accountId,
        accountName: s.account.accountName,
        fileName: s.fileName,
        fromDate: s.fromDate,
        toDate: s.toDate,
        openingBalance: s.openingBalance,
        closingBalance: s.closingBalance,
        importedAt: s.importedAt,
        transactionCount: total,
        matchedCount: matched,
        reconciled: total > 0 && matched === total,
      };
    }),
  );
  res.json(summaries);
});

// ---------- Statement detail (transactions + candidate matches) ----------

bankReconciliationRouter.get("/statements/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const stmt = await prisma.bankStatement.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      account: { select: { accountName: true } },
      transactions: {
        orderBy: { transactionDate: "asc" },
        include: {
          matchedGlEntry: {
            select: {
              id: true,
              voucherType: true,
              voucherName: true,
              debit: true,
              credit: true,
              postingDate: true,
              remarks: true,
            },
          },
        },
      },
    },
  });
  if (!stmt) return res.status(404).json({ error: "Not found" });
  res.json(stmt);
});

// ---------- Import CSV ----------

// Accept a base64-encoded CSV. Expected columns (case + punctuation
// insensitive): date, description, amount. Optional: reference, balance.
const importSchema = z.object({
  accountId: z.string().min(1),
  fileName: z.string().min(1),
  base64: z.string().min(1),
});

function parseAmount(raw: string): number {
  // Strip currency symbols, thousands separators, and handle (123.45) → -123.45.
  const t = raw
    .trim()
    .replace(/[$€£¥₹\s,]/g, "");
  if (/^\(.+\)$/.test(t)) return -Number(t.slice(1, -1));
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string): Date | null {
  const t = raw.trim();
  if (!t) return null;
  // Try ISO first, then common regional formats.
  const iso = new Date(t);
  if (!isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(t)) return iso;
  // MM/DD/YYYY or DD/MM/YYYY — treat as US if year is unambiguous.
  const parts = t.split(/[\/.\-]/);
  if (parts.length === 3) {
    let y = Number(parts[2]);
    if (y < 100) y += 2000;
    // Assume MM/DD/YYYY (US) — bank CSVs from US institutions are most common.
    const m = Number(parts[0]);
    const d = Number(parts[1]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (!isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

bankReconciliationRouter.post("/import", pWrite.create, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { accountId, fileName, base64 } = parsed.data;

  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId, isGroup: false, disabled: false },
  });
  if (!account) return res.status(400).json({ error: "Invalid account (must be leaf, non-disabled)" });

  const csvText = Buffer.from(base64, "base64").toString("utf8");
  const rows = parseCsv(csvText).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2)
    return res.status(400).json({ error: "CSV needs a header row + at least one transaction" });

  const header = headerMap(rows[0]);
  const dateCol =
    header["date"] ?? header["transactiondate"] ?? header["postingdate"];
  const descCol =
    header["description"] ?? header["memo"] ?? header["details"] ?? header["narration"];
  const amountCol =
    header["amount"] ?? header["value"];
  const debitCol = header["debit"] ?? header["withdrawal"];
  const creditCol = header["credit"] ?? header["deposit"];
  const refCol = header["reference"] ?? header["referencenumber"] ?? header["checkno"] ?? header["chequenumber"];
  const balanceCol = header["balance"] ?? header["runningbalance"];

  if (dateCol === undefined || descCol === undefined)
    return res
      .status(400)
      .json({ error: "CSV missing required columns (date, description)" });
  const hasSignedAmount = amountCol !== undefined;
  const hasSplitAmount = debitCol !== undefined && creditCol !== undefined;
  if (!hasSignedAmount && !hasSplitAmount)
    return res
      .status(400)
      .json({ error: "CSV needs either 'amount' OR ('debit' + 'credit') columns" });

  const parsedTxns: {
    date: Date;
    description: string;
    referenceNumber: string | null;
    amount: number;
    runningBalance: number | null;
  }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const d = parseDate(r[dateCol] ?? "");
    if (!d) continue;
    let amount = 0;
    if (hasSignedAmount) {
      amount = parseAmount(r[amountCol!] ?? "");
    } else {
      const debit = parseAmount(r[debitCol!] ?? "");
      const credit = parseAmount(r[creditCol!] ?? "");
      // From the bank's perspective: credit = money INTO the account (+),
      // debit = money OUT (-). If both filled (unusual), sum them signed.
      amount = credit - debit;
    }
    if (amount === 0) continue; // skip zero-amount noise rows
    parsedTxns.push({
      date: d,
      description: (r[descCol] ?? "").trim(),
      referenceNumber: refCol !== undefined ? (r[refCol] ?? "").trim() || null : null,
      amount,
      runningBalance: balanceCol !== undefined ? parseAmount(r[balanceCol] ?? "") : null,
    });
  }
  if (parsedTxns.length === 0)
    return res.status(400).json({ error: "No valid transaction rows found" });

  // Statement window is inferred from txn date range.
  const dates = parsedTxns.map((t) => t.date.getTime());
  const fromDate = new Date(Math.min(...dates));
  const toDate = new Date(Math.max(...dates));

  // Opening/closing derived from running balance if provided; otherwise
  // approximated as sum of txns from the earliest.
  const earliestWithBalance = parsedTxns.find((t) => t.runningBalance !== null);
  const latestWithBalance = [...parsedTxns].reverse().find((t) => t.runningBalance !== null);
  const openingBalance =
    earliestWithBalance && earliestWithBalance.runningBalance !== null
      ? earliestWithBalance.runningBalance - earliestWithBalance.amount
      : 0;
  const closingBalance =
    latestWithBalance && latestWithBalance.runningBalance !== null
      ? latestWithBalance.runningBalance
      : parsedTxns.reduce((s, t) => s + t.amount, openingBalance);

  const created = await prisma.bankStatement.create({
    data: {
      tenantId,
      accountId,
      fileName,
      fromDate,
      toDate,
      openingBalance: new Prisma.Decimal(openingBalance),
      closingBalance: new Prisma.Decimal(closingBalance),
      importedBy: req.auth!.userId,
      transactions: {
        create: parsedTxns.map((t) => ({
          tenantId,
          transactionDate: t.date,
          description: t.description,
          referenceNumber: t.referenceNumber,
          amount: new Prisma.Decimal(t.amount),
          runningBalance: t.runningBalance !== null ? new Prisma.Decimal(t.runningBalance) : null,
        })),
      },
    },
    include: { _count: { select: { transactions: true } } },
  });
  res.status(201).json({
    id: created.id,
    transactionCount: created._count.transactions,
  });
});

// ---------- Auto-match ----------
//
// For each unmatched BankTransaction: find candidate GLEntries on the same
// account, unmatched, non-cancelled, within ±dateWindow days, where the GL
// amount matches the bank amount. If exactly one candidate, auto-attach with
// matchStatus="AutoSuggested" (user reviews). If more than one, leave alone.

bankReconciliationRouter.post(
  "/statements/:id/auto-match",
  pWrite.write,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const dateWindow = Math.max(0, Math.min(30, Number(req.query.window ?? 3)));

    const stmt = await prisma.bankStatement.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!stmt) return res.status(404).json({ error: "Not found" });

    const unmatched = await prisma.bankTransaction.findMany({
      where: {
        statementId: stmt.id,
        tenantId,
        matchStatus: "Unmatched",
      },
    });

    let matched = 0;
    for (const t of unmatched) {
      const from = new Date(t.transactionDate);
      from.setDate(from.getDate() - dateWindow);
      const to = new Date(t.transactionDate);
      to.setDate(to.getDate() + dateWindow);

      // Bank: positive amount = money INTO the bank account = a DEBIT on the
      // bank ledger account (assets go up on debit). Negative = credit.
      const target = Number(t.amount);
      const looksLikeDebit = target > 0;
      const abs = Math.abs(target);

      // Widened SQL filter: ±5% amount band + ±dateWindow. The pure
      // rankCandidates() then scores + orders. Naive rule ("exactly 1
      // exact match") was leaving too many unmatched for real banks where
      // amounts drift by ₹0.50 fees or ±1 day posting.
      const [minAmt, maxAmt] = [abs * 0.95, abs * 1.05];
      const amountFilter = looksLikeDebit
        ? { debit: { gte: new Prisma.Decimal(minAmt), lte: new Prisma.Decimal(maxAmt) } }
        : { credit: { gte: new Prisma.Decimal(minAmt), lte: new Prisma.Decimal(maxAmt) } };
      const candidates = await prisma.gLEntry.findMany({
        where: {
          tenantId,
          accountId: stmt.accountId,
          isCancelled: false,
          postingDate: { gte: from, lte: to },
          bankTransactions: { none: {} },
          ...amountFilter,
        },
        select: {
          id: true,
          postingDate: true,
          debit: true,
          credit: true,
          voucherName: true,
          remarks: true,
        },
        take: 50,
      });

      const ranked = rankCandidates(
        {
          amount: target,
          transactionDate: t.transactionDate,
          description: t.description,
          referenceNumber: t.referenceNumber,
        },
        candidates.map((c) => ({
          id: c.id,
          postingDate: c.postingDate,
          debit: Number(c.debit),
          credit: Number(c.credit),
          voucherName: c.voucherName,
          remarks: c.remarks,
        })),
        { topN: 1, minScore: 0.7 },
      );
      // Confidence floor of 0.7 — top candidate must be strong enough
      // to justify surfacing as AutoSuggested. Lower-scored candidates
      // stay visible via GET /candidates when a user clicks "Find match".
      if (ranked.length === 1) {
        await prisma.bankTransaction.update({
          where: { id: t.id },
          data: {
            matchedGlEntryId: ranked[0].glEntry.id,
            matchStatus: "AutoSuggested",
          },
        });
        matched += 1;
      }
    }

    res.json({ matched, considered: unmatched.length });
  },
);

// ---------- Candidates for one transaction (used in UI dropdown) ----------

bankReconciliationRouter.get(
  "/transactions/:id/candidates",
  p.read,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId },
      include: { statement: { select: { accountId: true } } },
    });
    if (!t) return res.status(404).json({ error: "Not found" });

    // Wider window than auto-match (±14d, ±5%) because the user has
    // explicitly asked for suggestions on THIS transaction — they want
    // to see maybes, not just certainties. The scorer's minScore keeps
    // truly implausible matches off the list.
    const from = new Date(t.transactionDate);
    from.setDate(from.getDate() - 14);
    const to = new Date(t.transactionDate);
    to.setDate(to.getDate() + 14);
    const target = Number(t.amount);
    const looksLikeDebit = target > 0;
    const abs = Math.abs(target);
    const [minAmt, maxAmt] = [abs * 0.95, abs * 1.05];
    const amountFilter = looksLikeDebit
      ? { debit: { gte: new Prisma.Decimal(minAmt), lte: new Prisma.Decimal(maxAmt) } }
      : { credit: { gte: new Prisma.Decimal(minAmt), lte: new Prisma.Decimal(maxAmt) } };

    const candidates = await prisma.gLEntry.findMany({
      where: {
        tenantId,
        accountId: t.statement.accountId,
        isCancelled: false,
        postingDate: { gte: from, lte: to },
        bankTransactions: { none: {} },
        ...amountFilter,
      },
      select: {
        id: true,
        postingDate: true,
        debit: true,
        credit: true,
        voucherType: true,
        voucherName: true,
        remarks: true,
      },
      take: 100,
    });

    // Rank via the pure scorer + return the payload the UI needs: the
    // GL row plus the score (0..1) and a reasons[] array shown in a
    // tooltip so accountants understand *why* the match was suggested.
    const ranked = rankCandidates(
      {
        amount: target,
        transactionDate: t.transactionDate,
        description: t.description,
        referenceNumber: t.referenceNumber,
      },
      candidates.map((c) => ({
        id: c.id,
        postingDate: c.postingDate,
        debit: Number(c.debit),
        credit: Number(c.credit),
        voucherName: c.voucherName,
        remarks: c.remarks,
      })),
      { topN: 8 },
    );
    const byId = new Map(candidates.map((c) => [c.id, c]));
    res.json(
      ranked.map((r) => {
        const gl = byId.get(r.glEntry.id)!;
        return {
          id: gl.id,
          postingDate: gl.postingDate,
          debit: gl.debit,
          credit: gl.credit,
          voucherType: gl.voucherType,
          voucherName: gl.voucherName,
          remarks: gl.remarks,
          score: Math.round(r.score * 100),
          reasons: r.reasons,
        };
      }),
    );
  },
);

// ---------- Manual match / unmatch / ignore ----------

bankReconciliationRouter.post(
  "/transactions/:id/match",
  pWrite.write,
  async (req, res) => {
    const parsed = z
      .object({ glEntryId: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const tenantId = req.auth!.tenantId;

    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!t) return res.status(404).json({ error: "Not found" });

    const gl = await prisma.gLEntry.findFirst({
      where: { id: parsed.data.glEntryId, tenantId, isCancelled: false },
    });
    if (!gl) return res.status(400).json({ error: "Invalid GL entry" });

    const alreadyMatched = await prisma.bankTransaction.findFirst({
      where: { matchedGlEntryId: gl.id, id: { not: t.id }, tenantId },
    });
    if (alreadyMatched)
      return res.status(400).json({ error: "GL entry is already matched to another bank txn" });

    const updated = await prisma.bankTransaction.update({
      where: { id: t.id },
      data: {
        matchedGlEntryId: gl.id,
        matchStatus: "Matched",
        reconciledAt: new Date(),
        reconciledBy: req.auth!.userId,
      },
    });
    res.json(updated);
  },
);

bankReconciliationRouter.post(
  "/transactions/:id/unmatch",
  pWrite.write,
  async (req, res) => {
    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!t) return res.status(404).json({ error: "Not found" });
    const updated = await prisma.bankTransaction.update({
      where: { id: t.id },
      data: {
        matchedGlEntryId: null,
        matchStatus: "Unmatched",
        reconciledAt: null,
        reconciledBy: null,
      },
    });
    res.json(updated);
  },
);

bankReconciliationRouter.post(
  "/transactions/:id/ignore",
  pWrite.write,
  async (req, res) => {
    const parsed = z.object({ notes: z.string().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!t) return res.status(404).json({ error: "Not found" });
    const updated = await prisma.bankTransaction.update({
      where: { id: t.id },
      data: {
        matchStatus: "Ignored",
        notes: parsed.data.notes ?? t.notes,
        reconciledAt: new Date(),
        reconciledBy: req.auth!.userId,
      },
    });
    res.json(updated);
  },
);

// Confirm an AutoSuggested match (user reviewed and accepted).
bankReconciliationRouter.post(
  "/transactions/:id/confirm",
  pWrite.write,
  async (req, res) => {
    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!t) return res.status(404).json({ error: "Not found" });
    if (t.matchStatus !== "AutoSuggested")
      return res.status(400).json({ error: `Cannot confirm in status ${t.matchStatus}` });
    const updated = await prisma.bankTransaction.update({
      where: { id: t.id },
      data: {
        matchStatus: "Matched",
        reconciledAt: new Date(),
        reconciledBy: req.auth!.userId,
      },
    });
    res.json(updated);
  },
);

bankReconciliationRouter.delete(
  "/statements/:id",
  pWrite.delete,
  async (req, res) => {
    const stmt = await prisma.bankStatement.findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!stmt) return res.status(404).json({ error: "Not found" });
    await prisma.bankStatement.delete({ where: { id: stmt.id } });
    res.status(204).send();
  },
);

// ---------- Create Payment Entry from an unmatched bank transaction ----------
//
// The ERPNext "aha" moment for accountants: a bank inflow shows up in the
// statement that doesn't correspond to any invoice yet (customer paid
// early / on account). One click here mints a Draft PaymentEntry with
// the correct amount, date, and mode-of-payment inferred. Staff picks
// the customer + review, submits.
//
// We create the PE in Draft (not Submitted) so:
//   - staff pick the correct customer/supplier
//   - staff can attach it to an invoice via the standard PE workflow
//   - the bank txn stays AutoSuggested (linked to the eventual GLEntry
//     via matchedGlEntryId after PE submit) rather than jumping to
//     Matched before the money-flow is fully expressed
//
// The bank txn is NOT auto-matched at PE create time — the GLEntry for
// this PE doesn't exist yet (it's created at submit). After the operator
// submits the PE from the PE screen, they come back and hit the
// standard "Find match" flow which will now surface the fresh GLEntry.

const createPeSchema = z.object({
  paymentType: z.enum(["Receive", "Pay"]),
  partyType: z.enum(["Customer", "Supplier", "Employee"]),
  partyId: z.string().min(1),
  modeOfPayment: z.string().default("Bank"),
  remarks: z.string().max(500).optional().nullable(),
});

bankReconciliationRouter.post(
  "/transactions/:id/create-payment-entry",
  pWrite.write,
  async (req, res) => {
    const parsed = createPeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const tenantId = req.auth!.tenantId;

    const t = await prisma.bankTransaction.findFirst({
      where: { id: req.params.id, tenantId },
      include: { statement: { select: { accountId: true } } },
    });
    if (!t) return res.status(404).json({ error: "Not found" });
    if (t.matchStatus === "Matched") {
      return res
        .status(400)
        .json({ error: "Transaction is already matched — unmatch first" });
    }

    // Sign convention: bank txn.amount > 0 means money INTO the account,
    // so a Receive (from customer) — negative means Pay (to supplier).
    // Refuse the mismatch rather than silently posting the wrong direction.
    const signedAmount = Number(t.amount);
    const wantsReceive = signedAmount > 0;
    if (
      (parsed.data.paymentType === "Receive" && !wantsReceive) ||
      (parsed.data.paymentType === "Pay" && wantsReceive)
    ) {
      return res.status(400).json({
        error: `Bank txn amount ${signedAmount} doesn't match paymentType=${parsed.data.paymentType}`,
      });
    }

    // Party existence check + partyType compatibility guard, mirroring
    // the /payment-entries route so we don't drop PE creation quirks.
    if (parsed.data.paymentType === "Receive" && parsed.data.partyType !== "Customer") {
      return res.status(400).json({ error: "Receive requires partyType=Customer" });
    }
    if (parsed.data.paymentType === "Pay" && parsed.data.partyType === "Customer") {
      return res.status(400).json({ error: "Pay cannot use partyType=Customer" });
    }
    const partyOk =
      parsed.data.partyType === "Customer"
        ? await prisma.customer.findFirst({
            where: { id: parsed.data.partyId, tenantId },
            select: { id: true },
          })
        : parsed.data.partyType === "Supplier"
          ? await prisma.supplier.findFirst({
              where: { id: parsed.data.partyId, tenantId },
              select: { id: true },
            })
          : await prisma.employee.findFirst({
              where: { id: parsed.data.partyId, tenantId },
              select: { id: true },
            });
    if (!partyOk) return res.status(400).json({ error: "Invalid partyId" });

    const name = await nextName(prisma, tenantId, "PE-");
    const pe = await prisma.paymentEntry.create({
      data: {
        tenantId,
        name,
        paymentType: parsed.data.paymentType,
        partyType: parsed.data.partyType,
        partyId: parsed.data.partyId,
        paidAmount: new Prisma.Decimal(Math.abs(signedAmount)),
        currency: "INR",
        conversionRate: new Prisma.Decimal(1),
        modeOfPayment: parsed.data.modeOfPayment,
        postingDate: t.transactionDate,
        status: "Draft",
        remarks:
          parsed.data.remarks ??
          `From bank txn on ${new Date(t.transactionDate).toISOString().slice(0, 10)}${
            t.referenceNumber ? ` · ref ${t.referenceNumber}` : ""
          }`,
      },
    });

    res.status(201).json({
      paymentEntryId: pe.id,
      paymentEntryName: pe.name,
      status: pe.status,
      message:
        "Draft Payment Entry created. Review + submit, then use 'Find match' on the bank transaction to link.",
    });
  },
);

// ---------- Plaid feed sync ----------
//
// POST /bank-reconciliation/plaid-sync
//   {
//     integrationId: <TenantIntegration id whose secrets carry the
//                    plaidClientId / plaidSecret / plaidAccessToken>,
//     accountId:     <Account id to attach the imported statement to>,
//     fromDate:      "YYYY-MM-DD",
//     toDate:        "YYYY-MM-DD"
//   }
// Creates one BankStatement + one BankTransaction row per Plaid txn.
// External txn ids are checked to de-dupe re-runs on overlapping windows.
const plaidSyncSchema = z.object({
  integrationId: z.string().min(1),
  accountId: z.string().min(1),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

bankReconciliationRouter.post("/plaid-sync", pWrite.create, async (req, res) => {
  const parsed = plaidSyncSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const [integration, account] = await Promise.all([
    prisma.tenantIntegration.findFirst({
      where: { id: b.integrationId, tenantId, isActive: true },
    }),
    prisma.account.findFirst({
      where: { id: b.accountId, tenantId },
      select: { id: true, accountName: true },
    }),
  ]);
  if (!integration) return res.status(400).json({ error: "Active integration not found" });
  if (!account) return res.status(400).json({ error: "Account not found in tenant" });

  let creds;
  try {
    const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
    creds = validatePlaidCreds(secrets);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  let txns;
  try {
    txns = await fetchPlaidTransactions(creds, b.fromDate, b.toDate);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "Plaid fetch failed" });
  }

  // De-dupe against already-imported (any statement, same account +
  // reference — Plaid transaction_id lives in referenceNumber to keep
  // the schema unchanged).
  const existingRefs = new Set(
    (
      await prisma.bankTransaction.findMany({
        where: {
          tenantId,
          statement: { accountId: b.accountId },
          referenceNumber: { in: txns.map((t) => t.externalId) },
        },
        select: { referenceNumber: true },
      })
    )
      .map((r) => r.referenceNumber ?? "")
      .filter((s): s is string => !!s),
  );
  const fresh = txns.filter((t) => !existingRefs.has(t.externalId));

  const opening = 0; // Plaid transactions/get doesn't include running balance
  const closing = fresh.reduce((s, t) => s + t.amount, opening);

  const stmt = await prisma.$transaction(async (tx) => {
    const s = await tx.bankStatement.create({
      data: {
        tenantId,
        accountId: b.accountId,
        fileName: `plaid-${b.fromDate}_${b.toDate}`,
        fromDate: new Date(b.fromDate),
        toDate: new Date(b.toDate),
        openingBalance: new Prisma.Decimal(opening),
        closingBalance: new Prisma.Decimal(closing),
        importedBy: req.auth!.userId,
      },
    });
    if (fresh.length > 0) {
      await tx.bankTransaction.createMany({
        data: fresh.map((t) => ({
          tenantId,
          statementId: s.id,
          transactionDate: t.transactionDate,
          description: t.description,
          referenceNumber: t.externalId,
          amount: new Prisma.Decimal(t.amount),
        })),
      });
    }
    return s;
  });
  res.json({
    statementId: stmt.id,
    imported: fresh.length,
    duplicates: existingRefs.size,
    account: account.accountName,
  });
});

// ─── AI-assisted explanation of unmatched transactions ─────────────────
//
// Rule-based auto-match (above) handles 70-80% of real-world cases. The
// remaining long tail is where bookkeepers burn hours: cryptic bank
// descriptions ("NEFT/UTBK/..."), partial-amount transfers, fees. This
// endpoint takes the top-N UNMATCHED txns on a statement and asks the
// tenant's Anthropic key to:
//   1. Categorize each as revenue / expense / transfer / fee / unknown
//   2. Suggest a likely GL account from the tenant's chart of accounts
//   3. Flag anomalies (duplicate, way outside normal, round-number
//      suspicious of fraud)
//
// Returns suggestions WITHOUT committing them — operator reviews + hits
// /match or /ignore. LLM failures degrade gracefully (empty suggestions).

bankReconciliationRouter.post(
  "/statements/:id/ai-explain",
  pWrite.write,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const limit = Math.min(10, Math.max(1, Number(req.query.limit ?? 5)));

    const allowed = await takeToken(`bank-ai:${tenantId}`, 20);
    if (!allowed) return res.status(429).json({ error: "AI explain rate limit — try again shortly." });

    const stmt = await prisma.bankStatement.findFirst({
      where: { id: req.params.id, tenantId },
    });
    if (!stmt) return res.status(404).json({ error: "Not found" });

    const unmatched = await prisma.bankTransaction.findMany({
      where: { statementId: stmt.id, tenantId, matchStatus: "Unmatched" },
      take: limit,
      orderBy: { transactionDate: "desc" },
    });
    if (unmatched.length === 0) {
      return res.json({ suggestions: [], note: "No unmatched transactions on this statement" });
    }

    // Give the model the tenant's leaf accounts so suggestions are
    // concrete + accurate.
    const accounts = await prisma.account.findMany({
      where: { tenantId, isGroup: false, disabled: false },
      select: { id: true, accountName: true, rootType: true },
      take: 100,
    });

    let client;
    try {
      client = await getAnthropicClient(tenantId);
    } catch (e) {
      if (e instanceof NoApiKeyError) {
        return res.status(400).json({
          error: "No Anthropic API key configured",
          hint: "Add one in Admin → Integrations to enable AI explanations.",
        });
      }
      throw e;
    }

    const prompt = {
      transactions: unmatched.map((t) => ({
        id: t.id,
        date: t.transactionDate.toISOString().slice(0, 10),
        amount: Number(t.amount),
        description: t.description,
        reference: t.referenceNumber,
      })),
      accounts: accounts.map((a) => ({
        id: a.id, name: a.accountName, rootType: a.rootType,
      })),
    };

    try {
      const resp = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1500,
        system:
          "You help a bookkeeper categorize unmatched bank transactions. For each txn in <input>, " +
          "respond with ONE JSON array (no prose, no markdown). Each item: " +
          "{\"id\":\"<txn id>\",\"category\":\"revenue|expense|transfer|fee|unknown\",\"suggestedAccountId\":\"<id from accounts list>\"|null,\"reason\":\"<≤80 char explanation>\",\"anomaly\":\"<flag>|null}. " +
          "Pick the suggestedAccountId from the provided accounts list only. If unsure, return null for suggestedAccountId. " +
          "Return exactly as many items as input txns, in the same order.",
        messages: [{ role: "user", content: `<input>${JSON.stringify(prompt)}</input>` }],
      });
      const text = resp.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text).join("").trim();
      // Strip accidental code fences
      const jsonStr = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
      let suggestions: Array<Record<string, unknown>>;
      try {
        suggestions = JSON.parse(jsonStr);
      } catch {
        return res.status(502).json({ error: "AI returned non-JSON", raw: text.slice(0, 200) });
      }
      // Validate suggestedAccountId references real accounts (prevent
      // hallucinated ids from being auto-applied downstream).
      const validAccountIds = new Set(accounts.map((a) => a.id));
      for (const s of suggestions) {
        if (s.suggestedAccountId && !validAccountIds.has(String(s.suggestedAccountId))) {
          s.suggestedAccountId = null;
          s.reason = `(hallucinated account filtered) ${s.reason ?? ""}`;
        }
      }
      res.json({ suggestions, model: resp.model, usage: resp.usage });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("401")) return res.status(400).json({ error: "Anthropic API key rejected" });
      if (msg.includes("429")) return res.status(429).json({ error: "Anthropic rate limited" });
      res.status(502).json({ error: "AI explain upstream failed", detail: msg.slice(0, 200) });
    }
  },
);
