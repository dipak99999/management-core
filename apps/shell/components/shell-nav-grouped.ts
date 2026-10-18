import type { ReactNode } from "react";
import { Icon, type NavGroup } from "./app-shell";

// Shell sidebar nav reorganized into Lumaara's 5 top-level modules:
//   1. HRMS                   employees, attendance, leave, recruitment
//   2. Payroll                salary slips, salary structures, loans, TDS
//   3. Finance & Accounting   invoices, payments, GL, reports, taxes, POS, buying
//   4. Sales & CRM            leads, opportunities, campaigns, support, projects, website
//   5. Manufacturing & Inv.   warehouses, stock, BOMs, work orders, delivery
//
// Each `NavGroup.label` must match a module key from
// packages/shared-types/src/modules.ts so useFilteredShellNav() can hide
// a group when the tenant's plan doesn't include that module.
// Individual link visibility is controlled per-submodule via the data-sub
// attribute (set below) which the filter hook matches against the plan's
// allowedSubmodules list.
//
// Previous flat 20-group nav is preserved in shell-nav.ts for reference.

export interface GroupedNavLink {
  href: string;
  label: string;
  icon: ReactNode;
  submodule?: string; // dotted key like "hrms.employees" — see modules.ts
}

export interface GroupedNavGroup {
  moduleKey: "hrms" | "payroll" | "finance" | "sales" | "manufacturing" | "admin" | "overview";
  label: string;
  icon?: ReactNode;
  links: GroupedNavLink[];
}

export const GROUPED_SHELL_NAV: GroupedNavGroup[] = [
  {
    moduleKey: "overview",
    label: "Overview",
    links: [
      { href: "/",              label: "Dashboard",         icon: Icon.dashboard },
      { href: "/dashboards",    label: "Reports",           icon: Icon.bar },
      { href: "/admin/notebook", label: "BrewAI dashboard", icon: Icon.sparkles },
      { href: "/todos",         label: "My Todos",          icon: Icon.clipboard },
    ],
  },

  // ─── 1. HRMS ──────────────────────────────────────────────────────
  {
    moduleKey: "hrms",
    label: "HRMS",
    icon: Icon.users,
    links: [
      { href: "/hr/employees",                 label: "Employees",       icon: Icon.users,     submodule: "hrms.employees" },
      { href: "/hr/employee-categories",       label: "Categories",      icon: Icon.layers,    submodule: "hrms.employees" },
      { href: "/hr/org-chart",                 label: "Org Chart",       icon: Icon.layers,    submodule: "hrms.employees" },
      { href: "/hr/attendance",                label: "Attendance",      icon: Icon.clock,     submodule: "hrms.attendance" },
      { href: "/hr/attendance-regularizations", label: "Regularizations", icon: Icon.calendar, submodule: "hrms.attendance" },
      { href: "/hr/checkin",                   label: "Check-in",        icon: Icon.clock,     submodule: "hrms.attendance" },
      { href: "/hr/shift-types",               label: "Shift Types",     icon: Icon.calendar,  submodule: "hrms.attendance" },
      { href: "/hr/holiday-lists",             label: "Holidays",        icon: Icon.calendar,  submodule: "hrms.attendance" },
      { href: "/hr/leave-applications",        label: "Leave Applications", icon: Icon.calendar, submodule: "hrms.leave" },
      { href: "/hr/leave-allocations",         label: "Leave Allocations", icon: Icon.calendar, submodule: "hrms.leave" },
      { href: "/hr/leave-types",               label: "Leave Types",     icon: Icon.settings,  submodule: "hrms.leave" },
      { href: "/hr/leave-policies",            label: "Leave Policies",  icon: Icon.shield,    submodule: "hrms.leave" },
      { href: "/hr/leave-ledger",              label: "Leave Ledger",    icon: Icon.book,      submodule: "hrms.leave" },
      { href: "/hr/job-openings",              label: "Job Openings",    icon: Icon.megaphone, submodule: "hrms.recruitment" },
      { href: "/hr/job-applicants",            label: "Applicants",      icon: Icon.users,     submodule: "hrms.recruitment" },
      { href: "/hr/onboardings",               label: "Onboarding",      icon: Icon.clipboard, submodule: "hrms.onboarding" },
      { href: "/hr/separations",               label: "Separations",     icon: Icon.send,      submodule: "hrms.onboarding" },
      { href: "/hr/appraisals",                label: "Appraisals",      icon: Icon.target,    submodule: "hrms.appraisals" },
      { href: "/hr/training-events",           label: "Training",        icon: Icon.book,      submodule: "hrms.training" },
      { href: "/hr/skills-certs",              label: "Skills & Certs",  icon: Icon.shield,    submodule: "hrms.training" },
      { href: "/hr/expense-claims",            label: "Expense Claims",  icon: Icon.invoice,   submodule: "hrms.employees" },
    ],
  },

  // ─── 2. Payroll ──────────────────────────────────────────────────
  {
    moduleKey: "payroll",
    label: "Payroll",
    icon: Icon.cash,
    links: [
      { href: "/hr/salary-slips",             label: "Salary Slips",     icon: Icon.invoice,   submodule: "payroll.salary-slips" },
      { href: "/hr/payroll-entries",          label: "Payroll Runs",     icon: Icon.briefcase, submodule: "payroll.payroll-entries" },
      { href: "/hr/payroll-analytics",        label: "Payroll Analytics", icon: Icon.bar,      submodule: "payroll.payroll-entries" },
      { href: "/hr/salary-structures",        label: "Salary Structures", icon: Icon.book,     submodule: "payroll.salary-structures" },
      { href: "/hr/statutory-components",     label: "Statutory",        icon: Icon.shield,    submodule: "payroll.salary-structures" },
      { href: "/hr/loans",                    label: "Loans",            icon: Icon.cash,      submodule: "payroll.loans" },
      { href: "/hr/loan-types",               label: "Loan Types",       icon: Icon.settings,  submodule: "payroll.loans" },
      { href: "/hr/employee-advances",        label: "Advances",         icon: Icon.cash,      submodule: "payroll.loans" },
      { href: "/accounting/tds-challans",     label: "TDS Challans",     icon: Icon.cash,      submodule: "payroll.tds-challans" },
    ],
  },

  // ─── 3. Finance & Accounting ─────────────────────────────────────
  {
    moduleKey: "finance",
    label: "Finance & Accounting",
    icon: Icon.book,
    links: [
      { href: "/accounting/customers",                   label: "Customers",         icon: Icon.users,    submodule: "finance.customers" },
      { href: "/accounting/customer-groups",             label: "Customer Groups",   icon: Icon.layers,   submodule: "finance.customers" },
      { href: "/buying/suppliers",                       label: "Suppliers",         icon: Icon.users,    submodule: "finance.suppliers" },
      { href: "/accounting/sales-invoices",              label: "Sales Invoices",    icon: Icon.invoice,  submodule: "finance.sales-invoices" },
      { href: "/accounting/recurring-invoices",          label: "Recurring",         icon: Icon.clock,    submodule: "finance.sales-invoices" },
      { href: "/accounting/blanket-orders",              label: "Blanket Orders",    icon: Icon.clipboard, submodule: "finance.sales-invoices" },
      { href: "/buying/purchase-invoices",               label: "Purchase Invoices", icon: Icon.invoice,  submodule: "finance.purchase-invoices" },
      { href: "/buying/purchase-orders",                 label: "Purchase Orders",   icon: Icon.cart,     submodule: "finance.purchase-invoices" },
      { href: "/buying/request-for-quotations",          label: "RFQs",              icon: Icon.send,     submodule: "finance.purchase-invoices" },
      { href: "/accounting/payments",                    label: "Payments",          icon: Icon.cash,     submodule: "finance.payments" },
      { href: "/accounting/journal-entries",             label: "Journal Entries",   icon: Icon.book,     submodule: "finance.journal-entries" },
      { href: "/accounting/bank-reconciliation",         label: "Bank Reconcile",    icon: Icon.bank,     submodule: "finance.payments" },
      { href: "/accounting/accounts",                    label: "Chart of Accounts", icon: Icon.layers,   submodule: "finance.accounts" },
      { href: "/accounting/cost-centers",                label: "Cost Centers",      icon: Icon.tag,      submodule: "finance.accounts" },
      { href: "/accounting/budgets",                     label: "Budgets",           icon: Icon.bar,      submodule: "finance.accounts" },
      { href: "/accounting/fiscal-years",                label: "Fiscal Years",      icon: Icon.calendar, submodule: "finance.accounts" },
      { href: "/accounting/currencies",                  label: "Currencies",        icon: Icon.cash,     submodule: "finance.accounts" },
      { href: "/accounting/exchange-rates",              label: "Exchange Rates",    icon: Icon.cash,     submodule: "finance.accounts" },
      { href: "/accounting/tax-templates",               label: "Tax Templates",     icon: Icon.settings, submodule: "finance.taxes" },
      { href: "/accounting/tax-withholding-categories",  label: "TDS Categories",    icon: Icon.shield,   submodule: "finance.taxes" },
      { href: "/accounting/reports/trial-balance",       label: "Trial Balance",     icon: Icon.bar,      submodule: "finance.reports" },
      { href: "/accounting/reports/profit-and-loss",     label: "P&L",               icon: Icon.bar,      submodule: "finance.reports" },
      { href: "/accounting/reports/balance-sheet",       label: "Balance Sheet",     icon: Icon.bar,      submodule: "finance.reports" },
      { href: "/accounting/reports/general-ledger",      label: "General Ledger",    icon: Icon.book,     submodule: "finance.reports" },
      { href: "/accounting/reports/cash-flow",           label: "Cash Flow",         icon: Icon.cash,     submodule: "finance.reports" },
      { href: "/accounting/reports/budget-vs-actuals",   label: "Budget vs Actuals", icon: Icon.bar,      submodule: "finance.reports" },
      { href: "/accounting/reports/gst-filings",         label: "GST Filings",       icon: Icon.shield,   submodule: "finance.reports" },
      { href: "/accounting/assets",                      label: "Assets",            icon: Icon.box,      submodule: "finance.assets" },
      { href: "/accounting/asset-categories",            label: "Asset Categories",  icon: Icon.layers,   submodule: "finance.assets" },
      { href: "/accounting/pos",                         label: "POS",               icon: Icon.cart,     submodule: "finance.pos" },
      { href: "/accounting/pos-profiles",                label: "POS Profiles",      icon: Icon.settings, submodule: "finance.pos" },
      { href: "/accounting/pos-closings",                label: "POS Closings",      icon: Icon.clipboard, submodule: "finance.pos" },
      { href: "/accounting/loyalty-programs",            label: "Loyalty Programs",  icon: Icon.target,   submodule: "finance.pos" },
      { href: "/accounting/companies",                   label: "Companies",         icon: Icon.briefcase, submodule: "finance.accounts" },
      { href: "/admin/compliance",                       label: "Compliance",        icon: Icon.shield,   submodule: "finance.compliance" },
    ],
  },

  // ─── 4. Sales & CRM ──────────────────────────────────────────────
  {
    moduleKey: "sales",
    label: "Sales & CRM",
    icon: Icon.target,
    links: [
      { href: "/crm/leads",                 label: "Leads",         icon: Icon.target,    submodule: "sales.leads" },
      { href: "/crm/opportunities",         label: "Opportunities", icon: Icon.target,    submodule: "sales.opportunities" },
      { href: "/crm/quotations",            label: "Quotations",    icon: Icon.invoice,   submodule: "sales.quotations" },
      { href: "/crm/sales-orders",          label: "Sales Orders",  icon: Icon.cart,      submodule: "sales.sales-orders" },
      { href: "/crm/activities",            label: "Activities",    icon: Icon.calendar,  submodule: "sales.leads" },
      { href: "/crm/campaigns",             label: "Campaigns",     icon: Icon.megaphone, submodule: "sales.campaigns" },
      { href: "/crm/journeys",              label: "Journeys",      icon: Icon.send,      submodule: "sales.campaigns" },
      { href: "/crm/sequences",             label: "Sequences",     icon: Icon.send,      submodule: "sales.campaigns" },
      { href: "/crm/webinars",              label: "Webinars",      icon: Icon.megaphone, submodule: "sales.webinars" },
      { href: "/crm/desk/inbox",            label: "Support Inbox", icon: Icon.inbox,     submodule: "sales.desk" },
      { href: "/crm/desk/sla",              label: "SLA",           icon: Icon.shield,    submodule: "sales.desk" },
      { href: "/crm/whatsapp",              label: "WhatsApp",      icon: Icon.send,      submodule: "sales.whatsapp" },
      { href: "/crm/sms",                   label: "SMS",           icon: Icon.send,      submodule: "sales.whatsapp" },
      { href: "/crm/meetings",              label: "Meetings",      icon: Icon.calendar,  submodule: "sales.leads" },
      { href: "/projects/projects",         label: "Projects",      icon: Icon.layers,    submodule: "sales.projects" },
      { href: "/projects/milestones",       label: "Milestones",    icon: Icon.layers,    submodule: "sales.projects" },
      { href: "/projects/issues",           label: "Issues",        icon: Icon.clipboard, submodule: "sales.projects" },
      { href: "/projects/tasks",            label: "Tasks",         icon: Icon.clipboard, submodule: "sales.tasks" },
      { href: "/projects/sprints",          label: "Sprints",       icon: Icon.calendar,  submodule: "sales.tasks" },
      { href: "/projects/timesheets",       label: "Timesheets",    icon: Icon.clock,     submodule: "sales.tasks" },
      { href: "/crm/blog-posts",            label: "Blog Posts",    icon: Icon.book,      submodule: "sales.campaigns" },
      { href: "/crm/kb-articles",           label: "KB Articles",   icon: Icon.book,      submodule: "sales.desk" },
    ],
  },

  // ─── 5. Manufacturing & Inventory ────────────────────────────────
  {
    moduleKey: "manufacturing",
    label: "Manufacturing & Inventory",
    icon: Icon.box,
    links: [
      { href: "/stock/warehouses",              label: "Warehouses",       icon: Icon.bank,      submodule: "manufacturing.warehouses" },
      { href: "/accounting/items",              label: "Items",            icon: Icon.tag,       submodule: "manufacturing.items" },
      { href: "/accounting/price-lists",        label: "Price Lists",      icon: Icon.tag,       submodule: "manufacturing.items" },
      { href: "/stock/stock-entries",           label: "Stock Entries",    icon: Icon.box,       submodule: "manufacturing.stock-entries" },
      { href: "/stock/stock-reconciliations",   label: "Reconciliations",  icon: Icon.clipboard, submodule: "manufacturing.stock-entries" },
      { href: "/stock/material-requests",       label: "Material Requests", icon: Icon.send,     submodule: "manufacturing.stock-entries" },
      { href: "/stock/delivery-notes",          label: "Delivery Notes",   icon: Icon.truck,     submodule: "manufacturing.delivery-notes" },
      { href: "/stock/delivery-trips",          label: "Delivery Trips",   icon: Icon.truck,     submodule: "manufacturing.delivery-notes" },
      { href: "/stock/pick-lists",              label: "Pick Lists",       icon: Icon.clipboard, submodule: "manufacturing.delivery-notes" },
      { href: "/stock/purchase-receipts",       label: "Purchase Receipts", icon: Icon.truck,    submodule: "manufacturing.purchase-receipts" },
      { href: "/stock/batches",                 label: "Batches",          icon: Icon.layers,    submodule: "manufacturing.stock-entries" },
      { href: "/stock/serial-numbers",          label: "Serial Numbers",   icon: Icon.tag,       submodule: "manufacturing.stock-entries" },
      { href: "/stock/work-orders",             label: "Work Orders",      icon: Icon.factory,   submodule: "manufacturing.work-orders" },
      { href: "/stock/job-cards",               label: "Job Cards",        icon: Icon.clipboard, submodule: "manufacturing.work-orders" },
      { href: "/stock/boms",                    label: "BOMs",             icon: Icon.layers,    submodule: "manufacturing.boms" },
      { href: "/stock/production-plans",        label: "Production Plans", icon: Icon.calendar,  submodule: "manufacturing.production-plans" },
      { href: "/stock/workstations",            label: "Workstations",     icon: Icon.factory,   submodule: "manufacturing.work-orders" },
      { href: "/stock/quality-inspections",     label: "Quality Insp.",    icon: Icon.shield,    submodule: "manufacturing.quality-inspections" },
      { href: "/stock/reports/stock-balance",   label: "Stock Balance",    icon: Icon.bar,       submodule: "manufacturing.stock-entries" },
      { href: "/stock/reports/stock-aging",     label: "Stock Aging",      icon: Icon.clock,     submodule: "manufacturing.stock-entries" },
    ],
  },

  // ─── Admin / Settings (always visible to the authed user) ────────
  {
    moduleKey: "admin",
    label: "Admin",
    icon: Icon.settings,
    links: [
      { href: "/admin",              label: "Overview",       icon: Icon.settings },
      { href: "/admin/users",        label: "Users",          icon: Icon.users },
      { href: "/admin/roles",        label: "Roles",          icon: Icon.shield },
      { href: "/admin/workflows",    label: "Workflows",      icon: Icon.layers },
      { href: "/admin/imports",      label: "Imports",        icon: Icon.send },
      { href: "/admin/audit-logs",   label: "Audit Log",      icon: Icon.clock },
      { href: "/admin/integrations", label: "Integrations",   icon: Icon.layers },
      { href: "/admin/api-docs",     label: "API Reference",  icon: Icon.book },
      // Super-admin-only pages — visible to anyone, backend 403s non-super.
      // UI could hide these conditionally; keeping visible is fine for v1.
      { href: "/admin/super/plans",   label: "Subscription Plans", icon: Icon.target },
      { href: "/admin/super/tenants", label: "Tenants",            icon: Icon.briefcase },
    ],
  },
  {
    moduleKey: "admin",
    label: "Settings",
    icon: Icon.settings,
    links: [
      { href: "/settings/api-tokens",    label: "API Tokens",      icon: Icon.tag },
      { href: "/settings/two-factor",    label: "Two-Factor Auth", icon: Icon.shield },
      { href: "/settings/sessions",      label: "Active Sessions", icon: Icon.clock },
      { href: "/settings/notifications", label: "Notifications",   icon: Icon.send },
      { href: "/settings/digests",       label: "Digests",         icon: Icon.calendar },
    ],
  },
];

// Convert grouped nav → the flat NavGroup[] that AppShell expects, filtered
// by the tenant's active plan. "overview" and "admin" buckets always show.
export function filterNavByPlan(
  plan: { allowedModules: string[]; allowedSubmodules: string[] } | null,
): NavGroup[] {
  const out: NavGroup[] = [];
  for (const g of GROUPED_SHELL_NAV) {
    if (g.moduleKey === "overview" || g.moduleKey === "admin") {
      out.push({ label: g.label, links: g.links.map((l) => ({ href: l.href, label: l.label, icon: l.icon })) });
      continue;
    }
    if (plan && !plan.allowedModules.includes(g.moduleKey)) continue;
    const visibleLinks = g.links.filter((l) => {
      if (!l.submodule) return true;
      return plan ? plan.allowedSubmodules.includes(l.submodule) : true;
    });
    if (visibleLinks.length === 0) continue;
    out.push({ label: g.label, links: visibleLinks.map((l) => ({ href: l.href, label: l.label, icon: l.icon })) });
  }
  return out;
}
