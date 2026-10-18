import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Compact CRUD for the 12 Manufacturing P2 entities. Parent-only endpoints
// for the ones with child items (issue/transfer/return + sales enquiry) —
// items are managed inline via the parent's create/update body.

function crud<TSchema extends z.ZodType>(
  doctype: string,
  delegate: string,
  schema: TSchema,
  options: {
    listInclude?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
    filterKeys?: string[];
  } = {},
) {
  const router = Router();
  const p = perms(doctype);
  const del = (): { findMany: Function; create: Function; findFirst: Function; update: Function; delete: Function } =>
    (prisma as unknown as Record<string, any>)[delegate];

  router.get("/", p.read, async (req, res) => {
    try {
      const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      for (const k of options.filterKeys ?? []) {
        if (typeof req.query[k] === "string") where[k] = req.query[k];
      }
      const rows = await del().findMany({
        where,
        orderBy: options.orderBy ?? { createdAt: "desc" },
        include: options.listInclude,
        take: 500,
      });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  });

  router.post("/", p.create, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const row = await del().create({
        data: { tenantId: req.auth!.tenantId, ...(parsed.data as object) },
      });
      res.status(201).json(row);
    } catch (e) {
      res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
    }
  });

  router.put("/:id", p.write, async (req, res) => {
    const parsed = (schema as unknown as { partial: () => z.ZodType }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await del().findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const row = await del().update({ where: { id: existing.id }, data: parsed.data });
    res.json(row);
  });

  router.delete("/:id", p.delete, async (req, res) => {
    const existing = await del().findFirst({
      where: { id: req.params.id, tenantId: req.auth!.tenantId },
    });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await del().delete({ where: { id: existing.id } });
    res.status(204).send();
  });

  return router;
}

const isoDate = z.union([z.string().datetime(), z.date()]).transform((v) => (typeof v === "string" ? new Date(v) : v));
const isoDateOpt = z.union([z.string().datetime(), z.date(), z.null()]).transform((v) => (!v ? null : typeof v === "string" ? new Date(v) : v));

// ---------- MaterialIssue (parent only; items come via .items on body) ----------

export const materialIssueRouter = crud(
  "MaterialIssue",
  "materialIssue",
  z.object({
    issueNo: z.string().min(1),
    postingDate: isoDate,
    sourceWarehouseId: z.string().optional().nullable(),
    purpose: z.string().optional().nullable(),
    requestedBy: z.string().optional().nullable(),
    issuedBy: z.string().optional().nullable(),
    status: z.enum(["Draft", "Submitted", "Cancelled"]).default("Draft"),
    stockEntryId: z.string().optional().nullable(),
    totalQty: z.coerce.number().default(0),
    totalValue: z.coerce.number().default(0),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["status", "purpose", "sourceWarehouseId"], orderBy: { postingDate: "desc" }, listInclude: { sourceWarehouse: true, items: { include: { item: true } } } },
);

// ---------- MaterialTransfer ----------

export const materialTransferRouter = crud(
  "MaterialTransfer",
  "materialTransfer",
  z.object({
    transferNo: z.string().min(1),
    postingDate: isoDate,
    sourceWarehouseId: z.string().optional().nullable(),
    targetWarehouseId: z.string().optional().nullable(),
    requestedBy: z.string().optional().nullable(),
    transferredBy: z.string().optional().nullable(),
    status: z.enum(["Draft", "InTransit", "Received", "Cancelled"]).default("Draft"),
    stockEntryId: z.string().optional().nullable(),
    totalQty: z.coerce.number().default(0),
    totalValue: z.coerce.number().default(0),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["status", "sourceWarehouseId", "targetWarehouseId"], orderBy: { postingDate: "desc" }, listInclude: { sourceWarehouse: true, targetWarehouse: true, items: { include: { item: true } } } },
);

// ---------- MaterialReturn ----------

export const materialReturnRouter = crud(
  "MaterialReturn",
  "materialReturn",
  z.object({
    returnNo: z.string().min(1),
    postingDate: isoDate,
    returnType: z.enum(["ToSupplier", "ToWarehouse"]),
    againstDoctype: z.string().optional().nullable(),
    againstDocId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    warehouseId: z.string().optional().nullable(),
    reason: z.string().optional().nullable(),
    status: z.enum(["Draft", "Submitted", "Cancelled"]).default("Draft"),
    stockEntryId: z.string().optional().nullable(),
    totalQty: z.coerce.number().default(0),
    totalValue: z.coerce.number().default(0),
  }),
  { filterKeys: ["returnType", "status", "supplierId"], orderBy: { postingDate: "desc" }, listInclude: { supplier: true, warehouse: true, items: { include: { item: true } } } },
);

// ---------- Weighment ----------

export const weighmentRouter = crud(
  "Weighment",
  "weighment",
  z.object({
    weighmentNo: z.string().min(1),
    postingDate: isoDate,
    vehicleNo: z.string().min(1),
    driverName: z.string().optional().nullable(),
    transporter: z.string().optional().nullable(),
    itemId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    customerId: z.string().optional().nullable(),
    weighmentType: z.enum(["Inward", "Outward"]),
    grossWeight: z.coerce.number(),
    tareWeight: z.coerce.number(),
    netWeight: z.coerce.number(),
    moisturePct: z.coerce.number().optional().nullable(),
    quality: z.string().optional().nullable(),
    rate: z.coerce.number().optional().nullable(),
    amount: z.coerce.number().optional().nullable(),
    status: z.enum(["Weighed", "Verified", "Billed", "Cancelled"]).default("Weighed"),
  }),
  { filterKeys: ["weighmentType", "status", "vehicleNo"], orderBy: { postingDate: "desc" }, listInclude: { item: true, supplier: true, customer: true } },
);

// ---------- InwardOutwardNote ----------

export const inwardOutwardNoteRouter = crud(
  "InwardOutwardNote",
  "inwardOutwardNote",
  z.object({
    noteNo: z.string().min(1),
    postingDate: isoDate,
    noteType: z.enum(["Inward", "Outward"]),
    vehicleNo: z.string().optional().nullable(),
    weighmentId: z.string().optional().nullable(),
    refDoctype: z.string().optional().nullable(),
    refDocId: z.string().optional().nullable(),
    driverName: z.string().optional().nullable(),
    purpose: z.string().optional().nullable(),
    gatePassNo: z.string().optional().nullable(),
    status: z.enum(["Open", "Closed", "Cancelled"]).default("Open"),
  }),
  { filterKeys: ["noteType", "status"], orderBy: { postingDate: "desc" }, listInclude: { weighment: true } },
);

// ---------- SalesEnquiry ----------

export const salesEnquiryRouter = crud(
  "SalesEnquiry",
  "salesEnquiry",
  z.object({
    enquiryNo: z.string().min(1),
    enquiryDate: isoDate,
    customerId: z.string().optional().nullable(),
    leadId: z.string().optional().nullable(),
    distributorId: z.string().optional().nullable(),
    channel: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    ownerUserId: z.string().optional().nullable(),
    itemDescription: z.string().optional().nullable(),
    totalQty: z.coerce.number().optional().nullable(),
    status: z.enum(["Open", "Quoted", "Won", "Lost", "Closed"]).default("Open"),
    followUpDate: isoDateOpt.optional(),
    closingReason: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["status", "channel", "customerId", "distributorId"], orderBy: { enquiryDate: "desc" }, listInclude: { customer: true, lead: true, distributor: true, items: true } },
);

// ---------- MrpRun ----------

export const mrpRunRouter = crud(
  "MrpRun",
  "mrpRun",
  z.object({
    runNo: z.string().min(1),
    runDate: isoDate,
    horizonDays: z.coerce.number().int().default(30),
    scope: z.string().optional().nullable(),
    siteFilter: z.string().optional().nullable(),
    status: z.enum(["Draft", "Running", "Completed", "Failed"]).default("Draft"),
    triggeredBy: z.string().optional().nullable(),
    suggestionsCount: z.coerce.number().int().default(0),
    errorMessage: z.string().optional().nullable(),
  }),
  { filterKeys: ["status"], orderBy: { runDate: "desc" }, listInclude: { suggestions: { include: { item: true } } } },
);

// ---------- ItemSitePlanning ----------

export const itemSitePlanningRouter = crud(
  "ItemSitePlanning",
  "itemSitePlanning",
  z.object({
    itemId: z.string().min(1),
    warehouseId: z.string().min(1),
    reorderLevel: z.coerce.number().default(0),
    reorderQty: z.coerce.number().default(0),
    maxLevel: z.coerce.number().optional().nullable(),
    safetyStock: z.coerce.number().optional().nullable(),
    leadTimeDays: z.coerce.number().int().optional().nullable(),
    supplierId: z.string().optional().nullable(),
  }),
  { filterKeys: ["itemId", "warehouseId", "supplierId"], listInclude: { item: true, warehouse: true, supplier: true } },
);

// ---------- RoutingMaster ----------

export const routingMasterRouter = crud(
  "RoutingMaster",
  "routingMaster",
  z.object({
    routingName: z.string().min(1),
    itemId: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    isActive: z.boolean().default(true),
  }),
  { filterKeys: ["itemId", "isActive"], listInclude: { item: true, operations: { include: { workstation: true } } } },
);

// ---------- MaintenanceRequest ----------

export const maintenanceRequestRouter = crud(
  "MaintenanceRequest",
  "maintenanceRequest",
  z.object({
    requestNo: z.string().min(1),
    requestDate: isoDate,
    machineName: z.string().min(1),
    workstationId: z.string().optional().nullable(),
    requesterName: z.string().optional().nullable(),
    priority: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
    requestType: z.enum(["Breakdown", "Preventive", "Predictive", "Improvement"]),
    description: z.string().min(1),
    status: z.enum(["Open", "Acknowledged", "InProgress", "Completed", "Cancelled"]).default("Open"),
    assignedTo: z.string().optional().nullable(),
    completedAt: isoDateOpt.optional(),
  }),
  { filterKeys: ["priority", "status", "requestType", "workstationId"], orderBy: { requestDate: "desc" }, listInclude: { workstation: true, actions: true } },
);

// ---------- MaintenanceSchedule ----------

export const maintenanceScheduleRouter = crud(
  "MaintenanceSchedule",
  "maintenanceSchedule",
  z.object({
    scheduleName: z.string().min(1),
    workstationId: z.string().optional().nullable(),
    machineName: z.string().optional().nullable(),
    intervalDays: z.coerce.number().int().default(30),
    nextDueDate: isoDate,
    lastDoneDate: isoDateOpt.optional(),
    scheduleType: z.enum(["Preventive", "Calibration", "Inspection"]).default("Preventive"),
    status: z.enum(["Active", "Paused", "Discontinued"]).default("Active"),
  }),
  { filterKeys: ["scheduleType", "status", "workstationId"], orderBy: { nextDueDate: "asc" }, listInclude: { workstation: true } },
);

// ---------- MachineLogger ----------

export const machineLoggerRouter = crud(
  "MachineLogger",
  "machineLogger",
  z.object({
    workstationId: z.string().optional().nullable(),
    machineName: z.string().min(1),
    loggedAt: isoDate,
    loggedBy: z.string().optional().nullable(),
    eventType: z.enum(["Startup", "Shutdown", "Alarm", "ProductionRate", "Maintenance", "Idle"]),
    parameter: z.string().optional().nullable(),
    value: z.coerce.number().optional().nullable(),
    unit: z.string().optional().nullable(),
    isAlarm: z.boolean().default(false),
    severity: z.enum(["Info", "Warning", "Critical"]).optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["workstationId", "eventType", "isAlarm", "severity"], orderBy: { loggedAt: "desc" }, listInclude: { workstation: true } },
);

// ---------- MaintenanceAction ----------

export const maintenanceActionRouter = crud(
  "MaintenanceAction",
  "maintenanceAction",
  z.object({
    requestId: z.string().optional().nullable(),
    actionDate: isoDate,
    actionType: z.enum(["Inspect", "Replace", "Repair", "Adjust", "Lubricate"]),
    performedBy: z.string().optional().nullable(),
    timeSpentMins: z.coerce.number().int().optional().nullable(),
    partsUsed: z.string().optional().nullable(),
    costAmount: z.coerce.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["requestId", "actionType", "performedBy"], orderBy: { actionDate: "desc" }, listInclude: { request: true } },
);
