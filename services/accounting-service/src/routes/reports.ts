import { Router } from "express";
import React from "react";
import {
  computeMonthlyTdsDue,
  generate26q,
  generate27eq,
  loadForm16aData,
  prisma,
  tdsQuarter,
} from "@lumaara/db";
import { Form16aDocument, renderPdf } from "@lumaara/print";
import { getAllowedCompanyIds, perms } from "@lumaara/service-auth";

export const reportsRouter = Router();

const p = perms("Report");

// Multi-company Phase 3: parse the optional ?companyId= query param.
// Phase 6: also layer the user's company allowlist (deny-by-default for
// non-admins) so a locked-down user can't request a company they don't
// have access to, and reports without an explicit companyId still
// aggregate only over the companies they can see.
async function parseCompanyId(
  tenantId: string,
  raw: unknown,
  auth: import("@lumaara/shared-types").AuthContext,
): Promise<{
  companyId: string | null;
  // When explicit companyId is null and user has an allowlist, this is
  // the subset of company IDs the report should aggregate over. null =
  // no restriction (admin / bypass).
  allowedCompanyIds: string[] | null;
  error?: string;
}> {
  const allowed = await getAllowedCompanyIds(auth);
  // Explicit companyId from the query string.
  if (typeof raw === "string" && raw.length > 0) {
    const c = await prisma.company.findFirst({
      where: { id: raw, tenantId },
      select: { id: true },
    });
    if (!c) return { companyId: null, allowedCompanyIds: allowed, error: "companyId does not belong to this tenant" };
    // Non-admins may only request companies in their allowlist.
    if (allowed !== null && !allowed.includes(c.id)) {
      return {
        companyId: null,
        allowedCompanyIds: allowed,
        error: "You don't have access to that company",
      };
    }
    return { companyId: c.id, allowedCompanyIds: allowed };
  }
  return { companyId: null, allowedCompanyIds: allowed };
}

// When companyId is set, restrict GLEntry aggregations to rows stamped
// with that companyId. When null but the user has an allowlist, restrict
// to that allowlist (Phase 6). When both are null (admin or bypass), no
// predicate — full aggregation.
function companyGLFilter(companyId: string | null, allowed: string[] | null) {
  if (companyId) return { companyId };
  if (allowed !== null) return { companyId: { in: allowed } };
  return {};
}

// Account filter mirrors the GL filter but also permits shared accounts
// (companyId=null) which appear in every per-company view.
function companyAccountFilter(companyId: string | null, allowed: string[] | null) {
  if (companyId) return { OR: [{ companyId }, { companyId: null }] };
  if (allowed !== null) return { OR: [{ companyId: { in: allowed } }, { companyId: null }] };
  return {};
}

// Dashboard summary — headline accounting numbers for the shell home page.
// One round-trip, ~6 queries in parallel where possible.
reportsRouter.get("/dashboard-summary", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const glCompany = companyGLFilter(companyId, allowedCompanyIds);
  // SI/PI companyId filter — Phase 2 stamps this on every new voucher.
  // Legacy rows with companyId=null are included when no filter is set
  // (companyId undefined) but excluded when the user requests a specific
  // company scope (that's the correct semantics — legacy rows aren't
  // attributable to any specific company).
  const invoiceCompany = companyId
    ? { companyId }
    : allowedCompanyIds !== null
      ? { companyId: { in: allowedCompanyIds } }
      : {};

  const [
    outstandingSI,
    overdueSI,
    outstandingPI,
    cashBalances,
    incomeMTD,
    expenseMTD,
  ] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { tenantId, status: "Submitted", outstandingAmt: { gt: 0 }, ...invoiceCompany },
      _sum: { outstandingAmt: true },
      _count: true,
    }),
    prisma.salesInvoice.aggregate({
      where: {
        tenantId,
        status: "Submitted",
        outstandingAmt: { gt: 0 },
        dueDate: { lt: now },
        ...invoiceCompany,
      },
      _sum: { outstandingAmt: true },
      _count: true,
    }),
    prisma.purchaseInvoice.aggregate({
      where: { tenantId, status: "Submitted", outstandingAmt: { gt: 0 }, ...invoiceCompany },
      _sum: { outstandingAmt: true },
      _count: true,
    }),
    prisma.gLEntry.groupBy({
      by: ["accountId"],
      where: {
        tenantId,
        isCancelled: false,
        account: { accountType: { in: ["Cash", "Bank"] } },
        ...glCompany,
      },
      _sum: { debit: true, credit: true },
    }),
    prisma.gLEntry.aggregate({
      where: {
        tenantId,
        isCancelled: false,
        postingDate: { gte: monthStart, lte: now },
        account: { rootType: "Income" },
        ...glCompany,
      },
      _sum: { debit: true, credit: true },
    }),
    prisma.gLEntry.aggregate({
      where: {
        tenantId,
        isCancelled: false,
        postingDate: { gte: monthStart, lte: now },
        account: { rootType: "Expense" },
        ...glCompany,
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  const cashOnHand = cashBalances.reduce(
    (s, g) => s + Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0),
    0,
  );
  const income = Number(incomeMTD._sum.credit ?? 0) - Number(incomeMTD._sum.debit ?? 0);
  const expense = Number(expenseMTD._sum.debit ?? 0) - Number(expenseMTD._sum.credit ?? 0);

  res.json({
    receivables: {
      outstanding: Number(outstandingSI._sum.outstandingAmt ?? 0),
      openInvoices: outstandingSI._count,
      overdue: Number(overdueSI._sum.outstandingAmt ?? 0),
      overdueInvoices: overdueSI._count,
    },
    payables: {
      outstanding: Number(outstandingPI._sum.outstandingAmt ?? 0),
      openBills: outstandingPI._count,
    },
    cashOnHand,
    mtd: {
      income,
      expense,
      netProfit: income - expense,
    },
  });
});

// Trial Balance:
// Aggregates GLEntry rows by account (isCancelled=false), returns per-account
// totalDebit / totalCredit and net balance. Includes rows for accounts with no
// activity so the CoA is fully represented. Optionally filter by date range via
// ?from=YYYY-MM-DD&to=YYYY-MM-DD.
reportsRouter.get("/trial-balance", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

  const groups = await prisma.gLEntry.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      isCancelled: false,
      ...companyGLFilter(companyId, allowedCompanyIds),
      ...(from || to
        ? {
            postingDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    _sum: { debit: true, credit: true },
  });

  const accounts = await prisma.account.findMany({
    where: { tenantId, isGroup: false, disabled: false, ...companyAccountFilter(companyId, allowedCompanyIds) },
    orderBy: [{ rootType: "asc" }, { accountName: "asc" }],
    select: { id: true, accountName: true, rootType: true, accountType: true },
  });

  const byAccount = new Map(groups.map((g) => [g.accountId, g]));

  const rows = accounts.map((a) => {
    const g = byAccount.get(a.id);
    const debit = Number(g?._sum.debit ?? 0);
    const credit = Number(g?._sum.credit ?? 0);
    return {
      accountId: a.id,
      accountName: a.accountName,
      rootType: a.rootType,
      accountType: a.accountType,
      debit,
      credit,
      // Convention: Asset/Expense are debit-normal, Liability/Equity/Income are credit-normal.
      // We surface the raw debit/credit; the UI can render "balance" in the normal side.
      balance: debit - credit,
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  );

  res.json({ rows, totals });
});

// General Ledger drilldown: raw GL entries for one account, optionally date-scoped.
// Returns an envelope with the account details + entries so the UI can render
// a header without a second call. Entries are sorted by postingDate then
// createdAt (stable order for same-day movements).
reportsRouter.get("/general-ledger", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : null;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  if (!accountId) return res.status(400).json({ error: "accountId is required" });

  const account = await prisma.account.findFirst({
    where: { id: accountId, tenantId },
    select: { id: true, accountName: true, rootType: true, accountType: true, isGroup: true },
  });
  if (!account) return res.status(404).json({ error: "Account not found" });

  const glCompany = companyGLFilter(companyId, allowedCompanyIds);
  // Opening balance = all active entries strictly before `from` (if given).
  const openingAgg = from
    ? await prisma.gLEntry.aggregate({
        where: {
          tenantId,
          accountId,
          isCancelled: false,
          postingDate: { lt: from },
          ...glCompany,
        },
        _sum: { debit: true, credit: true },
      })
    : null;
  const openingBalance = openingAgg
    ? Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0)
    : 0;

  const rows = await prisma.gLEntry.findMany({
    where: {
      tenantId,
      accountId,
      isCancelled: false,
      ...glCompany,
      ...(from || to
        ? {
            postingDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ postingDate: "asc" }, { createdAt: "asc" }],
  });

  const totalDebit = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.credit), 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;

  res.json({
    account,
    openingBalance,
    entries: rows,
    totals: { debit: totalDebit, credit: totalCredit },
    closingBalance,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
  });
});

// Aggregates GLEntry sums per account for the given rootTypes and date filter.
// Returns per-account rows with debit, credit, balance (debit - credit).
async function accountBalances(
  tenantId: string,
  rootTypes: string[],
  filter: {
    from?: Date;
    to?: Date;
    onOrBefore?: Date;
    companyId?: string | null;
    allowedCompanyIds?: string[] | null;
  },
) {
  const dateWhere =
    filter.onOrBefore != null
      ? { postingDate: { lte: filter.onOrBefore } }
      : filter.from || filter.to
        ? {
            postingDate: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {};

  const companyId = filter.companyId ?? null;
  const allowedCompanyIds = filter.allowedCompanyIds ?? null;
  const accounts = await prisma.account.findMany({
    where: {
      tenantId,
      isGroup: false,
      disabled: false,
      rootType: { in: rootTypes },
      ...companyAccountFilter(companyId, allowedCompanyIds),
    },
    orderBy: [{ rootType: "asc" }, { accountName: "asc" }],
    select: { id: true, accountName: true, rootType: true, accountType: true },
  });

  const groups = await prisma.gLEntry.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      isCancelled: false,
      accountId: { in: accounts.map((a) => a.id) },
      ...companyGLFilter(companyId, allowedCompanyIds),
      ...dateWhere,
    },
    _sum: { debit: true, credit: true },
  });
  const byAccount = new Map(groups.map((g) => [g.accountId, g]));

  return accounts.map((a) => {
    const g = byAccount.get(a.id);
    const debit = Number(g?._sum.debit ?? 0);
    const credit = Number(g?._sum.credit ?? 0);
    return {
      accountId: a.id,
      accountName: a.accountName,
      rootType: a.rootType,
      accountType: a.accountType,
      debit,
      credit,
      balance: debit - credit, // debit-normal balance
    };
  });
}

// Profit & Loss: Income and Expense activity in the period.
// Convention:
//   Revenue = sum(credit - debit) over Income accounts   (credit-normal → positive is income)
//   Expense = sum(debit - credit) over Expense accounts  (debit-normal → positive is spend)
//   Net Profit = Revenue - Expense
reportsRouter.get("/profit-and-loss", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

  const rows = await accountBalances(tenantId, ["Income", "Expense"], {
    from,
    to,
    companyId,
    allowedCompanyIds,
  });

  const income = rows
    .filter((r) => r.rootType === "Income")
    .map((r) => ({ ...r, amount: r.credit - r.debit }));
  const expense = rows
    .filter((r) => r.rootType === "Expense")
    .map((r) => ({ ...r, amount: r.debit - r.credit }));

  const totalIncome = income.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expense.reduce((s, r) => s + r.amount, 0);
  const netProfit = totalIncome - totalExpense;

  res.json({
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    income,
    expense,
    totalIncome,
    totalExpense,
    netProfit,
  });
});

// Balance Sheet as of a specific date (default: today).
//   Assets      = sum(debit - credit)  over Asset accounts     (debit-normal)
//   Liabilities = sum(credit - debit)  over Liability accounts (credit-normal)
//   Equity      = sum(credit - debit)  over Equity accounts    (credit-normal)
//   Retained Earnings = Net Profit up to asOfDate (Income - Expense)
//   Balance check: Assets == Liabilities + Equity + Retained Earnings
reportsRouter.get("/balance-sheet", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const asOfDate =
    typeof req.query.asOfDate === "string" ? new Date(req.query.asOfDate) : new Date();

  const [balanceRows, plRows] = await Promise.all([
    accountBalances(tenantId, ["Asset", "Liability", "Equity"], {
      onOrBefore: asOfDate,
      companyId,
      allowedCompanyIds,
    }),
    accountBalances(tenantId, ["Income", "Expense"], {
      onOrBefore: asOfDate,
      companyId,
      allowedCompanyIds,
    }),
  ]);

  const assets = balanceRows
    .filter((r) => r.rootType === "Asset")
    .map((r) => ({ ...r, amount: r.debit - r.credit }));
  const liabilities = balanceRows
    .filter((r) => r.rootType === "Liability")
    .map((r) => ({ ...r, amount: r.credit - r.debit }));
  const equity = balanceRows
    .filter((r) => r.rootType === "Equity")
    .map((r) => ({ ...r, amount: r.credit - r.debit }));

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0);

  const totalIncome = plRows
    .filter((r) => r.rootType === "Income")
    .reduce((s, r) => s + (r.credit - r.debit), 0);
  const totalExpense = plRows
    .filter((r) => r.rootType === "Expense")
    .reduce((s, r) => s + (r.debit - r.credit), 0);
  const retainedEarnings = totalIncome - totalExpense;

  const totalLiabAndEquity = totalLiabilities + totalEquity + retainedEarnings;
  const difference = totalAssets - totalLiabAndEquity;

  res.json({
    asOfDate: asOfDate.toISOString(),
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    retainedEarnings,
    totalLiabAndEquity,
    difference,
    balanced: Math.abs(difference) < 0.01,
  });
});

// ---------- Multi-company Consolidated P&L / BS (Phase 3) ----------
//
// Aggregates GLEntries across every enabled Company in the tenant into a
// single consolidated statement, with a per-company breakdown. Callers pass
// an optional `eliminateAccountIds` CSV so intercompany receivable/payable
// pairs (or other elimination accounts) drop out of BOTH the per-company
// numbers and the consolidated totals.
//
// Design notes:
//   * Elimination is user-driven for now — we don't tag intercompany
//     transactions natively. In ERPNext the workflow is: user maintains
//     "IC Receivable"/"IC Payable" account pairs, and consolidation reports
//     exclude those accounts. Same model here — pass the account IDs and
//     they're filtered out at the GL aggregation level.
//   * Legacy rows with companyId=null are grouped under a synthetic
//     "unassigned" bucket so nothing is silently dropped. If a tenant has
//     never used multi-company, everything lands in this bucket.
//   * BS balancing (Assets == Liab + Equity + RE) is asserted per-company
//     AND on the consolidated total. A large imbalance on the consolidated
//     side that clears per-company usually means an intercompany pair
//     wasn't eliminated.
reportsRouter.get("/consolidation", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  // Phase 6: consolidation respects the user's allowlist. Non-admins see
  // per-company + consolidated numbers ONLY over the companies they can
  // access; the synthetic "(unassigned)" bucket is dropped for them.
  const { allowedCompanyIds } = await parseCompanyId(tenantId, undefined, req.auth!);
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const asOfDate =
    typeof req.query.asOfDate === "string" ? new Date(req.query.asOfDate) : (to ?? new Date());

  const userSuppliedElim =
    typeof req.query.eliminateAccountIds === "string"
      ? req.query.eliminateAccountIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const flaggedElim = await prisma.account.findMany({
    where: { tenantId, isIntercompany: true },
    select: { id: true },
  });
  const eliminateAccountIds = Array.from(
    new Set([...userSuppliedElim, ...flaggedElim.map((a) => a.id)]),
  );

  const companies = await prisma.company.findMany({
    where: {
      tenantId,
      disabled: false,
      ...(allowedCompanyIds !== null ? { id: { in: allowedCompanyIds } } : {}),
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, code: true, isDefault: true },
  });

  // Synthetic bucket for legacy/unassigned rows (companyId=null on GLEntry).
  const buckets: Array<{ id: string | null; name: string; code: string | null; isDefault: boolean }> = [
    ...companies,
    // Only surface the synthetic "(unassigned)" bucket to admins/bypass —
    // non-admins with an allowlist shouldn't see legacy-null-company rows
    // that aren't attributable to a company they can access.
    ...(allowedCompanyIds === null
      ? [{ id: null, name: "(unassigned)", code: null, isDefault: false }]
      : []),
  ];

  // Aggregate: for each bucket, run BS + P&L using the same accountBalances
  // helper. The `companyId` filter passed through applies both the
  // account-scope filter (company + shared) and the GL scope. We add an
  // extra elimination pass on the returned rows.
  async function bucketNumbers(companyId: string | null) {
    const [balanceRows, plRows] = await Promise.all([
      accountBalances(tenantId, ["Asset", "Liability", "Equity"], {
        onOrBefore: asOfDate,
        companyId,
      }),
      accountBalances(tenantId, ["Income", "Expense"], { from, to, companyId }),
    ]);

    const filteredBal = balanceRows.filter((r) => !eliminateAccountIds.includes(r.accountId));
    const filteredPl = plRows.filter((r) => !eliminateAccountIds.includes(r.accountId));

    const totalAssets = filteredBal
      .filter((r) => r.rootType === "Asset")
      .reduce((s, r) => s + (r.debit - r.credit), 0);
    const totalLiabilities = filteredBal
      .filter((r) => r.rootType === "Liability")
      .reduce((s, r) => s + (r.credit - r.debit), 0);
    const totalEquity = filteredBal
      .filter((r) => r.rootType === "Equity")
      .reduce((s, r) => s + (r.credit - r.debit), 0);
    const totalIncome = filteredPl
      .filter((r) => r.rootType === "Income")
      .reduce((s, r) => s + (r.credit - r.debit), 0);
    const totalExpense = filteredPl
      .filter((r) => r.rootType === "Expense")
      .reduce((s, r) => s + (r.debit - r.credit), 0);

    const netProfit = totalIncome - totalExpense;
    const totalLiabAndEquity = totalLiabilities + totalEquity + netProfit;
    return {
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalIncome,
      totalExpense,
      netProfit,
      totalLiabAndEquity,
      difference: totalAssets - totalLiabAndEquity,
      balanced: Math.abs(totalAssets - totalLiabAndEquity) < 0.01,
    };
  }

  const perCompany = await Promise.all(
    buckets.map(async (b) => ({
      companyId: b.id,
      name: b.name,
      code: b.code,
      isDefault: b.isDefault,
      ...(await bucketNumbers(b.id)),
    })),
  );

  const consolidated = perCompany.reduce(
    (acc, r) => ({
      totalAssets: acc.totalAssets + r.totalAssets,
      totalLiabilities: acc.totalLiabilities + r.totalLiabilities,
      totalEquity: acc.totalEquity + r.totalEquity,
      totalIncome: acc.totalIncome + r.totalIncome,
      totalExpense: acc.totalExpense + r.totalExpense,
      netProfit: acc.netProfit + r.netProfit,
    }),
    { totalAssets: 0, totalLiabilities: 0, totalEquity: 0, totalIncome: 0, totalExpense: 0, netProfit: 0 },
  );
  const consolidatedTotalLiabAndEquity =
    consolidated.totalLiabilities + consolidated.totalEquity + consolidated.netProfit;
  const consolidatedDifference = consolidated.totalAssets - consolidatedTotalLiabAndEquity;

  res.json({
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    asOfDate: asOfDate.toISOString(),
    eliminateAccountIds,
    perCompany,
    consolidated: {
      ...consolidated,
      totalLiabAndEquity: consolidatedTotalLiabAndEquity,
      difference: consolidatedDifference,
      balanced: Math.abs(consolidatedDifference) < 0.01,
    },
  });
});

// ---------- Cash Flow Statement (B8) ----------
//
// Direct-method cash flow. Walks GL entries against Cash + Bank accounts in
// the date window and classifies each movement by the source voucherType.
// Debit = money INTO the account = inflow; Credit = OUT = outflow. All amounts
// are in tenant baseCurrency (GL invariant).
//
// Classification (business rules):
//   Operating  — PaymentEntry, SalarySlip, ExpenseClaim, SalesInvoice-direct
//                cash post, PurchaseInvoice-direct cash post, JournalEntry
//                (default — user should reclassify with a separate GL memo if
//                they want a different bucket).
//   Investing  — Asset (acquisition), AssetScrap (proceeds), LandedCostVoucher
//                (a stretch but landed costs are asset-capitalization related).
//   Financing  — Loan (disburse OUT), LoanRepayment (IN).
//
// This is the same taxonomy ERPNext uses. Deferred: user-configurable
// per-account classification override.
const CASH_FLOW_CATEGORY: Record<string, "Operating" | "Investing" | "Financing"> = {
  PaymentEntry: "Operating",
  SalarySlip: "Operating",
  ExpenseClaim: "Operating",
  SalesInvoice: "Operating",
  PurchaseInvoice: "Operating",
  JournalEntry: "Operating",
  DeliveryNote: "Operating",
  PurchaseReceipt: "Operating",
  Asset: "Investing",
  AssetScrap: "Investing",
  AssetDepreciation: "Investing",
  LandedCostVoucher: "Investing",
  Loan: "Financing",
  LoanRepayment: "Financing",
};

reportsRouter.get("/cash-flow", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime()))
    return res.status(400).json({ error: "from + to (YYYY-MM-DD) required" });
  if (to < from) return res.status(400).json({ error: "to must be >= from" });

  const glCompany = companyGLFilter(companyId, allowedCompanyIds);
  const nameOrTypeMatch = {
    OR: [
      { accountType: "Cash" },
      { accountType: "Bank" },
      { accountName: { contains: "Cash", mode: "insensitive" as const } },
      { accountName: { contains: "Bank", mode: "insensitive" as const } },
    ],
  };
  const cashAccounts = await prisma.account.findMany({
    where: {
      tenantId,
      isGroup: false,
      rootType: "Asset",
      ...nameOrTypeMatch,
      ...companyAccountFilter(companyId, allowedCompanyIds),
    },
    select: { id: true, accountName: true, accountType: true },
  });
  const cashAccIds = cashAccounts.map((a) => a.id);
  if (cashAccIds.length === 0)
    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      openingBalance: 0,
      closingBalance: 0,
      netChange: 0,
      operating: { inflow: 0, outflow: 0, net: 0, breakdown: [] },
      investing: { inflow: 0, outflow: 0, net: 0, breakdown: [] },
      financing: { inflow: 0, outflow: 0, net: 0, breakdown: [] },
      cashAccounts: [],
    });

  // Opening balance = Σ(debit − credit) for cash accounts BEFORE `from`.
  const openingAgg = await prisma.gLEntry.aggregate({
    where: {
      tenantId,
      isCancelled: false,
      accountId: { in: cashAccIds },
      postingDate: { lt: from },
      ...glCompany,
    },
    _sum: { debit: true, credit: true },
  });
  const openingBalance =
    Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0);

  // Movements within window.
  const entries = await prisma.gLEntry.findMany({
    where: {
      tenantId,
      isCancelled: false,
      accountId: { in: cashAccIds },
      postingDate: { gte: from, lte: to },
      ...glCompany,
    },
    select: { debit: true, credit: true, voucherType: true },
  });

  const buckets: Record<
    "Operating" | "Investing" | "Financing",
    Map<string, { inflow: number; outflow: number; count: number }>
  > = { Operating: new Map(), Investing: new Map(), Financing: new Map() };

  for (const e of entries) {
    const cat = CASH_FLOW_CATEGORY[e.voucherType] ?? "Operating";
    const bucket = buckets[cat];
    const cur = bucket.get(e.voucherType) ?? { inflow: 0, outflow: 0, count: 0 };
    cur.inflow += Number(e.debit);
    cur.outflow += Number(e.credit);
    cur.count += 1;
    bucket.set(e.voucherType, cur);
  }

  function summarize(cat: "Operating" | "Investing" | "Financing") {
    let inflow = 0;
    let outflow = 0;
    const breakdown: {
      voucherType: string;
      inflow: number;
      outflow: number;
      net: number;
      count: number;
    }[] = [];
    for (const [voucherType, v] of buckets[cat]) {
      inflow += v.inflow;
      outflow += v.outflow;
      breakdown.push({
        voucherType,
        inflow: v.inflow,
        outflow: v.outflow,
        net: v.inflow - v.outflow,
        count: v.count,
      });
    }
    breakdown.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    return { inflow, outflow, net: inflow - outflow, breakdown };
  }

  const operating = summarize("Operating");
  const investing = summarize("Investing");
  const financing = summarize("Financing");
  const netChange = operating.net + investing.net + financing.net;

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    openingBalance,
    closingBalance: openingBalance + netChange,
    netChange,
    operating,
    investing,
    financing,
    cashAccounts: cashAccounts.map((a) => ({
      id: a.id,
      name: a.accountName,
      accountType: a.accountType,
    })),
  });
});

// D13: Sales analytics — monthly revenue trend + top customers + top items
// across a date range. Uses SI grandTotal × conversionRate for base ccy.
reportsRouter.get("/sales-analytics", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const from =
    typeof req.query.from === "string"
      ? new Date(req.query.from)
      : new Date(new Date().setMonth(new Date().getMonth() - 12));
  const to =
    typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  const topN = req.query.topN ? Number(req.query.topN) : 10;

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      status: { in: ["Submitted", "Paid"] },
      isReturn: false,
      postingDate: { gte: from, lte: to },
    },
    select: {
      customerId: true,
      postingDate: true,
      grandTotal: true,
      conversionRate: true,
      customer: { select: { customerName: true } },
      items: {
        select: {
          itemId: true,
          amount: true,
          qty: true,
          item: { select: { itemCode: true, itemName: true } },
        },
      },
    },
  });

  // Monthly trend (YYYY-MM keys, sum grandTotal × fx).
  const monthly = new Map<string, number>();
  const byCustomer = new Map<
    string,
    { customerName: string; revenue: number; count: number }
  >();
  const byItem = new Map<
    string,
    { itemCode: string; itemName: string; qty: number; revenue: number }
  >();
  for (const inv of invoices) {
    const fx = Number(inv.conversionRate);
    const value = Number(inv.grandTotal) * fx;
    const d = inv.postingDate;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly.set(key, (monthly.get(key) ?? 0) + value);
    const c = byCustomer.get(inv.customerId) ?? {
      customerName: inv.customer.customerName,
      revenue: 0,
      count: 0,
    };
    c.revenue += value;
    c.count += 1;
    byCustomer.set(inv.customerId, c);
    for (const line of inv.items) {
      const g = byItem.get(line.itemId) ?? {
        itemCode: line.item.itemCode,
        itemName: line.item.itemName,
        qty: 0,
        revenue: 0,
      };
      g.qty += Number(line.qty);
      g.revenue += Number(line.amount) * fx;
      byItem.set(line.itemId, g);
    }
  }

  const monthlyRows = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));
  const topCustomers = [...byCustomer.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN);
  const topItems = [...byItem.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN);

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totalRevenue: invoices.reduce(
      (s, i) => s + Number(i.grandTotal) * Number(i.conversionRate),
      0,
    ),
    invoiceCount: invoices.length,
    monthly: monthlyRows,
    topCustomers,
    topItems,
  });
});

// K11: Daily Sales Report — for a given day (defaults today), returns per-
// mode-of-payment collections + total-billed + top items. Consumed by both
// the shell for staff and the portal for the current customer's slice.
// Query params:
//   ?date=YYYY-MM-DD   (default: today)
//   ?scopeCustomerId=  (portal restricts to a single customer via this)
reportsRouter.get("/dsr", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const day = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(day.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const scopeCustomerId =
    typeof req.query.scopeCustomerId === "string"
      ? req.query.scopeCustomerId
      : undefined;

  const [invoices, payments] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: dayStart, lt: dayEnd },
        ...(scopeCustomerId ? { customerId: scopeCustomerId } : {}),
      },
      include: {
        customer: { select: { customerName: true } },
        items: { include: { item: { select: { itemCode: true, itemName: true } } } },
      },
    }),
    prisma.paymentEntry.findMany({
      where: {
        tenantId,
        status: "Submitted",
        paymentType: "Receive",
        postingDate: { gte: dayStart, lt: dayEnd },
        ...(scopeCustomerId ? { partyType: "Customer", partyId: scopeCustomerId } : {}),
      },
    }),
  ]);

  const byMode = new Map<string, number>();
  for (const pe of payments) {
    const mode = pe.modeOfPayment ?? "Unspecified";
    byMode.set(mode, (byMode.get(mode) ?? 0) + Number(pe.paidAmount));
  }
  const collections = [...byMode.entries()]
    .map(([modeOfPayment, amount]) => ({ modeOfPayment, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalBilled = invoices.reduce(
    (s, i) => s + Number(i.grandTotal) * Number(i.conversionRate),
    0,
  );
  const totalCollected = payments.reduce(
    (s, p) => s + Number(p.paidAmount),
    0,
  );

  const itemAgg = new Map<
    string,
    { itemCode: string; itemName: string; qty: number; amount: number }
  >();
  for (const inv of invoices) {
    for (const line of inv.items) {
      const key = line.itemId;
      const cur =
        itemAgg.get(key) ??
        {
          itemCode: line.item.itemCode,
          itemName: line.item.itemName,
          qty: 0,
          amount: 0,
        };
      cur.qty += Number(line.qty);
      cur.amount += Number(line.amount);
      itemAgg.set(key, cur);
    }
  }
  const topItems = [...itemAgg.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  res.json({
    date: dayStart.toISOString().slice(0, 10),
    totalBilled,
    totalCollected,
    invoiceCount: invoices.length,
    paymentCount: payments.length,
    collections,
    topItems,
    invoices: invoices.map((i) => ({
      id: i.id,
      name: i.name,
      customerName: i.customer.customerName,
      grandTotal: Number(i.grandTotal),
      currency: i.currency,
      status: i.status,
    })),
  });
});

// Quarterly TDS return (Form 26Q). Aggregates PE.withholdingAmount by
// (supplier, sectionCode) for the FY-quarter that contains ?date=. When
// ?format=csv, streams a NSDL-friendly column layout that a CA can import
// into their filing tool. JSON is the default (also drives the /admin UI).
//
// Query params:
//   ?date=YYYY-MM-DD   any date in the target quarter (default: today)
//   ?format=csv|json   (default: json)
reportsRouter.get("/tds-26q", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const asOf = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(asOf.getTime()))
    return res.status(400).json({ error: "Invalid date" });

  const result = await generate26q(prisma, tenantId, asOf);

  if (req.query.format === "csv") {
    // NSDL 26Q column layout — simplified to what our data supports. A CA's
    // filing tool typically maps these columns to the deductee sheet.
    // Row 1: header. Sanitize commas + quotes in supplierName.
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [
      [
        "Section",
        "DeducteeName",
        "PAN",
        "PANAvailable",
        "PaymentCount",
        "TotalPaidAmount",
        "TotalTDSAmount",
        "EffectiveRate",
      ].join(","),
    ];
    for (const r of result.rows) {
      lines.push(
        [
          esc(r.sectionCode),
          esc(r.supplierName),
          esc(r.pan ?? ""),
          esc(r.panAvailable ? "Y" : "N"),
          esc(r.paymentCount),
          esc(r.totalPaidAmount),
          esc(r.totalTdsAmount),
          esc(r.effectiveRate),
        ].join(","),
      );
    }
    const filename = `26Q-${result.fyLabel}-Q${result.quarter}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n") + "\n");
    return;
  }

  res.json(result);
});

// Quarterly TCS return (Form 27EQ). Mirror of /tds-26q on the sales side.
// Aggregates SI.tcsAmount by (customer, sectionCode) for the FY-quarter that
// contains ?date=. When ?format=csv, streams NSDL-friendly columns.
//
// Query params:
//   ?date=YYYY-MM-DD   any date in the target quarter (default: today)
//   ?format=csv|json   (default: json)
reportsRouter.get("/tcs-27eq", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const asOf = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(asOf.getTime()))
    return res.status(400).json({ error: "Invalid date" });

  const result = await generate27eq(prisma, tenantId, asOf);

  if (req.query.format === "csv") {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [
      [
        "Section",
        "CollecteeName",
        "PAN",
        "PANAvailable",
        "InvoiceCount",
        "TotalNetAmount",
        "TotalTCSAmount",
        "EffectiveRate",
      ].join(","),
    ];
    for (const r of result.rows) {
      lines.push(
        [
          esc(r.sectionCode),
          esc(r.customerName),
          esc(r.pan ?? ""),
          esc(r.panAvailable ? "Y" : "N"),
          esc(r.invoiceCount),
          esc(r.totalNetAmount),
          esc(r.totalTcsAmount),
          esc(r.effectiveRate),
        ].join(","),
      );
    }
    const filename = `27EQ-${result.fyLabel}-Q${result.quarter}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n") + "\n");
    return;
  }

  res.json(result);
});

// Monthly TDS-due summary. For the FY that contains ?date=, groups
// deducted-TDS by (section, calendar-month) and subtracts recorded challan
// deposits → dueBalance > 0 means the tenant still owes the govt for that
// month. Used by the admin UI + the operator's month-end checklist.
//
// Query params:
//   ?date=YYYY-MM-DD   any date in the target FY (default: today)
reportsRouter.get("/tds-monthly-due", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const asOf = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(asOf.getTime()))
    return res.status(400).json({ error: "Invalid date" });
  const rows = await computeMonthlyTdsDue(prisma, tenantId, asOf);
  res.json({ fyLabel: rows[0]?.fyLabel ?? null, rows });
});

// Form 16A PDF — per-supplier quarterly TDS certificate. NSDL issues the
// legally-authoritative version via TRACES after 26Q filing; this is the
// interim copy the supplier can use pending that. Streams application/pdf.
//
// Query params:
//   ?date=YYYY-MM-DD   any date in the target quarter (default: today)
//   ?download=1        force Content-Disposition: attachment
reportsRouter.get(
  "/form-16a/:supplierId",
  perms("Supplier").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const dateStr = typeof req.query.date === "string" ? req.query.date : "";
      const asOf = dateStr ? new Date(dateStr) : new Date();
      if (Number.isNaN(asOf.getTime()))
        return res.status(400).json({ error: "Invalid date" });

      const [tenant, data] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            name: true,
            companyTan: true,
            companyPan: true,
            companyGstin: true,
          },
        }),
        loadForm16aData(prisma, tenantId, req.params.supplierId, asOf),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });

      const doc = React.createElement(Form16aDocument, {
        tenantName: tenant.name,
        tenantTan: tenant.companyTan,
        tenantPan: tenant.companyPan,
        tenantGstin: tenant.companyGstin,
        supplier: {
          supplierName: data.supplier.supplierName,
          pan: data.supplier.pan,
          gstin: data.supplier.gstin,
        },
        quarter: data.quarter,
        fyLabel: data.fyLabel,
        windowStart: data.windowStart,
        windowEnd: data.windowEnd,
        payments: data.payments.map((p) => ({
          peName: p.peName,
          paidDate: p.paidDate,
          paidAmount: p.paidAmount,
          tdsAmount: p.tdsAmount,
          tdsRate: p.tdsRate,
          section: p.section,
          challanNo: p.challanNo,
          challanDate: p.challanDate,
        })),
        totals: data.totals,
      });
      const buf = await renderPdf(doc);
      const filename = `Form16A-${data.supplier.supplierName.replace(/\W+/g, "_")}-${data.fyLabel}-Q${data.quarter}.pdf`;
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${filename}"`,
      );
      res.setHeader("Content-Length", buf.length.toString());
      res.end(buf);
    } catch (e) {
      next(e);
    }
  },
);

// Convenience: given a date, return which quarter it maps to. Used by the
// admin UI to render "Q2 FY 2026-27" labels for a date picker.
reportsRouter.get("/tds-26q/quarter-of", p.read, (req, res) => {
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const asOf = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(asOf.getTime()))
    return res.status(400).json({ error: "Invalid date" });
  const q = tdsQuarter(asOf);
  res.json({
    quarter: q.quarter,
    fyLabel: q.fyLabel,
    windowStart: q.start.toISOString(),
    windowEnd: q.end.toISOString(),
  });
});

// ---------- Module 56: Cash Forecast ----------
//
// Bucketed daily/weekly projection of the cash position over N days:
// starts from current cash+bank balance, layers in AR schedules
// (SI InvoicePaymentSchedule due), AP schedules (PI schedule due),
// and recurring subscription revenue.
//
// Only counts Submitted docs — draft invoices aren't cash-generating
// commitments yet. Cancelled schedules excluded via status filter.
reportsRouter.get("/cash-forecast", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });

  const horizonDays = req.query.horizon ? Number(req.query.horizon) : 90;
  const granularity =
    typeof req.query.granularity === "string" && req.query.granularity === "daily"
      ? "daily"
      : "weekly";
  const asOfDate = new Date();
  const horizonEnd = new Date(asOfDate);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

  // Opening cash: same query pattern as /dashboard-summary but shared.
  const { forecastCashPosition, firstNegativeBucket } = await import("@lumaara/db");
  const cashGroups = await prisma.gLEntry.groupBy({
    by: ["accountId"],
    where: {
      tenantId,
      isCancelled: false,
      account: { accountType: { in: ["Cash", "Bank"] } },
      ...companyGLFilter(companyId, allowedCompanyIds),
    },
    _sum: { debit: true, credit: true },
  });
  const openingBalance = cashGroups.reduce(
    (s, g) => s + Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0),
    0,
  );

  // Upcoming AR from SI payment schedules (still-open portion).
  const arRows = await prisma.invoicePaymentSchedule.findMany({
    where: {
      tenantId,
      salesInvoiceId: { not: null },
      status: { in: ["Upcoming", "Overdue", "Partial"] },
      dueDate: { gte: asOfDate, lte: horizonEnd },
      salesInvoice: {
        status: "Submitted",
        ...(companyId ? { companyId } : allowedCompanyIds !== null ? { companyId: { in: allowedCompanyIds } } : {}),
      },
    },
    select: {
      dueDate: true,
      amount: true,
      paidAmount: true,
      salesInvoice: { select: { name: true } },
    },
  });
  const receipts = arRows.map((r) => ({
    dueDate: r.dueDate,
    amount: Math.max(0, Number(r.amount) - Number(r.paidAmount)),
    sourceDoc: r.salesInvoice?.name ?? "SI",
    sourceKind: "SalesInvoice" as const,
  }));

  // Upcoming AP from PI payment schedules.
  const apRows = await prisma.invoicePaymentSchedule.findMany({
    where: {
      tenantId,
      purchaseInvoiceId: { not: null },
      status: { in: ["Upcoming", "Overdue", "Partial"] },
      dueDate: { gte: asOfDate, lte: horizonEnd },
      purchaseInvoice: {
        status: "Submitted",
        ...(companyId ? { companyId } : allowedCompanyIds !== null ? { companyId: { in: allowedCompanyIds } } : {}),
      },
    },
    select: {
      dueDate: true,
      amount: true,
      paidAmount: true,
      purchaseInvoice: { select: { name: true } },
    },
  });
  const payments = apRows.map((r) => ({
    dueDate: r.dueDate,
    amount: Math.max(0, Number(r.amount) - Number(r.paidAmount)),
    sourceDoc: r.purchaseInvoice?.name ?? "PI",
    sourceKind: "PurchaseInvoice" as const,
  }));

  const buckets = forecastCashPosition({
    openingBalance,
    asOfDate,
    horizonDays,
    granularity,
    receipts,
    payments,
  });
  const runoutIdx = firstNegativeBucket(buckets);

  res.json({
    asOfDate: asOfDate.toISOString(),
    horizonDays,
    granularity,
    openingBalance,
    buckets,
    runoutBucket: runoutIdx >= 0 ? {
      index: runoutIdx,
      label: buckets[runoutIdx].label,
      runningBalance: buckets[runoutIdx].runningBalance,
    } : null,
  });
});

// ---------- Module 56: Budget vs Actuals ----------
//
// Compares Budget rows against GLEntry actuals within the fiscal
// year's window. Returns per-account rows + rootType summary. UI
// renders progress bars + variance percentages with color coding
// by rootType (Expense over-budget = red, Income over-budget = green).
reportsRouter.get("/budget-vs-actuals", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { companyId, allowedCompanyIds, error } = await parseCompanyId(
    tenantId,
    req.query.companyId,
    req.auth!,
  );
  if (error) return res.status(400).json({ error });

  const fiscalYearId = typeof req.query.fiscalYearId === "string" ? req.query.fiscalYearId : null;
  const fy = fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, tenantId } })
    : await prisma.fiscalYear.findFirst({ where: { tenantId, isCurrent: true } });
  if (!fy) return res.status(400).json({ error: "No fiscal year found" });

  const budgets = await prisma.budget.findMany({
    where: { tenantId, fiscalYearId: fy.id },
    include: {
      account: { select: { id: true, accountName: true, rootType: true } },
    },
  });

  // Actual sums per account within fiscal year window. We compute the
  // signed "amount" per rootType convention:
  //   Expense/Asset: debit-normal → sum(debit-credit)
  //   Income/Liability/Equity: credit-normal → sum(credit-debit)
  const accountIds = budgets.map((b) => b.accountId);
  const glGroups = accountIds.length
    ? await prisma.gLEntry.groupBy({
        by: ["accountId"],
        where: {
          tenantId,
          isCancelled: false,
          accountId: { in: accountIds },
          postingDate: { gte: fy.startDate, lte: fy.endDate },
          ...companyGLFilter(companyId, allowedCompanyIds),
        },
        _sum: { debit: true, credit: true },
      })
    : [];
  const actualsByAccount = new Map<string, number>();
  for (const g of glGroups) {
    const dr = Number(g._sum.debit ?? 0);
    const cr = Number(g._sum.credit ?? 0);
    actualsByAccount.set(g.accountId, dr - cr); // sign-normalized below per rootType
  }

  const { computeVariance, summarizeByRootType } = await import("@lumaara/db");
  const rows = budgets.map((b) => {
    const raw = actualsByAccount.get(b.accountId) ?? 0;
    // Flip sign for credit-normal accounts so "actual" is always
    // presented on the account's natural side.
    const creditNormal =
      b.account.rootType === "Income" ||
      b.account.rootType === "Liability" ||
      b.account.rootType === "Equity";
    const actualAmount = creditNormal ? -raw : raw;
    return computeVariance({
      accountId: b.account.id,
      accountName: b.account.accountName,
      rootType: b.account.rootType,
      budgetAmount: Number(b.annualAmount),
      actualAmount,
      costCenterId: null,
      costCenterName: null,
    });
  });
  const totals = summarizeByRootType(rows);

  res.json({
    fiscalYear: { id: fy.id, name: fy.name, startDate: fy.startDate, endDate: fy.endDate },
    rows,
    totals,
  });
});
