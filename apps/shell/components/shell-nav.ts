import type { NavGroup } from "./app-shell";
import { GROUPED_SHELL_NAV, filterNavByPlan } from "./shell-nav-grouped";

// Shell sidebar nav. Rebuilt in October 2026 to collapse the previous flat
// 20-group layout into Lumaara's 5 top-level module buckets with
// subscription-plan filtering. The 5 modules are:
//
//   1. HRMS                   employees, attendance, leave, recruitment
//   2. Payroll                salary slips, structures, loans, TDS
//   3. Finance & Accounting   invoices, payments, GL, reports, taxes, POS
//   4. Sales & CRM            leads, campaigns, support, projects, website
//   5. Manufacturing & Inv.   warehouses, stock, BOMs, work orders
//
// See shell-nav-grouped.ts for the canonical structure. filterNavByPlan()
// hides a module when the tenant's SubscriptionPlan.allowedModules
// doesn't include its key, and hides individual links when their
// submodule key isn't in allowedSubmodules.
//
// SHELL_NAV below reads the cached plan from sessionStorage (populated by
// apps/shell/hooks/use-plan.ts) when run in the browser. On the server
// (SSR) + before login we fall back to the full nav so static pages
// render. The authoritative gate is still backend requireModule().

function readCachedPlan(): { allowedModules: string[]; allowedSubmodules: string[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("lumaara.myPlan");
    if (!raw) return null;
    const p = JSON.parse(raw) as { allowedModules?: string[]; allowedSubmodules?: string[] };
    if (!Array.isArray(p.allowedModules) || !Array.isArray(p.allowedSubmodules)) return null;
    return { allowedModules: p.allowedModules, allowedSubmodules: p.allowedSubmodules };
  } catch { return null; }
}

// Static full-nav fallback for SSR + initial render before plan loads.
const FULL_NAV: NavGroup[] = filterNavByPlan(null);

export const SHELL_NAV: NavGroup[] = FULL_NAV;

// Clients that want live subscription filtering can call this at render.
export function filteredShellNav(): NavGroup[] {
  const plan = readCachedPlan();
  return plan ? filterNavByPlan(plan) : FULL_NAV;
}

export { GROUPED_SHELL_NAV, filterNavByPlan };
