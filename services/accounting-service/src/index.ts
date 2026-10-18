import { initOtel } from "@lumaara/service-auth";
initOtel("accounting-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("accounting-service");

import express from "express";
import { customerRouter } from "./routes/customers";
import { aiChatRouter } from "./routes/ai-chat";
import { aiManifestRouter, wellKnownMcpRouter } from "./routes/ai-manifest";
import { aiForecastRouter } from "./routes/ai-forecast";
import { supplierRouter } from "./routes/suppliers";
import { itemRouter } from "./routes/items";
import { salesInvoiceRouter } from "./routes/sales-invoices";
import { recurringInvoiceRouter } from "./routes/recurring-invoices";
import { purchaseInvoiceRouter } from "./routes/purchase-invoices";
import { purchaseOrderRouter } from "./routes/purchase-orders";
import { paymentEntryRouter } from "./routes/payment-entries";
import { ewayBillRouter } from "./routes/eway-bills";
import { companyRouter } from "./routes/companies";
import { intercompanyJournalRouter } from "./routes/intercompany-journals";
import { rfqRouter } from "./routes/request-for-quotations";
import { supplierQuotationRouter } from "./routes/supplier-quotations";
import { supplierScorecardRouter } from "./routes/supplier-scorecards";
import { vehicleRouter } from "./routes/vehicles";
import { itemAlternateRouter } from "./routes/item-alternates";
import { blanketOrderRouter } from "./routes/blanket-orders";
import { aiExtractRouter } from "./routes/ai-extract";
import { duplicateRouter } from "./routes/duplicates";
import { fxRevalRouter } from "./routes/fx-revaluations";
import { bulkEditRouter } from "./routes/bulk-edit";
import { accountRouter } from "./routes/accounts";
import { journalEntryRouter } from "./routes/journal-entries";
import { reportsRouter } from "./routes/reports";
import { currencyRouter } from "./routes/currencies";
import { taxTemplateRouter } from "./routes/tax-templates";
import { taxWithholdingCategoryRouter } from "./routes/tax-withholding-categories";
import { taxCollectionCategoryRouter } from "./routes/tax-collection-categories";
import { tdsChallanRouter } from "./routes/tds-challans";
import { priceListRouter, itemPriceRouter } from "./routes/price-lists";
import { itemUOMConversionRouter } from "./routes/item-uom-conversions";
import { addressRouter } from "./routes/addresses";
import { contactRouter } from "./routes/contacts";
import { customerGroupRouter } from "./routes/customer-groups";
import { territoryRouter } from "./routes/territories";
import { pricingRuleRouter } from "./routes/pricing-rules";
import { couponCodeRouter } from "./routes/coupon-codes";
import { loyaltyProgramRouter, loyaltyEntryRouter } from "./routes/loyalty";
import { salesPersonRouter } from "./routes/sales-persons";
import { paymentTermsTemplateRouter } from "./routes/payment-terms-templates";
import { subscriptionRouter } from "./routes/subscriptions";
import { partySearchRouter } from "./routes/party-search";
import { globalSearchRouter } from "./routes/global-search";
import { fiscalYearRouter } from "./routes/fiscal-years";
import { budgetRouter } from "./routes/budgets";
import { assetCategoryRouter } from "./routes/asset-categories";
import { assetRouter } from "./routes/assets";
import { assetMaintenanceLogRouter } from "./routes/asset-maintenance-logs";
import { bankReconciliationRouter } from "./routes/bank-reconciliation";
import { landedCostVoucherRouter } from "./routes/landed-cost-vouchers";
import { exchangeRateRouter } from "./routes/exchange-rates";
import { esignRouter, publicSignRouter } from "./routes/esign";
import { agentRouter } from "./routes/agents";
import { agentActionsRouter } from "./routes/agent-actions";
import { aiInsightsRouter } from "./routes/ai-insights";
import { aiInboxRouter } from "./routes/ai-inbox";
import { integrationHealthRouter } from "./routes/integration-health";
import { aiRagRouter } from "./routes/ai-rag";
import { printRouter } from "./routes/print";
import { reportsBuilderRouter } from "./routes/reports-builder";
import { dashboardRouter } from "./routes/dashboards";
import {
  costCenterRouter,
  bankGuaranteeRouter,
  letterOfCreditRouter,
} from "./routes/finance-masters";
import { posProfileRouter } from "./routes/pos-profiles";
import { posOpeningRouter } from "./routes/pos-opening";
import { posClosingRouter } from "./routes/pos-closing";
import { posInvoiceRouter } from "./routes/pos-invoices";
import { financeAnalyticsRouter } from "./routes/finance-analytics";
import { scheduledReportRouter } from "./routes/scheduled-reports";
import { analyticsRouter, analyticsPublicRouter } from "./routes/analytics-plus";
import { letterheadRouter } from "./routes/letterheads";
import { printFormatRouter } from "./routes/print-formats";
import { importRouter } from "./routes/imports";
import { exportRouter } from "./routes/exports";
import { bulkActionRouter } from "./routes/bulk-actions";
import { portalRouter } from "./routes/portal";
import { staffTicketRouter } from "./routes/staff-tickets";
import {
  integrationRouter,
  webhookSubscriptionRouter,
  webhookDeliveryRouter,
} from "./routes/integrations";
import { webhookReceiverRouter } from "./routes/webhook-receiver";
import {
  opsPublicRouter,
  opsAdminRouter,
  featureFlagRouter,
  backupRouter,
  errorLogRouter,
} from "./routes/ops";
import {
  auditRouter,
  dsrRouter,
  retentionRouter,
  gstRouter,
  archiveRouter,
} from "./routes/compliance";
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
  pdfLimiter,
  reportLimiter,
  mountBasicOps,
  apiLimiter,
  aiLimiter,
  aiTenantDailyLimiter,
  requestLogger,
  securityHeaders,
  validateEnv,
  workflowEndpoints,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4002" },
});
installCrashHandlers("accounting-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("accounting-service"));
app.use(apiLimiter);
app.use(express.json());
app.use(normalizeBody);
app.use(
  auditMiddleware({
    routeMap: {
      "share-links": "Dashboard",
      "analytics": "Dashboard",
      "customers": "Customer",
      "suppliers": "Supplier",
      "items": "Item",
      "sales-invoices": "SalesInvoice",
      "purchase-invoices": "PurchaseInvoice",
      "purchase-orders": "PurchaseOrder",
      "payment-entries": "PaymentEntry",
      "accounts": "Account",
      "journal-entries": "JournalEntry",
      "currencies": "Currency",
      "tax-templates": "TaxTemplate",
      "tax-withholding-categories": "TaxWithholdingCategory",
      "tax-collection-categories": "TaxCollectionCategory",
      "tds-challans": "TdsChallan",
      "price-lists": "PriceList",
      "item-prices": "PriceList",
      "addresses": "Address",
      "contacts": "Contact",
      "customer-groups": "CustomerGroup",
      "territories": "Territory",
      "pricing-rules": "PricingRule",
      "coupon-codes": "CouponCode",
      "loyalty-programs": "LoyaltyProgram",
      "loyalty-entries": "LoyaltyPointEntry",
      "sales-persons": "SalesPerson",
      "payment-terms-templates": "PaymentTermsTemplate",
      "subscriptions": "Subscription",
      "fiscal-years": "FiscalYear",
      "budgets": "Budget",
      "asset-categories": "AssetCategory",
      "assets": "Asset",
      "asset-maintenance-logs": "AssetMaintenanceLog",
      "dashboards": "Dashboard",
      "scheduled-reports": "ScheduledReport",
      "letterheads": "Letterhead",
      "print-formats": "PrintFormat",
      "imports": "ImportJob",
      "exports": "ExportPreset",
      "bulk-actions": "Report",
      "integrations": "TenantIntegration",
      "webhook-subscriptions": "WebhookSubscription",
      "webhook-deliveries": "WebhookSubscription",
      "feature-flags": "FeatureFlag",
      "backups": "BackupJob",
      "error-logs": "ErrorLog",
      "dsr": "DataSubjectRequest",
      "retention": "DataRetentionPolicy",
      "pos-profiles": "POSProfile",
      "pos-openings": "POSOpeningEntry",
      "pos-closings": "POSClosingEntry",
      "pos-invoices": "SalesInvoice",
      "eway-bills": "EWayBill",
      "landed-cost-vouchers": "LandedCostVoucher",
      "signatures": "SignatureEnvelope",
      "agents/tasks": "AgentTask",
      "agents/policies": "AgentPolicy",
      // Multi-company Phase 7 audit mappings. Every route under
      // /companies + /intercompany-journals now surfaces the correct
      // doctype in AuditLog. Note that /companies/user-access falls
      // under "Company" too — the middleware only reads the first
      // path segment; sub-actions (e.g. "user-access") flow into
      // AuditLog.method as "PUT-user-access" so operators can still
      // filter the log stream for access changes.
      "companies": "Company",
      "intercompany-journals": "IntercompanyJournalEntry",
      "request-for-quotations": "RequestForQuotation",
      "supplier-quotations": "SupplierQuotation",
      "supplier-scorecards": "SupplierScorecard",
      "vehicles": "Vehicle",
      "item-alternates": "ItemAlternate",
      "blanket-orders": "BlanketOrder",
      "ai": "AIExtractionJob",
      "duplicates": "DuplicateReview",
      "fx-revaluations": "FxRevaluationRun",
    },
  }),
);

// Mounts /health, /health/ready (DB probe), /metrics (Prometheus).
mountBasicOps(app, "accounting-service");

// ── Public OpenAPI 3.1 spec (Phase 1.7) ───────────────────────────
//
// Unauthenticated — third-party tooling (Postman, Swagger UI, codegen)
// needs to read the spec without a token. The spec describes *what* the
// API exposes; every operation still requires bearer auth to invoke.
//
// The spec is generated from the same MCP catalog the LLM router sees so
// one place-add-tool means docs update everywhere.
app.get("/openapi.json", (req, res) => {
  const serverUrl =
    process.env.PUBLIC_API_URL ??
    `${req.protocol}://${req.get("host") ?? "localhost:4002"}`;
  const version = process.env.APP_VERSION ?? "dev";
  const { buildOpenApiSpec } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@lumaara/db") as typeof import("@lumaara/db");
  res.json(buildOpenApiSpec({ serverUrl, version }));
});

// Every business route requires a valid JWT; tenantId comes off the claims.
app.use("/customers", requireAuth, customerRouter);
// AI endpoints: three gates in order —
//   requireAuth               ensures req.auth.{userId,tenantId} is set
//                             so the limiter key generators work.
//   aiLimiter                 30/min per user — bursts.
//   aiTenantDailyLimiter      1000/day per tenant — spend cap. One tenant
//                             with N users still can't collectively burn
//                             more than the daily budget.
// ai-manifest + well-known are discovery endpoints, intentionally not gated.
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiChatRouter);
app.use("/ai", aiManifestRouter);
// Unauthed MCP discovery doc — convention path, no tenant leak.
app.use("/.well-known", wellKnownMcpRouter);
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiForecastRouter);
app.use("/suppliers", requireAuth, supplierRouter);
app.use("/items", requireAuth, itemRouter);
app.use("/sales-invoices", requireAuth, salesInvoiceRouter);
app.use("/recurring-invoices", requireAuth, recurringInvoiceRouter);
app.use("/purchase-invoices", requireAuth, purchaseInvoiceRouter);
app.use("/purchase-orders", requireAuth, purchaseOrderRouter);
app.use("/payment-entries", requireAuth, paymentEntryRouter);
app.use("/accounts", requireAuth, accountRouter);
app.use("/journal-entries", requireAuth, journalEntryRouter);
app.use("/currencies", requireAuth, currencyRouter);
app.use("/tax-templates", requireAuth, taxTemplateRouter);
app.use("/tax-withholding-categories", requireAuth, taxWithholdingCategoryRouter);
app.use("/tax-collection-categories", requireAuth, taxCollectionCategoryRouter);
app.use("/tds-challans", requireAuth, tdsChallanRouter);
app.use("/price-lists", requireAuth, priceListRouter);
app.use("/item-prices", requireAuth, itemPriceRouter);
app.use("/item-uom-conversions", requireAuth, itemUOMConversionRouter);
app.use("/addresses", requireAuth, addressRouter);
app.use("/contacts", requireAuth, contactRouter);
app.use("/customer-groups", requireAuth, customerGroupRouter);
app.use("/territories", requireAuth, territoryRouter);
app.use("/pricing-rules", requireAuth, pricingRuleRouter);
app.use("/coupon-codes", requireAuth, couponCodeRouter);
app.use("/loyalty-programs", requireAuth, loyaltyProgramRouter);
app.use("/loyalty-entries", requireAuth, loyaltyEntryRouter);
app.use("/sales-persons", requireAuth, salesPersonRouter);
app.use("/payment-terms-templates", requireAuth, paymentTermsTemplateRouter);
app.use("/eway-bills", requireAuth, ewayBillRouter);
app.use("/companies", requireAuth, companyRouter);
app.use("/intercompany-journals", requireAuth, intercompanyJournalRouter);
app.use("/request-for-quotations", requireAuth, rfqRouter);
app.use("/supplier-quotations", requireAuth, supplierQuotationRouter);
app.use("/supplier-scorecards", requireAuth, supplierScorecardRouter);
app.use("/vehicles", requireAuth, vehicleRouter);
app.use("/item-alternates", requireAuth, itemAlternateRouter);
app.use("/blanket-orders", requireAuth, blanketOrderRouter);
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiExtractRouter);
app.use("/duplicates", requireAuth, duplicateRouter);
app.use("/fx-revaluations", requireAuth, fxRevalRouter);
app.use("/bulk-edit", requireAuth, bulkEditRouter);
app.use("/subscriptions", requireAuth, subscriptionRouter);
app.use("/party-search", requireAuth, partySearchRouter);
app.use("/global-search", requireAuth, globalSearchRouter);
app.use("/fiscal-years", requireAuth, fiscalYearRouter);
app.use("/budgets", requireAuth, budgetRouter);
app.use("/asset-categories", requireAuth, assetCategoryRouter);
app.use("/assets", requireAuth, assetRouter);
app.use("/asset-maintenance-logs", requireAuth, assetMaintenanceLogRouter);
app.use("/bank-reconciliation", requireAuth, bankReconciliationRouter);
app.use("/landed-cost-vouchers", requireAuth, landedCostVoucherRouter);
app.use("/exchange-rates", requireAuth, exchangeRateRouter);
app.use("/signatures", requireAuth, esignRouter);
app.use("/agents", requireAuth, agentRouter);
app.use("/agents", requireAuth, agentActionsRouter);
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiInsightsRouter);
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiInboxRouter);
app.use("/integrations", requireAuth, integrationHealthRouter);
app.use("/ai", requireAuth, aiLimiter, aiTenantDailyLimiter, aiRagRouter);
app.use("/public/sign", publicSignRouter);
app.use("/print", requireAuth, pdfLimiter, printRouter);
app.use("/custom-fields-for", customFieldsReadRouter());
app.use("/reports-builder", requireAuth, reportLimiter, reportsBuilderRouter);
app.use("/reports", requireAuth, reportsRouter);
app.use("/dashboards", requireAuth, dashboardRouter);
app.use("/cost-centers", requireAuth, costCenterRouter);
app.use("/bank-guarantees", requireAuth, bankGuaranteeRouter);
app.use("/letters-of-credit", requireAuth, letterOfCreditRouter);
// POS
app.use("/pos-profiles", requireAuth, posProfileRouter);
app.use("/pos-openings", requireAuth, posOpeningRouter);
app.use("/pos-closings", requireAuth, posClosingRouter);
app.use("/pos-invoices", requireAuth, posInvoiceRouter);
app.use("/finance-analytics", requireAuth, financeAnalyticsRouter);
app.use("/scheduled-reports", requireAuth, scheduledReportRouter);
// Zoho-Analytics-Plus: forecasting, anomaly detection, share-link management.
app.use("/analytics", requireAuth, analyticsRouter);
// Public — no auth. Token-guarded read-only view of a shared dashboard.
app.use("/public/analytics", analyticsPublicRouter);
app.use("/letterheads", requireAuth, letterheadRouter);
app.use("/print-formats", requireAuth, printFormatRouter);
app.use("/imports", requireAuth, importRouter);
app.use("/exports", requireAuth, exportRouter);
app.use("/bulk-actions", requireAuth, bulkActionRouter);
// Portal (K4-K9). No requireAuth here — portalRouter uses requirePortalAuth
// on the router itself so staff JWTs are rejected.
app.use("/portal", portalRouter);
// K7: staff-side view of portal tickets. Uses standard staff auth + perms.
app.use("/staff-tickets", requireAuth, staffTicketRouter);

// Phase L: Integrations. Admin CRUD requires staff auth; incoming webhooks
// are public (path is guarded by the integration id + signature).
app.use("/integrations", requireAuth, integrationRouter);
app.use("/webhook-subscriptions", requireAuth, webhookSubscriptionRouter);
app.use("/webhook-deliveries", requireAuth, webhookDeliveryRouter);
app.use("/webhooks", webhookReceiverRouter);
app.use("/workflow-actions", workflowEndpoints());

// Phase M: Ops
app.use(opsPublicRouter);
app.use(requireAuth, opsAdminRouter);
app.use("/feature-flags", requireAuth, featureFlagRouter);
app.use("/backups", requireAuth, backupRouter);
app.use("/error-logs", requireAuth, errorLogRouter);

// Phase O: Compliance
app.use("/audit-log", requireAuth, auditRouter);
app.use("/dsr", requireAuth, dsrRouter);
app.use("/retention", requireAuth, retentionRouter);
app.use("/gst", requireAuth, gstRouter);
app.use("/anonymization-archives", requireAuth, archiveRouter);

app.use(errorCapture("accounting-service"));
app.use(jsonErrorHandler("accounting-service"));

const port = Number(process.env.PORT) || 4002;
const server = app.listen(port, () => getLogger("accounting-service").info("service listening", { port }));
installGracefulShutdown(server, "accounting-service");
