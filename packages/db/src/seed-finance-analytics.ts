// Seeds the 18 Finance & Accounting dashboards (52 charts total) — each
// mapped to existing accounting doctypes (SalesInvoice, PurchaseInvoice,
// PaymentEntry, JournalEntry, GLEntry, Account, CostCenter, Budget,
// FiscalYear, Asset, BankGuarantee, LetterOfCredit, Customer, Supplier).
//
// Every config lines up with the resolver its ChartKind dispatches to. See
// packages/db/src/dashboard-advanced.ts for shape validation.

import { PrismaClient } from "@prisma/client";

interface CardSpec {
  kind: string;
  title: string;
  subtitle?: string;
  config: Record<string, unknown>;
  gridWidth?: number;
}

interface DashboardSpec {
  name: string;
  description: string;
  cards: CardSpec[];
}

function specs(): DashboardSpec[] {
  return [
    // 1. Accounts Payable — Donut, Line, StackedBar
    {
      name: "Accounts Payable",
      description: "Outstanding to suppliers, aging, cash-out trend",
      cards: [
        { kind: "Donut", title: "AP by status", config: { doctype: "PurchaseInvoice", aggregate: "count", groupBy: "status" } },
        { kind: "Line", title: "Payables trend", config: { doctype: "PurchaseInvoice", aggregate: "sum", field: "outstandingAmt", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "StackedBar", title: "AP by supplier × status", config: { doctype: "PurchaseInvoice", aggregate: "sum", field: "outstandingAmt", groupBy: "supplier.supplierName", seriesBy: "status" } },
      ],
    },

    // 2. Accounts Receivable — Line, Pie, StackedBar
    {
      name: "Accounts Receivable",
      description: "Customer outstanding + aging + cash-in trend",
      cards: [
        { kind: "Line", title: "Receivables trend", config: { doctype: "SalesInvoice", aggregate: "sum", field: "outstandingAmt", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Pie", title: "AR by status", config: { doctype: "SalesInvoice", aggregate: "count", groupBy: "status" } },
        { kind: "StackedBar", title: "AR by customer × status", config: { doctype: "SalesInvoice", aggregate: "sum", field: "outstandingAmt", groupBy: "customer.customerName", seriesBy: "status" } },
      ],
    },

    // 3. Cash Flow & Bank — Bar, Line, Waterfall
    {
      name: "Cash Flow & Bank",
      description: "Cash-in / cash-out / bank movement",
      cards: [
        { kind: "Bar", title: "Payments by mode", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "modeOfPayment" } },
        { kind: "Line", title: "Payments trend (30d)", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Waterfall", title: "Payment mix", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "paymentType" } },
      ],
    },

    // 4. Budgeting & Forecasting — Bar, Line, Scatter
    {
      name: "Budgeting & Forecasting",
      description: "Budget vs actual across accounts",
      cards: [
        { kind: "Bar", title: "Annual budget by account", config: { doctype: "Budget", aggregate: "sum", field: "annualAmount", groupBy: "accountId", limit: 15 } },
        { kind: "Line", title: "GL trend", config: { doctype: "GLEntry", aggregate: "sum", field: "debit", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Scatter", title: "Debit vs credit per entry", config: { doctype: "GLEntry", xField: "debit", yField: "credit", limit: 300 } },
      ],
    },

    // 5. Taxation & Compliance — Pie, StackedBar, Timeline
    {
      name: "Taxation & Compliance",
      description: "Tax collected / paid + status snapshot",
      cards: [
        { kind: "Pie", title: "SI tax share", config: { doctype: "SalesInvoice", aggregate: "sum", field: "totalTaxes", groupBy: "status" } },
        { kind: "StackedBar", title: "AP tax by supplier × status", config: { doctype: "PurchaseInvoice", aggregate: "sum", field: "totalTaxes", groupBy: "supplier.supplierName", seriesBy: "status" } },
        { kind: "Timeline", title: "Invoices timeline", config: { doctype: "SalesInvoice", nameField: "name", startField: "postingDate", endField: "dueDate", groupField: "status", limit: 100 } },
      ],
    },

    // 6. Fixed Asset Management — Bar, Line, TreeMap
    {
      name: "Fixed Asset Management",
      description: "Asset base, depreciation, categories",
      cards: [
        { kind: "Bar", title: "Assets by category", config: { doctype: "Asset", aggregate: "sum", field: "currentValue", groupBy: "categoryId", limit: 15 } },
        { kind: "Line", title: "Asset acquisition trend", config: { doctype: "Asset", aggregate: "sum", field: "purchasePrice", groupBy: "purchaseDate", dateField: "purchaseDate", period: "ytd", orderDir: "asc" } },
        { kind: "TreeMap", title: "Asset value by category → location", config: { doctype: "Asset", rootGroupBy: "categoryId", leafGroupBy: "location", aggregate: "sum", valueField: "currentValue", rootLabel: "Assets" } },
      ],
    },

    // 7. Operational Efficiency — Bar, Bubble, Line
    {
      name: "Operational Efficiency",
      description: "Turnover speed, DSO/DPO, throughput",
      cards: [
        { kind: "Bar", title: "SI grand total by customer", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", limit: 15 } },
        { kind: "Bubble", title: "SI grand total vs outstanding", config: { doctype: "SalesInvoice", xField: "grandTotal", yField: "outstandingAmt", sizeField: "totalTaxes", limit: 200 } },
        { kind: "Line", title: "GL debit trend", config: { doctype: "GLEntry", aggregate: "sum", field: "debit", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
      ],
    },

    // 8. Cost Center Analysis — Bar, Heatmap, Pie
    {
      name: "Cost Center Analysis",
      description: "Spend, allocation, budget usage by cost center",
      cards: [
        { kind: "Bar", title: "Budget by cost center", config: { doctype: "CostCenter", aggregate: "sum", field: "budget", groupBy: "name", limit: 20 } },
        { kind: "Heatmap", title: "GL voucher type × account", config: { doctype: "GLEntry", xField: "voucherType", yField: "accountId", aggregate: "sum", valueField: "debit" } },
        { kind: "Pie", title: "Cost centers by group vs leaf", config: { doctype: "CostCenter", aggregate: "count", groupBy: "isGroup" } },
      ],
    },

    // 9. Journal Entry — Line, StackedBar, TreeMap
    {
      name: "Journal Entry",
      description: "Manual JE volume and composition",
      cards: [
        { kind: "Line", title: "JEs per day", config: { doctype: "JournalEntry", aggregate: "count", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "StackedBar", title: "JE totals by status", config: { doctype: "JournalEntry", aggregate: "sum", field: "totalDebit", groupBy: "postingDate", seriesBy: "status" } },
        { kind: "TreeMap", title: "GL by voucherType", config: { doctype: "GLEntry", rootGroupBy: "voucherType", aggregate: "sum", valueField: "debit", rootLabel: "GL Volume" } },
      ],
    },

    // 10. Budget & Allocation — Donut, Waterfall, Bar
    {
      name: "Budget & Allocation",
      description: "How annual budgets split across accounts + cost centers",
      cards: [
        { kind: "Donut", title: "Budget shares", config: { doctype: "Budget", aggregate: "sum", field: "annualAmount", groupBy: "accountId", limit: 12 } },
        { kind: "Waterfall", title: "Budget vs actuals by fiscal year", config: { doctype: "Budget", aggregate: "sum", field: "annualAmount", groupBy: "fiscalYearId" } },
        { kind: "Bar", title: "Cost center budget totals", config: { doctype: "CostCenter", aggregate: "sum", field: "budget", groupBy: "name", limit: 15 } },
      ],
    },

    // 11. Financial Summary — Line, StackedArea, KPICards
    {
      name: "Financial Summary",
      description: "Topline P&L view — rev, expense, cash",
      cards: [
        { kind: "Line", title: "Revenue trend", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "StackedArea", title: "Payment & receipt over time", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "postingDate", seriesBy: "paymentType" } },
        { kind: "KPICards", title: "This month", config: { cards: [
          { label: "Sales MTD", doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", period: "mtd", dateField: "postingDate", format: "currency" },
          { label: "Purchases MTD", doctype: "PurchaseInvoice", aggregate: "sum", field: "grandTotal", period: "mtd", dateField: "postingDate", format: "currency" },
          { label: "Receipts MTD", doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", period: "mtd", dateField: "postingDate", format: "currency" },
        ] } },
      ],
    },

    // 12. Variance & Forecasting — Bar, Line, Scatter
    {
      name: "Variance & Forecasting",
      description: "Budget-to-actual variance + trend forecast",
      cards: [
        { kind: "Bar", title: "Budget by account", config: { doctype: "Budget", aggregate: "sum", field: "annualAmount", groupBy: "accountId", limit: 15 } },
        { kind: "Line", title: "GL credit trend", config: { doctype: "GLEntry", aggregate: "sum", field: "credit", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Scatter", title: "Budget vs GL debit (proxy)", config: { doctype: "Budget", xField: "annualAmount", yField: "annualAmount", limit: 100 } },
      ],
    },

    // 13. Compliance & Audit — Gantt, Pie, ConditionalTable(SummaryTable stand-in)
    {
      name: "Compliance & Audit",
      description: "Fiscal-year closure, cancelled entries, audit signals",
      cards: [
        { kind: "Gantt", title: "Fiscal year windows", config: { doctype: "FiscalYear", nameField: "name", startField: "startDate", endField: "endDate", limit: 10 } },
        { kind: "Pie", title: "GL cancelled vs active", config: { doctype: "GLEntry", aggregate: "count", groupBy: "isCancelled" } },
        { kind: "Bar", title: "SI status mix", config: { doctype: "SalesInvoice", aggregate: "count", groupBy: "status" } },
      ],
    },

    // 14. Allocation — StackedBar, Sunburst, TreeMap
    {
      name: "Allocation",
      description: "How GL splits across accounts and voucher types",
      cards: [
        { kind: "StackedBar", title: "GL by account × voucher", config: { doctype: "GLEntry", aggregate: "sum", field: "debit", groupBy: "accountId", seriesBy: "voucherType" } },
        { kind: "Sunburst", title: "GL rollup: voucherType → account", config: { doctype: "GLEntry", rootGroupBy: "voucherType", leafGroupBy: "accountId", aggregate: "sum", valueField: "debit", rootLabel: "GL" } },
        { kind: "TreeMap", title: "Accounts by root type", config: { doctype: "Account", rootGroupBy: "rootType", leafGroupBy: "accountType", aggregate: "count", rootLabel: "Accounts" } },
      ],
    },

    // 15. Custom — Dynamic (only 1 chart per user spec)
    {
      name: "Custom",
      description: "Dynamic dashboard slot for ad-hoc analysis",
      cards: [
        { kind: "SummaryTable", title: "Recent SIs", config: { savedReportId: "" } }, // caller fills savedReportId later; safe to leave empty
      ],
    },

    // 16. Party & Bank — Bar, Line, Pie
    {
      name: "Party & Bank",
      description: "Party (customer/supplier) balances + bank movement",
      cards: [
        { kind: "Bar", title: "Top customers by balance", config: { doctype: "SalesInvoice", aggregate: "sum", field: "outstandingAmt", groupBy: "customer.customerName", limit: 15 } },
        { kind: "Line", title: "Payment trend", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Pie", title: "Payment mode share", config: { doctype: "PaymentEntry", aggregate: "sum", field: "paidAmount", groupBy: "modeOfPayment" } },
      ],
    },

    // 17. Summary & Dashboard — Combo, Bar, KPICards
    {
      name: "Summary & Dashboard",
      description: "Executive rollup: KPIs + combined chart",
      cards: [
        { kind: "Combo", title: "Sales vs Purchases by month", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "postingDate", seriesBy: "status" } },
        { kind: "Bar", title: "SI grand totals", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", limit: 10 } },
        { kind: "KPICards", title: "Business at a glance", config: { cards: [
          { label: "Open SIs", doctype: "SalesInvoice", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Open PIs", doctype: "PurchaseInvoice", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Bank Guarantees", doctype: "BankGuarantee", aggregate: "count", filters: { status: "Active" } },
          { label: "LCs Active", doctype: "LetterOfCredit", aggregate: "count", filters: { status: "Active" } },
        ] } },
      ],
    },

    // 18. Budgeting & Variance — Heatmap, Line, Waterfall
    {
      name: "Budgeting & Variance",
      description: "Where actuals deviate from budget",
      cards: [
        { kind: "Heatmap", title: "Budget by FY × account", config: { doctype: "Budget", xField: "fiscalYearId", yField: "accountId", aggregate: "sum", valueField: "annualAmount" } },
        { kind: "Line", title: "GL debit vs credit trend", config: { doctype: "GLEntry", aggregate: "sum", field: "debit", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Waterfall", title: "Budget waterfall by account", config: { doctype: "Budget", aggregate: "sum", field: "annualAmount", groupBy: "accountId" } },
      ],
    },
  ];
}

export async function seedFinanceAnalytics(
  prisma: PrismaClient,
  tenantId: string,
  ownerUserId: string,
): Promise<{ dashboards: Array<{ name: string; id: string; cards: number }> }> {
  const dashboards = specs();
  const results: Array<{ name: string; id: string; cards: number }> = [];

  for (let i = 0; i < dashboards.length; i++) {
    const spec = dashboards[i];
    const existing = await prisma.dashboard.findFirst({
      where: { tenantId, name: spec.name },
      include: { cards: true },
    });
    let dashId: string;
    if (existing) {
      await prisma.dashboardCard.deleteMany({ where: { dashboardId: existing.id } });
      await prisma.dashboard.update({
        where: { id: existing.id },
        data: { description: spec.description, ownerUserId, isShared: true, sortOrder: 300 + i },
      });
      dashId = existing.id;
    } else {
      const d = await prisma.dashboard.create({
        data: {
          tenantId,
          ownerUserId,
          name: spec.name,
          description: spec.description,
          isShared: true,
          sortOrder: 300 + i,
        },
      });
      dashId = d.id;
    }

    for (let j = 0; j < spec.cards.length; j++) {
      const c = spec.cards[j];
      await prisma.dashboardCard.create({
        data: {
          dashboardId: dashId,
          kind: c.kind,
          title: c.title,
          subtitle: c.subtitle ?? null,
          config: c.config as object,
          gridCol: (j * 4) % 12,
          gridRow: Math.floor((j * 4) / 12),
          gridWidth: c.gridWidth ?? 4,
          gridHeight: 3,
          sortOrder: j,
        },
      });
    }
    results.push({ name: spec.name, id: dashId, cards: spec.cards.length });
  }

  return { dashboards: results };
}
