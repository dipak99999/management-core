// Seeds the 11 Manufacturing dashboards (97 charts) across the mfg P2
// entities + existing stock/production entities. Idempotent per (tenantId,
// name).

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
    // 1. Master Data (9)
    {
      name: "Master Data",
      description: "Item / warehouse / party / master data coverage",
      cards: [
        { kind: "Bar", title: "Items by group", config: { doctype: "Item", aggregate: "count", groupBy: "itemGroup", limit: 15 } },
        { kind: "Heatmap", title: "Item group × warehouse (SLE volume)", config: { doctype: "StockLedgerEntry", xField: "itemId", yField: "warehouseId", aggregate: "count" } },
        { kind: "Line", title: "New items trend", config: { doctype: "Item", aggregate: "count", groupBy: "createdAt", dateField: "createdAt", period: "ytd" } },
        { kind: "Pie", title: "Customers by group", config: { doctype: "Customer", aggregate: "count", groupBy: "customerGroup" } },
        { kind: "KPICards", title: "Master counts", config: { cards: [
          { label: "Items", doctype: "Item", aggregate: "count" },
          { label: "Customers", doctype: "Customer", aggregate: "count" },
          { label: "Suppliers", doctype: "Supplier", aggregate: "count" },
        ] } },
        { kind: "Bar", title: "Suppliers by group", config: { doctype: "Supplier", aggregate: "count", groupBy: "supplierGroup", limit: 15 } },
        { kind: "TreeMap", title: "Item group → item", config: { doctype: "Item", rootGroupBy: "itemGroup", aggregate: "count", rootLabel: "Items" } },
        { kind: "Column", title: "Routing masters by item", config: { doctype: "RoutingMaster", aggregate: "count", groupBy: "itemId", limit: 15 } },
        { kind: "Donut", title: "Routings active vs inactive", config: { doctype: "RoutingMaster", aggregate: "count", groupBy: "isActive" } },
      ],
    },

    // 2. Planning (9)
    {
      name: "Planning",
      description: "MRP + site planning outlook",
      cards: [
        { kind: "Bar", title: "MRP runs by status", config: { doctype: "MrpRun", aggregate: "count", groupBy: "status" } },
        { kind: "Bubble", title: "Site plan reorder vs safety", config: { doctype: "ItemSitePlanning", xField: "reorderLevel", yField: "safetyStock", sizeField: "reorderQty", limit: 200 } },
        { kind: "Calendar", title: "MRP run calendar", config: { doctype: "MrpRun", dateField: "runDate", aggregate: "count", year: new Date().getFullYear() } },
        { kind: "Gantt", title: "Plan horizon per run", config: { doctype: "MrpRun", nameField: "runNo", startField: "runDate", endField: "runDate", limit: 30 } },
        { kind: "Line", title: "Suggestions volume", config: { doctype: "MrpRun", aggregate: "sum", field: "suggestionsCount", groupBy: "runDate", dateField: "runDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Suggestion action type", config: { doctype: "MrpSuggestion", aggregate: "count", groupBy: "actionType" } },
        { kind: "Heatmap", title: "Reorder level × warehouse", config: { doctype: "ItemSitePlanning", xField: "warehouseId", yField: "itemId", aggregate: "sum", valueField: "reorderLevel" } },
        { kind: "Bar", title: "Lead time by supplier", config: { doctype: "ItemSitePlanning", aggregate: "sum", field: "leadTimeDays", groupBy: "supplierId", limit: 15 } },
        { kind: "StackedBar", title: "Suggestions per run × action", config: { doctype: "MrpSuggestion", aggregate: "count", groupBy: "mrpRunId", seriesBy: "actionType" } },
      ],
    },

    // 3. Procurement (9)
    {
      name: "Procurement",
      description: "PR / PO / GRN throughput and coverage",
      cards: [
        { kind: "Funnel", title: "Procurement funnel", config: { doctype: "PurchaseOrder", aggregate: "count", groupBy: "status" } },
        { kind: "Line", title: "PO trend", config: { doctype: "PurchaseOrder", aggregate: "sum", field: "grandTotal", groupBy: "transactionDate", dateField: "transactionDate", period: "last30", orderDir: "asc" } },
        { kind: "Pie", title: "PO by supplier group", config: { doctype: "PurchaseOrder", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Procurement KPIs", config: { cards: [
          { label: "Open POs", doctype: "PurchaseOrder", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Received", doctype: "PurchaseReceipt", aggregate: "count" },
          { label: "Bills raised", doctype: "PurchaseInvoice", aggregate: "count" },
        ] } },
        { kind: "Scatter", title: "PO amount vs items", config: { doctype: "PurchaseOrder", xField: "grandTotal", yField: "grandTotal", limit: 200 } },
        { kind: "Bar", title: "Top suppliers by amount", config: { doctype: "PurchaseOrder", aggregate: "sum", field: "grandTotal", groupBy: "supplier.supplierName", limit: 15 } },
        { kind: "StackedBar", title: "PO grand total × status", config: { doctype: "PurchaseOrder", aggregate: "sum", field: "grandTotal", groupBy: "supplier.supplierName", seriesBy: "status" } },
        { kind: "Timeline", title: "PO timeline", config: { doctype: "PurchaseOrder", nameField: "name", startField: "transactionDate", endField: "transactionDate", groupField: "status", limit: 60 } },
        { kind: "Waterfall", title: "PO by status waterfall", config: { doctype: "PurchaseOrder", aggregate: "sum", field: "grandTotal", groupBy: "status" } },
      ],
    },

    // 4. Weighment (8)
    {
      name: "Weighment",
      description: "Truck weighments in / out",
      cards: [
        { kind: "Bar", title: "Net weight by vehicle", config: { doctype: "Weighment", aggregate: "sum", field: "netWeight", groupBy: "vehicleNo", limit: 20 } },
        { kind: "Gauge", title: "Today's throughput", config: { value: 0, min: 0, max: 100 } },
        { kind: "Histogram", title: "Moisture % distribution", config: { doctype: "Weighment", field: "moisturePct", bins: 10 } },
        { kind: "Line", title: "Daily net weight", config: { doctype: "Weighment", aggregate: "sum", field: "netWeight", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "KPICards", title: "Weighment KPIs", config: { cards: [
          { label: "Inward slips", doctype: "Weighment", aggregate: "count", filters: { weighmentType: "Inward" } },
          { label: "Outward slips", doctype: "Weighment", aggregate: "count", filters: { weighmentType: "Outward" } },
          { label: "Total amount", doctype: "Weighment", aggregate: "sum", field: "amount", format: "currency" },
        ] } },
        { kind: "StackedBar", title: "Vehicle × type", config: { doctype: "Weighment", aggregate: "sum", field: "netWeight", groupBy: "vehicleNo", seriesBy: "weighmentType" } },
        { kind: "Pie", title: "Inward vs outward", config: { doctype: "Weighment", aggregate: "count", groupBy: "weighmentType" } },
        { kind: "Bar", title: "Notes issued by type", config: { doctype: "InwardOutwardNote", aggregate: "count", groupBy: "noteType" } },
      ],
    },

    // 5. Quality (8)
    {
      name: "Quality",
      description: "Inspection pass rates + defect flow",
      cards: [
        { kind: "Bar", title: "Inspections by result", config: { doctype: "QualityInspection", aggregate: "count", groupBy: "status" } },
        { kind: "BoxPlot", title: "Reading distribution per item", config: { doctype: "QualityInspection", groupBy: "itemId", valueField: "totalReadings" } },
        { kind: "Line", title: "Inspections over time", config: { doctype: "QualityInspection", aggregate: "count", groupBy: "inspectionDate", dateField: "inspectionDate", period: "last30" } },
        { kind: "Radar", title: "Result mix", config: { doctype: "QualityInspection", aggregate: "count", groupBy: "inspectionType", seriesBy: "status" } },
        { kind: "KPICards", title: "Quality KPIs", config: { cards: [
          { label: "Total inspections", doctype: "QualityInspection", aggregate: "count" },
          { label: "Rejected", doctype: "QualityInspection", aggregate: "count", filters: { status: "Rejected" } },
        ] } },
        { kind: "StackedBar", title: "Item × result", config: { doctype: "QualityInspection", aggregate: "count", groupBy: "itemId", seriesBy: "status" } },
        { kind: "Heatmap", title: "Inspection type × result", config: { doctype: "QualityInspection", xField: "inspectionType", yField: "status", aggregate: "count" } },
        { kind: "Pie", title: "Inspection type mix", config: { doctype: "QualityInspection", aggregate: "count", groupBy: "inspectionType" } },
      ],
    },

    // 6. Inventory (9)
    {
      name: "Inventory",
      description: "Balance movement + valuation + issues/transfers/returns",
      cards: [
        { kind: "Bar", title: "SLE volume by warehouse", config: { doctype: "StockLedgerEntry", aggregate: "count", groupBy: "warehouseId", limit: 15 } },
        { kind: "Donut", title: "Material issues by purpose", config: { doctype: "MaterialIssue", aggregate: "count", groupBy: "purpose" } },
        { kind: "Heatmap", title: "Item × warehouse SLE intensity", config: { doctype: "StockLedgerEntry", xField: "itemId", yField: "warehouseId", aggregate: "count" } },
        { kind: "Line", title: "Stock value trend", config: { doctype: "StockLedgerEntry", aggregate: "sum", field: "stockValue", groupBy: "postingDate", dateField: "postingDate", period: "last30", orderDir: "asc" } },
        { kind: "KPICards", title: "Inventory KPIs", config: { cards: [
          { label: "Active items", doctype: "Item", aggregate: "count" },
          { label: "Issues MTD", doctype: "MaterialIssue", aggregate: "sum", field: "totalValue", period: "mtd", dateField: "postingDate", format: "currency" },
          { label: "Transfers MTD", doctype: "MaterialTransfer", aggregate: "sum", field: "totalValue", period: "mtd", dateField: "postingDate", format: "currency" },
        ] } },
        { kind: "StackedBar", title: "Issues by warehouse × purpose", config: { doctype: "MaterialIssue", aggregate: "sum", field: "totalValue", groupBy: "sourceWarehouseId", seriesBy: "purpose" } },
        { kind: "Bar", title: "Returns by reason", config: { doctype: "MaterialReturn", aggregate: "count", groupBy: "returnType" } },
        { kind: "Pie", title: "Transfer status", config: { doctype: "MaterialTransfer", aggregate: "count", groupBy: "status" } },
        { kind: "Column", title: "Voucher type volume", config: { doctype: "StockLedgerEntry", aggregate: "count", groupBy: "voucherType" } },
      ],
    },

    // 7. Production (9)
    {
      name: "Production",
      description: "WO progress + BOM usage + throughput",
      cards: [
        { kind: "Bar", title: "Work orders by status", config: { doctype: "WorkOrder", aggregate: "count", groupBy: "status" } },
        { kind: "Gauge", title: "WO completion %", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "WO throughput trend", config: { doctype: "WorkOrder", aggregate: "sum", field: "producedQty", groupBy: "createdAt", dateField: "createdAt", period: "last30", orderDir: "asc" } },
        { kind: "KPICards", title: "Production KPIs", config: { cards: [
          { label: "Open WOs", doctype: "WorkOrder", aggregate: "count", filters: { status: "InProgress" } },
          { label: "Completed", doctype: "WorkOrder", aggregate: "count", filters: { status: "Completed" } },
        ] } },
        { kind: "Scatter", title: "Planned vs produced qty", config: { doctype: "WorkOrder", xField: "qty", yField: "producedQty", limit: 200 } },
        { kind: "StackedBar", title: "WO qty by status", config: { doctype: "WorkOrder", aggregate: "sum", field: "qty", groupBy: "createdAt", seriesBy: "status" } },
        { kind: "TreeMap", title: "BOM cost by FG item", config: { doctype: "WorkOrder", rootGroupBy: "bomId", aggregate: "sum", valueField: "producedQty", rootLabel: "WO output" } },
        { kind: "Bar", title: "Job cards by status", config: { doctype: "JobCard", aggregate: "count", groupBy: "status" } },
        { kind: "Pie", title: "Production plans", config: { doctype: "ProductionPlan", aggregate: "count", groupBy: "status" } },
      ],
    },

    // 8. Engineering (9)
    {
      name: "Engineering",
      description: "BOM depth + routing operations + workstation load",
      cards: [
        { kind: "Bar", title: "BOMs per item", config: { doctype: "BOM", aggregate: "count", groupBy: "itemId", limit: 15 } },
        { kind: "Heatmap", title: "Item × workstation ops", config: { doctype: "BOMOperation", xField: "workstationId", yField: "bomId", aggregate: "sum", valueField: "timeInMins" } },
        { kind: "Line", title: "New BOM trend", config: { doctype: "BOM", aggregate: "count", groupBy: "createdAt", dateField: "createdAt", period: "ytd" } },
        { kind: "NetworkDiagram", title: "Routing → workstation graph", config: { doctype: "RoutingOperation", nodeField: "operationName", edgeSourceField: "routingId", edgeTargetField: "workstationId" } },
        { kind: "Radar", title: "Routing coverage by item", config: { doctype: "RoutingMaster", aggregate: "count", groupBy: "itemId", seriesBy: "isActive" } },
        { kind: "Bar", title: "Ops per workstation", config: { doctype: "RoutingOperation", aggregate: "count", groupBy: "workstationId", limit: 15 } },
        { kind: "StackedBar", title: "Time per routing", config: { doctype: "RoutingOperation", aggregate: "sum", field: "timeInMins", groupBy: "routingId", seriesBy: "operationName" } },
        { kind: "KPICards", title: "Engineering KPIs", config: { cards: [
          { label: "Active BOMs", doctype: "BOM", aggregate: "count", filters: { isActive: true } },
          { label: "Active routings", doctype: "RoutingMaster", aggregate: "count", filters: { isActive: true } },
          { label: "Workstations", doctype: "Workstation", aggregate: "count" },
        ] } },
        { kind: "Pie", title: "Routing active mix", config: { doctype: "RoutingMaster", aggregate: "count", groupBy: "isActive" } },
      ],
    },

    // 9. Plant Maintenance (9)
    {
      name: "Plant Maintenance",
      description: "Requests, schedules, actions, alarms",
      cards: [
        { kind: "Bar", title: "Requests by priority", config: { doctype: "MaintenanceRequest", aggregate: "count", groupBy: "priority" } },
        { kind: "Gauge", title: "Open request count", config: { value: 0, min: 0, max: 50 } },
        { kind: "Line", title: "New requests trend", config: { doctype: "MaintenanceRequest", aggregate: "count", groupBy: "requestDate", dateField: "requestDate", period: "last30" } },
        { kind: "Pie", title: "Request types", config: { doctype: "MaintenanceRequest", aggregate: "count", groupBy: "requestType" } },
        { kind: "KPICards", title: "Maintenance KPIs", config: { cards: [
          { label: "Open", doctype: "MaintenanceRequest", aggregate: "count", filters: { status: "Open" } },
          { label: "In progress", doctype: "MaintenanceRequest", aggregate: "count", filters: { status: "InProgress" } },
          { label: "Alarms MTD", doctype: "MachineLogger", aggregate: "count", filters: { isAlarm: true }, period: "mtd", dateField: "loggedAt" },
        ] } },
        { kind: "StackedBar", title: "Machine × priority", config: { doctype: "MaintenanceRequest", aggregate: "count", groupBy: "machineName", seriesBy: "priority" } },
        { kind: "Heatmap", title: "Alarm severity × machine", config: { doctype: "MachineLogger", xField: "machineName", yField: "severity", aggregate: "count" } },
        { kind: "Timeline", title: "Schedule due dates", config: { doctype: "MaintenanceSchedule", nameField: "scheduleName", startField: "nextDueDate", endField: "nextDueDate", groupField: "scheduleType", limit: 100 } },
        { kind: "Bar", title: "Actions by type", config: { doctype: "MaintenanceAction", aggregate: "count", groupBy: "actionType" } },
      ],
    },

    // 10. Sales (9)
    {
      name: "Sales (Manufacturing)",
      description: "Enquiry → quote → order → shipment throughput",
      cards: [
        { kind: "Bar", title: "Enquiries by channel", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "channel" } },
        { kind: "Funnel", title: "Enquiry funnel", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "status" } },
        { kind: "Heatmap", title: "Channel × status", config: { doctype: "SalesEnquiry", xField: "channel", yField: "status", aggregate: "count" } },
        { kind: "Line", title: "Enquiry trend", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "enquiryDate", dateField: "enquiryDate", period: "last30" } },
        { kind: "Pie", title: "Enquiries by source", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "source" } },
        { kind: "StackedBar", title: "Distributor × status", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "distributorId", seriesBy: "status" } },
        { kind: "KPICards", title: "Sales KPIs", config: { cards: [
          { label: "Open enquiries", doctype: "SalesEnquiry", aggregate: "count", filters: { status: "Open" } },
          { label: "Quoted", doctype: "SalesEnquiry", aggregate: "count", filters: { status: "Quoted" } },
          { label: "Won", doctype: "SalesEnquiry", aggregate: "count", filters: { status: "Won" } },
        ] } },
        { kind: "Column", title: "Enquiries per owner", config: { doctype: "SalesEnquiry", aggregate: "count", groupBy: "ownerUserId", limit: 15 } },
        { kind: "Timeline", title: "Follow-up timeline", config: { doctype: "SalesEnquiry", nameField: "enquiryNo", startField: "enquiryDate", endField: "followUpDate", groupField: "status", limit: 100 } },
      ],
    },

    // 11. Import/Export (9)
    {
      name: "Import / Export",
      description: "Cross-border trade using LC coverage + PO/PR flow",
      cards: [
        { kind: "Bar", title: "LCs by type", config: { doctype: "LetterOfCredit", aggregate: "count", groupBy: "lcType" } },
        { kind: "Bubble", title: "LC amount vs utilization", config: { doctype: "LetterOfCredit", xField: "amount", yField: "utilizationPct", sizeField: "amount", limit: 200 } },
        { kind: "Line", title: "LC new coverage", config: { doctype: "LetterOfCredit", aggregate: "sum", field: "amount", groupBy: "issueDate", dateField: "issueDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "LC status", config: { doctype: "LetterOfCredit", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Trade KPIs", config: { cards: [
          { label: "Active LCs", doctype: "LetterOfCredit", aggregate: "count", filters: { status: "Active" } },
          { label: "BGs Active", doctype: "BankGuarantee", aggregate: "count", filters: { status: "Active" } },
          { label: "Import POs", doctype: "PurchaseOrder", aggregate: "count" },
        ] } },
        { kind: "StackedBar", title: "LC type × status", config: { doctype: "LetterOfCredit", aggregate: "count", groupBy: "lcType", seriesBy: "status" } },
        { kind: "Bar", title: "BGs by bank", config: { doctype: "BankGuarantee", aggregate: "sum", field: "amount", groupBy: "bankName", limit: 15 } },
        { kind: "Timeline", title: "LC expiry timeline", config: { doctype: "LetterOfCredit", nameField: "lcNumber", startField: "issueDate", endField: "expiryDate", groupField: "status", limit: 100 } },
        { kind: "Column", title: "BG commission by bank", config: { doctype: "BankGuarantee", aggregate: "sum", field: "commissionAmount", groupBy: "bankName", limit: 15 } },
      ],
    },
  ];
}

export async function seedMfgAnalytics(
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
        data: { description: spec.description, ownerUserId, isShared: true, sortOrder: 700 + i },
      });
      dashId = existing.id;
    } else {
      const d = await prisma.dashboard.create({
        data: { tenantId, ownerUserId, name: spec.name, description: spec.description, isShared: true, sortOrder: 700 + i },
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
