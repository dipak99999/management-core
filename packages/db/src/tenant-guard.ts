import type { PrismaClient } from "@prisma/client";

// Cross-tenant data-leak guard. Attaches to the PrismaClient via $extends
// and refuses queries against tenant-scoped models that don't include
// `tenantId` in their `where` clause.
//
// The threat model: a route file forgets `tenantId` in a WHERE and returns
// every tenant's rows. Every existing route has been audited by hand and is
// correct today; this extension prevents regression on future routes.
//
// Guarded ops (return sets): findMany, findFirst, updateMany, deleteMany,
// count, aggregate, groupBy.
// Not guarded (single-row by unique key): findUnique, update, delete —
// the leak surface requires guessing an exact cuid, which is much smaller
// than a set-query miss. Routes that call these still use the
// `findFirst({where: {id, tenantId}})` pattern in this codebase.
//
// Env:
//   TENANT_GUARD_MODE=enforce   DEFAULT when NODE_ENV=production. Throws on
//                               any tenant-scoped set-query missing `tenantId`
//                               in `where` — a missing tenantId is a data-leak
//                               bug and must fail loud.
//   TENANT_GUARD_MODE=warn      DEFAULT when NODE_ENV != production. Logs to
//                               stderr on violation, does not throw. Also
//                               available as an opt-in soak window in prod for
//                               a fresh service's first rollout.
//   TENANT_GUARD_MODE=off       Bypass entirely. Only for one-off admin scripts.
//
// The middleware logs its selected mode once at attach time so operators
// can grep for `[tenant-guard] attached mode=` to confirm what's actually
// running — no silent surprise about warn-vs-enforce.

// Tenant-scoped model names — every model in schema.prisma that has a
// `tenantId` column. This list is CHECKED IN CI against the schema; drift
// fails the build so the guard can't silently miss a new model.
//
// To regenerate:
//
//   pnpm --filter @lumaara/db exec tsx scripts/gen-tenant-models.ts
//
// Or hand-rebuild:
//
//   awk '/^model / {m=$2} /^  tenantId / {print "  \"" m "\","}' \
//     packages/db/prisma/schema.prisma | sort -u
export const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "AIExtractionJob",
  "AITicketSuggestion",
  "Account",
  "Address",
  "AdhocPaymentRecovery",
  "AgentPolicy",
  "AgentStep",
  "AgentTask",
  "AgileWorkspace",
  "AiInboxPreference",
  "AiInboxTenantConfig",
  "AiInsightInbox",
  "AnalyticsShareLink",
  "AnonymizationArchive",
  "ApiToken",
  "Appraisal",
  "AppraisalTemplate",
  "ApproverHierarchy",
  "Assessment",
  "AssessmentResult",
  "Asset",
  "AssetCategory",
  "Attachment",
  "Attendance",
  "AttendanceRegularization",
  "AttributionTouchpoint",
  "AuditLog",
  "AutoDealer",
  "AvailabilityWindow",
  "BOM",
  "BackupJob",
  "BackupVerification",
  "BankGuarantee",
  "BankStatement",
  "BankTransaction",
  "Batch",
  "BillingEvent",
  "BillingInvoice",
  "Bin",
  "BlanketOrder",
  "BlogPost",
  "Bonus",
  "BookedMeeting",
  "Branch",
  "BrandKit",
  "Broadcast",
  "Budget",
  "BundleComponent",
  "CTC",
  "Campaign",
  "CampaignRecipient",
  "CampaignVariant",
  "CliqChannel",
  "CliqMessage",
  "Comment",
  "Company",
  "CompanyAccommodation",
  "ConsentRecord",
  "Contact",
  "ContactList",
  "CostCenter",
  "CouponCode",
  "Course",
  "CrmActivity",
  "CrmProcess",
  "CrmTarget",
  "CrmTargetActual",
  "CropActivity",
  "CropCycle",
  "Currency",
  "CustomField",
  "Customer",
  "CustomerGroup",
  "DailyWorksheet",
  "Dashboard",
  "DashboardBookmark",
  "DataRetentionPolicy",
  "DataSubjectRequest",
  "DeferredRevenueSchedule",
  "DeliveryNote",
  "DeliveryTrip",
  "DeskAssignmentRule",
  "DeskCannedResponse",
  "DeskSlaPolicy",
  "DeskTicket",
  "DigestSchedule",
  "DocSubscription",
  "Donation",
  "Donor",
  "DuplicateMerge",
  "DuplicateReview",
  "ESICDetail",
  "ETDSDetail",
  "EWayBill",
  "EditorialNote",
  "EmailMessage",
  "EmailSequence",
  "EmailTemplate",
  "Embedding",
  "Employee",
  "EmployeeAdvance",
  "EmployeeCTC",
  "EmployeeCategory",
  "EmployeeCertification",
  "EmployeeCheckin",
  "EmployeeChecklist",
  "EmployeeChecklistTemplate",
  "EmployeeGrade",
  "EmployeeOnboarding",
  "EmployeeSeparation",
  "EmployeeSkill",
  "EmploymentType",
  "EntityInsight",
  "ErrorLog",
  "ExchangeRate",
  "ExpenseClaim",
  "ExpenseClaimType",
  "ExportPreset",
  "FeatureFlag",
  "FeePosting",
  "FeeSchedule",
  "FinalSettlement",
  "FiscalYear",
  "Form12BB",
  "Form16",
  "FxRevaluationRun",
  "GLEntry",
  "Grant",
  "HolidayList",
  "HouseRentDetail",
  "IdempotencyKey",
  "ImportJob",
  "IntegrationEvent",
  "IntercompanyJournalEntry",
  "InvoicePaymentSchedule",
  "InwardOutwardNote",
  "Issue",
  "Item",
  "ItemAlternate",
  "ItemPrice",
  "ItemReorderRule",
  "ItemSitePlanning",
  "ItemUOMConversion",
  "JobApplicant",
  "JobCard",
  "JobOpening",
  "JournalEntry",
  "JourneyEnrollment",
  "KBArticle",
  "KBCategory",
  "LWFDetail",
  "LandUnit",
  "LandedCostVoucher",
  "LandingPage",
  "Lead",
  "LeadScoreRule",
  "LearnCertificate",
  "LearnCourse",
  "LearnEnrollment",
  "LeaveAllocation",
  "LeaveApplication",
  "LeaveEncashment",
  "LeaveLedgerEntry",
  "LeavePolicy",
  "LeaveType",
  "LetterOfCredit",
  "Letterhead",
  "ListView",
  "Loan",
  "LoanType",
  "LocationCapture",
  "LoyaltyPointEntry",
  "LoyaltyProgram",
  "MachineLogger",
  "MaintenanceAction",
  "MaintenanceRequest",
  "MaintenanceSchedule",
  "MarketingApproval",
  "MarketingJourney",
  "MaterialIssue",
  "MaterialRequest",
  "MaterialReturn",
  "MaterialTransfer",
  "MediaAsset",
  "MeetingType",
  "Membership",
  "Milestone",
  "MrpRun",
  "NamingSeriesCounter",
  "NonConformance",
  "Note",
  "Notebook",
  "Notification",
  "NotificationPreference",
  "OAuthClient",
  "Opportunity",
  "OutsidePayrollDetail",
  "OvertimeRequest",
  "PFDetail",
  "POSClosingEntry",
  "POSOpeningEntry",
  "POSProfile",
  "Patient",
  "PatientAppointment",
  "PatientEncounter",
  "PayCode",
  "PayableDays",
  "PaymentEntry",
  "PaymentReminder",
  "PaymentTermsTemplate",
  "PayrollEntry",
  "PickList",
  "PipelineBlueprint",
  "PortalInvite",
  "PortalTicket",
  "PortalUser",
  "Prescription",
  "PreviousEmployerDetail",
  "PriceList",
  "PricingRule",
  "PrintFormat",
  "ProductionPlan",
  "ProfessionalTaxDetail",
  "Program",
  "Project",
  "ProjectPlanning",
  "ProjectTemplate",
  "PurchaseInvoice",
  "PurchaseOrder",
  "PurchaseReceipt",
  "PurchaseWarranty",
  "QualityInspection",
  "QualityInspectionTemplate",
  "Quotation",
  "RecurringInvoice",
  "ReportBookmark",
  "RepostItemValuation",
  "RequestForQuotation",
  "Role",
  "RolePermission",
  "Room",
  "RoomBooking",
  "RoutingMaster",
  "RunningTimer",
  "SalaryJV",
  "SalarySlip",
  "SalaryStructure",
  "SalesEnquiry",
  "SalesInvoice",
  "SalesInvoiceSalesPersonAllocation",
  "SalesOrder",
  "SalesPerson",
  "SavedReport",
  "Saving",
  "ScheduledReport",
  "ScimToken",
  "SequenceEnrollment",
  "SerialNo",
  "ServiceContract",
  "ShiftType",
  "Shipment",
  "ShipmentEvent",
  "SignatureEnvelope",
  "SignatureRequest",
  "SiqChatSession",
  "SiqVisitor",
  "SiqWidgetSettings",
  "SmsMessage",
  "SmsTemplate",
  "SocialAccount",
  "SocialMention",
  "SocialMonitor",
  "SocialPost",
  "SsoProvider",
  "StatutoryComponent",
  "StockEntry",
  "StockLedgerEntry",
  "StockReconciliation",
  "Student",
  "StudentEnrollment",
  "Subscription",
  "SubscriptionPlan",
  "SuperAnnuationFund",
  "Supplier",
  "SupplierQuotation",
  "SupplierScorecard",
  "Suppression",
  "Survey",
  "SurveyResponse",
  "Task",
  "TaxCollectionCategory",
  "TaxTemplate",
  "TaxWithholdingCategory",
  "TdsChallan",
  "TenantIntegration",
  "TenantSubscription",
  "Territory",
  "Timesheet",
  "Todo",
  "TrackingEvent",
  "TrainingEvent",
  "User",
  "UserCompanyAccess",
  "Vehicle",
  "VehicleLog",
  "Warehouse",
  "Warranty",
  "WebForm",
  "WebFormSubmission",
  "WebPage",
  "WebhookDelivery",
  "WebhookSubscription",
  "WebinarEvent",
  "WebinarRegistration",
  "WebsiteItem",
  "Weighment",
  "WhatsappMessage",
  "WhatsappTemplate",
  "WorkDriveFile",
  "WorkDriveFolder",
  "WorkDriveShareLink",
  "WorkGroup",
  "WorkItem",
  "WorkOrder",
  "WorkPlan",
  "Workflow",
  "Workstation",
]);

// Explicit escape hatch — set on a per-call args bag when a query is
// intentionally cross-tenant (e.g., internal cron scanning every tenant's
// backup jobs). Add the property and the guard skips: `{ ...args, __allowCrossTenant: true }`.
//
// Prefer this over toggling env vars — the intent is auditable in the diff.
type GuardableArgs = { where?: unknown; __allowCrossTenant?: boolean } | undefined;

function hasTenantIdInWhere(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const w = where as Record<string, unknown>;
  if (w.tenantId !== undefined) return true;
  // Prisma allows composite AND arrays where the tenantId lives on one leg.
  if (Array.isArray(w.AND)) return w.AND.some(hasTenantIdInWhere);
  // OR/NOT are not counted — a tenantId inside an OR arm doesn't restrict
  // the query. If a caller genuinely needs OR + tenant scoping they should
  // wrap: `{ AND: [{ tenantId }, { OR: [...] }] }`.
  return false;
}

// Prod defaults to `enforce` — a missing `tenantId` in a set-returning
// query is a cross-tenant data-leak bug and must fail loud. Dev/test default
// to `warn` so a developer running a bare pnpm test doesn't get 500s on
// legitimate cross-tenant ops (backup sweeper, tenant-provisioning, etc.).
// Operators bringing a fresh service to prod for the first time can explicitly
// set TENANT_GUARD_MODE=warn during the first rollout window if they want a
// soak period, then remove the override.
function defaultGuardMode(): "warn" | "enforce" | "off" {
  return process.env.NODE_ENV === "production" ? "enforce" : "warn";
}

function assertGuard(model: string, op: string, args: GuardableArgs): void {
  if (!TENANT_SCOPED_MODELS.has(model)) return;
  if (args?.__allowCrossTenant) return;
  if (hasTenantIdInWhere(args?.where)) return;

  const mode = process.env.TENANT_GUARD_MODE ?? defaultGuardMode();
  if (mode === "off") return;

  const msg = `[tenant-guard] ${model}.${op} without tenantId in where — cross-tenant leak risk`;
  if (mode === "warn") {
    // eslint-disable-next-line no-console
    console.warn(msg);
    return;
  }
  throw new Error(msg);
}

// Set-returning ops that could leak across tenants when `where` misses
// `tenantId`. Single-row ops on unique keys (findUnique / update / delete)
// aren't guarded — they need an exact cuid, and every route in the codebase
// already uses `findFirst({where: {id, tenantId}})` for auth-boundary reads.
const GUARDED_ACTIONS = new Set([
  "findMany",
  "findFirst",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

// Attach the guard via Prisma's `$extends` query extension — the supported
// API in Prisma 5+ ($use is deprecated and slated for removal). Returns an
// extended client typed as PrismaClient so the 34 call-sites in the repo
// that annotate against PrismaClient don't need to change — the extension
// is structurally a PrismaClient, we just hide the extension's branded
// type behind the generic.
//
// The old `attachTenantGuard(client)` function remains exported below as a
// no-op shim for any out-of-tree callers; the real work has moved here.
// Once-per-process attach log. Without this, every file in a vitest run
// re-imports buildClient and the "[tenant-guard] attached" line prints 60+
// times — pure noise. The constant lives on globalThis so hot-reload or
// multi-worker setups (where globalThis is per-worker) still emit once per
// worker, which is useful signal.
declare global {
  // eslint-disable-next-line no-var
  var __lumaaraTenantGuardLogged: boolean | undefined;
}

export function withTenantGuardExtension<P extends PrismaClient>(client: P): P {
  const mode = process.env.TENANT_GUARD_MODE ?? defaultGuardMode();
  if (!globalThis.__lumaaraTenantGuardLogged) {
    // eslint-disable-next-line no-console
    console.log(
      `[tenant-guard] attached mode=${mode} (models=${TENANT_SCOPED_MODELS.size})`,
    );
    globalThis.__lumaaraTenantGuardLogged = true;
  }
  // $extends generates a huge union over all models which blows past TS's
  // "complex union type" ceiling (TS2590). The `any` cast on the extend
  // call keeps the returned shape visible to callers as plain P.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extend = (client as any).$extends.bind(client);
  return extend({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (
            model &&
            GUARDED_ACTIONS.has(operation) &&
            TENANT_SCOPED_MODELS.has(model)
          ) {
            assertGuard(model, operation, args as GuardableArgs);
          }
          // Strip the escape-hatch flag before Prisma sees it — unknown
          // keys at the query engine would error.
          if (args && (args as GuardableArgs)?.__allowCrossTenant) {
            delete (args as Record<string, unknown>).__allowCrossTenant;
          }
          return query(args);
        },
      },
    },
  }) as P;
}

/**
 * Deprecated: back-compat shim. The guard is now applied as an extension
 * via `withTenantGuardExtension(client)` inside `buildClient()`. Direct
 * callers (test harnesses that construct their own PrismaClient) should
 * switch to `prisma = withTenantGuardExtension(new PrismaClient())` and
 * use the returned client. This stub is a no-op so a wayward call doesn't
 * silently install a second (dead) guard.
 */
export function attachTenantGuard(_client: PrismaClient): void {
  // intentionally empty — see withTenantGuardExtension above.
}

/**
 * Type-safe cross-tenant escape hatch. Use instead of `{ __allowCrossTenant: true } as any`
 * so the intent is explicit + the escape can be grep'd for audit.
 *
 * Example:
 *   await prisma.tenantIntegration.findMany(withCrossTenant({
 *     where: { provider: "s3", isActive: true },
 *   }));
 */
export function withCrossTenant<T extends object>(args: T): T {
  // Mutate in place so TS keeps the EXACT inferred shape of T (preserves
  // the caller's include/select structure for Prisma's conditional
  // return type). A spread + cast widens T through structural
  // uncertainty and makes `.user`/`.tenant` disappear from the returned
  // row's type.
  (args as T & { __allowCrossTenant?: boolean }).__allowCrossTenant = true;
  return args;
}
