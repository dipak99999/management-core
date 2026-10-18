// Canonical module + submodule registry. The 5 top-level buckets gate
// which features a tenant can access based on their SubscriptionPlan.
// Keep this file in sync with:
//   • packages/db/prisma/migrations/20261002000000_subscription_modules
//     (backfill SQL hardcodes these strings)
//   • apps/shell/components/module-nav-grouped.ts (sidebar rendering)
//   • packages/service-auth/src/require-module.ts (route gating)

export const MODULES = ["hrms", "payroll", "finance", "sales", "manufacturing"] as const;
export type ModuleKey = (typeof MODULES)[number];

export interface SubmoduleDef {
  key: string; // dotted — "hrms.employees"
  label: string;
  // Primary path the sidebar links to for this submodule.
  path: string;
  // Routes gated by this submodule. Wildcards use trailing /* for prefix match.
  // Checked by requireModule() middleware on every API request.
  apiPaths: string[];
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  // Lucide-style icon name; shell uses this to pick an SVG from Icon.<name>.
  icon: string;
  submodules: SubmoduleDef[];
}

export const MODULE_REGISTRY: ModuleDef[] = [
  {
    key: "hrms",
    label: "HRMS",
    icon: "users",
    submodules: [
      { key: "hrms.employees",    label: "Employees",   path: "/hr/employees",                apiPaths: ["/employees", "/employees/*"] },
      { key: "hrms.attendance",   label: "Attendance",  path: "/hr/attendance",               apiPaths: ["/attendance", "/attendance/*", "/attendance-regularizations", "/employee-checkins"] },
      { key: "hrms.leave",        label: "Leave",       path: "/hr/leave-applications",       apiPaths: ["/leave-applications", "/leave-types", "/leave-allocations", "/leave-encashments", "/leave-ledger", "/leave-policies"] },
      { key: "hrms.recruitment",  label: "Recruitment", path: "/hr/job-openings",             apiPaths: ["/job-openings", "/job-applicants", "/job-offers"] },
      { key: "hrms.onboarding",   label: "Onboarding",  path: "/hr/onboardings",              apiPaths: ["/onboardings", "/onboarding", "/onboarding/*"] },
      { key: "hrms.appraisals",   label: "Appraisals",  path: "/hr/appraisals",               apiPaths: ["/appraisals", "/appraisals/*", "/appraisal-templates"] },
      { key: "hrms.training",     label: "Training",    path: "/hr/training-events",          apiPaths: ["/training-events", "/skills-certs"] },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    icon: "cash",
    submodules: [
      { key: "payroll.salary-slips",       label: "Salary Slips",       path: "/hr/salary-slips",       apiPaths: ["/salary-slips", "/salary-slips/*"] },
      { key: "payroll.payroll-entries",    label: "Payroll Entries",    path: "/hr/payroll-entries",    apiPaths: ["/payroll-entries", "/payroll-entries/*", "/payroll-analytics"] },
      { key: "payroll.loans",              label: "Loans",              path: "/hr/loans",              apiPaths: ["/loans", "/loan-types", "/employee-advances"] },
      { key: "payroll.salary-structures",  label: "Salary Structures",  path: "/hr/salary-structures",  apiPaths: ["/salary-structures", "/statutory-components"] },
      { key: "payroll.tds-challans",       label: "TDS Challans",       path: "/accounting/tds-challans", apiPaths: ["/tds-challans", "/tds-challans/*"] },
    ],
  },
  {
    key: "finance",
    label: "Finance & Accounting",
    icon: "book",
    submodules: [
      { key: "finance.customers",         label: "Customers",         path: "/accounting/customers",         apiPaths: ["/customers", "/customers/*", "/customer-groups"] },
      { key: "finance.suppliers",         label: "Suppliers",         path: "/buying/suppliers",             apiPaths: ["/suppliers", "/suppliers/*"] },
      { key: "finance.sales-invoices",    label: "Sales Invoices",    path: "/accounting/sales-invoices",    apiPaths: ["/sales-invoices", "/sales-invoices/*", "/recurring-invoices", "/blanket-orders"] },
      { key: "finance.purchase-invoices", label: "Purchase Invoices", path: "/buying/purchase-invoices",     apiPaths: ["/purchase-invoices", "/purchase-invoices/*", "/purchase-orders", "/request-for-quotations", "/supplier-quotations"] },
      { key: "finance.payments",          label: "Payments",          path: "/accounting/payments",          apiPaths: ["/payment-entries", "/payment-entries/*", "/payments"] },
      { key: "finance.journal-entries",   label: "Journal Entries",   path: "/accounting/journal-entries",   apiPaths: ["/journal-entries", "/journal-entries/*", "/intercompany-journals"] },
      { key: "finance.accounts",          label: "Chart of Accounts", path: "/accounting/accounts",          apiPaths: ["/accounts", "/accounts/*", "/currencies", "/exchange-rates", "/fx-revaluations"] },
      { key: "finance.reports",           label: "Reports",           path: "/accounting/reports/trial-balance", apiPaths: ["/reports", "/reports/*"] },
      { key: "finance.taxes",             label: "Taxes",             path: "/accounting/tax-templates",     apiPaths: ["/tax-templates", "/tax-withholding-categories", "/tax-collection-categories", "/gst-filings"] },
      { key: "finance.assets",            label: "Assets",            path: "/accounting/assets",            apiPaths: ["/assets", "/asset-categories", "/asset-maintenance-logs"] },
      { key: "finance.pos",               label: "Point of Sale",     path: "/accounting/pos",               apiPaths: ["/pos", "/pos/*", "/pos-profiles", "/pos-openings", "/pos-closings", "/pos-invoices"] },
      { key: "finance.compliance",        label: "Compliance",        path: "/admin/compliance",             apiPaths: ["/compliance", "/compliance/*", "/data-subject-requests"] },
    ],
  },
  {
    key: "sales",
    label: "Sales & CRM",
    icon: "target",
    submodules: [
      { key: "sales.leads",         label: "Leads",         path: "/crm/leads",         apiPaths: ["/leads", "/leads/*", "/lead-sources"] },
      { key: "sales.opportunities", label: "Opportunities", path: "/crm/opportunities", apiPaths: ["/opportunities", "/opportunities/*"] },
      { key: "sales.quotations",    label: "Quotations",    path: "/crm/quotations",    apiPaths: ["/quotations", "/quotations/*"] },
      { key: "sales.sales-orders",  label: "Sales Orders",  path: "/crm/sales-orders",  apiPaths: ["/sales-orders", "/sales-orders/*"] },
      { key: "sales.campaigns",     label: "Campaigns",     path: "/crm/campaigns",     apiPaths: ["/campaigns", "/campaigns/*", "/email-templates"] },
      { key: "sales.webinars",      label: "Webinars",      path: "/crm/webinars",      apiPaths: ["/webinars", "/webinars/*"] },
      { key: "sales.desk",          label: "Support Desk",  path: "/crm/desk/tickets",  apiPaths: ["/desk", "/desk/*", "/kb-categories", "/kb-articles"] },
      { key: "sales.whatsapp",      label: "WhatsApp",      path: "/crm/whatsapp",      apiPaths: ["/whatsapp", "/whatsapp/*"] },
      { key: "sales.projects",      label: "Projects",      path: "/projects/projects", apiPaths: ["/projects", "/projects/*", "/project-templates", "/milestones", "/issues"] },
      { key: "sales.tasks",         label: "Tasks",         path: "/projects/tasks",    apiPaths: ["/tasks", "/tasks/*", "/task-dependencies", "/timesheets", "/sprints"] },
    ],
  },
  {
    key: "manufacturing",
    label: "Manufacturing & Inventory",
    icon: "box",
    submodules: [
      { key: "manufacturing.warehouses",         label: "Warehouses",          path: "/stock/warehouses",         apiPaths: ["/warehouses", "/warehouses/*"] },
      { key: "manufacturing.items",              label: "Items",               path: "/accounting/items",         apiPaths: ["/items", "/items/*", "/item-alternates", "/price-lists", "/pricing-rules"] },
      { key: "manufacturing.stock-entries",      label: "Stock Entries",       path: "/stock/stock-entries",      apiPaths: ["/stock-entries", "/stock-entries/*", "/stock-reconciliations", "/material-requests"] },
      { key: "manufacturing.delivery-notes",     label: "Delivery Notes",      path: "/stock/delivery-notes",     apiPaths: ["/delivery-notes", "/delivery-notes/*", "/delivery-trips", "/pick-lists"] },
      { key: "manufacturing.purchase-receipts",  label: "Purchase Receipts",   path: "/stock/purchase-receipts",  apiPaths: ["/purchase-receipts", "/purchase-receipts/*"] },
      { key: "manufacturing.work-orders",        label: "Work Orders",         path: "/stock/work-orders",        apiPaths: ["/work-orders", "/work-orders/*", "/job-cards", "/workstations"] },
      { key: "manufacturing.boms",               label: "BOMs",                path: "/stock/boms",               apiPaths: ["/boms", "/boms/*", "/bom-tools"] },
      { key: "manufacturing.production-plans",   label: "Production Plans",    path: "/stock/production-plans",   apiPaths: ["/production-plans", "/production-plans/*"] },
      { key: "manufacturing.quality-inspections",label: "Quality Inspections", path: "/stock/quality-inspections", apiPaths: ["/quality-inspections", "/quality-inspection-templates"] },
    ],
  },
];

// Index: map an API path → the submodule.key that gates it. Precomputed at
// module load. Used by requireModule() to look up the gate for an incoming
// request in O(1) (prefix-match for /path/*).
const PATH_TO_SUBMODULE = new Map<string, string>();
const PREFIX_SUBMODULES: Array<{ prefix: string; subKey: string }> = [];

for (const m of MODULE_REGISTRY) {
  for (const sm of m.submodules) {
    for (const p of sm.apiPaths) {
      if (p.endsWith("/*")) {
        PREFIX_SUBMODULES.push({ prefix: p.slice(0, -2), subKey: sm.key });
      } else {
        PATH_TO_SUBMODULE.set(p, sm.key);
      }
    }
  }
}

export function submoduleForPath(apiPath: string): { module: ModuleKey; submodule: string } | null {
  // Normalize: strip query string + trailing slash.
  const p = apiPath.split("?")[0].replace(/\/$/, "");
  // Exact match first.
  let subKey = PATH_TO_SUBMODULE.get(p);
  if (!subKey) {
    // Prefix match (longest wins).
    let best = "";
    for (const entry of PREFIX_SUBMODULES) {
      if (p === entry.prefix || p.startsWith(entry.prefix + "/")) {
        if (entry.prefix.length > best.length) {
          best = entry.prefix;
          subKey = entry.subKey;
        }
      }
    }
  }
  if (!subKey) return null;
  return { module: subKey.split(".")[0] as ModuleKey, submodule: subKey };
}

// Guard helper: does this plan permit this submodule?
export function planAllows(
  plan: { allowedModules: string[]; allowedSubmodules: string[] } | null,
  moduleKey: ModuleKey,
  submoduleKey?: string,
): boolean {
  if (!plan) return false;
  if (!plan.allowedModules.includes(moduleKey)) return false;
  if (submoduleKey && !plan.allowedSubmodules.includes(submoduleKey)) return false;
  return true;
}
