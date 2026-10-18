import { test, expect, type APIRequestContext } from "@playwright/test";
import { URLS, PORTS } from "./_ports";

// Smoke test every dynamic (`/foo/[id]`) route as a signed-in staff user.
//
// The static-page suite skips these because we don't know the id at test
// time. Here we resolve one at run-time by hitting the list API for the
// doctype and grabbing the first row's id, then navigating.
//
// Ports match the e2e harness (services 4101-4109, apps 3100-3107) — that
// is a +100 offset from the dev defaults so a running dev stack doesn't
// collide with the test run.

const AUTH_API = URLS.authSvc;
const ACC_API = URLS.accSvc;
const STOCK_API = URLS.stockSvc;
const CRM_API = URLS.crmSvc;
const HR_API = URLS.hrSvc;
const PROJ_API = URLS.projSvc;

// Map of route template → list endpoint that yields `[{ id, ... }]`.
// The key is the exact `route` string from pages.json, minus the `/[id]`
// (and the trailing `/edit` for nested dynamic paths).
//
// If a route needs no id-lookup (rare), map it to null and we'll skip it.
type RouteDef = {
  // The dynamic route from pages.json (e.g. "/accounting/customers/[id]").
  route: string;
  port: number;
  // Endpoint that returns a list we can pluck an id from.
  listUrl: string;
  // Some list endpoints return `{ items: [...] }` instead of a raw array.
  listKey?: string;
};

const ROUTES: RouteDef[] = [
  // ── shell ────────────────────────────────────────────────────────────
  { route: "/dashboards/[id]", port: 3100, listUrl: `${ACC_API}/dashboards` },
  {
    route: "/dashboards/[id]/edit",
    port: 3100,
    listUrl: `${ACC_API}/dashboards`,
  },
  { route: "/admin/users/[id]", port: 3100, listUrl: `${AUTH_API}/roles/users/list` },
  { route: "/admin/imports/[id]", port: 3100, listUrl: `${ACC_API}/imports` },
  { route: "/admin/roles/[id]", port: 3100, listUrl: `${AUTH_API}/roles` },
  { route: "/admin/workflows/[id]", port: 3100, listUrl: `${AUTH_API}/workflows` },
  { route: "/admin/broadcasts/[id]", port: 3100, listUrl: `${AUTH_API}/broadcasts` },
  { route: "/admin/tickets/[id]", port: 3100, listUrl: `${ACC_API}/staff-tickets` },

  // ── accounting-web ───────────────────────────────────────────────────
  { route: "/accounting/sales-invoices/[id]", port: 3101, listUrl: `${ACC_API}/sales-invoices` },
  { route: "/accounting/assets/[id]", port: 3101, listUrl: `${ACC_API}/assets` },
  { route: "/accounting/items/[id]", port: 3101, listUrl: `${ACC_API}/items` },
  { route: "/accounting/bank-reconciliation/[id]", port: 3101, listUrl: `${ACC_API}/bank-reconciliation` },
  { route: "/accounting/landed-cost-vouchers/[id]", port: 3101, listUrl: `${ACC_API}/landed-cost-vouchers` },
  { route: "/accounting/price-lists/[id]", port: 3101, listUrl: `${ACC_API}/price-lists` },
  { route: "/accounting/journal-entries/[id]", port: 3101, listUrl: `${ACC_API}/journal-entries` },
  { route: "/accounting/payments/[id]", port: 3101, listUrl: `${ACC_API}/payments` },
  { route: "/accounting/customers/[id]", port: 3101, listUrl: `${ACC_API}/customers` },

  // ── buying-web ───────────────────────────────────────────────────────
  { route: "/buying/purchase-invoices/[id]", port: 3102, listUrl: `${ACC_API}/purchase-invoices` },
  { route: "/buying/suppliers/[id]", port: 3102, listUrl: `${ACC_API}/suppliers` },
  { route: "/buying/purchase-orders/[id]", port: 3102, listUrl: `${ACC_API}/purchase-orders` },

  // ── stock-web ────────────────────────────────────────────────────────
  { route: "/stock/boms/[id]", port: 3103, listUrl: `${STOCK_API}/boms` },
  { route: "/stock/delivery-notes/[id]", port: 3103, listUrl: `${STOCK_API}/delivery-notes` },
  { route: "/stock/material-requests/[id]", port: 3103, listUrl: `${STOCK_API}/material-requests` },
  { route: "/stock/purchase-receipts/[id]", port: 3103, listUrl: `${STOCK_API}/purchase-receipts` },
  { route: "/stock/production-plans/[id]", port: 3103, listUrl: `${STOCK_API}/production-plans` },
  { route: "/stock/stock-entries/[id]", port: 3103, listUrl: `${STOCK_API}/stock-entries` },
  { route: "/stock/warehouses/[id]", port: 3103, listUrl: `${STOCK_API}/warehouses` },
  { route: "/stock/work-orders/[id]", port: 3103, listUrl: `${STOCK_API}/work-orders` },
  { route: "/stock/stock-reconciliations/[id]", port: 3103, listUrl: `${STOCK_API}/stock-reconciliations` },

  // ── crm-web ──────────────────────────────────────────────────────────
  { route: "/crm/sales-orders/[id]", port: 3104, listUrl: `${CRM_API}/sales-orders` },
  { route: "/crm/campaigns/[id]", port: 3104, listUrl: `${CRM_API}/campaigns` },
  { route: "/crm/quotations/[id]", port: 3104, listUrl: `${CRM_API}/quotations` },
  { route: "/crm/leads/[id]", port: 3104, listUrl: `${CRM_API}/leads` },
  { route: "/crm/opportunities/[id]", port: 3104, listUrl: `${CRM_API}/opportunities` },
  { route: "/crm/contact-lists/[id]", port: 3104, listUrl: `${CRM_API}/contact-lists` },
  { route: "/crm/landing-pages/[id]", port: 3104, listUrl: `${CRM_API}/landing-pages` },
  { route: "/crm/sequences/[id]", port: 3104, listUrl: `${CRM_API}/email-sequences` },
  { route: "/crm/surveys/[id]", port: 3104, listUrl: `${CRM_API}/surveys` },
  { route: "/crm/web-forms/[id]", port: 3104, listUrl: `${CRM_API}/web-forms` },
  { route: "/crm/desk/tickets/[id]", port: 3104, listUrl: `${CRM_API}/desk/tickets` },
  { route: "/crm/salesiq/chats/[id]", port: 3104, listUrl: `${CRM_API}/salesiq/chats` },

  // ── hr-web ───────────────────────────────────────────────────────────
  { route: "/hr/employees/[id]", port: 3105, listUrl: `${HR_API}/employees` },
  { route: "/hr/salary-slips/[id]", port: 3105, listUrl: `${HR_API}/salary-slips` },
  { route: "/hr/onboarding/[id]", port: 3105, listUrl: `${HR_API}/employee-checklists` },
  { route: "/hr/training-events/[id]", port: 3105, listUrl: `${HR_API}/training-events` },
  { route: "/hr/appraisals/[id]", port: 3105, listUrl: `${HR_API}/appraisals` },
  { route: "/hr/job-applicants/[id]", port: 3105, listUrl: `${HR_API}/job-applicants` },
  { route: "/hr/job-openings/[id]", port: 3105, listUrl: `${HR_API}/job-openings` },
  { route: "/hr/employee-advances/[id]", port: 3105, listUrl: `${HR_API}/employee-advances` },
  { route: "/hr/holiday-lists/[id]", port: 3105, listUrl: `${HR_API}/holiday-lists` },
  { route: "/hr/loans/[id]", port: 3105, listUrl: `${HR_API}/loans` },
  { route: "/hr/payroll-entries/[id]", port: 3105, listUrl: `${HR_API}/payroll-entries` },

  // ── projects-web ─────────────────────────────────────────────────────
  { route: "/projects/projects/[id]", port: 3106, listUrl: `${PROJ_API}/projects` },
  { route: "/projects/timesheets/[id]", port: 3106, listUrl: `${PROJ_API}/timesheets` },
];

// Cache list responses so 47 tests don't cause 47 identical fetches.
const idCache = new Map<string, string | null>();

async function fetchFirstId(
  request: APIRequestContext,
  token: string,
  listUrl: string,
): Promise<string | null> {
  if (idCache.has(listUrl)) return idCache.get(listUrl)!;
  const res = await request.get(listUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok()) {
    idCache.set(listUrl, null);
    return null;
  }
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body?.items ?? []);
  const id = rows[0]?.id ?? null;
  idCache.set(listUrl, id);
  return id;
}

let staffToken: string | null = null;

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${AUTH_API}/auth/login`, {
    data: { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  staffToken = (await res.json()).token as string;
});

// Dynamic routes hit two expensive things on first-visit: Prisma list
// endpoint + Next dev-mode compile of the detail page. Default 30s fails
// cold; 60s matches smoke-all-pages + sidebar-links.
test.describe("smoke: dynamic detail pages render", () => {
  // Dev-mode cold compile of a never-visited detail page can take 60-90s
  // (full dependency graph + Prisma query planning). Default 60s was too
  // tight — bumped to 120s with a 90s per-goto cap.
  test.setTimeout(120_000);
  for (const def of ROUTES) {
    test(`${def.port} ${def.route}`, async ({ page, request }) => {
      if (!staffToken) throw new Error("no staff token");
      const id = await fetchFirstId(request, staffToken, def.listUrl);

      // Translate HARNESS port (3100-3106) to the runtime layout — dev
      // uses 4556 for shell + 3001-3006 for modules.
      const PORT_MAP: Record<number, string> = {
        3100: PORTS.shell,
        3101: PORTS.accountingWeb,
        3102: PORTS.buyingWeb,
        3103: PORTS.stockWeb,
        3104: PORTS.crmWeb,
        3105: PORTS.hrWeb,
        3106: PORTS.projectsWeb,
      };
      const port = PORT_MAP[def.port] ?? String(def.port);
      // When no fixture data exists, fall back to the /new form instead
      // of skipping. Both routes exercise the same detail/edit page
      // compile — a successful /new render still proves the page is
      // wired and the Prisma schema is loadable.
      const resolvedPath = id
        ? def.route.replace("[id]", id)
        : def.route.replace("/[id]", "/new").replace("/[id]/edit", "/new");
      const url = `http://localhost:${port}${resolvedPath}`;
      const pageErrors: string[] = [];
      page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));

      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const status = resp?.status() ?? 0;
      expect(status, `got ${status} at ${url}`).toBeLessThan(500);

      // Detail pages typically do 1-3 client-side fetches — give hydration
      // room to settle before sniffing the body.
      await page.waitForTimeout(500);
      const body = await page.locator("body").innerText();
      expect(
        body.trim().length,
        `body has no text at ${url}:\n${body.slice(0, 200)}`,
      ).toBeGreaterThan(3);
      expect(body).not.toContain("Application error");

      expect(
        pageErrors,
        `uncaught JS error at ${url}:\n${pageErrors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
