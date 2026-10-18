import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Compact CRUD for the 10 CRM P2 entities. One router per doctype exported
// individually so the service index can mount them at distinct URLs.
//
// Pattern: same z.object per model, standard tenant-scoping via req.auth,
// perms(doctype) gating.

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

// Date coercion helper for schemas that need to accept ISO string OR Date
const isoDate = z.union([z.string().datetime(), z.date()]).transform((v) => (typeof v === "string" ? new Date(v) : v));
const isoDateOpt = z.union([z.string().datetime(), z.date(), z.null()]).transform((v) => (!v ? null : typeof v === "string" ? new Date(v) : v));

// ---------- Warranty ----------

export const warrantyRouter = crud(
  "Warranty",
  "warranty",
  z.object({
    warrantyType: z.enum(["Definition", "ClaimInward", "ClaimOutward", "Helpdesk"]),
    serialNo: z.string().optional().nullable(),
    itemId: z.string().optional().nullable(),
    customerId: z.string().optional().nullable(),
    supplierId: z.string().optional().nullable(),
    startDate: isoDateOpt.optional(),
    endDate: isoDateOpt.optional(),
    claimNo: z.string().optional().nullable(),
    claimDate: isoDateOpt.optional(),
    amount: z.coerce.number().optional().nullable(),
    status: z.enum(["Open", "InProgress", "Resolved", "Closed", "Rejected"]).default("Open"),
    resolution: z.string().optional().nullable(),
    reportedBy: z.string().optional().nullable(),
    assignedTo: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    attachmentUrl: z.string().optional().nullable(),
  }),
  { filterKeys: ["warrantyType", "status", "customerId", "supplierId"], listInclude: { item: true, customer: true, supplier: true } },
);

// ---------- PurchaseWarranty ----------

export const purchaseWarrantyRouter = crud(
  "PurchaseWarranty",
  "purchaseWarranty",
  z.object({
    supplierId: z.string().optional().nullable(),
    itemId: z.string().optional().nullable(),
    purchaseDate: isoDate,
    warrantyMonths: z.coerce.number().int().default(12),
    expiryDate: isoDateOpt.optional(),
    invoiceNo: z.string().optional().nullable(),
    amount: z.coerce.number().optional().nullable(),
    status: z.enum(["Active", "Expiring", "Expired", "Claimed"]).default("Active"),
  }),
  { filterKeys: ["supplierId", "itemId", "status"], listInclude: { item: true, supplier: true } },
);

// ---------- LocationCapture ----------

export const locationCaptureRouter = crud(
  "LocationCapture",
  "locationCapture",
  z.object({
    userId: z.string().min(1),
    employeeId: z.string().optional().nullable(),
    capturedAt: isoDate,
    latitude: z.coerce.number(),
    longitude: z.coerce.number(),
    accuracyM: z.coerce.number().optional().nullable(),
    address: z.string().optional().nullable(),
    purpose: z.string().optional().nullable(),
    refDoctype: z.string().optional().nullable(),
    refDocId: z.string().optional().nullable(),
  }),
  { filterKeys: ["userId", "employeeId", "purpose"], orderBy: { capturedAt: "desc" } },
);

// ---------- AutoDealer ----------

export const autoDealerRouter = crud(
  "AutoDealer",
  "autoDealer",
  z.object({
    dealerCode: z.string().min(1),
    dealerName: z.string().min(1),
    dealerType: z.string().optional().nullable(),
    region: z.string().optional().nullable(),
    territory: z.string().optional().nullable(),
    contactPerson: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    status: z.enum(["Active", "Inactive"]).default("Active"),
    registeredAt: isoDateOpt.optional(),
  }),
  { filterKeys: ["region", "territory", "status", "dealerType"], orderBy: { dealerName: "asc" } },
);

// ---------- CrmTarget ----------

export const crmTargetRouter = crud(
  "CrmTarget",
  "crmTarget",
  z.object({
    ownerUserId: z.string().optional().nullable(),
    employeeId: z.string().optional().nullable(),
    territoryId: z.string().optional().nullable(),
    itemGroupId: z.string().optional().nullable(),
    periodType: z.enum(["Monthly", "Quarterly", "Yearly"]),
    periodStart: isoDate,
    periodEnd: isoDate,
    targetQty: z.coerce.number().optional().nullable(),
    targetAmount: z.coerce.number().optional().nullable(),
  }),
  { filterKeys: ["ownerUserId", "employeeId", "periodType"], orderBy: { periodStart: "desc" } },
);

// ---------- CrmTargetActual ----------

export const crmTargetActualRouter = crud(
  "CrmTargetActual",
  "crmTargetActual",
  z.object({
    targetId: z.string().optional().nullable(),
    ownerUserId: z.string().optional().nullable(),
    employeeId: z.string().optional().nullable(),
    postingDate: isoDate,
    actualQty: z.coerce.number().default(0),
    actualAmount: z.coerce.number().default(0),
    sourceDoctype: z.string().optional().nullable(),
    sourceDocId: z.string().optional().nullable(),
  }),
  { filterKeys: ["ownerUserId", "employeeId", "targetId"], orderBy: { postingDate: "desc" } },
);

// ---------- WorkPlan ----------

export const workPlanRouter = crud(
  "WorkPlan",
  "workPlan",
  z.object({
    ownerUserId: z.string().min(1),
    employeeId: z.string().optional().nullable(),
    weekStartDate: isoDate,
    planTitle: z.string().min(1),
    summary: z.string().optional().nullable(),
    status: z.enum(["Draft", "Approved", "InProgress", "Completed"]).default("Draft"),
  }),
  { filterKeys: ["ownerUserId", "employeeId", "status"], orderBy: { weekStartDate: "desc" } },
);

// ---------- DailyWorksheet ----------

export const dailyWorksheetRouter = crud(
  "DailyWorksheet",
  "dailyWorksheet",
  z.object({
    ownerUserId: z.string().min(1),
    employeeId: z.string().optional().nullable(),
    postingDate: isoDate,
    visitCount: z.coerce.number().int().default(0),
    callsMade: z.coerce.number().int().default(0),
    quotesGiven: z.coerce.number().int().default(0),
    ordersBooked: z.coerce.number().int().default(0),
    amountBooked: z.coerce.number().default(0),
    distanceKm: z.coerce.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
  { filterKeys: ["ownerUserId", "employeeId"], orderBy: { postingDate: "desc" } },
);

// ---------- CrmProcess ----------

export const crmProcessRouter = crud(
  "CrmProcess",
  "crmProcess",
  z.object({
    processName: z.string().min(1),
    category: z.string().optional().nullable(),
    ownerUserId: z.string().optional().nullable(),
    currentStep: z.string().optional().nullable(),
    status: z.enum(["Active", "OnHold", "Completed", "Cancelled"]).default("Active"),
    slaTargetDate: isoDateOpt.optional(),
  }),
  { filterKeys: ["category", "status", "ownerUserId"], orderBy: { createdAt: "desc" } },
);

// ---------- ProjectPlanning ----------

export const projectPlanningRouter = crud(
  "ProjectPlanning",
  "projectPlanning",
  z.object({
    projectName: z.string().min(1),
    customerId: z.string().optional().nullable(),
    ownerUserId: z.string().optional().nullable(),
    startDate: isoDateOpt.optional(),
    targetDate: isoDateOpt.optional(),
    budgetAmount: z.coerce.number().optional().nullable(),
    currentStage: z.string().optional().nullable(),
    progressPct: z.coerce.number().min(0).max(100).default(0),
    status: z.enum(["Open", "OnHold", "Completed", "Cancelled"]).default("Open"),
  }),
  { filterKeys: ["customerId", "status", "currentStage"], listInclude: { customer: true } },
);
