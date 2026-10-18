// Seeds the "Leave Ledger for Employee" saved report + the 11 Leave
// dashboards (33 charts total) for a tenant. Idempotent: any dashboard with
// the same (tenantId, name) is replaced, cards re-created from scratch.
//
// Every card's `config` matches the schema its target resolver expects
// (ChartCardConfig / MultiSeriesConfig / XYConfig / HeatmapConfig /
// SankeyConfig / TreeConfig / BoxPlotConfig / GanttConfig / HistogramConfig).
// See packages/db/src/dashboard-advanced.ts.

import { PrismaClient } from "@prisma/client";
import { REPORT_DOCTYPE_META } from "./report-meta";

const LEAVE_LEDGER_REPORT_NAME = "Leave Ledger for Employee";

// All 18 fields of the ledger, in the exact column order asked for by the
// spec. Sourced from the LeaveLedgerEntry meta.
function leaveLedgerColumns() {
  const meta = REPORT_DOCTYPE_META["LeaveLedgerEntry"];
  if (!meta) throw new Error("LeaveLedgerEntry not in REPORT_DOCTYPE_META");
  return meta.defaultColumns.concat(
    meta.columns
      .map((c) => c.key)
      .filter((k) => !meta.defaultColumns.includes(k)),
  );
}

// Blueprint: an ordered list of dashboards with per-card chart kind + config.
// Referenced fields must exist in LeaveLedgerEntry's report-meta filterable /
// groupable columns.

interface CardSpec {
  kind: string;
  title: string;
  subtitle?: string;
  config: Record<string, unknown>;
  gridWidth?: number;
  gridHeight?: number;
}

interface DashboardSpec {
  name: string;
  description: string;
  cards: CardSpec[];
}

function buildDashboardSpecs(_currentYear: number): DashboardSpec[] {
  const D = "LeaveLedgerEntry";
  return [
    // 1. Employee Leave Summary — Bar, Pie, StackedBar
    {
      name: "Employee Leave Summary",
      description: "Balance snapshot and consumption mix across all employees",
      cards: [
        {
          kind: "Bar",
          title: "Leaves by type",
          subtitle: "Total ledger movement per leave type",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "leaveTypeId", orderDir: "desc", limit: 20 },
        },
        {
          kind: "Pie",
          title: "Consumption vs allocation",
          subtitle: "Share of ledger entries by type",
          config: { doctype: D, aggregate: "count", groupBy: "entryType", limit: 10 },
        },
        {
          kind: "StackedBar",
          title: "Entry types per leave type",
          subtitle: "Stack composition per leave type",
          config: { doctype: D, aggregate: "count", groupBy: "leaveTypeId", seriesBy: "entryType" },
        },
      ],
    },

    // 2. Leave Utilization — GroupedBar, Heatmap, Line
    {
      name: "Leave Utilization",
      description: "How much of allocated leave is being used, over time and across employees",
      cards: [
        {
          kind: "GroupedBar",
          title: "Utilization by leave type",
          subtitle: "Allocation vs consumption grouped",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "leaveTypeId", seriesBy: "entryType" },
        },
        {
          kind: "Heatmap",
          title: "Leave-type × entry-type intensity",
          subtitle: "Density of ledger events",
          config: { doctype: D, xField: "leaveTypeId", yField: "entryType", aggregate: "count" },
        },
        {
          kind: "Line",
          title: "Consumption trend",
          subtitle: "Total leaves consumed over the last 30 days",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "postingDate", dateField: "postingDate", period: "last30", filters: { entryType: "Consumption" } },
        },
      ],
    },

    // 3. Leave Balance Modification — Bar, Scatter, Timeline
    {
      name: "Leave Balance Modification",
      description: "Adjustments, carry-forwards, and expiries that change balances outside the normal flow",
      cards: [
        {
          kind: "Bar",
          title: "Adjustment volume",
          subtitle: "Count of manual adjustments per employee",
          config: { doctype: D, aggregate: "count", groupBy: "employeeId", filters: { entryType: "Adjustment" }, limit: 20 },
        },
        {
          kind: "Scatter",
          title: "Adjustment size vs balance",
          subtitle: "Leaves adjusted (x) vs balance after (y)",
          config: { doctype: D, xField: "leaves", yField: "balanceAfter", labelField: "employeeId", filters: { entryType: "Adjustment" }, limit: 200 },
        },
        {
          kind: "Timeline",
          title: "Adjustments over time",
          subtitle: "Every non-Allocation/Consumption event",
          config: { doctype: D, nameField: "reason", startField: "postingDate", endField: "postingDate", groupField: "entryType", filters: { entryType: "Adjustment" }, limit: 100 },
        },
      ],
    },

    // 4. Leave Entitlement by Work Group — ClusteredColumn, HorizontalBar, StackedBar
    {
      name: "Leave Entitlement by Work Group",
      description: "How allocations and utilization compare across work groups",
      cards: [
        {
          kind: "ClusteredColumn",
          title: "Allocation vs consumption per group",
          subtitle: "Grouped columns per WorkGroup",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "workGroupId", seriesBy: "entryType" },
        },
        {
          kind: "HorizontalBar",
          title: "Total allocated per group",
          subtitle: "Only Allocation entries",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "workGroupId", filters: { entryType: "Allocation" }, limit: 15 },
        },
        {
          kind: "StackedBar",
          title: "Entry-type mix per group",
          subtitle: "Ledger event count stacked",
          config: { doctype: D, aggregate: "count", groupBy: "workGroupId", seriesBy: "entryType" },
        },
      ],
    },

    // 5. Employee Leave Status — Donut, Pie, Timeline
    {
      name: "Employee Leave Status",
      description: "Application pipeline snapshot: draft, approved, rejected, cancelled",
      cards: [
        {
          kind: "Donut",
          title: "Applications by status",
          config: { doctype: "LeaveApplication", aggregate: "count", groupBy: "status" },
        },
        {
          kind: "Pie",
          title: "Applications by leave type",
          config: { doctype: "LeaveApplication", aggregate: "count", groupBy: "leaveTypeId", limit: 10 },
        },
        {
          kind: "Timeline",
          title: "Approved leave calendar",
          subtitle: "Approved applications by from/to date",
          config: { doctype: "LeaveApplication", nameField: "reason", startField: "fromDate", endField: "toDate", groupField: "leaveTypeId", filters: { status: "Approved" }, limit: 100 },
        },
      ],
    },

    // 6. Leave Approval Hierarchy — FlowChart, StackedColumn, TreeMap
    {
      name: "Leave Approval Hierarchy",
      description: "Employee → approver structure and approval throughput",
      cards: [
        {
          kind: "FlowChart",
          title: "Employee → approver flow",
          subtitle: "Sankey view of Leave-scope hierarchy",
          config: { doctype: "ApproverHierarchy", sourceField: "employeeId", targetField: "approverEmployeeId", aggregate: "count", filters: { scope: "Leave", isActive: true } },
        },
        {
          kind: "StackedColumn",
          title: "Approvals per approver over time",
          subtitle: "Distinct approvers × application status",
          config: { doctype: "LeaveApplication", aggregate: "count", groupBy: "approvedBy", seriesBy: "status" },
        },
        {
          kind: "TreeMap",
          title: "Hierarchy density",
          subtitle: "Approvers weighted by direct-report count",
          config: { doctype: "ApproverHierarchy", rootGroupBy: "approverEmployeeId", aggregate: "count", filters: { scope: "Leave" }, rootLabel: "Approvers" },
        },
      ],
    },

    // 7. Leave Trends & Analytics — Area, Bubble, Line
    {
      name: "Leave Trends & Analytics",
      description: "YoY / seasonal patterns and outliers in consumption",
      cards: [
        {
          kind: "Area",
          title: "Consumption over year",
          subtitle: "Rolling window of consumption entries",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "postingDate", dateField: "postingDate", period: "ytd", filters: { entryType: "Consumption" }, orderDir: "asc" },
        },
        {
          kind: "Bubble",
          title: "Duration vs balance-impact per event",
          subtitle: "Leaves consumed (x) vs balance after (y), sized by fromDate-toDate span",
          config: { doctype: D, xField: "leaves", yField: "balanceAfter", sizeField: "leaves", labelField: "employeeId", filters: { entryType: "Consumption" }, limit: 300 },
        },
        {
          kind: "Line",
          title: "Trend of new applications",
          subtitle: "Applications created per day",
          config: { doctype: "LeaveApplication", aggregate: "count", groupBy: "createdAt", dateField: "createdAt", period: "last30" },
        },
      ],
    },

    // 8. Leave Absenteeism — Bar, ClusteredColumn, Histogram
    {
      name: "Leave Absenteeism",
      description: "Who is off, how often, and how those days distribute",
      cards: [
        {
          kind: "Bar",
          title: "Absenteeism by employee",
          subtitle: "Sum of consumed leaves",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "employeeId", filters: { entryType: "Consumption" }, limit: 20 },
        },
        {
          kind: "ClusteredColumn",
          title: "Consumption by employee × leave type",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "employeeId", seriesBy: "leaveTypeId", filters: { entryType: "Consumption" } },
        },
        {
          kind: "Histogram",
          title: "Distribution of application lengths",
          subtitle: "Days per approved application",
          config: { doctype: "LeaveApplication", field: "totalLeaveDays", bins: 10, filters: { status: "Approved" } },
        },
      ],
    },

    // 9. Leave Distribution by Employee Category — Funnel, Pie, StackedBar
    {
      name: "Leave Distribution by Employee Category",
      description: "How leave flows across Permanent / Contract / Intern / etc",
      cards: [
        {
          kind: "Funnel",
          title: "Consumption funnel by category",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "employeeCategoryId", filters: { entryType: "Consumption" }, orderDir: "desc" },
        },
        {
          kind: "Pie",
          title: "Ledger events by category",
          config: { doctype: D, aggregate: "count", groupBy: "employeeCategoryId" },
        },
        {
          kind: "StackedBar",
          title: "Category × entry-type",
          config: { doctype: D, aggregate: "count", groupBy: "employeeCategoryId", seriesBy: "entryType" },
        },
      ],
    },

    // 10. WorkGroup Leave Allocation — BoxPlot, ClusteredBar, Radar
    {
      name: "WorkGroup Leave Allocation",
      description: "Spread and shape of allocations across work groups",
      cards: [
        {
          kind: "BoxPlot",
          title: "Allocation spread per group",
          subtitle: "Distribution of totalLeaves across employees in each group",
          config: { doctype: "LeaveAllocation", groupBy: "employeeId", valueField: "totalLeaves" },
        },
        {
          kind: "ClusteredBar",
          title: "Allocation totals per group by type",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "workGroupId", seriesBy: "leaveTypeId", filters: { entryType: "Allocation" } },
        },
        {
          kind: "Radar",
          title: "Balance profile per group",
          subtitle: "Radar of allocation/consumption/adjustment averages",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "workGroupId", seriesBy: "entryType" },
        },
      ],
    },

    // 11. New Employee Leave Adjustment — Line, Scatter, StackedColumn
    {
      name: "New Employee Leave Adjustment",
      description: "Onboarding-cohort leave flows: openings, adjustments, initial allocations",
      cards: [
        {
          kind: "Line",
          title: "Openings & carry-forwards over time",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "postingDate", dateField: "postingDate", period: "ytd", filters: { entryType: "Opening" } },
        },
        {
          kind: "Scatter",
          title: "Adjustment amounts vs post-balance",
          config: { doctype: D, xField: "leaves", yField: "balanceAfter", labelField: "employeeId", filters: { entryType: "Adjustment" }, limit: 200 },
        },
        {
          kind: "StackedColumn",
          title: "New-hire adjustments per type",
          config: { doctype: D, aggregate: "sum", field: "leaves", groupBy: "leaveTypeId", seriesBy: "entryType", filters: { entryType: "Adjustment" } },
        },
      ],
    },
  ];
}

// -------- Public entry point --------

export async function seedLeaveAnalytics(
  prisma: PrismaClient,
  tenantId: string,
  ownerUserId: string,
): Promise<{ report: { id: string; created: boolean }; dashboards: Array<{ name: string; id: string; cards: number }> }> {
  // 1. The 18-field SavedReport
  const columns = leaveLedgerColumns();
  const existingReport = await prisma.savedReport.findFirst({
    where: { tenantId, name: LEAVE_LEDGER_REPORT_NAME, doctype: "LeaveLedgerEntry" },
  });
  const reportDefinition = {
    columns,
    filters: [],
    sortBy: [{ column: "postingDate", dir: "desc" }],
    limit: 500,
  };
  const report = existingReport
    ? await prisma.savedReport.update({
        where: { id: existingReport.id },
        data: { definition: reportDefinition as unknown as object, ownerUserId, isShared: true },
      })
    : await prisma.savedReport.create({
        data: {
          tenantId,
          ownerUserId,
          name: LEAVE_LEDGER_REPORT_NAME,
          doctype: "LeaveLedgerEntry",
          definition: reportDefinition as unknown as object,
          isShared: true,
        },
      });

  // 2. The 11 dashboards
  const currentYear = new Date().getFullYear();
  const specs = buildDashboardSpecs(currentYear);
  const results: Array<{ name: string; id: string; cards: number }> = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const existing = await prisma.dashboard.findFirst({
      where: { tenantId, name: spec.name },
      include: { cards: true },
    });
    let dashId: string;
    if (existing) {
      // Wipe cards + reset the dashboard metadata
      await prisma.dashboardCard.deleteMany({ where: { dashboardId: existing.id } });
      await prisma.dashboard.update({
        where: { id: existing.id },
        data: { description: spec.description, ownerUserId, isShared: true, sortOrder: 100 + i },
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
          sortOrder: 100 + i,
        },
      });
      dashId = d.id;
    }

    // Cards: default 4-col × 3-row layout for now, 3 across
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
          gridHeight: c.gridHeight ?? 3,
          sortOrder: j,
        },
      });
    }
    results.push({ name: spec.name, id: dashId, cards: spec.cards.length });
  }

  return {
    report: { id: report.id, created: !existingReport },
    dashboards: results,
  };
}
