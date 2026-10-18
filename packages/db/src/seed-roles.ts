import { PrismaClient, Prisma } from "@prisma/client";

// ---------- DocType registry (used by permission matrix + gates) ----------
//
// The canonical list of doctypes that RolePermission can gate. When you ship
// a new doctype: (1) add it here, (2) add it to a role in DEFAULT_ROLE_PERMS
// so seedTenantRoles grants access on tenant creation.

export const DOCTYPES = [
  // Accounting
  "Customer",
  "Supplier",
  "Item",
  "Account",
  "SalesInvoice",
  "PurchaseInvoice",
  "PurchaseOrder",
  "PaymentEntry",
  "JournalEntry",
  "GLEntry",
  "Currency",
  "TaxTemplate",
  "PriceList",
  "PricingRule",
  "CouponCode",
  "LoyaltyProgram",
  "LoyaltyPointEntry",
  "SalesPerson",
  "Campaign",
  "PaymentTermsTemplate",
  "Subscription",
  // Stock
  "Warehouse",
  "StockEntry",
  "DeliveryNote",
  "PurchaseReceipt",
  "MaterialRequest",
  "StockReconciliation",
  "SerialNo",
  "Batch",
  "QualityInspectionTemplate",
  "QualityInspection",
  "Bin",
  "StockLedgerEntry",
  "BOM",
  "WorkOrder",
  "ProductionPlan",
  "ItemReorderRule",
  // CRM
  "Lead",
  "Opportunity",
  "Quotation",
  "SalesOrder",
  "Address",
  "Contact",
  "CustomerGroup",
  "Territory",
  // HR
  "Employee",
  "Attendance",
  "SalarySlip",
  "SalaryStructure",
  "LeaveType",
  "LeaveAllocation",
  "LeaveApplication",
  "ExpenseClaim",
  "ExpenseClaimType",
  "ShiftType",
  "Loan",
  "LoanType",
  "HolidayList",
  "PayrollEntry",
  "EmployeeChecklistTemplate",
  "EmployeeChecklist",
  "EmployeeAdvance",
  "AppraisalTemplate",
  "Appraisal",
  "EmployeeCheckin",
  "OvertimeRequest",
  "AttendanceRegularization",
  "LeavePolicy",
  "StatutoryComponent",
  "JobOpening",
  "JobApplicant",
  "TrainingEvent",
  "EmployeeGrade",
  "EmploymentType",
  "Branch",
  "EmployeeSkill",
  "EmployeeCertification",
  "LeaveEncashment",
  "LeaveLedgerEntry",
  "WorkGroup",
  "EmployeeCategory",
  "ApproverHierarchy",
  // P2 · Finance
  "CostCenter",
  // P2 · CRM
  "Warranty",
  "PurchaseWarranty",
  "LocationCapture",
  "AutoDealer",
  "CrmTarget",
  "CrmTargetActual",
  "WorkPlan",
  "DailyWorksheet",
  "CrmProcess",
  "ProjectPlanning",
  // P2 · Manufacturing
  "MaterialIssue",
  "MaterialTransfer",
  "MaterialReturn",
  "Weighment",
  "InwardOutwardNote",
  "SalesEnquiry",
  "MrpRun",
  "ItemSitePlanning",
  "RoutingMaster",
  "MaintenanceRequest",
  "MaintenanceSchedule",
  "MachineLogger",
  "MaintenanceAction",
  // P3 · Finance
  "BankGuarantee",
  "LetterOfCredit",
  // POS
  "POSProfile",
  "POSOpeningEntry",
  "POSClosingEntry",
  // Website / CMS
  "WebPage",
  "BlogPost",
  // E-commerce
  "WebsiteItem",
  // P6 · Payroll
  "Form12BB",
  "Saving",
  "Form16",
  "ETDSDetail",
  "PFDetail",
  "SuperAnnuationFund",
  "AdhocPaymentRecovery",
  "HouseRentDetail",
  "CompanyAccommodation",
  "PreviousEmployerDetail",
  "FinalSettlement",
  "OutsidePayrollDetail",
  "SalaryJV",
  "Bonus",
  "ESICDetail",
  "PayCode",
  "ProfessionalTaxDetail",
  "CTC",
  "EmployeeCTC",
  "PayableDays",
  "LWFDetail",
  // Projects
  "Project",
  "Task",
  "Timesheet",
  // Assets
  "AssetCategory",
  "Asset",
  "AssetMaintenanceLog",
  // Manufacturing extensions
  "Workstation",
  "JobCard",
  // System
  "Role",
  "User",
  "Report",
  "Workflow",
  "FiscalYear",
  "Budget",
  "CustomField",
  "SavedReport",
  "Attachment",
  "Comment",
  "Notification",
  "Todo",
  "EmailTemplate",
  "EmailMessage",
  "SmsTemplate",
  "SmsMessage",
  "WhatsappTemplate",
  "WhatsappMessage",
  // Marketing P3
  "BrandKit",
  "EditorialNote",
  "DocSubscription",
  "NotificationPreference",
  "DigestSchedule",
  "Broadcast",
  "MarketingApproval",
  "MeetingType",
  "BookedMeeting",
  "PipelineBlueprint",
  "LeadScoreRule",
  "Issue",
  "SignatureEnvelope",
  "SignatureRequest",
  "Shipment",
  "Program",
  "Course",
  "Student",
  "StudentEnrollment",
  "FeeSchedule",
  "FeePosting",
  "Assessment",
  "AssessmentResult",
  "Patient",
  "PatientAppointment",
  "PatientEncounter",
  "Prescription",
  "Donor",
  "Donation",
  "Grant",
  "Membership",
  "Room",
  "RoomBooking",
  "LandUnit",
  "CropCycle",
  "CropActivity",
  "AgentPolicy",
  "AgentTask",
  "AgentStep",
  "Embedding",
  "Dashboard",
  "DashboardCard",
  "ReportBookmark",
  "ScheduledReport",
  "Letterhead",
  "PrintFormat",
  "ListView",
  "ImportJob",
  "ExportPreset",
  "PortalUser",
  "PortalTicket",
  "TenantIntegration",
  "WebhookSubscription",
  "FeatureFlag",
  "BackupJob",
  "ErrorLog",
  "DataSubjectRequest",
  "DataRetentionPolicy",
  "AnonymizationArchive",
  "ConsentRecord",
  // Auth / access-control admin — SystemManager-only.
  "SsoProvider",
] as const;

export type DocType = (typeof DOCTYPES)[number];

export const ACTIONS = [
  "read",
  "write",
  "create",
  "delete",
  "submit",
  "cancel",
] as const;
export type PermAction = (typeof ACTIONS)[number];

// ---------- Default role → permission matrix ----------
//
// Each role gets a set of (doctype, actions[]) grants. SystemManager gets
// everything on every doctype below. Other roles get scoped access matching
// their responsibility. Tenants can add custom roles at runtime; those start
// with zero permissions and the tenant admin grants them via Role Permission
// Manager UI (built later).

const ALL_ACTIONS: PermAction[] = ["read", "write", "create", "delete", "submit", "cancel"];
const READ_ONLY: PermAction[] = ["read"];
const CRUD_NO_SUBMIT: PermAction[] = ["read", "write", "create", "delete"];
const FULL_TXN: PermAction[] = ["read", "write", "create", "delete", "submit", "cancel"];

type PermMatrix = Record<string, Partial<Record<DocType, PermAction[]>>>;

export const DEFAULT_ROLE_PERMS: PermMatrix = {
  // Full access to everything. Auto-granted to the tenant's first admin user.
  SystemManager: Object.fromEntries(
    DOCTYPES.map((dt) => [dt, ALL_ACTIONS]),
  ) as Record<DocType, PermAction[]>,

  // Accounts team: full accounting side; read-only on stock/CRM/HR for context.
  AccountsManager: {
    Customer: FULL_TXN,
    Supplier: FULL_TXN,
    Address: CRUD_NO_SUBMIT,
    Contact: CRUD_NO_SUBMIT,
    PaymentTermsTemplate: CRUD_NO_SUBMIT,
    Subscription: FULL_TXN,
    Item: CRUD_NO_SUBMIT,
    Account: CRUD_NO_SUBMIT,
    SalesInvoice: FULL_TXN,
    PurchaseInvoice: FULL_TXN,
    PaymentEntry: FULL_TXN,
    JournalEntry: FULL_TXN,
    GLEntry: READ_ONLY,
    Currency: CRUD_NO_SUBMIT,
    TaxTemplate: CRUD_NO_SUBMIT,
    PriceList: CRUD_NO_SUBMIT,
    FiscalYear: FULL_TXN,
    Budget: CRUD_NO_SUBMIT,
    AssetCategory: CRUD_NO_SUBMIT,
    Asset: FULL_TXN,
    AssetMaintenanceLog: CRUD_NO_SUBMIT,
    Warehouse: READ_ONLY,
    DeliveryNote: READ_ONLY,
    PurchaseReceipt: READ_ONLY,
    Bin: READ_ONLY,
    StockLedgerEntry: READ_ONLY,
    Employee: READ_ONLY,
    SalarySlip: FULL_TXN,
    CostCenter: CRUD_NO_SUBMIT,
    BankGuarantee: FULL_TXN,
    LetterOfCredit: FULL_TXN,
    // POS: managers configure terminals and see all sessions.
    POSProfile: CRUD_NO_SUBMIT,
    POSOpeningEntry: FULL_TXN,
    POSClosingEntry: FULL_TXN,
    Report: READ_ONLY,
    SavedReport: FULL_TXN,
  },

  AccountsUser: {
    Customer: CRUD_NO_SUBMIT,
    Supplier: CRUD_NO_SUBMIT,
    Item: READ_ONLY,
    SalesInvoice: CRUD_NO_SUBMIT,
    PurchaseInvoice: CRUD_NO_SUBMIT,
    PaymentEntry: CRUD_NO_SUBMIT,
    JournalEntry: CRUD_NO_SUBMIT,
    GLEntry: READ_ONLY,
    Currency: READ_ONLY,
    TaxTemplate: READ_ONLY,
    FiscalYear: READ_ONLY,
    Budget: READ_ONLY,
    AssetCategory: READ_ONLY,
    Asset: READ_ONLY,
    AssetMaintenanceLog: READ_ONLY,
    Report: READ_ONLY,
    SavedReport: FULL_TXN,
  },

  // POS cashier. Reads profiles + items + customers so the cashier UI can
  // load. Can open a session, submit POS invoices (which auto-create+submit
  // a Payment Entry inside the checkout tx), and close their own session.
  // Cannot edit POSProfile (a manager task) or touch non-POS invoices.
  POSUser: {
    POSProfile: READ_ONLY,
    POSOpeningEntry: ["read", "write", "create", "submit"],
    POSClosingEntry: ["read", "write", "create", "submit"],
    // POS checkout creates SI + PE; grant create+submit so the checkout tx
    // succeeds under this role. Delete is intentionally omitted — POS invoices
    // are immutable once posted; refunds go through Credit Notes.
    SalesInvoice: ["read", "write", "create", "submit"],
    PaymentEntry: ["read", "write", "create", "submit"],
    Customer: CRUD_NO_SUBMIT,   // walk-in signup at the counter
    Item: READ_ONLY,
    PriceList: READ_ONLY,
    Warehouse: READ_ONLY,
    TaxTemplate: READ_ONLY,
  },

  SalesManager: {
    Customer: FULL_TXN,
    Item: READ_ONLY,
    PriceList: READ_ONLY,
    Address: CRUD_NO_SUBMIT,
    Contact: CRUD_NO_SUBMIT,
    CustomerGroup: CRUD_NO_SUBMIT,
    Territory: CRUD_NO_SUBMIT,
    PricingRule: CRUD_NO_SUBMIT,
    CouponCode: CRUD_NO_SUBMIT,
    LoyaltyProgram: CRUD_NO_SUBMIT,
    LoyaltyPointEntry: READ_ONLY,
    SalesPerson: CRUD_NO_SUBMIT,
    Campaign: CRUD_NO_SUBMIT,
    // Website / CMS: sales/marketing owns evergreen web content.
    WebPage: CRUD_NO_SUBMIT,
    BlogPost: CRUD_NO_SUBMIT,
    // E-commerce: sales manages the storefront catalog. Checkout creates SOs
    // (already granted above via SalesOrder: FULL_TXN).
    WebsiteItem: CRUD_NO_SUBMIT,
    // P3 (Marketing approvals): sales/marketing managers can request approval
    // and withdraw their own requests; they cannot approve their own work —
    // that requires the MarketingApprover role.
    MarketingApproval: ["read", "write", "create", "delete"],
    // Meeting Scheduler: sales/marketing owns the meeting types + booked
    // meetings for prospect outreach.
    MeetingType: CRUD_NO_SUBMIT,
    BookedMeeting: CRUD_NO_SUBMIT,
    PipelineBlueprint: CRUD_NO_SUBMIT,
    LeadScoreRule: CRUD_NO_SUBMIT,
    Issue: CRUD_NO_SUBMIT,
    SignatureEnvelope: FULL_TXN,
    SignatureRequest: FULL_TXN,
    Shipment: FULL_TXN,
    Program: CRUD_NO_SUBMIT,
    Course: CRUD_NO_SUBMIT,
    Student: CRUD_NO_SUBMIT,
    StudentEnrollment: CRUD_NO_SUBMIT,
    FeeSchedule: CRUD_NO_SUBMIT,
    FeePosting: CRUD_NO_SUBMIT,
    Assessment: CRUD_NO_SUBMIT,
    AssessmentResult: CRUD_NO_SUBMIT,
    Patient: CRUD_NO_SUBMIT,
    PatientAppointment: CRUD_NO_SUBMIT,
    PatientEncounter: CRUD_NO_SUBMIT,
    Prescription: CRUD_NO_SUBMIT,
    Donor: CRUD_NO_SUBMIT,
    Donation: CRUD_NO_SUBMIT,
    Grant: CRUD_NO_SUBMIT,
    Membership: CRUD_NO_SUBMIT,
    Room: CRUD_NO_SUBMIT,
    RoomBooking: CRUD_NO_SUBMIT,
    LandUnit: CRUD_NO_SUBMIT,
    CropCycle: CRUD_NO_SUBMIT,
    CropActivity: CRUD_NO_SUBMIT,
    AgentPolicy: CRUD_NO_SUBMIT,
    AgentTask: FULL_TXN,
    AgentStep: READ_ONLY,
    Embedding: READ_ONLY,
    // P3 (Marketing operations): brand kit is read/write for sales+marketing
    // managers so they can update colours/logo without pinging IT. Editorial
    // notes are full CRUD (they own the content calendar).
    BrandKit: CRUD_NO_SUBMIT,
    EditorialNote: CRUD_NO_SUBMIT,
    PaymentTermsTemplate: CRUD_NO_SUBMIT,
    Lead: FULL_TXN,
    Opportunity: FULL_TXN,
    Quotation: FULL_TXN,
    SalesOrder: FULL_TXN,
    SalesInvoice: FULL_TXN,
    DeliveryNote: FULL_TXN,
    Warehouse: READ_ONLY,
    Bin: READ_ONLY,
    // P2 CRM additions — sales owns warranty follow-up + targets + field work
    Warranty: FULL_TXN,
    PurchaseWarranty: READ_ONLY,
    LocationCapture: CRUD_NO_SUBMIT,
    AutoDealer: CRUD_NO_SUBMIT,
    CrmTarget: FULL_TXN,
    CrmTargetActual: CRUD_NO_SUBMIT,
    WorkPlan: FULL_TXN,
    DailyWorksheet: FULL_TXN,
    CrmProcess: FULL_TXN,
    ProjectPlanning: FULL_TXN,
    SalesEnquiry: FULL_TXN,
    Report: READ_ONLY,
  },

  SalesUser: {
    Customer: CRUD_NO_SUBMIT,
    Item: READ_ONLY,
    Lead: CRUD_NO_SUBMIT,
    Opportunity: CRUD_NO_SUBMIT,
    Quotation: CRUD_NO_SUBMIT,
    SalesOrder: CRUD_NO_SUBMIT,
    Warehouse: READ_ONLY,
    Bin: READ_ONLY,
  },

  PurchaseManager: {
    Supplier: FULL_TXN,
    Item: READ_ONLY,
    PriceList: READ_ONLY,
    Address: CRUD_NO_SUBMIT,
    Contact: CRUD_NO_SUBMIT,
    PurchaseOrder: FULL_TXN,
    PurchaseInvoice: FULL_TXN,
    PurchaseReceipt: FULL_TXN,
    Warehouse: READ_ONLY,
    Bin: READ_ONLY,
    Report: READ_ONLY,
  },

  PurchaseUser: {
    Supplier: CRUD_NO_SUBMIT,
    Item: READ_ONLY,
    PurchaseOrder: CRUD_NO_SUBMIT,
    PurchaseInvoice: CRUD_NO_SUBMIT,
    PurchaseReceipt: CRUD_NO_SUBMIT,
    Warehouse: READ_ONLY,
  },

  StockManager: {
    Item: FULL_TXN,
    Warehouse: FULL_TXN,
    StockEntry: FULL_TXN,
    DeliveryNote: FULL_TXN,
    PurchaseReceipt: FULL_TXN,
    MaterialRequest: FULL_TXN,
    StockReconciliation: FULL_TXN,
    SerialNo: CRUD_NO_SUBMIT,
    Batch: CRUD_NO_SUBMIT,
    ItemReorderRule: CRUD_NO_SUBMIT,
    QualityInspectionTemplate: CRUD_NO_SUBMIT,
    QualityInspection: CRUD_NO_SUBMIT,
    Bin: READ_ONLY,
    StockLedgerEntry: READ_ONLY,
    BOM: FULL_TXN,
    WorkOrder: FULL_TXN,
    Workstation: CRUD_NO_SUBMIT,
    JobCard: FULL_TXN,
    // P2 Manufacturing additions
    MaterialIssue: FULL_TXN,
    MaterialTransfer: FULL_TXN,
    MaterialReturn: FULL_TXN,
    Weighment: FULL_TXN,
    InwardOutwardNote: FULL_TXN,
    SalesEnquiry: READ_ONLY,
    MrpRun: CRUD_NO_SUBMIT,
    ItemSitePlanning: CRUD_NO_SUBMIT,
    RoutingMaster: CRUD_NO_SUBMIT,
    MaintenanceRequest: FULL_TXN,
    MaintenanceSchedule: CRUD_NO_SUBMIT,
    MachineLogger: CRUD_NO_SUBMIT,
    MaintenanceAction: CRUD_NO_SUBMIT,
    Report: READ_ONLY,
  },

  StockUser: {
    Item: CRUD_NO_SUBMIT,
    Warehouse: READ_ONLY,
    StockEntry: CRUD_NO_SUBMIT,
    DeliveryNote: CRUD_NO_SUBMIT,
    PurchaseReceipt: CRUD_NO_SUBMIT,
    MaterialRequest: CRUD_NO_SUBMIT,
    StockReconciliation: CRUD_NO_SUBMIT,
    SerialNo: READ_ONLY,
    Batch: READ_ONLY,
    QualityInspectionTemplate: READ_ONLY,
    QualityInspection: CRUD_NO_SUBMIT,
    Bin: READ_ONLY,
    StockLedgerEntry: READ_ONLY,
    BOM: READ_ONLY,
    WorkOrder: CRUD_NO_SUBMIT,
    Workstation: READ_ONLY,
    JobCard: CRUD_NO_SUBMIT,
  },

  ManufacturingManager: {
    Item: READ_ONLY,
    BOM: FULL_TXN,
    WorkOrder: FULL_TXN,
    ProductionPlan: FULL_TXN,
    Workstation: CRUD_NO_SUBMIT,
    JobCard: FULL_TXN,
    Warehouse: READ_ONLY,
    Bin: READ_ONLY,
    StockLedgerEntry: READ_ONLY,
    // P2 Manufacturing — planning + maintenance + routing
    MaterialIssue: FULL_TXN,
    MaterialTransfer: FULL_TXN,
    MaterialReturn: FULL_TXN,
    Weighment: READ_ONLY,
    InwardOutwardNote: READ_ONLY,
    MrpRun: FULL_TXN,
    ItemSitePlanning: FULL_TXN,
    RoutingMaster: FULL_TXN,
    MaintenanceRequest: FULL_TXN,
    MaintenanceSchedule: FULL_TXN,
    MachineLogger: CRUD_NO_SUBMIT,
    MaintenanceAction: FULL_TXN,
    Report: READ_ONLY,
  },

  HRManager: {
    Employee: FULL_TXN,
    Attendance: FULL_TXN,
    SalarySlip: FULL_TXN,
    SalaryStructure: FULL_TXN,
    LeaveType: CRUD_NO_SUBMIT,
    LeaveAllocation: CRUD_NO_SUBMIT,
    LeaveApplication: FULL_TXN,
    ExpenseClaim: FULL_TXN,
    ExpenseClaimType: CRUD_NO_SUBMIT,
    ShiftType: CRUD_NO_SUBMIT,
    Loan: FULL_TXN,
    LoanType: CRUD_NO_SUBMIT,
    HolidayList: CRUD_NO_SUBMIT,
    PayrollEntry: FULL_TXN,
    EmployeeChecklistTemplate: CRUD_NO_SUBMIT,
    EmployeeChecklist: FULL_TXN,
    EmployeeAdvance: FULL_TXN,
    AppraisalTemplate: CRUD_NO_SUBMIT,
    Appraisal: FULL_TXN,
    EmployeeCheckin: FULL_TXN,
    OvertimeRequest: FULL_TXN,
    AttendanceRegularization: FULL_TXN,
    LeavePolicy: CRUD_NO_SUBMIT,
    StatutoryComponent: CRUD_NO_SUBMIT,
    JobOpening: CRUD_NO_SUBMIT,
    JobApplicant: FULL_TXN,
    TrainingEvent: CRUD_NO_SUBMIT,
    EmployeeGrade: CRUD_NO_SUBMIT,
    EmploymentType: CRUD_NO_SUBMIT,
    Branch: CRUD_NO_SUBMIT,
    EmployeeSkill: CRUD_NO_SUBMIT,
    EmployeeCertification: CRUD_NO_SUBMIT,
    LeaveEncashment: FULL_TXN,
    LeaveLedgerEntry: CRUD_NO_SUBMIT,
    WorkGroup: CRUD_NO_SUBMIT,
    EmployeeCategory: CRUD_NO_SUBMIT,
    ApproverHierarchy: CRUD_NO_SUBMIT,
    // P6 Payroll
    Form12BB: FULL_TXN,
    Saving: FULL_TXN,
    Form16: FULL_TXN,
    ETDSDetail: FULL_TXN,
    PFDetail: FULL_TXN,
    SuperAnnuationFund: FULL_TXN,
    AdhocPaymentRecovery: FULL_TXN,
    HouseRentDetail: FULL_TXN,
    CompanyAccommodation: FULL_TXN,
    PreviousEmployerDetail: FULL_TXN,
    FinalSettlement: FULL_TXN,
    OutsidePayrollDetail: FULL_TXN,
    SalaryJV: FULL_TXN,
    Bonus: FULL_TXN,
    ESICDetail: FULL_TXN,
    PayCode: CRUD_NO_SUBMIT,
    ProfessionalTaxDetail: FULL_TXN,
    CTC: CRUD_NO_SUBMIT,
    EmployeeCTC: FULL_TXN,
    PayableDays: FULL_TXN,
    LWFDetail: FULL_TXN,
    Report: READ_ONLY,
  },

  HRUser: {
    Employee: CRUD_NO_SUBMIT,
    Attendance: CRUD_NO_SUBMIT,
    SalarySlip: READ_ONLY,
    SalaryStructure: READ_ONLY,
    LeaveType: READ_ONLY,
    LeaveAllocation: READ_ONLY,
    LeaveApplication: CRUD_NO_SUBMIT,
    ExpenseClaim: CRUD_NO_SUBMIT,
    ExpenseClaimType: READ_ONLY,
    ShiftType: READ_ONLY,
    Loan: READ_ONLY,
    LoanType: READ_ONLY,
    HolidayList: READ_ONLY,
    EmployeeChecklistTemplate: READ_ONLY,
    EmployeeChecklist: CRUD_NO_SUBMIT,
    EmployeeAdvance: CRUD_NO_SUBMIT,
    AppraisalTemplate: READ_ONLY,
    Appraisal: CRUD_NO_SUBMIT,
    EmployeeCheckin: CRUD_NO_SUBMIT,
    OvertimeRequest: CRUD_NO_SUBMIT,
    AttendanceRegularization: CRUD_NO_SUBMIT,
    LeavePolicy: READ_ONLY,
    StatutoryComponent: READ_ONLY,
    JobOpening: READ_ONLY,
    JobApplicant: CRUD_NO_SUBMIT,
    TrainingEvent: READ_ONLY,
    EmployeeGrade: READ_ONLY,
    EmploymentType: READ_ONLY,
    Branch: READ_ONLY,
    EmployeeSkill: CRUD_NO_SUBMIT,
    EmployeeCertification: CRUD_NO_SUBMIT,
    LeaveEncashment: CRUD_NO_SUBMIT,
    LeaveLedgerEntry: READ_ONLY,
    WorkGroup: READ_ONLY,
    EmployeeCategory: READ_ONLY,
    ApproverHierarchy: READ_ONLY,
  },

  ProjectsManager: {
    Project: FULL_TXN,
    Task: FULL_TXN,
    Timesheet: FULL_TXN,
    Customer: READ_ONLY,
    Employee: READ_ONLY,
    Report: READ_ONLY,
  },

  ProjectsUser: {
    Project: READ_ONLY,
    Task: CRUD_NO_SUBMIT,
    // Users can create + submit their own timesheets; approval flow is via
    // the workflow engine when a tenant configures one.
    Timesheet: FULL_TXN,
    Customer: READ_ONLY,
    Employee: READ_ONLY,
  },

  // P3 (Marketing approvals): reviewer role. Can see + approve/reject any
  // MarketingApproval in the tenant. "submit" carries the semantics of
  // approve/reject in this workflow so the perms helper can gate both actions
  // with the same grant. Marketing content itself (Campaign / SocialPost /
  // Broadcast) is only readable — reviewers don't edit copy, they gate sends.
  MarketingApprover: {
    MarketingApproval: ["read", "write", "submit"],
    Campaign: READ_ONLY,
    Broadcast: READ_ONLY,
    // SocialPost is defined on the CRM side of the perms matrix; even though
    // it doesn't appear in DOCTYPES yet, the perms() runtime accepts any
    // doctype string so grants here don't need a corresponding entry to work.
    // Keeping READ_ONLY here makes the intent explicit to future readers.
    EmailTemplate: READ_ONLY,
    Notification: FULL_TXN,
    Todo: FULL_TXN,
    Comment: FULL_TXN,
    Attachment: FULL_TXN,
  },

  // Auditor-like: read everything, edit nothing. Given to external accountants
  // etc who need visibility but not write access.
  Auditor: Object.fromEntries(
    DOCTYPES.map((dt) => [dt, READ_ONLY]),
  ) as Record<DocType, PermAction[]>,
};

// Collaboration primitives (Attachment, Comment, Notification, Todo) are
// available to everyone in every non-Auditor role — attaching a file to a
// Sales Invoice shouldn't require its own permission grant. Apply once
// here so we don't have to remember it in every role above.
const COLLAB_DOCTYPES: DocType[] = ["Attachment", "Comment", "Notification", "Todo"];
for (const roleName of Object.keys(DEFAULT_ROLE_PERMS)) {
  if (roleName === "Auditor") continue;
  for (const dt of COLLAB_DOCTYPES) {
    (DEFAULT_ROLE_PERMS[roleName] as Partial<Record<DocType, PermAction[]>>)[dt] = FULL_TXN;
  }
}

export const SYSTEM_ROLE_NAMES = Object.keys(DEFAULT_ROLE_PERMS);

// ---------- Seeding ----------
//
// Seeds all default system roles into a tenant + their permission grants.
// Idempotent: safe to call multiple times (upserts by unique (tenantId, roleName)).

export async function seedTenantRoles(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
): Promise<Record<string, string>> {
  const nameToId: Record<string, string> = {};

  for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMS)) {
    const role = await tx.role.upsert({
      where: { tenantId_roleName: { tenantId, roleName } },
      create: { tenantId, roleName, isSystem: true },
      update: { isSystem: true },
    });
    nameToId[roleName] = role.id;

    // Wipe + reseed permissions for this role so schema updates to the matrix
    // propagate on re-seed. Safe because system roles aren't user-edited.
    // Include tenantId in the where even though roleId is unique — tenant-guard
    // is satisfied only when tenantId is on the WHERE, not when it's implicit
    // in the joined-key. This is the same defensive practice we want every
    // route to follow when we flip TENANT_GUARD_MODE=enforce.
    await tx.rolePermission.deleteMany({ where: { tenantId, roleId: role.id } });
    const grants: { tenantId: string; roleId: string; doctype: string; action: string }[] = [];
    for (const [doctype, actions] of Object.entries(perms)) {
      for (const action of actions ?? []) {
        grants.push({ tenantId, roleId: role.id, doctype, action });
      }
    }
    if (grants.length > 0) {
      await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
    }
  }

  return nameToId;
}

// Assigns the SystemManager role to a user. Called for the first admin user
// during signup.
export async function assignSystemManagerRole(
  tx: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  userId: string,
): Promise<void> {
  const role = await tx.role.findUnique({
    where: { tenantId_roleName: { tenantId, roleName: "SystemManager" } },
  });
  if (!role) throw new Error("SystemManager role missing — did seedTenantRoles run?");
  await tx.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    create: { userId, roleId: role.id },
    update: {},
  });
}

// Returns the set of "{doctype}:{action}" strings a user is allowed to perform,
// aggregated across all their roles.
export async function getUserPermissions(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<Set<string>> {
  const rows = await tx.rolePermission.findMany({
    where: { role: { userRoles: { some: { userId } } } },
    select: { doctype: true, action: true },
  });
  return new Set(rows.map((r) => `${r.doctype}:${r.action}`));
}

// Returns the names of roles held by a user. Used to embed into JWT so most
// permission checks can be short-circuited without a DB round-trip.
export async function getUserRoleNames(
  tx: Prisma.TransactionClient | PrismaClient,
  userId: string,
): Promise<string[]> {
  const rows = await tx.userRole.findMany({
    where: { userId },
    select: { role: { select: { roleName: true } } },
  });
  return rows.map((r) => r.role.roleName);
}
