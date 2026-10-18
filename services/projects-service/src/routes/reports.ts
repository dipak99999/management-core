import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const reportsRouter = Router();

reportsRouter.get("/dashboard-summary", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [openProjects, openTasks, hoursThisWeek] = await Promise.all([
    prisma.project.count({ where: { tenantId, status: "Open" } }),
    prisma.task.count({
      where: { tenantId, status: { in: ["Open", "InProgress"] } },
    }),
    prisma.timesheetLine.aggregate({
      where: {
        timesheet: { tenantId, status: "Submitted" },
        date: { gte: weekAgo },
      },
      _sum: { hours: true, billingAmount: true },
    }),
  ]);

  res.json({
    openProjects,
    openTasks,
    weekHours: Number(hoursThisWeek._sum.hours ?? 0),
    weekBillingAmount: Number(hoursThisWeek._sum.billingAmount ?? 0),
  });
});

// Project P&L / profitability report.
//
// Revenue = sum(SI.netTotal) for SIs with projectId + status in Submitted|Paid.
//         + sum(TimesheetLine.billingAmount) for billable lines that aren't
//           yet rolled into an SI (salesInvoiceItemId=null) — this is
//           "work-in-progress revenue" the CFO can see accruing.
// Cost    = sum(ExpenseClaim.totalAmount) for Approved|Paid claims with
//           projectId + sum(TimesheetLine.hours) × (employee.baseSalary /
//           176 avg working hrs/month) as labor cost.
// Margin  = (revenue - cost) / revenue.
//
// Filters:
//   ?projectId=<id>  → single project (default = all projects)
//   ?from=YYYY-MM-DD → SI postingDate / TimesheetLine.date / ExpenseClaim.postingDate lower bound
//   ?to=YYYY-MM-DD   → upper bound
//
// Assumption: baseSalary is monthly. 176 hrs/month = 8 hrs × 22 working
// days — a common shorthand across Zoho / QuickBooks Projects.
const WORKING_HOURS_PER_MONTH = 176;

reportsRouter.get("/profitability", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date(0);
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();

  const projectWhere = { tenantId, ...(projectId ? { id: projectId } : {}) };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, name: true, projectName: true, status: true },
  });
  const ids = projects.map((p) => p.id);

  const [siGroups, tsRolledGroups, tsWipGroups, expenseGroups, laborRaw] = await Promise.all([
    prisma.salesInvoice.groupBy({
      by: ["projectId"],
      where: {
        tenantId,
        projectId: { in: ids },
        status: { in: ["Submitted", "Paid"] },
        isReturn: false,
        postingDate: { gte: from, lte: to },
      },
      _sum: { netTotal: true },
    }),
    // Billed timesheet lines — informational, doesn't add to revenue since
    // the SI already covers it.
    prisma.timesheetLine.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: ids },
        salesInvoiceItemId: { not: null },
        date: { gte: from, lte: to },
        timesheet: { tenantId },
      },
      _sum: { billingAmount: true },
    }),
    // Un-billed billable lines — WIP revenue.
    prisma.timesheetLine.groupBy({
      by: ["projectId"],
      where: {
        projectId: { in: ids },
        isBillable: true,
        salesInvoiceItemId: null,
        date: { gte: from, lte: to },
        timesheet: { tenantId },
      },
      _sum: { billingAmount: true },
    }),
    prisma.expenseClaim.groupBy({
      by: ["projectId"],
      where: {
        tenantId,
        projectId: { in: ids },
        status: { in: ["Approved", "Paid"] },
        postingDate: { gte: from, lte: to },
      },
      _sum: { totalAmount: true },
    }),
    // Labor cost — hours × (baseSalary / 176). One query pulling hours +
    // employee salary joined; the caller aggregates in JS.
    prisma.timesheetLine.findMany({
      where: {
        projectId: { in: ids },
        date: { gte: from, lte: to },
        timesheet: { tenantId },
      },
      select: {
        projectId: true,
        hours: true,
        timesheet: {
          select: { employee: { select: { baseSalary: true } } },
        },
      },
    }),
  ]);

  const revenueByProject = new Map<string, number>();
  for (const g of siGroups) {
    revenueByProject.set(g.projectId!, Number(g._sum.netTotal ?? 0));
  }
  const wipByProject = new Map<string, number>();
  for (const g of tsWipGroups) {
    wipByProject.set(g.projectId, Number(g._sum.billingAmount ?? 0));
  }
  const billedByProject = new Map<string, number>();
  for (const g of tsRolledGroups) {
    billedByProject.set(g.projectId, Number(g._sum.billingAmount ?? 0));
  }
  const expenseByProject = new Map<string, number>();
  for (const g of expenseGroups) {
    expenseByProject.set(g.projectId!, Number(g._sum.totalAmount ?? 0));
  }
  const laborByProject = new Map<string, number>();
  for (const l of laborRaw) {
    const salary = Number(l.timesheet.employee.baseSalary);
    const hourly = salary / WORKING_HOURS_PER_MONTH;
    const prev = laborByProject.get(l.projectId) ?? 0;
    laborByProject.set(l.projectId, prev + Number(l.hours) * hourly);
  }

  const rows = projects.map((p) => {
    const revenue = revenueByProject.get(p.id) ?? 0;
    const wip = wipByProject.get(p.id) ?? 0;
    const billed = billedByProject.get(p.id) ?? 0;
    const expense = expenseByProject.get(p.id) ?? 0;
    const labor = laborByProject.get(p.id) ?? 0;
    const cost = expense + labor;
    const totalRevenue = revenue + wip;
    const profit = totalRevenue - cost;
    return {
      projectId: p.id,
      projectName: p.projectName ?? p.name,
      status: p.status,
      revenueBilled: revenue,
      revenueWip: wip,
      revenueTotal: totalRevenue,
      timesheetBilled: billed,
      costLabor: labor,
      costExpenses: expense,
      costTotal: cost,
      profit,
      marginPct: totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.revenue += r.revenueTotal;
      acc.cost += r.costTotal;
      acc.profit += r.profit;
      return acc;
    },
    { revenue: 0, cost: 0, profit: 0 },
  );
  const grandMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: { ...totals, marginPct: grandMargin },
  });
});
