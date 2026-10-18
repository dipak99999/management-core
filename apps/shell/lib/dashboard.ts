"use client";

// Cross-service dashboard fetcher. Each service exposes /reports/dashboard-summary
// under its own base URL; the browser calls all 4 in parallel with the JWT
// from localStorage.

const ACC = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
const STK = process.env.NEXT_PUBLIC_STOCK_SERVICE_URL ?? "/api/stock";
const CRM = process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";
const HR = process.env.NEXT_PUBLIC_HR_SERVICE_URL ?? "/api/hr";
const PRJ = process.env.NEXT_PUBLIC_PROJECTS_SERVICE_URL ?? "/api/projects";

function token(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
    );
  }
  return res.json();
}

export interface AccountingSummary {
  receivables: {
    outstanding: number;
    openInvoices: number;
    overdue: number;
    overdueInvoices: number;
  };
  payables: { outstanding: number; openBills: number };
  cashOnHand: number;
  mtd: { income: number; expense: number; netProfit: number };
}

export interface StockSummary {
  totalStockValue: number;
  itemsInStock: number;
  openWorkOrders: number;
  todayDeliveries: number;
}

export interface CrmSummary {
  openLeads: number;
  openOpportunities: number;
  pipelineValue: number;
  openQuotations: number;
  quotedValue: number;
  openSalesOrders: number;
  salesOrderValue: number;
}

export interface HrSummary {
  activeEmployees: number;
  mtdPayrollGross: number;
  mtdPayrollNet: number;
  mtdSlipsSubmitted: number;
  draftSlips: number;
  absentToday: number;
  onLeaveToday: number;
}

export interface ProjectsSummary {
  openProjects: number;
  openTasks: number;
  weekHours: number;
  weekBillingAmount: number;
}

export interface DashboardData {
  accounting: AccountingSummary | null;
  stock: StockSummary | null;
  crm: CrmSummary | null;
  hr: HrSummary | null;
  projects: ProjectsSummary | null;
  errors: string[];
}

// Fetch all five in parallel. Any one failing doesn't block the others — we
// return whatever succeeded plus a list of error messages the UI can show.
export async function fetchDashboard(): Promise<DashboardData> {
  const results = await Promise.allSettled([
    get<AccountingSummary>(`${ACC}/reports/dashboard-summary`),
    get<StockSummary>(`${STK}/reports/dashboard-summary`),
    get<CrmSummary>(`${CRM}/reports/dashboard-summary`),
    get<HrSummary>(`${HR}/reports/dashboard-summary`),
    get<ProjectsSummary>(`${PRJ}/reports/dashboard-summary`),
  ]);

  const labels = ["Accounting", "Stock", "CRM", "HR", "Projects"];
  const errors: string[] = [];
  const out = [null, null, null, null, null] as [
    AccountingSummary | null,
    StockSummary | null,
    CrmSummary | null,
    HrSummary | null,
    ProjectsSummary | null,
  ];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[i] = r.value;
    } else {
      errors.push(`${labels[i]}: ${r.reason?.message ?? "failed"}`);
    }
  });

  return {
    accounting: out[0],
    stock: out[1],
    crm: out[2],
    hr: out[3],
    projects: out[4],
    errors,
  };
}
