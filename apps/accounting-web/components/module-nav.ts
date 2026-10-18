import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "Accounting";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/accounting",                 label: "Overview",       icon: Icon.home },
    ],
  },
  {
    label: "Sales",
    links: [
      { href: "/accounting/customers",       label: "Customers",      icon: Icon.users },
      { href: "/accounting/sales-invoices",  label: "Sales Invoices", icon: Icon.invoice },
      { href: "/accounting/blanket-orders",  label: "Blanket Orders", icon: Icon.clipboard },
      { href: "/accounting/recurring-invoices", label: "Recurring",      icon: Icon.calendar },
      { href: "/accounting/payments",        label: "Payments",       icon: Icon.cash },
      { href: "/accounting/sales-persons",   label: "Sales Persons",  icon: Icon.users },
    ],
  },
  {
    label: "Inventory",
    links: [
      { href: "/accounting/items",           label: "Items",          icon: Icon.tag },
      { href: "/accounting/item-alternates", label: "Item Alternates", icon: Icon.layers },
      { href: "/accounting/price-lists",     label: "Price Lists",    icon: Icon.tag },
      { href: "/accounting/pricing-rules",   label: "Pricing Rules",  icon: Icon.layers },
      { href: "/accounting/coupon-codes",    label: "Coupon Codes",   icon: Icon.tag },
    ],
  },
  {
    label: "Ledger",
    links: [
      { href: "/accounting/accounts",        label: "Chart of Accounts", icon: Icon.book },
      { href: "/accounting/journal-entries", label: "Journal Entries",   icon: Icon.book },
      { href: "/accounting/bank-reconciliation", label: "Bank Reconciliation", icon: Icon.bank },
      { href: "/accounting/currencies",      label: "Currencies",     icon: Icon.cash },
      { href: "/accounting/exchange-rates",  label: "Exchange Rates", icon: Icon.bar },
      { href: "/accounting/fx-revaluations", label: "FX Revaluation", icon: Icon.cash },
    ],
  },
  {
    label: "Assets",
    links: [
      { href: "/accounting/assets",          label: "Assets",         icon: Icon.box },
      { href: "/accounting/asset-categories", label: "Categories",    icon: Icon.layers },
      { href: "/accounting/vehicles",        label: "Vehicles",       icon: Icon.send },
      { href: "/accounting/landed-cost-vouchers", label: "Landed Cost", icon: Icon.cart },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/accounting/fiscal-years",    label: "Fiscal Years",   icon: Icon.calendar },
      { href: "/accounting/budgets",         label: "Budgets",        icon: Icon.bar },
      { href: "/accounting/cost-centers",    label: "Cost Centers",   icon: Icon.layers },
      { href: "/accounting/tax-templates",   label: "Tax Templates",  icon: Icon.shield },
      { href: "/accounting/tax-withholding-categories", label: "TDS Categories", icon: Icon.shield },
      { href: "/accounting/tds-challans",   label: "TDS Challans",   icon: Icon.cash },
      { href: "/accounting/customer-groups", label: "Customer Groups", icon: Icon.users },
      { href: "/accounting/territories",     label: "Territories",    icon: Icon.target },
      { href: "/accounting/subscriptions",   label: "Subscriptions",  icon: Icon.calendar },
      { href: "/accounting/loyalty-programs", label: "Loyalty Programs", icon: Icon.tag },
      { href: "/accounting/duplicates",      label: "Duplicates",     icon: Icon.layers },
      { href: "/accounting/companies",       label: "Companies",      icon: Icon.layers },
      { href: "/accounting/companies/user-access", label: "User Access", icon: Icon.users },
      { href: "/accounting/intercompany-journals", label: "Intercompany JEs", icon: Icon.book },
    ],
  },
  {
    label: "Trade Finance",
    links: [
      { href: "/accounting/bank-guarantees",   label: "Bank Guarantees", icon: Icon.shield },
      { href: "/accounting/letters-of-credit", label: "Letters of Credit", icon: Icon.book },
    ],
  },
  {
    label: "Point of Sale",
    links: [
      { href: "/accounting/pos",           label: "Cashier",       icon: Icon.cart },
      { href: "/accounting/pos-profiles",  label: "POS Profiles",  icon: Icon.settings },
      { href: "/accounting/pos-closings",  label: "Session Closings", icon: Icon.book },
    ],
  },
  {
    label: "Analytics",
    links: [
      { href: "/accounting/finance-analytics", label: "Finance Dashboards", icon: Icon.bar },
    ],
  },
  {
    label: "Reports",
    links: [
      { href: "/accounting/reports/trial-balance",     label: "Trial Balance",  icon: Icon.bar },
      { href: "/accounting/reports/profit-and-loss",   label: "P&L",            icon: Icon.bar },
      { href: "/accounting/reports/balance-sheet",     label: "Balance Sheet",  icon: Icon.bar },
      { href: "/accounting/reports/general-ledger",    label: "General Ledger", icon: Icon.book },
      { href: "/accounting/reports/cash-flow",         label: "Cash Flow",      icon: Icon.cash },
      { href: "/accounting/reports/cash-forecast",     label: "Cash Forecast",  icon: Icon.calendar },
      { href: "/accounting/reports/budget-vs-actuals", label: "Budget vs Actuals", icon: Icon.bar },
      { href: "/accounting/reports/gst-filings",       label: "GST Filings",    icon: Icon.shield },
      { href: "/accounting/reports/builder",           label: "Report Builder", icon: Icon.settings },
    ],
  },
];
