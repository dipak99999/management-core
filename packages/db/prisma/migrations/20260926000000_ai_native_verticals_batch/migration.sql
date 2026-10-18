-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "isIntercompany" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "lastExpiryAlertAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "fenceLatitude" DECIMAL(10,7),
ADD COLUMN     "fenceLongitude" DECIMAL(10,7),
ADD COLUMN     "fenceRadiusMeters" INTEGER;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "defaultPaymentTermsTemplateId" TEXT;

-- AlterTable
ALTER TABLE "employee_checkins" ADD COLUMN     "faceMatchConfidence" DECIMAL(5,4),
ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7);

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "faceEmbedding" TEXT,
ADD COLUMN     "faceEnrolledAt" TIMESTAMP(3),
ADD COLUMN     "ifscCode" TEXT,
ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "gl_entries" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "defaultSupplierId" TEXT,
ADD COLUMN     "deferredRevenueMonths" INTEGER NOT NULL DEFAULT 12,
ADD COLUMN     "enableDeferredRevenue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isProductBundle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVariantTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "variantAttributes" JSONB,
ADD COLUMN     "variantOfId" TEXT;

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "isReversing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reverseOnDate" DATE,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedByJournalId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "payment_entries" ADD COLUMN     "chequeDate" DATE,
ADD COLUMN     "chequeNumber" TEXT,
ADD COLUMN     "chequePrinted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "paymentTermsTemplateId" TEXT;

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "sourceSalesOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "quotations" ADD COLUMN     "opportunityId" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "isPos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentTermsTemplateId" TEXT,
ADD COLUMN     "posOpeningId" TEXT,
ADD COLUMN     "posProfileId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "sourceRecurringId" TEXT;

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "isDropship" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "inTransitWarehouseId" TEXT,
ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "receivedByUserId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "defaultPaymentTermsTemplateId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultDeferredRevenueAccountId" TEXT,
ADD COLUMN     "defaultLoyaltyDiscountAccountId" TEXT,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "reminderThresholds" JSONB;

-- CreateTable
CREATE TABLE "user_company_access" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_payment_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesInvoiceId" TEXT,
    "purchaseInvoiceId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "invoicePortion" DECIMAL(5,2) NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Upcoming',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_payment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "slaPolicyId" TEXT,
    "contractType" TEXT NOT NULL DEFAULT 'Fixed Hours',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "entitledUnits" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "usedUnits" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "contractValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_sales_person_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "salesPersonId" TEXT NOT NULL,
    "allocationPct" DECIMAL(6,3) NOT NULL,
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_invoice_sales_person_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "paymentScheduleId" TEXT,
    "kind" TEXT NOT NULL,
    "daysOverdue" INTEGER NOT NULL,
    "outstandingAmt" DECIMAL(18,4) NOT NULL,
    "toEmail" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'Auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blanket_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blanketType" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "validFrom" DATE NOT NULL,
    "validTill" DATE NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blanket_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blanket_order_items" (
    "id" TEXT NOT NULL,
    "blanketOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "orderedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "blanket_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'Delivery',
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pick_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pick_list_items" (
    "id" TEXT NOT NULL,
    "pickListId" TEXT NOT NULL,
    "deliveryNoteItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "pickedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchNo" TEXT,
    "serialNos" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "pick_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_trips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driverName" TEXT,
    "vehicleNo" TEXT,
    "scheduledStart" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_trip_stops" (
    "id" TEXT NOT NULL,
    "deliveryTripId" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "addressLine" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "signatureCapture" TEXT,
    "notes" TEXT,

    CONSTRAINT "delivery_trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_for_quotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDueDate" TIMESTAMP(3),
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "awardedSupplierQuotationId" TEXT,
    "awardedPurchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_for_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_items" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "materialRequestItemId" TEXT,
    "description" TEXT,

    CONSTRAINT "rfq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_suppliers" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "responseStatus" TEXT NOT NULL DEFAULT 'Invited',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTill" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversionRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "netTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotation_items" (
    "id" TEXT NOT NULL,
    "supplierQuotationId" TEXT NOT NULL,
    "rfqItemId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "leadTimeDays" INTEGER,
    "notes" TEXT,

    CONSTRAINT "supplier_quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_scorecards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'Monthly',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "latestScore" DECIMAL(6,2),
    "latestStanding" TEXT,
    "latestScoredAsOf" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_scorecard_criteria" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "weight" DECIMAL(6,2) NOT NULL,

    CONSTRAINT "supplier_scorecard_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_scorecard_periods" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" DECIMAL(6,2) NOT NULL,
    "standing" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "supplier_scorecard_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_score_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "applyMode" TEXT NOT NULL DEFAULT 'Add',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_score_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_blueprints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_blueprint_stages" (
    "id" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiredFields" JSONB NOT NULL DEFAULT '[]',
    "allowedNext" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_blueprint_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_onboardings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "boardingDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_onboarding_tasks" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "taskName" TEXT NOT NULL,
    "assignedTo" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "employee_onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_separations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "separationDate" DATE NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_separations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_separation_tasks" (
    "id" TEXT NOT NULL,
    "separationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "taskName" TEXT NOT NULL,
    "assignedTo" TEXT,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "employee_separation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_alternates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "alternateItemId" TEXT NOT NULL,
    "twoWay" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_alternates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_conformances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualityInspectionId" TEXT,
    "itemId" TEXT,
    "batchNo" TEXT,
    "serialNo" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'Minor',
    "category" TEXT,
    "description" TEXT NOT NULL,
    "rootCause" TEXT,
    "disposition" TEXT,
    "correctiveAction" TEXT,
    "preventiveAction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "assignedTo" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "non_conformances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_feedback_rounds" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "dueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appraisal_feedback_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appraisal_feedback_responses" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "respondentEmail" TEXT NOT NULL,
    "respondentName" TEXT,
    "scoresJson" JSONB NOT NULL DEFAULT '{}',
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "appraisal_feedback_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "severity" TEXT NOT NULL DEFAULT 'Minor',
    "status" TEXT NOT NULL DEFAULT 'Open',
    "issueType" TEXT NOT NULL DEFAULT 'Bug',
    "reporterUserId" TEXT NOT NULL,
    "assignedEmployeeId" TEXT,
    "sprintId" TEXT,
    "releaseId" TEXT,
    "environment" TEXT,
    "reproSteps" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dueDate" DATE,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "running_timers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "billingRate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "running_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "vin" TEXT,
    "fuelType" TEXT,
    "color" TEXT,
    "yearOfMake" INTEGER,
    "assetId" TEXT,
    "currentOdometer" INTEGER NOT NULL DEFAULT 0,
    "lastServiceDate" DATE,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "logDate" DATE NOT NULL,
    "logType" TEXT NOT NULL,
    "odometer" INTEGER,
    "fuelQty" DECIMAL(10,3),
    "fuelRate" DECIMAL(10,3),
    "amount" DECIMAL(18,4),
    "vendor" TEXT,
    "driverName" TEXT,
    "notes" TEXT,
    "expenseClaimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_extraction_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetDoctype" TEXT NOT NULL DEFAULT 'PurchaseInvoice',
    "attachmentId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'pdf',
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "rawOutput" JSONB,
    "createdDocId" TEXT,
    "errorMessage" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "ai_extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_ticket_suggestions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "suggestedPriority" TEXT,
    "suggestedCategory" TEXT,
    "matchingArticleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedResponse" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "autoApplied" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_ticket_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_reviews" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "leftId" TEXT NOT NULL,
    "rightId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "snoozeUntil" TIMESTAMP(3),
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "duplicate_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_merges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "keeperId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "fkCounts" JSONB NOT NULL,
    "mergedSnapshot" JSONB NOT NULL,
    "mergedBy" TEXT,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_revaluation_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "ratesJson" JSONB NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Preview',
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "committedAt" TIMESTAMP(3),
    "committedBy" TEXT,

    CONSTRAINT "fx_revaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_types" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "colorHex" TEXT,
    "locationType" TEXT NOT NULL DEFAULT 'Video',
    "locationDetails" TEXT,
    "redirectUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_windows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "meetingTypeId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booked_meetings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meetingTypeId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviteePhone" TEXT,
    "inviteeNotes" TEXT,
    "inviteeTimezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Booked',
    "cancellationReason" TEXT,
    "cancellationToken" TEXT NOT NULL,
    "meetingUrl" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booked_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gstin" TEXT,
    "homeStateCode" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'INR',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultReceivableAccountId" TEXT,
    "defaultPayableAccountId" TEXT,
    "defaultCashAccountId" TEXT,
    "defaultBankAccountId" TEXT,
    "defaultIncomeAccountId" TEXT,
    "defaultExpenseAccountId" TEXT,
    "defaultStockInHandAccountId" TEXT,
    "defaultCogsAccountId" TEXT,
    "defaultStockReceivedButNotBilledAccountId" TEXT,
    "defaultSalaryExpenseAccountId" TEXT,
    "defaultEmployeePayableAccountId" TEXT,
    "defaultStatutoryPayableAccountId" TEXT,
    "defaultFxGainLossAccountId" TEXT,
    "defaultLoanReceivableAccountId" TEXT,
    "defaultInterestIncomeAccountId" TEXT,
    "defaultRetainedEarningsAccountId" TEXT,
    "defaultRoundOffAccountId" TEXT,
    "defaultStockAdjustmentAccountId" TEXT,
    "defaultLoyaltyDiscountAccountId" TEXT,
    "defaultDeferredRevenueAccountId" TEXT,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercompany_journals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCompanyId" TEXT NOT NULL,
    "toCompanyId" TEXT NOT NULL,
    "fromJournalId" TEXT NOT NULL,
    "toJournalId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "fromCurrency" TEXT NOT NULL DEFAULT 'INR',
    "fromConversionRate" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "fromNativeAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "fromFxGainLoss" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "toCurrency" TEXT NOT NULL DEFAULT 'INR',
    "toConversionRate" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "toNativeAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "toFxGainLoss" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "narrative" TEXT,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "reversedById" TEXT,
    "reversesId" TEXT,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,

    CONSTRAINT "intercompany_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repost_item_valuations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Queued',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "slesReposted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repost_item_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_revenue_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesInvoiceItemId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "isBooked" BOOLEAN NOT NULL DEFAULT false,
    "bookedAt" TIMESTAMP(3),
    "bookedVoucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferred_revenue_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eway_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesInvoiceId" TEXT NOT NULL,
    "ewbNumber" TEXT NOT NULL,
    "ewbDate" DATE NOT NULL,
    "distanceKm" INTEGER NOT NULL,
    "cargoType" TEXT NOT NULL DEFAULT 'Normal',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "transportMode" INTEGER NOT NULL,
    "vehicleNumber" TEXT,
    "transporterId" TEXT,
    "transporterName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "partBUpdatedAt" TIMESTAMP(3),
    "extendedCount" INTEGER NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eway_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "warehouseId" TEXT,
    "priceListId" TEXT,
    "defaultCustomerId" TEXT,
    "incomeAccountId" TEXT,
    "letterheadId" TEXT,
    "paymentMethods" JSONB NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_opening_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "posProfileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closeTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "openingBalances" JSONB NOT NULL,
    "notes" TEXT,
    "customData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_opening_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_closing_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "posProfileId" TEXT NOT NULL,
    "openingEntryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "expectedByMode" JSONB NOT NULL,
    "countedByMode" JSONB NOT NULL,
    "differenceByMode" JSONB NOT NULL,
    "totalSales" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "totalDifference" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_closing_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "headHtml" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "authorName" TEXT,
    "category" TEXT,
    "featuredImage" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "publicSlug" TEXT NOT NULL,
    "webItemName" TEXT NOT NULL,
    "shortDescription" TEXT,
    "descriptionHtml" TEXT,
    "imageUrl" TEXT,
    "galleryUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webPrice" DECIMAL(18,4),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "componentItemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundle_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_envelopes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT,
    "sourceDoctype" TEXT,
    "sourceId" TEXT,
    "documentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "provider" TEXT NOT NULL DEFAULT 'Stub',
    "externalId" TEXT,
    "sequential" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "declineReason" TEXT,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deliveryNoteId" TEXT,
    "purchaseReceiptId" TEXT,
    "carrier" TEXT NOT NULL,
    "service" TEXT,
    "trackingNumber" TEXT,
    "labelUrl" TEXT,
    "costAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costCurrency" TEXT NOT NULL DEFAULT 'INR',
    "weightGrams" INTEGER,
    "dimensionsCm" TEXT,
    "fromAddress" JSONB NOT NULL,
    "toAddress" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "externalId" TEXT,
    "providerRateId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'EasyPost',
    "purchasedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academicYear" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" DECIMAL(4,1) NOT NULL DEFAULT 3,
    "instructorEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentCode" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "address" TEXT,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "section" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programId" TEXT,
    "academicYear" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "dueDayOfMonth" INTEGER,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_postings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feeScheduleId" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,4) NOT NULL,
    "dueDate" DATE NOT NULL,
    "salesInvoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Due',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxScore" DECIMAL(6,2) NOT NULL,
    "weightPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" DECIMAL(6,2) NOT NULL,
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedBy" TEXT,
    "comments" TEXT,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mrn" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "email" TEXT,
    "mobile" TEXT,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "allergies" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_appointments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "practitionerEmployeeId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Scheduled',
    "encounterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_encounters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "practitionerEmployeeId" TEXT NOT NULL,
    "encounterAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chiefComplaint" TEXT,
    "historyOfIllness" TEXT,
    "examinationFindings" TEXT,
    "diagnosis" TEXT,
    "treatmentPlan" TEXT,
    "followUpAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "durationDays" INTEGER,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "donorCode" TEXT NOT NULL,
    "donorName" TEXT NOT NULL,
    "donorType" TEXT NOT NULL DEFAULT 'Individual',
    "email" TEXT,
    "mobile" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "postingDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignName" TEXT,
    "paymentMethod" TEXT NOT NULL DEFAULT 'Bank',
    "reference" TEXT,
    "receiptIssued" BOOLEAN NOT NULL DEFAULT false,
    "receiptNumber" TEXT,
    "paymentEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "grantorName" TEXT NOT NULL,
    "grantCode" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "awardedOn" DATE NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "reportingCadence" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "donorId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentEntryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 2,
    "ratePerNight" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "floor" TEXT,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Available',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bookings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bookingCode" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "checkInDate" DATE NOT NULL,
    "checkOutDate" DATE NOT NULL,
    "actualCheckIn" TIMESTAMP(3),
    "actualCheckOut" TIMESTAMP(3),
    "ratePerNight" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'Booked',
    "customerId" TEXT,
    "salesInvoiceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "room_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "land_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "areaAcres" DECIMAL(10,4) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "soilType" TEXT,
    "irrigation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "land_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_cycles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "landUnitId" TEXT NOT NULL,
    "cropName" TEXT NOT NULL,
    "variety" TEXT,
    "sowingDate" DATE NOT NULL,
    "expectedHarvestDate" DATE,
    "actualHarvestDate" DATE,
    "seedQty" DECIMAL(10,2),
    "seedUom" TEXT,
    "expectedYield" DECIMAL(12,2),
    "actualYield" DECIMAL(12,2),
    "yieldUom" TEXT NOT NULL DEFAULT 'kg',
    "status" TEXT NOT NULL DEFAULT 'Sown',
    "totalCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalRevenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crop_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_activities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cropCycleId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quantity" DECIMAL(10,2),
    "uom" TEXT,
    "cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crop_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_company_access_tenantId_userId_idx" ON "user_company_access"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_access_userId_companyId_key" ON "user_company_access"("userId", "companyId");

-- CreateIndex
CREATE INDEX "invoice_payment_schedules_tenantId_salesInvoiceId_sortOrder_idx" ON "invoice_payment_schedules"("tenantId", "salesInvoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "invoice_payment_schedules_tenantId_purchaseInvoiceId_sortOr_idx" ON "invoice_payment_schedules"("tenantId", "purchaseInvoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "invoice_payment_schedules_tenantId_dueDate_status_idx" ON "invoice_payment_schedules"("tenantId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "kb_categories_tenantId_parentId_idx" ON "kb_categories"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "kb_categories_tenantId_slug_key" ON "kb_categories"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "kb_articles_tenantId_status_idx" ON "kb_articles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "kb_articles_tenantId_categoryId_idx" ON "kb_articles"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "kb_articles_tenantId_slug_key" ON "kb_articles"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "service_contracts_tenantId_customerId_idx" ON "service_contracts"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "service_contracts_tenantId_status_idx" ON "service_contracts"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_contracts_tenantId_name_key" ON "service_contracts"("tenantId", "name");

-- CreateIndex
CREATE INDEX "sales_invoice_sales_person_allocations_tenantId_salesPerson_idx" ON "sales_invoice_sales_person_allocations"("tenantId", "salesPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_sales_person_allocations_salesInvoiceId_sales_key" ON "sales_invoice_sales_person_allocations"("salesInvoiceId", "salesPersonId");

-- CreateIndex
CREATE INDEX "payment_reminders_tenantId_salesInvoiceId_createdAt_idx" ON "payment_reminders"("tenantId", "salesInvoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_reminders_tenantId_paymentScheduleId_createdAt_idx" ON "payment_reminders"("tenantId", "paymentScheduleId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_reminders_tenantId_createdAt_idx" ON "payment_reminders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "blanket_orders_tenantId_status_idx" ON "blanket_orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "blanket_orders_tenantId_name_key" ON "blanket_orders"("tenantId", "name");

-- CreateIndex
CREATE INDEX "blanket_order_items_blanketOrderId_idx" ON "blanket_order_items"("blanketOrderId");

-- CreateIndex
CREATE INDEX "pick_lists_tenantId_status_idx" ON "pick_lists"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pick_lists_tenantId_name_key" ON "pick_lists"("tenantId", "name");

-- CreateIndex
CREATE INDEX "pick_list_items_pickListId_idx" ON "pick_list_items"("pickListId");

-- CreateIndex
CREATE INDEX "pick_list_items_deliveryNoteItemId_idx" ON "pick_list_items"("deliveryNoteItemId");

-- CreateIndex
CREATE INDEX "delivery_trips_tenantId_status_idx" ON "delivery_trips"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_trips_tenantId_name_key" ON "delivery_trips"("tenantId", "name");

-- CreateIndex
CREATE INDEX "delivery_trip_stops_deliveryTripId_idx" ON "delivery_trip_stops"("deliveryTripId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_trip_stops_deliveryTripId_sequence_key" ON "delivery_trip_stops"("deliveryTripId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_trip_stops_deliveryTripId_deliveryNoteId_key" ON "delivery_trip_stops"("deliveryTripId", "deliveryNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "request_for_quotations_awardedSupplierQuotationId_key" ON "request_for_quotations"("awardedSupplierQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "request_for_quotations_awardedPurchaseOrderId_key" ON "request_for_quotations"("awardedPurchaseOrderId");

-- CreateIndex
CREATE INDEX "request_for_quotations_tenantId_status_idx" ON "request_for_quotations"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "request_for_quotations_tenantId_name_key" ON "request_for_quotations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "rfq_items_rfqId_idx" ON "rfq_items"("rfqId");

-- CreateIndex
CREATE INDEX "rfq_suppliers_rfqId_idx" ON "rfq_suppliers"("rfqId");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_suppliers_rfqId_supplierId_key" ON "rfq_suppliers"("rfqId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_quotations_tenantId_status_idx" ON "supplier_quotations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "supplier_quotations_rfqId_supplierId_idx" ON "supplier_quotations"("rfqId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotations_tenantId_name_key" ON "supplier_quotations"("tenantId", "name");

-- CreateIndex
CREATE INDEX "supplier_quotation_items_supplierQuotationId_idx" ON "supplier_quotation_items"("supplierQuotationId");

-- CreateIndex
CREATE INDEX "supplier_quotation_items_rfqItemId_idx" ON "supplier_quotation_items"("rfqItemId");

-- CreateIndex
CREATE INDEX "supplier_scorecards_tenantId_isActive_idx" ON "supplier_scorecards"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scorecards_tenantId_supplierId_key" ON "supplier_scorecards"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scorecard_criteria_scorecardId_formula_key" ON "supplier_scorecard_criteria"("scorecardId", "formula");

-- CreateIndex
CREATE INDEX "supplier_scorecard_periods_scorecardId_computedAt_idx" ON "supplier_scorecard_periods"("scorecardId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_scorecard_periods_scorecardId_fromDate_toDate_key" ON "supplier_scorecard_periods"("scorecardId", "fromDate", "toDate");

-- CreateIndex
CREATE INDEX "lead_score_rules_tenantId_enabled_idx" ON "lead_score_rules"("tenantId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "lead_score_rules_tenantId_name_key" ON "lead_score_rules"("tenantId", "name");

-- CreateIndex
CREATE INDEX "pipeline_blueprints_tenantId_doctype_active_idx" ON "pipeline_blueprints"("tenantId", "doctype", "active");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_blueprints_tenantId_doctype_name_key" ON "pipeline_blueprints"("tenantId", "doctype", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_blueprint_stages_blueprintId_stageKey_key" ON "pipeline_blueprint_stages"("blueprintId", "stageKey");

-- CreateIndex
CREATE INDEX "employee_onboardings_tenantId_status_idx" ON "employee_onboardings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_onboardings_tenantId_employeeId_key" ON "employee_onboardings"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_onboarding_tasks_onboardingId_idx" ON "employee_onboarding_tasks"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_onboarding_tasks_onboardingId_sequence_key" ON "employee_onboarding_tasks"("onboardingId", "sequence");

-- CreateIndex
CREATE INDEX "employee_separations_tenantId_status_idx" ON "employee_separations"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_separations_tenantId_employeeId_key" ON "employee_separations"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "employee_separation_tasks_separationId_idx" ON "employee_separation_tasks"("separationId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_separation_tasks_separationId_sequence_key" ON "employee_separation_tasks"("separationId", "sequence");

-- CreateIndex
CREATE INDEX "item_alternates_tenantId_itemId_idx" ON "item_alternates"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "item_alternates_tenantId_itemId_alternateItemId_key" ON "item_alternates"("tenantId", "itemId", "alternateItemId");

-- CreateIndex
CREATE INDEX "non_conformances_tenantId_status_idx" ON "non_conformances"("tenantId", "status");

-- CreateIndex
CREATE INDEX "non_conformances_tenantId_severity_idx" ON "non_conformances"("tenantId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "non_conformances_tenantId_name_key" ON "non_conformances"("tenantId", "name");

-- CreateIndex
CREATE INDEX "appraisal_feedback_rounds_appraisalId_audience_idx" ON "appraisal_feedback_rounds"("appraisalId", "audience");

-- CreateIndex
CREATE INDEX "appraisal_feedback_responses_roundId_submittedAt_idx" ON "appraisal_feedback_responses"("roundId", "submittedAt");

-- CreateIndex
CREATE INDEX "issues_tenantId_projectId_status_idx" ON "issues"("tenantId", "projectId", "status");

-- CreateIndex
CREATE INDEX "issues_tenantId_assignedEmployeeId_status_idx" ON "issues"("tenantId", "assignedEmployeeId", "status");

-- CreateIndex
CREATE INDEX "issues_tenantId_sprintId_idx" ON "issues"("tenantId", "sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "issues_tenantId_name_key" ON "issues"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "running_timers_userId_key" ON "running_timers"("userId");

-- CreateIndex
CREATE INDEX "running_timers_tenantId_employeeId_idx" ON "running_timers"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "vehicles_tenantId_disabled_idx" ON "vehicles"("tenantId", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_tenantId_licensePlate_key" ON "vehicles"("tenantId", "licensePlate");

-- CreateIndex
CREATE INDEX "vehicle_logs_tenantId_vehicleId_idx" ON "vehicle_logs"("tenantId", "vehicleId");

-- CreateIndex
CREATE INDEX "vehicle_logs_tenantId_logDate_idx" ON "vehicle_logs"("tenantId", "logDate");

-- CreateIndex
CREATE INDEX "ai_extraction_jobs_tenantId_status_idx" ON "ai_extraction_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_extraction_jobs_tenantId_createdAt_idx" ON "ai_extraction_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_ticket_suggestions_tenantId_createdAt_idx" ON "ai_ticket_suggestions"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_ticket_suggestions_ticketId_key" ON "ai_ticket_suggestions"("ticketId");

-- CreateIndex
CREATE INDEX "duplicate_reviews_tenantId_doctype_status_idx" ON "duplicate_reviews"("tenantId", "doctype", "status");

-- CreateIndex
CREATE INDEX "duplicate_reviews_tenantId_score_idx" ON "duplicate_reviews"("tenantId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_reviews_tenantId_doctype_leftId_rightId_key" ON "duplicate_reviews"("tenantId", "doctype", "leftId", "rightId");

-- CreateIndex
CREATE INDEX "duplicate_merges_tenantId_doctype_idx" ON "duplicate_merges"("tenantId", "doctype");

-- CreateIndex
CREATE INDEX "duplicate_merges_tenantId_mergedAt_idx" ON "duplicate_merges"("tenantId", "mergedAt");

-- CreateIndex
CREATE UNIQUE INDEX "fx_revaluation_runs_journalEntryId_key" ON "fx_revaluation_runs"("journalEntryId");

-- CreateIndex
CREATE INDEX "fx_revaluation_runs_tenantId_asOfDate_idx" ON "fx_revaluation_runs"("tenantId", "asOfDate");

-- CreateIndex
CREATE INDEX "fx_revaluation_runs_tenantId_status_idx" ON "fx_revaluation_runs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "meeting_types_tenantId_ownerUserId_active_idx" ON "meeting_types"("tenantId", "ownerUserId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_types_tenantId_slug_key" ON "meeting_types"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "availability_windows_tenantId_ownerUserId_dayOfWeek_idx" ON "availability_windows"("tenantId", "ownerUserId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "booked_meetings_cancellationToken_key" ON "booked_meetings"("cancellationToken");

-- CreateIndex
CREATE INDEX "booked_meetings_tenantId_ownerUserId_startsAt_idx" ON "booked_meetings"("tenantId", "ownerUserId", "startsAt");

-- CreateIndex
CREATE INDEX "booked_meetings_tenantId_meetingTypeId_startsAt_idx" ON "booked_meetings"("tenantId", "meetingTypeId", "startsAt");

-- CreateIndex
CREATE INDEX "booked_meetings_tenantId_status_startsAt_idx" ON "booked_meetings"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "booked_meetings_status_reminderSentAt_startsAt_idx" ON "booked_meetings"("status", "reminderSentAt", "startsAt");

-- CreateIndex
CREATE INDEX "companies_tenantId_isDefault_idx" ON "companies"("tenantId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenantId_code_key" ON "companies"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "companies_tenantId_name_key" ON "companies"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_journals_fromJournalId_key" ON "intercompany_journals"("fromJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_journals_toJournalId_key" ON "intercompany_journals"("toJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_journals_reversedById_key" ON "intercompany_journals"("reversedById");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_journals_reversesId_key" ON "intercompany_journals"("reversesId");

-- CreateIndex
CREATE INDEX "intercompany_journals_tenantId_postingDate_idx" ON "intercompany_journals"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "repost_item_valuations_tenantId_status_createdAt_idx" ON "repost_item_valuations"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "repost_item_valuations_tenantId_itemId_warehouseId_idx" ON "repost_item_valuations"("tenantId", "itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "deferred_revenue_schedules_tenantId_dueDate_isBooked_idx" ON "deferred_revenue_schedules"("tenantId", "dueDate", "isBooked");

-- CreateIndex
CREATE UNIQUE INDEX "deferred_revenue_schedules_salesInvoiceItemId_installmentNo_key" ON "deferred_revenue_schedules"("salesInvoiceItemId", "installmentNo");

-- CreateIndex
CREATE INDEX "eway_bills_tenantId_salesInvoiceId_idx" ON "eway_bills"("tenantId", "salesInvoiceId");

-- CreateIndex
CREATE INDEX "eway_bills_tenantId_status_validTo_idx" ON "eway_bills"("tenantId", "status", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bills_tenantId_ewbNumber_key" ON "eway_bills"("tenantId", "ewbNumber");

-- CreateIndex
CREATE INDEX "pos_profiles_tenantId_disabled_idx" ON "pos_profiles"("tenantId", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "pos_profiles_tenantId_name_key" ON "pos_profiles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "pos_opening_entries_tenantId_status_idx" ON "pos_opening_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "pos_opening_entries_tenantId_userId_status_idx" ON "pos_opening_entries"("tenantId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_opening_entries_tenantId_name_key" ON "pos_opening_entries"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pos_closing_entries_openingEntryId_key" ON "pos_closing_entries"("openingEntryId");

-- CreateIndex
CREATE INDEX "pos_closing_entries_tenantId_status_idx" ON "pos_closing_entries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "pos_closing_entries_tenantId_postingDate_idx" ON "pos_closing_entries"("tenantId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "pos_closing_entries_tenantId_name_key" ON "pos_closing_entries"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "web_pages_publicSlug_key" ON "web_pages"("publicSlug");

-- CreateIndex
CREATE INDEX "web_pages_tenantId_isPublished_idx" ON "web_pages"("tenantId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "web_pages_tenantId_name_key" ON "web_pages"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_publicSlug_key" ON "blog_posts"("publicSlug");

-- CreateIndex
CREATE INDEX "blog_posts_tenantId_isPublished_publishedAt_idx" ON "blog_posts"("tenantId", "isPublished", "publishedAt");

-- CreateIndex
CREATE INDEX "blog_posts_tenantId_category_idx" ON "blog_posts"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_tenantId_name_key" ON "blog_posts"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "website_items_itemId_key" ON "website_items"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "website_items_publicSlug_key" ON "website_items"("publicSlug");

-- CreateIndex
CREATE INDEX "website_items_tenantId_isPublished_idx" ON "website_items"("tenantId", "isPublished");

-- CreateIndex
CREATE INDEX "bundle_components_tenantId_parentItemId_idx" ON "bundle_components"("tenantId", "parentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_components_tenantId_parentItemId_componentItemId_key" ON "bundle_components"("tenantId", "parentItemId", "componentItemId");

-- CreateIndex
CREATE INDEX "signature_envelopes_tenantId_status_idx" ON "signature_envelopes"("tenantId", "status");

-- CreateIndex
CREATE INDEX "signature_envelopes_tenantId_sourceDoctype_sourceId_idx" ON "signature_envelopes"("tenantId", "sourceDoctype", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "signature_envelopes_tenantId_name_key" ON "signature_envelopes"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "signature_requests_accessToken_key" ON "signature_requests"("accessToken");

-- CreateIndex
CREATE INDEX "signature_requests_envelopeId_order_idx" ON "signature_requests"("envelopeId", "order");

-- CreateIndex
CREATE INDEX "signature_requests_tenantId_signerEmail_status_idx" ON "signature_requests"("tenantId", "signerEmail", "status");

-- CreateIndex
CREATE INDEX "shipments_tenantId_status_idx" ON "shipments"("tenantId", "status");

-- CreateIndex
CREATE INDEX "shipments_tenantId_deliveryNoteId_idx" ON "shipments"("tenantId", "deliveryNoteId");

-- CreateIndex
CREATE INDEX "shipments_tenantId_purchaseReceiptId_idx" ON "shipments"("tenantId", "purchaseReceiptId");

-- CreateIndex
CREATE INDEX "shipments_tenantId_trackingNumber_idx" ON "shipments"("tenantId", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tenantId_name_key" ON "shipments"("tenantId", "name");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_ts_idx" ON "shipment_events"("shipmentId", "ts");

-- CreateIndex
CREATE INDEX "programs_tenantId_active_idx" ON "programs"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "programs_tenantId_code_key" ON "programs"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "courses_tenantId_programId_code_key" ON "courses"("tenantId", "programId", "code");

-- CreateIndex
CREATE INDEX "students_tenantId_status_idx" ON "students"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenantId_studentCode_key" ON "students"("tenantId", "studentCode");

-- CreateIndex
CREATE INDEX "student_enrollments_tenantId_programId_status_idx" ON "student_enrollments"("tenantId", "programId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_enrollments_studentId_programId_academicYear_key" ON "student_enrollments"("studentId", "programId", "academicYear");

-- CreateIndex
CREATE INDEX "fee_schedules_tenantId_active_idx" ON "fee_schedules"("tenantId", "active");

-- CreateIndex
CREATE INDEX "fee_postings_tenantId_studentId_status_idx" ON "fee_postings"("tenantId", "studentId", "status");

-- CreateIndex
CREATE INDEX "fee_postings_tenantId_dueDate_idx" ON "fee_postings"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "assessments_tenantId_courseId_idx" ON "assessments"("tenantId", "courseId");

-- CreateIndex
CREATE INDEX "assessment_results_tenantId_studentId_idx" ON "assessment_results"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_assessmentId_studentId_key" ON "assessment_results"("assessmentId", "studentId");

-- CreateIndex
CREATE INDEX "patients_tenantId_status_idx" ON "patients"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenantId_mrn_key" ON "patients"("tenantId", "mrn");

-- CreateIndex
CREATE INDEX "patient_appointments_tenantId_patientId_startAt_idx" ON "patient_appointments"("tenantId", "patientId", "startAt");

-- CreateIndex
CREATE INDEX "patient_appointments_tenantId_practitionerEmployeeId_startA_idx" ON "patient_appointments"("tenantId", "practitionerEmployeeId", "startAt");

-- CreateIndex
CREATE INDEX "patient_appointments_tenantId_status_startAt_idx" ON "patient_appointments"("tenantId", "status", "startAt");

-- CreateIndex
CREATE INDEX "patient_encounters_tenantId_patientId_encounterAt_idx" ON "patient_encounters"("tenantId", "patientId", "encounterAt");

-- CreateIndex
CREATE INDEX "prescriptions_encounterId_idx" ON "prescriptions"("encounterId");

-- CreateIndex
CREATE UNIQUE INDEX "donors_tenantId_donorCode_key" ON "donors"("tenantId", "donorCode");

-- CreateIndex
CREATE INDEX "donations_tenantId_donorId_postingDate_idx" ON "donations"("tenantId", "donorId", "postingDate");

-- CreateIndex
CREATE INDEX "grants_tenantId_status_idx" ON "grants"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "grants_tenantId_grantCode_key" ON "grants"("tenantId", "grantCode");

-- CreateIndex
CREATE INDEX "memberships_tenantId_donorId_status_idx" ON "memberships"("tenantId", "donorId", "status");

-- CreateIndex
CREATE INDEX "memberships_tenantId_endDate_idx" ON "memberships"("tenantId", "endDate");

-- CreateIndex
CREATE INDEX "rooms_tenantId_status_idx" ON "rooms"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenantId_roomNumber_key" ON "rooms"("tenantId", "roomNumber");

-- CreateIndex
CREATE INDEX "room_bookings_tenantId_roomId_checkInDate_idx" ON "room_bookings"("tenantId", "roomId", "checkInDate");

-- CreateIndex
CREATE INDEX "room_bookings_tenantId_status_checkInDate_idx" ON "room_bookings"("tenantId", "status", "checkInDate");

-- CreateIndex
CREATE UNIQUE INDEX "room_bookings_tenantId_bookingCode_key" ON "room_bookings"("tenantId", "bookingCode");

-- CreateIndex
CREATE INDEX "land_units_tenantId_status_idx" ON "land_units"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "land_units_tenantId_name_key" ON "land_units"("tenantId", "name");

-- CreateIndex
CREATE INDEX "crop_cycles_tenantId_landUnitId_status_idx" ON "crop_cycles"("tenantId", "landUnitId", "status");

-- CreateIndex
CREATE INDEX "crop_cycles_tenantId_status_idx" ON "crop_cycles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "crop_activities_tenantId_cropCycleId_performedAt_idx" ON "crop_activities"("tenantId", "cropCycleId", "performedAt");

-- CreateIndex
CREATE INDEX "employees_tenantId_managerId_idx" ON "employees"("tenantId", "managerId");

-- CreateIndex
CREATE INDEX "gl_entries_tenantId_companyId_postingDate_idx" ON "gl_entries"("tenantId", "companyId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversedByJournalId_key" ON "journal_entries"("reversedByJournalId");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_isReversing_reverseOnDate_idx" ON "journal_entries"("tenantId", "isReversing", "reverseOnDate");

-- CreateIndex
CREATE INDEX "leads_tenantId_score_idx" ON "leads"("tenantId", "score");

-- CreateIndex
CREATE INDEX "purchase_order_items_sourceSalesOrderLineId_idx" ON "purchase_order_items"("sourceSalesOrderLineId");

-- CreateIndex
CREATE INDEX "quotations_tenantId_opportunityId_idx" ON "quotations"("tenantId", "opportunityId");

-- CreateIndex
CREATE INDEX "sales_invoices_tenantId_posOpeningId_idx" ON "sales_invoices"("tenantId", "posOpeningId");

-- CreateIndex
CREATE INDEX "sales_invoices_tenantId_sourceRecurringId_idx" ON "sales_invoices"("tenantId", "sourceRecurringId");

-- CreateIndex
CREATE INDEX "stock_entries_tenantId_inTransitWarehouseId_status_idx" ON "stock_entries"("tenantId", "inTransitWarehouseId", "status");

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_schedules" ADD CONSTRAINT "invoice_payment_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_schedules" ADD CONSTRAINT "invoice_payment_schedules_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_payment_schedules" ADD CONSTRAINT "invoice_payment_schedules_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "desk_sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_defaultPaymentTermsTemplateId_fkey" FOREIGN KEY ("defaultPaymentTermsTemplateId") REFERENCES "payment_terms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_defaultPaymentTermsTemplateId_fkey" FOREIGN KEY ("defaultPaymentTermsTemplateId") REFERENCES "payment_terms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_variantOfId_fkey" FOREIGN KEY ("variantOfId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_posProfileId_fkey" FOREIGN KEY ("posProfileId") REFERENCES "pos_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_posOpeningId_fkey" FOREIGN KEY ("posOpeningId") REFERENCES "pos_opening_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sourceRecurringId_fkey" FOREIGN KEY ("sourceRecurringId") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_paymentTermsTemplateId_fkey" FOREIGN KEY ("paymentTermsTemplateId") REFERENCES "payment_terms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_sales_person_allocations" ADD CONSTRAINT "sales_invoice_sales_person_allocations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_sales_person_allocations" ADD CONSTRAINT "sales_invoice_sales_person_allocations_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_sales_person_allocations" ADD CONSTRAINT "sales_invoice_sales_person_allocations_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "sales_persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_paymentScheduleId_fkey" FOREIGN KEY ("paymentScheduleId") REFERENCES "invoice_payment_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_paymentTermsTemplateId_fkey" FOREIGN KEY ("paymentTermsTemplateId") REFERENCES "payment_terms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversedByJournalId_fkey" FOREIGN KEY ("reversedByJournalId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_inTransitWarehouseId_fkey" FOREIGN KEY ("inTransitWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blanket_orders" ADD CONSTRAINT "blanket_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blanket_orders" ADD CONSTRAINT "blanket_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blanket_orders" ADD CONSTRAINT "blanket_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blanket_order_items" ADD CONSTRAINT "blanket_order_items_blanketOrderId_fkey" FOREIGN KEY ("blanketOrderId") REFERENCES "blanket_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blanket_order_items" ADD CONSTRAINT "blanket_order_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_lists" ADD CONSTRAINT "pick_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_list_items" ADD CONSTRAINT "pick_list_items_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "pick_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_list_items" ADD CONSTRAINT "pick_list_items_deliveryNoteItemId_fkey" FOREIGN KEY ("deliveryNoteItemId") REFERENCES "delivery_note_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_list_items" ADD CONSTRAINT "pick_list_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pick_list_items" ADD CONSTRAINT "pick_list_items_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trips" ADD CONSTRAINT "delivery_trips_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trip_stops" ADD CONSTRAINT "delivery_trip_stops_deliveryTripId_fkey" FOREIGN KEY ("deliveryTripId") REFERENCES "delivery_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_trip_stops" ADD CONSTRAINT "delivery_trip_stops_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_awardedSupplierQuotationId_fkey" FOREIGN KEY ("awardedSupplierQuotationId") REFERENCES "supplier_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_awardedPurchaseOrderId_fkey" FOREIGN KEY ("awardedPurchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_materialRequestItemId_fkey" FOREIGN KEY ("materialRequestItemId") REFERENCES "material_request_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_items" ADD CONSTRAINT "supplier_quotation_items_supplierQuotationId_fkey" FOREIGN KEY ("supplierQuotationId") REFERENCES "supplier_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_items" ADD CONSTRAINT "supplier_quotation_items_rfqItemId_fkey" FOREIGN KEY ("rfqItemId") REFERENCES "rfq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_items" ADD CONSTRAINT "supplier_quotation_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scorecards" ADD CONSTRAINT "supplier_scorecards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scorecards" ADD CONSTRAINT "supplier_scorecards_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scorecard_criteria" ADD CONSTRAINT "supplier_scorecard_criteria_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "supplier_scorecards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_scorecard_periods" ADD CONSTRAINT "supplier_scorecard_periods_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "supplier_scorecards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_sourceSalesOrderLineId_fkey" FOREIGN KEY ("sourceSalesOrderLineId") REFERENCES "sales_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_score_rules" ADD CONSTRAINT "lead_score_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_blueprints" ADD CONSTRAINT "pipeline_blueprints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_blueprint_stages" ADD CONSTRAINT "pipeline_blueprint_stages_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "pipeline_blueprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_onboardings" ADD CONSTRAINT "employee_onboardings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_onboardings" ADD CONSTRAINT "employee_onboardings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_onboarding_tasks" ADD CONSTRAINT "employee_onboarding_tasks_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "employee_onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_separations" ADD CONSTRAINT "employee_separations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_separations" ADD CONSTRAINT "employee_separations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_separation_tasks" ADD CONSTRAINT "employee_separation_tasks_separationId_fkey" FOREIGN KEY ("separationId") REFERENCES "employee_separations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_alternates" ADD CONSTRAINT "item_alternates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_alternates" ADD CONSTRAINT "item_alternates_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_alternates" ADD CONSTRAINT "item_alternates_alternateItemId_fkey" FOREIGN KEY ("alternateItemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "non_conformances" ADD CONSTRAINT "non_conformances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_feedback_rounds" ADD CONSTRAINT "appraisal_feedback_rounds_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "appraisals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisal_feedback_responses" ADD CONSTRAINT "appraisal_feedback_responses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "appraisal_feedback_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_logs" ADD CONSTRAINT "vehicle_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_logs" ADD CONSTRAINT "vehicle_logs_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_logs" ADD CONSTRAINT "vehicle_logs_expenseClaimId_fkey" FOREIGN KEY ("expenseClaimId") REFERENCES "expense_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_extraction_jobs" ADD CONSTRAINT "ai_extraction_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_ticket_suggestions" ADD CONSTRAINT "ai_ticket_suggestions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_ticket_suggestions" ADD CONSTRAINT "ai_ticket_suggestions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "desk_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_reviews" ADD CONSTRAINT "duplicate_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_merges" ADD CONSTRAINT "duplicate_merges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_revaluation_runs" ADD CONSTRAINT "fx_revaluation_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_types" ADD CONSTRAINT "meeting_types_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_windows" ADD CONSTRAINT "availability_windows_meetingTypeId_fkey" FOREIGN KEY ("meetingTypeId") REFERENCES "meeting_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booked_meetings" ADD CONSTRAINT "booked_meetings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booked_meetings" ADD CONSTRAINT "booked_meetings_meetingTypeId_fkey" FOREIGN KEY ("meetingTypeId") REFERENCES "meeting_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_fromCompanyId_fkey" FOREIGN KEY ("fromCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_toCompanyId_fkey" FOREIGN KEY ("toCompanyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_fromJournalId_fkey" FOREIGN KEY ("fromJournalId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_toJournalId_fkey" FOREIGN KEY ("toJournalId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "intercompany_journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repost_item_valuations" ADD CONSTRAINT "repost_item_valuations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repost_item_valuations" ADD CONSTRAINT "repost_item_valuations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repost_item_valuations" ADD CONSTRAINT "repost_item_valuations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_revenue_schedules" ADD CONSTRAINT "deferred_revenue_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_revenue_schedules" ADD CONSTRAINT "deferred_revenue_schedules_salesInvoiceItemId_fkey" FOREIGN KEY ("salesInvoiceItemId") REFERENCES "sales_invoice_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_defaultCustomerId_fkey" FOREIGN KEY ("defaultCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_profiles" ADD CONSTRAINT "pos_profiles_letterheadId_fkey" FOREIGN KEY ("letterheadId") REFERENCES "letterheads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_opening_entries" ADD CONSTRAINT "pos_opening_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_opening_entries" ADD CONSTRAINT "pos_opening_entries_posProfileId_fkey" FOREIGN KEY ("posProfileId") REFERENCES "pos_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_opening_entries" ADD CONSTRAINT "pos_opening_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_closing_entries" ADD CONSTRAINT "pos_closing_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_closing_entries" ADD CONSTRAINT "pos_closing_entries_posProfileId_fkey" FOREIGN KEY ("posProfileId") REFERENCES "pos_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_closing_entries" ADD CONSTRAINT "pos_closing_entries_openingEntryId_fkey" FOREIGN KEY ("openingEntryId") REFERENCES "pos_opening_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_closing_entries" ADD CONSTRAINT "pos_closing_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_pages" ADD CONSTRAINT "web_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_items" ADD CONSTRAINT "website_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_items" ADD CONSTRAINT "website_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_componentItemId_fkey" FOREIGN KEY ("componentItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_envelopes" ADD CONSTRAINT "signature_envelopes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "signature_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_instructorEmployeeId_fkey" FOREIGN KEY ("instructorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_enrollments" ADD CONSTRAINT "student_enrollments_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_postings" ADD CONSTRAINT "fee_postings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_postings" ADD CONSTRAINT "fee_postings_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_postings" ADD CONSTRAINT "fee_postings_feeScheduleId_fkey" FOREIGN KEY ("feeScheduleId") REFERENCES "fee_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_appointments" ADD CONSTRAINT "patient_appointments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_appointments" ADD CONSTRAINT "patient_appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_appointments" ADD CONSTRAINT "patient_appointments_practitionerEmployeeId_fkey" FOREIGN KEY ("practitionerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_appointments" ADD CONSTRAINT "patient_appointments_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "patient_encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_encounters" ADD CONSTRAINT "patient_encounters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_encounters" ADD CONSTRAINT "patient_encounters_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_encounters" ADD CONSTRAINT "patient_encounters_practitionerEmployeeId_fkey" FOREIGN KEY ("practitionerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "patient_encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donors" ADD CONSTRAINT "donors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grants" ADD CONSTRAINT "grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "land_units" ADD CONSTRAINT "land_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_cycles" ADD CONSTRAINT "crop_cycles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_cycles" ADD CONSTRAINT "crop_cycles_landUnitId_fkey" FOREIGN KEY ("landUnitId") REFERENCES "land_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_activities" ADD CONSTRAINT "crop_activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_activities" ADD CONSTRAINT "crop_activities_cropCycleId_fkey" FOREIGN KEY ("cropCycleId") REFERENCES "crop_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

