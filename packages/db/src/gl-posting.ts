import { Prisma } from "@prisma/client";

// GL posting primitives — used by every voucher submit/cancel handler across
// services. Lives in @lumaara/db so both accounting-service and stock-service
// can import from a single source of truth.
//
// Invariant: every call to `postGLEntries` receives lines that sum to zero
// (total debit == total credit). We assert this so a bug can't silently
// produce an unbalanced ledger.
//
// Balance check is done in Decimal, not JS float. GLLine.debit/credit are
// typed `number` for the call sites that compute them in-JS, but accumulating
// as `number` loses precision above ~2^53 or on long tax-split sums; a
// legitimately-balanced posting could trip the tolerance. Prisma.Decimal
// accumulation avoids both.
//
// Cancellation policy: GLEntries are immutable in principle. On voucher cancel
// we mark existing rows isCancelled=true (mirrors ERPNext's approach). Reports
// filter isCancelled=false.

export interface GLLine {
  accountId: string;
  debit: number;
  credit: number;
  partyType?: string | null;
  partyId?: string | null;
  remarks?: string | null;
}

export type VoucherType =
  | "SalesInvoice"
  | "PurchaseInvoice"
  | "PaymentEntry"
  | "JournalEntry"
  | "DeliveryNote"
  | "PurchaseReceipt"
  | "SalarySlip"
  | "ExpenseClaim"
  | "Loan"
  | "LoanRepayment"
  | "Asset"
  | "AssetDepreciation"
  | "AssetScrap"
  | "LandedCostVoucher"
  | "PayrollEntry"
  | "EmployeeAdvance"
  | "EmployeeAdvanceReturn"
  | "DeferredRevenue"
  | "LeaveEncashment"
  | "JobCard"
  | "StockReconciliation";

export interface PostGLParams {
  tenantId: string;
  postingDate: Date;
  voucherType: VoucherType;
  voucherId: string;
  voucherName?: string | null;
  lines: GLLine[];
  /**
   * Multi-company Phase 2: when provided, stamps this companyId on EVERY
   * GLEntry line — overrides the per-account companyId lookup and the
   * tenant-default fallback. Callers with a doctype-level companyId
   * (SI/PI/PE/JE headers post-Phase-2) pass it here so ALL lines of the
   * voucher land in the same company, even if some accounts are shared
   * (companyId=null on Account).
   *
   * When omitted, Phase 1 behavior applies: per-line company from the
   * account, else tenant default, else null.
   */
  companyId?: string | null;
}

export async function postGLEntries(
  tx: Prisma.TransactionClient,
  params: PostGLParams,
): Promise<void> {
  const { tenantId, postingDate, voucherType, voucherId, voucherName, lines, companyId: voucherCompanyId } = params;

  const totalDebit = lines.reduce(
    (s, l) => s.plus(new Prisma.Decimal(l.debit)),
    new Prisma.Decimal(0),
  );
  const totalCredit = lines.reduce(
    (s, l) => s.plus(new Prisma.Decimal(l.credit)),
    new Prisma.Decimal(0),
  );
  // Tolerance at 1e-4 — one unit of the schema's Decimal(18,4) smallest
  // place. Anything looser would mask rounding bugs; tighter would false-
  // positive on legitimate tax-split postings.
  if (totalDebit.minus(totalCredit).abs().gt("0.0001")) {
    throw new Error(
      `GL post is unbalanced: debit=${totalDebit.toString()} credit=${totalCredit.toString()} on ${voucherType}/${voucherId}`,
    );
  }

  // Period-close guard: reject postings dated on or before any FiscalYear's
  // closedTill for this tenant. Applies uniformly to every voucher type that
  // routes through postGLEntries (SI, PI, PE, JE, DN, PR, SalarySlip).
  const blocking = await tx.fiscalYear.findFirst({
    where: {
      tenantId,
      closedTill: { not: null, gte: postingDate },
      startDate: { lte: postingDate },
      endDate: { gte: postingDate },
    },
    select: { name: true, closedTill: true },
  });
  if (blocking) {
    throw new Error(
      `Cannot post to ${voucherType} on ${postingDate.toISOString().slice(0, 10)}: fiscal year "${blocking.name}" is closed through ${blocking.closedTill!.toISOString().slice(0, 10)}`,
    );
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({
    where: { id: { in: accountIds }, tenantId },
    select: { id: true, isGroup: true, accountName: true, companyId: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("One or more accounts in GL post do not belong to this tenant");
  }
  const groups = accounts.filter((a) => a.isGroup);
  if (groups.length > 0) {
    throw new Error(
      `Cannot post to group accounts: ${groups.map((g) => g.accountName).join(", ")}`,
    );
  }

  // Multi-company Phase 5: cross-company posting guard.
  //
  // A single voucher must post to exactly one Company. If the caller
  // provided a voucherCompanyId, every account's own companyId must be
  // either null (shared) OR match voucherCompanyId. If no voucher-level
  // companyId is set, the accounts themselves must not span multiple
  // non-null companies.
  //
  // Cross-company JEs are almost always a data-entry mistake — the
  // operator picked an account from Company B while filing a JE for
  // Company A. The correct workflow is POST /intercompany-journals which
  // creates a mirror pair. Reject with a directive error so the operator
  // is nudged to the right endpoint.
  const distinctAccountCompanies = new Set(
    accounts.map((a) => a.companyId).filter((id): id is string => id !== null),
  );
  if (voucherCompanyId) {
    const foreign = accounts.filter(
      (a) => a.companyId !== null && a.companyId !== voucherCompanyId,
    );
    if (foreign.length > 0) {
      throw new Error(
        `Cross-company posting on ${voucherType}/${voucherId}: accounts ${foreign
          .map((a) => a.accountName)
          .join(", ")} belong to a different company than the voucher. Use POST /intercompany-journals to move value between companies.`,
      );
    }
  } else if (distinctAccountCompanies.size > 1) {
    throw new Error(
      `Cross-company posting on ${voucherType}/${voucherId}: line accounts span multiple companies. Use POST /intercompany-journals to move value between companies.`,
    );
  }

  // Multi-company: stamp GLEntry.companyId. Precedence:
  //   1. voucherCompanyId (Phase 2: caller passed a doctype-level companyId)
  //   2. account's companyId (Phase 1: account scoped to a company)
  //   3. tenant's default Company (Phase 1 fallback)
  //   4. null (legacy tenant with no default)
  const accountCompanyById = new Map(accounts.map((a) => [a.id, a.companyId]));
  let defaultCompanyId: string | null = null;
  if (voucherCompanyId === undefined || voucherCompanyId === null) {
    const tenantDefaultCompany = await tx.company.findFirst({
      where: { tenantId, isDefault: true, disabled: false },
      select: { id: true },
    });
    defaultCompanyId = tenantDefaultCompany?.id ?? null;
  }

  await tx.gLEntry.createMany({
    data: lines
      .filter((l) => l.debit > 0 || l.credit > 0)
      .map((l) => ({
        tenantId,
        postingDate,
        accountId: l.accountId,
        debit: new Prisma.Decimal(l.debit),
        credit: new Prisma.Decimal(l.credit),
        voucherType,
        voucherId,
        voucherName: voucherName ?? null,
        partyType: l.partyType ?? null,
        partyId: l.partyId ?? null,
        remarks: l.remarks ?? null,
        isCancelled: false,
        companyId:
          voucherCompanyId ??
          accountCompanyById.get(l.accountId) ??
          defaultCompanyId,
      })),
  });
}

export async function cancelGLEntries(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; voucherType: string; voucherId: string },
): Promise<void> {
  await tx.gLEntry.updateMany({
    where: {
      tenantId: params.tenantId,
      voucherType: params.voucherType,
      voucherId: params.voucherId,
      isCancelled: false,
    },
    data: { isCancelled: true },
  });
}

export interface TenantDefaults {
  defaultReceivableAccountId: string | null;
  defaultPayableAccountId: string | null;
  defaultCashAccountId: string | null;
  defaultBankAccountId: string | null;
  defaultIncomeAccountId: string | null;
  defaultExpenseAccountId: string | null;
  defaultStockInHandAccountId: string | null;
  defaultCogsAccountId: string | null;
  defaultStockReceivedButNotBilledAccountId: string | null;
  defaultSalaryExpenseAccountId: string | null;
  defaultEmployeePayableAccountId: string | null;
  defaultStatutoryPayableAccountId: string | null;
  defaultFxGainLossAccountId: string | null;
  defaultLoanReceivableAccountId: string | null;
  defaultInterestIncomeAccountId: string | null;
  defaultRetainedEarningsAccountId: string | null;
  defaultRoundOffAccountId: string | null;
  defaultStockAdjustmentAccountId: string | null;
}

// Multi-company Phase 4: `companyId` opts into Company-scoped overrides.
// Resolution per-field: Company override (when set + non-null) → Tenant
// default → error. Backwards-compatible: existing callers that omit the
// 4th arg behave exactly as before (tenant-only lookup).
export async function requireTenantDefaults(
  tx: Prisma.TransactionClient,
  tenantId: string,
  required: Array<keyof TenantDefaults>,
  companyId?: string | null,
): Promise<TenantDefaults> {
  const select = {
    defaultReceivableAccountId: true,
    defaultPayableAccountId: true,
    defaultCashAccountId: true,
    defaultBankAccountId: true,
    defaultIncomeAccountId: true,
    defaultExpenseAccountId: true,
    defaultStockInHandAccountId: true,
    defaultCogsAccountId: true,
    defaultStockReceivedButNotBilledAccountId: true,
    defaultSalaryExpenseAccountId: true,
    defaultEmployeePayableAccountId: true,
    defaultStatutoryPayableAccountId: true,
    defaultFxGainLossAccountId: true,
    defaultLoanReceivableAccountId: true,
    defaultInterestIncomeAccountId: true,
    defaultRetainedEarningsAccountId: true,
    defaultRoundOffAccountId: true,
    defaultStockAdjustmentAccountId: true,
  } as const;
  const [t, c] = await Promise.all([
    tx.tenant.findUnique({ where: { id: tenantId }, select }),
    companyId
      ? tx.company.findFirst({ where: { id: companyId, tenantId }, select })
      : Promise.resolve(null),
  ]);
  if (!t) throw new Error("Tenant not found");

  const resolved = {} as TenantDefaults;
  for (const key of Object.keys(select) as Array<keyof TenantDefaults>) {
    const cv = c ? (c as TenantDefaults)[key] : null;
    const tv = (t as TenantDefaults)[key];
    resolved[key] = cv ?? tv;
  }
  for (const key of required) {
    if (!resolved[key]) {
      throw new Error(
        `Missing default account "${key}" — set it on Company ${companyId ?? "(none)"} or on the tenant`,
      );
    }
  }
  return resolved;
}

// Maps a Payment Entry's modeOfPayment to a tenant-default account.
// Cash/UPI/Card → Cash account, Bank → Bank account.
export function accountForPaymentMode(
  defaults: TenantDefaults,
  mode: string,
): string {
  const isBank = mode.toLowerCase() === "bank";
  const acc = isBank ? defaults.defaultBankAccountId : defaults.defaultCashAccountId;
  if (!acc) throw new Error(`No default account configured for mode "${mode}"`);
  return acc;
}
