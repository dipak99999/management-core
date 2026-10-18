import { initOtel } from "@lumaara/service-auth";
initOtel("stock-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("stock-service");

import express from "express";
import { warehouseRouter } from "./routes/warehouses";
import { stockEntryRouter } from "./routes/stock-entries";
import { stockReportsRouter } from "./routes/reports";
import { itemsReadRouter } from "./routes/items-read";
import { customersReadRouter, suppliersReadRouter } from "./routes/parties-read";
import { deliveryNoteRouter } from "./routes/delivery-notes";
import { pickListRouter } from "./routes/pick-lists";
import { deliveryTripRouter } from "./routes/delivery-trips";
import { purchaseReceiptRouter } from "./routes/purchase-receipts";
import { bomRouter } from "./routes/boms";
import { workOrderRouter } from "./routes/work-orders";
import { workstationRouter } from "./routes/workstations";
import { jobCardRouter } from "./routes/job-cards";
import { materialRequestRouter } from "./routes/material-requests";
import { stockReconciliationRouter } from "./routes/stock-reconciliations";
import { repostItemValuationRouter } from "./routes/repost-item-valuations";
import { serialNoRouter } from "./routes/serial-numbers";
import { batchRouter } from "./routes/batches";
import {
  qualityInspectionTemplateRouter,
  qualityInspectionRouter,
} from "./routes/quality-inspections";
import { nonConformanceRouter } from "./routes/non-conformances";
import { productionPlanRouter } from "./routes/production-plans";
import { itemReorderRuleRouter } from "./routes/item-reorder-rules";
import {
  materialIssueRouter,
  materialTransferRouter,
  materialReturnRouter,
  weighmentRouter,
  inwardOutwardNoteRouter,
  salesEnquiryRouter,
  mrpRunRouter,
  itemSitePlanningRouter,
  routingMasterRouter,
  maintenanceRequestRouter,
  maintenanceScheduleRouter,
  machineLoggerRouter,
  maintenanceActionRouter,
} from "./routes/mfg-p2-masters";
import { mfgAnalyticsRouter } from "./routes/mfg-analytics";
import { printRouter } from "./routes/print";
import { labelRouter } from "./routes/labels";
import { shipmentRouter } from "./routes/shipments";
import {
  roomRouter,
  roomBookingRouter,
  landUnitRouter,
  cropCycleRouter,
} from "./routes/verticals";
import { requireAuth } from "./middleware/require-auth";
import {
  auditMiddleware,
  corsMiddleware,
  customFieldsReadRouter,
  errorCapture,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  pdfLimiter,
  apiLimiter,
  requestLogger,
  securityHeaders,
  validateEnv,
  workflowEndpoints,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4003" },
});
installCrashHandlers("stock-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("stock-service"));
app.use(apiLimiter);
app.use(express.json());
app.use(normalizeBody);
app.use(
  auditMiddleware({
    routeMap: {
      "warehouses": "Warehouse",
      "shipments": "Shipment",
      "rooms": "Room",
      "room-bookings": "RoomBooking",
      "land-units": "LandUnit",
      "crop-cycles": "CropCycle",
      "stock-entries": "StockEntry",
      "delivery-notes": "DeliveryNote",
      "purchase-receipts": "PurchaseReceipt",
      "boms": "BOM",
      "work-orders": "WorkOrder",
      "workstations": "Workstation",
      "job-cards": "JobCard",
      "material-requests": "MaterialRequest",
      "stock-reconciliations": "StockReconciliation",
      "serial-numbers": "SerialNo",
      "batches": "Batch",
      "quality-inspection-templates": "QualityInspectionTemplate",
      "quality-inspections": "QualityInspection",
      "non-conformances": "NonConformance",
      "production-plans": "ProductionPlan",
      "item-reorder-rules": "ItemReorderRule",
      "pick-lists": "PickList",
      "delivery-trips": "DeliveryTrip",
    },
  }),
);

mountBasicOps(app, "stock-service");

app.use("/warehouses", requireAuth, warehouseRouter);
app.use("/stock-entries", requireAuth, stockEntryRouter);
app.use("/delivery-notes", requireAuth, deliveryNoteRouter);
app.use("/pick-lists", requireAuth, pickListRouter);
app.use("/delivery-trips", requireAuth, deliveryTripRouter);
app.use("/purchase-receipts", requireAuth, purchaseReceiptRouter);
app.use("/boms", requireAuth, bomRouter);
app.use("/work-orders", requireAuth, workOrderRouter);
app.use("/workstations", requireAuth, workstationRouter);
app.use("/job-cards", requireAuth, jobCardRouter);
app.use("/material-requests", requireAuth, materialRequestRouter);
app.use("/stock-reconciliations", requireAuth, stockReconciliationRouter);
app.use("/repost-item-valuations", requireAuth, repostItemValuationRouter);
app.use("/serial-numbers", requireAuth, serialNoRouter);
app.use("/batches", requireAuth, batchRouter);
app.use("/quality-inspection-templates", requireAuth, qualityInspectionTemplateRouter);
app.use("/quality-inspections", requireAuth, qualityInspectionRouter);
app.use("/non-conformances", requireAuth, nonConformanceRouter);
app.use("/production-plans", requireAuth, productionPlanRouter);
app.use("/item-reorder-rules", requireAuth, itemReorderRuleRouter);
app.use("/print", requireAuth, pdfLimiter, printRouter);
app.use("/labels", requireAuth, labelRouter);
app.use("/shipments", requireAuth, shipmentRouter);
// Hospitality vertical.
app.use("/rooms",         requireAuth, roomRouter);
app.use("/room-bookings", requireAuth, roomBookingRouter);
// Agriculture vertical.
app.use("/land-units",    requireAuth, landUnitRouter);
app.use("/crop-cycles",   requireAuth, cropCycleRouter);
app.use("/reports", requireAuth, stockReportsRouter);
// Read-through masters so stock-web renders dropdowns without cross-service calls.
// Writes still go through accounting-service (which owns Item/Customer/Supplier).
app.use("/items", requireAuth, itemsReadRouter);
app.use("/customers", requireAuth, customersReadRouter);
app.use("/suppliers", requireAuth, suppliersReadRouter);
app.use("/custom-fields-for", customFieldsReadRouter());
app.use("/workflow-actions", workflowEndpoints());

// P5 Manufacturing masters + analytics
app.use("/material-issues",      requireAuth, materialIssueRouter);
app.use("/material-transfers",   requireAuth, materialTransferRouter);
app.use("/material-returns",     requireAuth, materialReturnRouter);
app.use("/weighments",           requireAuth, weighmentRouter);
app.use("/inward-outward-notes", requireAuth, inwardOutwardNoteRouter);
app.use("/sales-enquiries",      requireAuth, salesEnquiryRouter);
app.use("/mrp-runs",             requireAuth, mrpRunRouter);
app.use("/item-site-plannings",  requireAuth, itemSitePlanningRouter);
app.use("/routing-masters",      requireAuth, routingMasterRouter);
app.use("/maintenance-requests", requireAuth, maintenanceRequestRouter);
app.use("/maintenance-schedules",requireAuth, maintenanceScheduleRouter);
app.use("/machine-loggers",      requireAuth, machineLoggerRouter);
app.use("/maintenance-actions",  requireAuth, maintenanceActionRouter);
app.use("/mfg-analytics",        requireAuth, mfgAnalyticsRouter);

app.use(errorCapture("stock-service"));
app.use(jsonErrorHandler("stock-service"));

const port = Number(process.env.PORT) || 4003;
const server = app.listen(port, () => getLogger("stock-service").info("service listening", { port }));
installGracefulShutdown(server, "stock-service");
