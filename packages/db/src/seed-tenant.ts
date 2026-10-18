import { PrismaClient, Prisma } from "@prisma/client";
import { seedTenantRoles } from "./seed-roles";

// One-stop provisioning for a fresh tenant: Chart of Accounts + default
// warehouse + currencies + system roles. Runs inside the caller's transaction
// so signup is atomic.

export async function seedTenantDefaults(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  await seedChartOfAccounts(tx, tenantId);
  await seedDefaultWarehouse(tx, tenantId);
  await seedDefaultCurrencies(tx, tenantId);
  await seedDefaultPriceLists(tx, tenantId);
  await seedDefaultCompany(tx, tenantId);
  await seedTenantRoles(tx, tenantId);
}

// Kept as a named alias for callers that already imported this name.
export const seedTenantChartOfAccounts = seedTenantDefaults;

async function seedChartOfAccounts(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  async function create(
    accountName: string,
    rootType: string,
    accountType: string | null,
    parentId: string | null,
    isGroup: boolean,
  ): Promise<string> {
    const a = await tx.account.create({
      data: { tenantId, accountName, rootType, accountType, parentId, isGroup },
    });
    return a.id;
  }

  const assets = await create("Assets", "Asset", null, null, true);
  const debtors = await create("Debtors", "Asset", "Receivable", assets, false);
  const cash = await create("Cash", "Asset", "Cash", assets, false);
  const bank = await create("Bank", "Asset", "Bank", assets, false);
  const stockInHand = await create("Stock in Hand", "Asset", "Stock", assets, false);
  const loanReceivable = await create(
    "Loans to Employees",
    "Asset",
    "Receivable",
    assets,
    false,
  );
  await create("Fixed Assets", "Asset", "Fixed Asset", assets, false);
  await create(
    "Accumulated Depreciation",
    "Asset",
    "Accumulated Depreciation",
    assets,
    false,
  );

  const liabilities = await create("Liabilities", "Liability", null, null, true);
  const creditors = await create("Creditors", "Liability", "Payable", liabilities, false);
  const srbnb = await create(
    "Stock Received But Not Billed",
    "Liability",
    "Stock Received But Not Billed",
    liabilities,
    false,
  );
  const employeePayable = await create(
    "Employee Payable",
    "Liability",
    "Payable",
    liabilities,
    false,
  );
  const statutoryPayable = await create(
    "Statutory Payable",
    "Liability",
    "Payable",
    liabilities,
    false,
  );

  const equity = await create("Equity", "Equity", null, null, true);
  const retainedEarnings = await create(
    "Retained Earnings",
    "Equity",
    "Equity",
    equity,
    false,
  );

  const income = await create("Income", "Income", null, null, true);
  const sales = await create("Sales", "Income", "Income", income, false);
  const interestIncome = await create("Interest Income", "Income", "Income", income, false);

  const expenses = await create("Expenses", "Expense", null, null, true);
  const purchases = await create("Purchases", "Expense", "Expense", expenses, false);
  const cogs = await create("Cost of Goods Sold", "Expense", "Cost of Goods Sold", expenses, false);
  const salary = await create("Salary", "Expense", "Expense", expenses, false);
  const fxGainLoss = await create("FX Gain/Loss", "Expense", "Expense", expenses, false);
  await create("Depreciation Expense", "Expense", "Depreciation", expenses, false);
  await create("Loss on Asset Scrap", "Expense", "Expense", expenses, false);
  // B12: dedicated round-off account. Sign of the rounding delta is small
  // and unpredictable so we park it under Expenses (net-negative on net;
  // matches ERPNext's default placement).
  const roundOff = await create("Round Off", "Expense", "Expense", expenses, false);
  // C3: Stock Reconciliation +/- valuation deltas.
  const stockAdjustment = await create("Stock Adjustment", "Expense", "Expense", expenses, false);

  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      defaultReceivableAccountId: debtors,
      defaultPayableAccountId: creditors,
      defaultCashAccountId: cash,
      defaultBankAccountId: bank,
      defaultIncomeAccountId: sales,
      defaultExpenseAccountId: purchases,
      defaultStockInHandAccountId: stockInHand,
      defaultCogsAccountId: cogs,
      defaultStockReceivedButNotBilledAccountId: srbnb,
      defaultSalaryExpenseAccountId: salary,
      defaultEmployeePayableAccountId: employeePayable,
      defaultStatutoryPayableAccountId: statutoryPayable,
      defaultFxGainLossAccountId: fxGainLoss,
      defaultLoanReceivableAccountId: loanReceivable,
      defaultInterestIncomeAccountId: interestIncome,
      defaultRetainedEarningsAccountId: retainedEarnings,
      defaultRoundOffAccountId: roundOff,
      defaultStockAdjustmentAccountId: stockAdjustment,
    },
  });
}

// Multi-company Phase 2: every tenant gets a default Company at seed time.
// Downstream GL posting falls back to this Company when a voucher/account
// carries no explicit companyId. Idempotent — re-running the seed on a
// tenant that already has a default is a no-op.
async function seedDefaultCompany(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  const existing = await tx.company.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true },
  });
  if (existing) return;
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, baseCurrency: true },
  });
  const name = tenant?.name ?? "Main";
  const code = name.slice(0, 24).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "MAIN";
  await tx.company.create({
    data: {
      tenantId,
      name,
      code,
      isDefault: true,
      baseCurrency: tenant?.baseCurrency ?? "INR",
    },
  });
}

async function seedDefaultWarehouse(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  await tx.warehouse.create({
    data: { tenantId, warehouseName: "Stores", isGroup: false },
  });
}

async function seedDefaultCurrencies(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  const currencies = [
    { code: "INR", name: "Indian Rupee", symbol: "₹" },
    { code: "USD", name: "US Dollar", symbol: "$" },
    { code: "EUR", name: "Euro", symbol: "€" },
    { code: "GBP", name: "Pound Sterling", symbol: "£" },
  ];
  for (const c of currencies) {
    await tx.currency.create({
      data: { tenantId, ...c, isEnabled: true },
    });
  }
}

// C4: seed the two ERPNext-standard price lists so SI/PI new-forms have
// something to pick out of the box. Rates start empty — user adds ItemPrice
// rows as needed. Tenant.defaultSelling/BuyingPriceListId points at them so
// the UIs auto-select on new-doc.
async function seedDefaultPriceLists(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<void> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { baseCurrency: true },
  });
  const currency = tenant?.baseCurrency ?? "INR";
  const selling = await tx.priceList.create({
    data: {
      tenantId,
      name: "Standard Selling",
      currency,
      buyingOrSelling: "Selling",
      isDefault: true,
      enabled: true,
    },
  });
  const buying = await tx.priceList.create({
    data: {
      tenantId,
      name: "Standard Buying",
      currency,
      buyingOrSelling: "Buying",
      isDefault: true,
      enabled: true,
    },
  });
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      defaultSellingPriceListId: selling.id,
      defaultBuyingPriceListId: buying.id,
    },
  });
}
