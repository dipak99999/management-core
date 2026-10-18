// Seeds the 16 CRM dashboards (75 charts) across the CRM P2 entities and
// the existing sales-side doctypes (Customer, Lead, Opportunity, Quotation,
// SalesOrder, SalesInvoice). Idempotent per (tenantId, name).

import { PrismaClient } from "@prisma/client";

interface CardSpec {
  kind: string;
  title: string;
  subtitle?: string;
  config: Record<string, unknown>;
}

interface DashboardSpec {
  name: string;
  description: string;
  cards: CardSpec[];
}

function specs(): DashboardSpec[] {
  return [
    // 1. Sales & Performance (5): Bar, Funnel, Line, Donut, StackedBar
    {
      name: "Sales & Performance",
      description: "Top-line sales KPIs and pipeline conversion",
      cards: [
        { kind: "Bar", title: "SI by customer", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", limit: 15 } },
        { kind: "Funnel", title: "Pipeline funnel", config: { doctype: "Opportunity", aggregate: "count", groupBy: "status" } },
        { kind: "Line", title: "Sales trend (30d)", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Donut", title: "SI status", config: { doctype: "SalesInvoice", aggregate: "count", groupBy: "status" } },
        { kind: "StackedBar", title: "Customer × status", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", seriesBy: "status" } },
      ],
    },

    // 2. Marketing & Campaign (5): Bar, Bubble, Heatmap, Line, TreeMap
    {
      name: "Marketing & Campaign",
      description: "Campaign-driven pipeline generation and engagement",
      cards: [
        { kind: "Bar", title: "Leads by source", config: { doctype: "Lead", aggregate: "count", groupBy: "source", limit: 15 } },
        { kind: "Bubble", title: "Lead conversion size", config: { doctype: "Opportunity", xField: "probabilityPct", yField: "amount", sizeField: "amount", limit: 200 } },
        { kind: "Heatmap", title: "Lead source × status", config: { doctype: "Lead", xField: "source", yField: "status", aggregate: "count" } },
        { kind: "Line", title: "New leads trend", config: { doctype: "Lead", aggregate: "count", groupBy: "createdAt", dateField: "createdAt", period: "last30" } },
        { kind: "TreeMap", title: "Campaign share", config: { doctype: "Lead", rootGroupBy: "campaignId", aggregate: "count", rootLabel: "Campaigns" } },
      ],
    },

    // 3. Customer Relationship Management (5): Bar, Line, Pie, Radar, Sankey
    {
      name: "Customer Relationship Management",
      description: "Customer roster + engagement + activity flow",
      cards: [
        { kind: "Bar", title: "Customers by group", config: { doctype: "Customer", aggregate: "count", groupBy: "customerGroup", limit: 15 } },
        { kind: "Line", title: "New customers trend", config: { doctype: "Customer", aggregate: "count", groupBy: "createdAt", dateField: "createdAt", period: "ytd" } },
        { kind: "Pie", title: "Customer types", config: { doctype: "Customer", aggregate: "count", groupBy: "customerType" } },
        { kind: "Radar", title: "Group × territory shape", config: { doctype: "Customer", aggregate: "count", groupBy: "customerGroup", seriesBy: "territory" } },
        { kind: "Sankey", title: "Territory → group flow", config: { doctype: "Customer", sourceField: "territory", targetField: "customerGroup", aggregate: "count" } },
      ],
    },

    // 4. Warranty & Support (5): Column, Gauge, Scatter, StackedBar, Timeline
    {
      name: "Warranty & Support",
      description: "In-warranty coverage, claim throughput, resolution SLAs",
      cards: [
        { kind: "Column", title: "Warranties by type", config: { doctype: "Warranty", aggregate: "count", groupBy: "warrantyType" } },
        { kind: "Gauge", title: "Open claims count", config: { value: 0, min: 0, max: 100, label: "Open" } },
        { kind: "Scatter", title: "Claim amount vs age", config: { doctype: "Warranty", xField: "amount", yField: "amount", labelField: "claimNo", filters: { warrantyType: "ClaimInward" }, limit: 200 } },
        { kind: "StackedBar", title: "Warranty status × type", config: { doctype: "Warranty", aggregate: "count", groupBy: "warrantyType", seriesBy: "status" } },
        { kind: "Timeline", title: "Warranty coverage timeline", config: { doctype: "Warranty", nameField: "serialNo", startField: "startDate", endField: "endDate", groupField: "warrantyType", filters: { warrantyType: "Definition" }, limit: 100 } },
      ],
    },

    // 5. Operational & Task Management (5): Bar, Gantt, Heatmap, KPICards, Pie
    {
      name: "Operational & Task Management",
      description: "Task load, aging, and completion patterns",
      cards: [
        { kind: "Bar", title: "Tasks by status", config: { doctype: "Task", aggregate: "count", groupBy: "status" } },
        { kind: "Gantt", title: "Task timeline", config: { doctype: "Task", nameField: "subject", startField: "startDate", endField: "endDate", groupField: "assignedEmployeeId", limit: 100 } },
        { kind: "Heatmap", title: "Priority × status", config: { doctype: "Task", xField: "priority", yField: "status", aggregate: "count" } },
        { kind: "KPICards", title: "Task KPIs", config: { cards: [
          { label: "Open tasks", doctype: "Task", aggregate: "count", filters: { status: "Open" } },
          { label: "In progress", doctype: "Task", aggregate: "count", filters: { status: "InProgress" } },
          { label: "Overdue", doctype: "Task", aggregate: "count", filters: { status: "Overdue" } },
        ] } },
        { kind: "Pie", title: "Task priority mix", config: { doctype: "Task", aggregate: "count", groupBy: "priority" } },
      ],
    },

    // 6. Service & Case Management (5): Bar, Funnel, Pie, Scatter, Timeline
    {
      name: "Service & Case Management",
      description: "Case volume, resolution funnel, and outcomes",
      cards: [
        { kind: "Bar", title: "Cases by category", config: { doctype: "DeskTicket", aggregate: "count", groupBy: "category", limit: 15 } },
        { kind: "Funnel", title: "Ticket resolution funnel", config: { doctype: "DeskTicket", aggregate: "count", groupBy: "status" } },
        { kind: "Pie", title: "Ticket priority", config: { doctype: "DeskTicket", aggregate: "count", groupBy: "priority" } },
        { kind: "Scatter", title: "Ticket age vs response", config: { doctype: "DeskTicket", xField: "ageHours", yField: "firstResponseHours", limit: 200 } },
        { kind: "Timeline", title: "Ticket timeline", config: { doctype: "DeskTicket", nameField: "subject", startField: "createdAt", endField: "resolvedAt", groupField: "status", limit: 100 } },
      ],
    },

    // 7. Location-Based (4): BubbleMap, GeoMap, Heatmap, Line
    {
      name: "Location-Based",
      description: "Field-staff GPS captures + geographic patterns",
      cards: [
        { kind: "BubbleMap", title: "Field visits map", config: { doctype: "LocationCapture", xField: "longitude", yField: "latitude", aggregate: "count", mapName: "world" } },
        { kind: "GeoMap", title: "Visit intensity by region", config: { doctype: "LocationCapture", mapName: "world" } },
        { kind: "Heatmap", title: "Purpose × day", config: { doctype: "LocationCapture", xField: "purpose", yField: "userId", aggregate: "count" } },
        { kind: "Line", title: "Captures trend", config: { doctype: "LocationCapture", aggregate: "count", groupBy: "capturedAt", dateField: "capturedAt", period: "last30" } },
      ],
    },

    // 8. Project & Planning (5): Bar, Gantt, Line, Pie, Waterfall
    {
      name: "Project & Planning",
      description: "Active project book and delivery timelines",
      cards: [
        { kind: "Bar", title: "Projects by stage", config: { doctype: "ProjectPlanning", aggregate: "count", groupBy: "currentStage", limit: 10 } },
        { kind: "Gantt", title: "Project timelines", config: { doctype: "ProjectPlanning", nameField: "projectName", startField: "startDate", endField: "targetDate", groupField: "status", limit: 50 } },
        { kind: "Line", title: "Progress over time (avg)", config: { doctype: "ProjectPlanning", aggregate: "sum", field: "progressPct", groupBy: "targetDate", dateField: "targetDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Project status mix", config: { doctype: "ProjectPlanning", aggregate: "count", groupBy: "status" } },
        { kind: "Waterfall", title: "Budget waterfall by customer", config: { doctype: "ProjectPlanning", aggregate: "sum", field: "budgetAmount", groupBy: "customer.customerName" } },
      ],
    },

    // 9. Purchase & Inventory (5): Bar, Line, Pie, Scatter, StackedBar
    {
      name: "Purchase & Inventory (CRM view)",
      description: "Supplier and warranty coverage on customer-facing items",
      cards: [
        { kind: "Bar", title: "Purchase warranties by status", config: { doctype: "PurchaseWarranty", aggregate: "count", groupBy: "status" } },
        { kind: "Line", title: "New coverage trend", config: { doctype: "PurchaseWarranty", aggregate: "count", groupBy: "purchaseDate", dateField: "purchaseDate", period: "ytd" } },
        { kind: "Pie", title: "Coverage share by supplier", config: { doctype: "PurchaseWarranty", aggregate: "count", groupBy: "supplierId", limit: 10 } },
        { kind: "Scatter", title: "Amount vs warranty months", config: { doctype: "PurchaseWarranty", xField: "warrantyMonths", yField: "amount", limit: 200 } },
        { kind: "StackedBar", title: "Supplier × status", config: { doctype: "PurchaseWarranty", aggregate: "count", groupBy: "supplierId", seriesBy: "status" } },
      ],
    },

    // 10. Performance Evaluation (5): Bar, Gauge, Heatmap, Line, Radar
    {
      name: "Performance Evaluation",
      description: "Sales rep and team target attainment",
      cards: [
        { kind: "Bar", title: "Target amount by user", config: { doctype: "CrmTarget", aggregate: "sum", field: "targetAmount", groupBy: "ownerUserId", limit: 20 } },
        { kind: "Gauge", title: "Attainment %", config: { value: 0, min: 0, max: 200, label: "Attainment" } },
        { kind: "Heatmap", title: "User × period", config: { doctype: "CrmTarget", xField: "ownerUserId", yField: "periodType", aggregate: "sum", valueField: "targetAmount" } },
        { kind: "Line", title: "Actuals trend", config: { doctype: "CrmTargetActual", aggregate: "sum", field: "actualAmount", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Radar", title: "Attainment shape by user", config: { doctype: "CrmTargetActual", aggregate: "sum", field: "actualAmount", groupBy: "ownerUserId", seriesBy: "sourceDoctype" } },
      ],
    },

    // 11. Customer Interaction & Support (4): Bar, Funnel, Timeline, WordCloud
    {
      name: "Customer Interaction & Support",
      description: "Touchpoints and resolution flow",
      cards: [
        { kind: "Bar", title: "Activities by type", config: { doctype: "Activity", aggregate: "count", groupBy: "type" } },
        { kind: "Funnel", title: "Support flow", config: { doctype: "DeskTicket", aggregate: "count", groupBy: "status" } },
        { kind: "Timeline", title: "Support timeline", config: { doctype: "DeskTicket", nameField: "subject", startField: "createdAt", endField: "resolvedAt", groupField: "priority", limit: 100 } },
        { kind: "WordCloud", title: "Ticket subjects", config: { doctype: "DeskTicket", field: "subject", limit: 60 } },
      ],
    },

    // 12. Customer Segmentation & Insights (4): ClusterDiagram, Pie, Scatter, TreeMap
    {
      name: "Customer Segmentation & Insights",
      description: "Group / territory / spend patterns",
      cards: [
        { kind: "ClusterDiagram", title: "Customer clusters", config: { doctype: "Customer", nodeField: "customerName", edgeSourceField: "customerGroup", edgeTargetField: "territory" } },
        { kind: "Pie", title: "Group share", config: { doctype: "Customer", aggregate: "count", groupBy: "customerGroup" } },
        { kind: "Scatter", title: "Deals × amount", config: { doctype: "Opportunity", xField: "probabilityPct", yField: "amount", limit: 200 } },
        { kind: "TreeMap", title: "Territory → group tree", config: { doctype: "Customer", rootGroupBy: "territory", leafGroupBy: "customerGroup", aggregate: "count", rootLabel: "Territories" } },
      ],
    },

    // 13. Financial & Revenue (5): Bar, Line, Pie, StackedColumn, Waterfall
    {
      name: "Financial & Revenue (CRM view)",
      description: "Revenue signals from the CRM pipeline",
      cards: [
        { kind: "Bar", title: "Revenue by customer", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", limit: 15 } },
        { kind: "Line", title: "Revenue trend", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "SI by status", config: { doctype: "SalesInvoice", aggregate: "count", groupBy: "status" } },
        { kind: "StackedColumn", title: "Territory × customer group revenue", config: { doctype: "SalesInvoice", aggregate: "sum", field: "grandTotal", groupBy: "customer.customerName", seriesBy: "status" } },
        { kind: "Waterfall", title: "SO fulfilment waterfall", config: { doctype: "SalesOrder", aggregate: "sum", field: "grandTotal", groupBy: "status" } },
      ],
    },

    // 14. Activity Tracking (4): Heatmap, Line, Scatter, Timeline
    {
      name: "Activity Tracking",
      description: "Volume + rhythm of daily rep activity",
      cards: [
        { kind: "Heatmap", title: "Visits by user × day", config: { doctype: "DailyWorksheet", xField: "ownerUserId", yField: "postingDate", aggregate: "sum", valueField: "visitCount" } },
        { kind: "Line", title: "Orders booked trend", config: { doctype: "DailyWorksheet", aggregate: "sum", field: "amountBooked", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "Scatter", title: "Calls vs orders", config: { doctype: "DailyWorksheet", xField: "callsMade", yField: "ordersBooked", labelField: "ownerUserId", limit: 200 } },
        { kind: "Timeline", title: "Work-plan calendar", config: { doctype: "WorkPlan", nameField: "planTitle", startField: "weekStartDate", endField: "weekStartDate", groupField: "ownerUserId", limit: 100 } },
      ],
    },

    // 15. Customer Feedback & Sentiment Analysis (4): Bar, Bubble, SentimentLine, WordCloud
    {
      name: "Customer Feedback & Sentiment",
      description: "What customers are saying + how it trends",
      cards: [
        { kind: "Bar", title: "Feedback by resolution", config: { doctype: "Warranty", aggregate: "count", groupBy: "resolution", filters: { warrantyType: "Helpdesk" }, limit: 15 } },
        { kind: "Bubble", title: "Amount vs status", config: { doctype: "Warranty", xField: "amount", yField: "amount", sizeField: "amount", filters: { warrantyType: "ClaimInward" }, limit: 200 } },
        { kind: "SentimentLine", title: "Case volume over time", config: { doctype: "Warranty", aggregate: "count", groupBy: "claimDate", dateField: "claimDate", period: "ytd", orderDir: "asc" } },
        { kind: "WordCloud", title: "Feedback phrases", config: { doctype: "Warranty", field: "resolution", limit: 60 } },
      ],
    },

    // 16. General CRM Dashboards (5): Bar, Combo, Funnel, KPICards, Pie
    {
      name: "General CRM",
      description: "Executive rollup across CRM entities",
      cards: [
        { kind: "Bar", title: "Leads by status", config: { doctype: "Lead", aggregate: "count", groupBy: "status" } },
        { kind: "Combo", title: "Opps × amount by status", config: { doctype: "Opportunity", aggregate: "sum", field: "amount", groupBy: "status", seriesBy: "type" } },
        { kind: "Funnel", title: "Full funnel", config: { doctype: "Opportunity", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "CRM KPIs", config: { cards: [
          { label: "Open leads", doctype: "Lead", aggregate: "count", filters: { status: "Open" } },
          { label: "Open opps", doctype: "Opportunity", aggregate: "count", filters: { status: "Open" } },
          { label: "Active dealers", doctype: "AutoDealer", aggregate: "count", filters: { status: "Active" } },
          { label: "In-warranty items", doctype: "Warranty", aggregate: "count", filters: { warrantyType: "Definition", status: "Open" } },
        ] } },
        { kind: "Pie", title: "Warranty status", config: { doctype: "Warranty", aggregate: "count", groupBy: "status" } },
      ],
    },
  ];
}

export async function seedCrmAnalytics(
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
        data: { description: spec.description, ownerUserId, isShared: true, sortOrder: 500 + i },
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
          sortOrder: 500 + i,
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
          gridWidth: 4,
          gridHeight: 3,
          sortOrder: j,
        },
      });
    }
    results.push({ name: spec.name, id: dashId, cards: spec.cards.length });
  }
  return { dashboards: results };
}
