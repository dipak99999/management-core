-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "employeeCategoryId" TEXT,
ADD COLUMN     "workGroupId" TEXT;

-- CreateTable
CREATE TABLE "leave_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "entryType" TEXT NOT NULL,
    "leaves" DECIMAL(9,2) NOT NULL,
    "balanceAfter" DECIMAL(9,2) NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "workGroupId" TEXT,
    "employeeCategoryId" TEXT,
    "isCarryForward" BOOLEAN NOT NULL DEFAULT false,
    "isExpired" BOOLEAN NOT NULL DEFAULT false,
    "isEncashment" BOOLEAN NOT NULL DEFAULT false,
    "sourceDoctype" TEXT,
    "sourceDocId" TEXT,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approver_hierarchies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "approverEmployeeId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "scope" TEXT NOT NULL DEFAULT 'Leave',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approver_hierarchies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "budget" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warrantyType" TEXT NOT NULL,
    "serialNo" TEXT,
    "itemId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "claimNo" TEXT,
    "claimDate" DATE,
    "amount" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "resolution" TEXT,
    "reportedBy" TEXT,
    "assignedTo" TEXT,
    "description" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_warranties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT,
    "itemId" TEXT,
    "purchaseDate" DATE NOT NULL,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 12,
    "expiryDate" DATE,
    "invoiceNo" TEXT,
    "amount" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_captures" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyM" DECIMAL(8,2),
    "address" TEXT,
    "purpose" TEXT,
    "refDoctype" TEXT,
    "refDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_dealers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dealerCode" TEXT NOT NULL,
    "dealerName" TEXT NOT NULL,
    "dealerType" TEXT,
    "region" TEXT,
    "territory" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "registeredAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_dealers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_targets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "employeeId" TEXT,
    "territoryId" TEXT,
    "itemGroupId" TEXT,
    "periodType" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "targetQty" DECIMAL(18,4),
    "targetAmount" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_target_actuals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetId" TEXT,
    "ownerUserId" TEXT,
    "employeeId" TEXT,
    "postingDate" DATE NOT NULL,
    "actualQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actualAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceDoctype" TEXT,
    "sourceDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_target_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "employeeId" TEXT,
    "weekStartDate" DATE NOT NULL,
    "planTitle" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_plan_items" (
    "id" TEXT NOT NULL,
    "workPlanId" TEXT NOT NULL,
    "dayOffset" INTEGER NOT NULL,
    "activity" TEXT NOT NULL,
    "target" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "work_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_worksheets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "employeeId" TEXT,
    "postingDate" DATE NOT NULL,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "quotesGiven" INTEGER NOT NULL DEFAULT 0,
    "ordersBooked" INTEGER NOT NULL DEFAULT 0,
    "amountBooked" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "distanceKm" DECIMAL(9,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_worksheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_processes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "category" TEXT,
    "ownerUserId" TEXT,
    "currentStep" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "slaTargetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_plannings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "customerId" TEXT,
    "ownerUserId" TEXT,
    "startDate" DATE,
    "targetDate" DATE,
    "budgetAmount" DECIMAL(18,4),
    "currentStage" TEXT,
    "progressPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_plannings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issueNo" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "sourceWarehouseId" TEXT,
    "purpose" TEXT,
    "requestedBy" TEXT,
    "issuedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "stockEntryId" TEXT,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issue_items" (
    "id" TEXT NOT NULL,
    "materialIssueId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchNo" TEXT,
    "serialNo" TEXT,

    CONSTRAINT "material_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_transfers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "sourceWarehouseId" TEXT,
    "targetWarehouseId" TEXT,
    "requestedBy" TEXT,
    "transferredBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "stockEntryId" TEXT,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_transfer_items" (
    "id" TEXT NOT NULL,
    "materialTransferId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchNo" TEXT,

    CONSTRAINT "material_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_returns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "returnType" TEXT NOT NULL,
    "againstDoctype" TEXT,
    "againstDocId" TEXT,
    "supplierId" TEXT,
    "warehouseId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "stockEntryId" TEXT,
    "totalQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_return_items" (
    "id" TEXT NOT NULL,
    "materialReturnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "material_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weighments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "weighmentNo" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "vehicleNo" TEXT NOT NULL,
    "driverName" TEXT,
    "transporter" TEXT,
    "itemId" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "weighmentType" TEXT NOT NULL,
    "grossWeight" DECIMAL(12,3) NOT NULL,
    "tareWeight" DECIMAL(12,3) NOT NULL,
    "netWeight" DECIMAL(12,3) NOT NULL,
    "moisturePct" DECIMAL(5,2),
    "quality" TEXT,
    "rate" DECIMAL(18,4),
    "amount" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'Weighed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weighments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inward_outward_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "noteNo" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "noteType" TEXT NOT NULL,
    "vehicleNo" TEXT,
    "weighmentId" TEXT,
    "refDoctype" TEXT,
    "refDocId" TEXT,
    "driverName" TEXT,
    "purpose" TEXT,
    "gatePassNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inward_outward_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_enquiries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enquiryNo" TEXT NOT NULL,
    "enquiryDate" DATE NOT NULL,
    "customerId" TEXT,
    "leadId" TEXT,
    "distributorId" TEXT,
    "channel" TEXT,
    "source" TEXT,
    "ownerUserId" TEXT,
    "itemDescription" TEXT,
    "totalQty" DECIMAL(18,4),
    "status" TEXT NOT NULL DEFAULT 'Open',
    "followUpDate" DATE,
    "closingReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_enquiry_items" (
    "id" TEXT NOT NULL,
    "salesEnquiryId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemDescription" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "targetRate" DECIMAL(18,4),
    "targetAmount" DECIMAL(18,4),

    CONSTRAINT "sales_enquiry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "horizonDays" INTEGER NOT NULL DEFAULT 30,
    "scope" TEXT,
    "siteFilter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "triggeredBy" TEXT,
    "suggestionsCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mrp_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mrp_suggestions" (
    "id" TEXT NOT NULL,
    "mrpRunId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "requiredQty" DECIMAL(18,4) NOT NULL,
    "onHandQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "suggestedQty" DECIMAL(18,4) NOT NULL,
    "actionType" TEXT NOT NULL,
    "requiredBy" DATE,
    "status" TEXT NOT NULL DEFAULT 'Suggested',

    CONSTRAINT "mrp_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_site_plannings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "reorderLevel" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reorderQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "maxLevel" DECIMAL(18,4),
    "safetyStock" DECIMAL(18,4),
    "leadTimeDays" INTEGER,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_site_plannings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_masters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "routingName" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_operations" (
    "id" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "operationName" TEXT NOT NULL,
    "workstationId" TEXT,
    "timeInMins" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "setupTimeMins" DECIMAL(10,2),
    "scrapPct" DECIMAL(5,2),
    "notes" TEXT,

    CONSTRAINT "routing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestNo" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "machineName" TEXT NOT NULL,
    "workstationId" TEXT,
    "requesterName" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "requestType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "assignedTo" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scheduleName" TEXT NOT NULL,
    "workstationId" TEXT,
    "machineName" TEXT,
    "intervalDays" INTEGER NOT NULL DEFAULT 30,
    "nextDueDate" DATE NOT NULL,
    "lastDoneDate" DATE,
    "scheduleType" TEXT NOT NULL DEFAULT 'Preventive',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_loggers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workstationId" TEXT,
    "machineName" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL,
    "loggedBy" TEXT,
    "eventType" TEXT NOT NULL,
    "parameter" TEXT,
    "value" DECIMAL(18,4),
    "unit" TEXT,
    "isAlarm" BOOLEAN NOT NULL DEFAULT false,
    "severity" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_loggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_actions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT,
    "actionDate" DATE NOT NULL,
    "actionType" TEXT NOT NULL,
    "performedBy" TEXT,
    "timeSpentMins" INTEGER,
    "partsUsed" TEXT,
    "costAmount" DECIMAL(18,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_guarantees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bgNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bgType" TEXT NOT NULL,
    "beneficiaryName" TEXT,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "marginPct" DECIMAL(5,2),
    "commissionAmount" DECIMAL(18,4),
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "linkedProject" TEXT,
    "supplierId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_12bb" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "submittedDate" DATE,
    "hraLandlordName" TEXT,
    "hraAmount" DECIMAL(18,2),
    "ltaAmount" DECIMAL(18,2),
    "homeLoanInterest" DECIMAL(18,2),
    "section80CTotal" DECIMAL(18,2),
    "section80DTotal" DECIMAL(18,2),
    "section80GTotal" DECIMAL(18,2),
    "otherDeductions" DECIMAL(18,2),
    "totalClaimed" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_12bb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "savingType" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "section" TEXT,
    "investmentDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "provider" TEXT,
    "policyNumber" TEXT,
    "maturityDate" DATE,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_16" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "panNumber" TEXT,
    "tanNumber" TEXT,
    "grossSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exemptions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "standardDeduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "section80CDeduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxOnIncome" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "surchargeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalTaxLiability" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsDeducted" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refundOrDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "issuedDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_16_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etds_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "fiscalYearName" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "panNumber" TEXT,
    "challanNumber" TEXT,
    "challanDate" DATE,
    "bsrCode" TEXT,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isAnnexure2" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etds_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pf_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "wages" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employeeContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "epsContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adminCharges" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "uanNumber" TEXT,
    "pfAccountNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pf_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_annuation_funds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "fundName" TEXT,
    "contributionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxExemption" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "super_annuation_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adhoc_payment_recoveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "entryType" TEXT NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adhoc_payment_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_rent_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "cityType" TEXT,
    "monthlyRent" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "landlordName" TEXT,
    "landlordPAN" TEXT,
    "hraReceived" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fortyPctBasic" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rentMinusTenPct" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "hraExemption" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "house_rent_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_accommodations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE,
    "accommodationType" TEXT,
    "location" TEXT,
    "perquisiteValue" DECIMAL(18,2),
    "employeeContribution" DECIMAL(18,2),
    "taxablePerquisite" DECIMAL(18,2),
    "status" TEXT NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_accommodations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previous_employer_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "previousEmployerName" TEXT NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "grossSalary" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableIncome" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "section80C" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsDeducted" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "previous_employer_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "settlementDate" DATE NOT NULL,
    "leavingDate" DATE NOT NULL,
    "reasonForLeaving" TEXT,
    "salaryPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "leaveEncashment" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gratuityAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bonusPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reimbursements" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deductionsTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "loanRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "advanceRecovery" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsDeduction" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "final_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outside_payroll_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payeeName" TEXT NOT NULL,
    "panNumber" TEXT,
    "category" TEXT,
    "postingDate" DATE NOT NULL,
    "invoiceNumber" TEXT,
    "grossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tdsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outside_payroll_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_jvs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "payrollEntryId" TEXT,
    "totalDebit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_jvs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonuses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "bonusType" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "postingDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esic_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "esicNumber" TEXT,
    "wages" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employeeContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isApplicable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esic_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "glAccountId" TEXT,
    "formula" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pay_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_tax_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "stateName" TEXT NOT NULL,
    "wages" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ptAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_tax_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ctcs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gradeId" TEXT,
    "annualBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualHra" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualLta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualPfEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualGratuity" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualBonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCTC" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ctcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_ctcs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "ctcTemplateId" TEXT,
    "annualBase" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualHra" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualLta" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualPfEmployer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualGratuity" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "annualBonus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherAllowances" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCTC" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_ctcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payable_days" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalDays" INTEGER NOT NULL DEFAULT 30,
    "workingDays" INTEGER NOT NULL DEFAULT 0,
    "leavesPaid" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "leavesUnpaid" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "weekOffs" INTEGER NOT NULL DEFAULT 0,
    "holidays" INTEGER NOT NULL DEFAULT 0,
    "absences" INTEGER NOT NULL DEFAULT 0,
    "adjustmentDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "payableDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payable_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lwf_details" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "postingDate" DATE NOT NULL,
    "stateName" TEXT NOT NULL,
    "employeeContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lwf_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letters_of_credit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lcNumber" TEXT NOT NULL,
    "lcType" TEXT NOT NULL,
    "issuingBank" TEXT NOT NULL,
    "advisingBank" TEXT,
    "beneficiaryName" TEXT,
    "applicantName" TEXT,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "utilizationPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "goodsDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supplierId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letters_of_credit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenantId_employeeId_leaveTypeId_postin_idx" ON "leave_ledger_entries"("tenantId", "employeeId", "leaveTypeId", "postingDate");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenantId_postingDate_idx" ON "leave_ledger_entries"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenantId_entryType_idx" ON "leave_ledger_entries"("tenantId", "entryType");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenantId_workGroupId_idx" ON "leave_ledger_entries"("tenantId", "workGroupId");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenantId_employeeCategoryId_idx" ON "leave_ledger_entries"("tenantId", "employeeCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "work_groups_tenantId_name_key" ON "work_groups"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "employee_categories_tenantId_name_key" ON "employee_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "approver_hierarchies_tenantId_employeeId_scope_isActive_idx" ON "approver_hierarchies"("tenantId", "employeeId", "scope", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "approver_hierarchies_tenantId_employeeId_approverEmployeeId_key" ON "approver_hierarchies"("tenantId", "employeeId", "approverEmployeeId", "scope");

-- CreateIndex
CREATE INDEX "cost_centers_tenantId_parentId_idx" ON "cost_centers"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_tenantId_name_key" ON "cost_centers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "warranties_tenantId_warrantyType_status_idx" ON "warranties"("tenantId", "warrantyType", "status");

-- CreateIndex
CREATE INDEX "warranties_tenantId_endDate_idx" ON "warranties"("tenantId", "endDate");

-- CreateIndex
CREATE INDEX "warranties_tenantId_customerId_idx" ON "warranties"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "purchase_warranties_tenantId_expiryDate_idx" ON "purchase_warranties"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "purchase_warranties_tenantId_status_idx" ON "purchase_warranties"("tenantId", "status");

-- CreateIndex
CREATE INDEX "location_captures_tenantId_userId_capturedAt_idx" ON "location_captures"("tenantId", "userId", "capturedAt");

-- CreateIndex
CREATE INDEX "location_captures_tenantId_employeeId_capturedAt_idx" ON "location_captures"("tenantId", "employeeId", "capturedAt");

-- CreateIndex
CREATE INDEX "location_captures_tenantId_purpose_idx" ON "location_captures"("tenantId", "purpose");

-- CreateIndex
CREATE INDEX "auto_dealers_tenantId_region_idx" ON "auto_dealers"("tenantId", "region");

-- CreateIndex
CREATE INDEX "auto_dealers_tenantId_status_idx" ON "auto_dealers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auto_dealers_tenantId_dealerCode_key" ON "auto_dealers"("tenantId", "dealerCode");

-- CreateIndex
CREATE INDEX "crm_targets_tenantId_ownerUserId_periodStart_idx" ON "crm_targets"("tenantId", "ownerUserId", "periodStart");

-- CreateIndex
CREATE INDEX "crm_targets_tenantId_employeeId_periodStart_idx" ON "crm_targets"("tenantId", "employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "crm_target_actuals_tenantId_ownerUserId_postingDate_idx" ON "crm_target_actuals"("tenantId", "ownerUserId", "postingDate");

-- CreateIndex
CREATE INDEX "crm_target_actuals_tenantId_targetId_idx" ON "crm_target_actuals"("tenantId", "targetId");

-- CreateIndex
CREATE INDEX "work_plans_tenantId_ownerUserId_weekStartDate_idx" ON "work_plans"("tenantId", "ownerUserId", "weekStartDate");

-- CreateIndex
CREATE INDEX "work_plan_items_workPlanId_idx" ON "work_plan_items"("workPlanId");

-- CreateIndex
CREATE INDEX "daily_worksheets_tenantId_postingDate_idx" ON "daily_worksheets"("tenantId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_worksheets_tenantId_ownerUserId_postingDate_key" ON "daily_worksheets"("tenantId", "ownerUserId", "postingDate");

-- CreateIndex
CREATE INDEX "crm_processes_tenantId_category_status_idx" ON "crm_processes"("tenantId", "category", "status");

-- CreateIndex
CREATE INDEX "project_plannings_tenantId_status_idx" ON "project_plannings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "project_plannings_tenantId_customerId_idx" ON "project_plannings"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "material_issues_tenantId_postingDate_idx" ON "material_issues"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "material_issues_tenantId_status_idx" ON "material_issues"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_issues_tenantId_issueNo_key" ON "material_issues"("tenantId", "issueNo");

-- CreateIndex
CREATE INDEX "material_issue_items_materialIssueId_idx" ON "material_issue_items"("materialIssueId");

-- CreateIndex
CREATE INDEX "material_transfers_tenantId_postingDate_idx" ON "material_transfers"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "material_transfers_tenantId_status_idx" ON "material_transfers"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_transfers_tenantId_transferNo_key" ON "material_transfers"("tenantId", "transferNo");

-- CreateIndex
CREATE INDEX "material_transfer_items_materialTransferId_idx" ON "material_transfer_items"("materialTransferId");

-- CreateIndex
CREATE INDEX "material_returns_tenantId_postingDate_idx" ON "material_returns"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "material_returns_tenantId_returnType_idx" ON "material_returns"("tenantId", "returnType");

-- CreateIndex
CREATE UNIQUE INDEX "material_returns_tenantId_returnNo_key" ON "material_returns"("tenantId", "returnNo");

-- CreateIndex
CREATE INDEX "material_return_items_materialReturnId_idx" ON "material_return_items"("materialReturnId");

-- CreateIndex
CREATE INDEX "weighments_tenantId_postingDate_idx" ON "weighments"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "weighments_tenantId_weighmentType_idx" ON "weighments"("tenantId", "weighmentType");

-- CreateIndex
CREATE UNIQUE INDEX "weighments_tenantId_weighmentNo_key" ON "weighments"("tenantId", "weighmentNo");

-- CreateIndex
CREATE INDEX "inward_outward_notes_tenantId_postingDate_idx" ON "inward_outward_notes"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "inward_outward_notes_tenantId_noteType_idx" ON "inward_outward_notes"("tenantId", "noteType");

-- CreateIndex
CREATE UNIQUE INDEX "inward_outward_notes_tenantId_noteNo_key" ON "inward_outward_notes"("tenantId", "noteNo");

-- CreateIndex
CREATE INDEX "sales_enquiries_tenantId_enquiryDate_idx" ON "sales_enquiries"("tenantId", "enquiryDate");

-- CreateIndex
CREATE INDEX "sales_enquiries_tenantId_status_idx" ON "sales_enquiries"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sales_enquiries_tenantId_ownerUserId_idx" ON "sales_enquiries"("tenantId", "ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_enquiries_tenantId_enquiryNo_key" ON "sales_enquiries"("tenantId", "enquiryNo");

-- CreateIndex
CREATE INDEX "sales_enquiry_items_salesEnquiryId_idx" ON "sales_enquiry_items"("salesEnquiryId");

-- CreateIndex
CREATE INDEX "mrp_runs_tenantId_runDate_idx" ON "mrp_runs"("tenantId", "runDate");

-- CreateIndex
CREATE UNIQUE INDEX "mrp_runs_tenantId_runNo_key" ON "mrp_runs"("tenantId", "runNo");

-- CreateIndex
CREATE INDEX "mrp_suggestions_mrpRunId_idx" ON "mrp_suggestions"("mrpRunId");

-- CreateIndex
CREATE INDEX "mrp_suggestions_itemId_idx" ON "mrp_suggestions"("itemId");

-- CreateIndex
CREATE INDEX "item_site_plannings_tenantId_itemId_idx" ON "item_site_plannings"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "item_site_plannings_tenantId_itemId_warehouseId_key" ON "item_site_plannings"("tenantId", "itemId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "routing_masters_tenantId_routingName_key" ON "routing_masters"("tenantId", "routingName");

-- CreateIndex
CREATE INDEX "routing_operations_routingId_idx" ON "routing_operations"("routingId");

-- CreateIndex
CREATE INDEX "maintenance_requests_tenantId_requestDate_idx" ON "maintenance_requests"("tenantId", "requestDate");

-- CreateIndex
CREATE INDEX "maintenance_requests_tenantId_priority_status_idx" ON "maintenance_requests"("tenantId", "priority", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_tenantId_requestNo_key" ON "maintenance_requests"("tenantId", "requestNo");

-- CreateIndex
CREATE INDEX "maintenance_schedules_tenantId_nextDueDate_idx" ON "maintenance_schedules"("tenantId", "nextDueDate");

-- CreateIndex
CREATE INDEX "maintenance_schedules_tenantId_status_idx" ON "maintenance_schedules"("tenantId", "status");

-- CreateIndex
CREATE INDEX "machine_loggers_tenantId_workstationId_loggedAt_idx" ON "machine_loggers"("tenantId", "workstationId", "loggedAt");

-- CreateIndex
CREATE INDEX "machine_loggers_tenantId_isAlarm_severity_idx" ON "machine_loggers"("tenantId", "isAlarm", "severity");

-- CreateIndex
CREATE INDEX "maintenance_actions_tenantId_actionDate_idx" ON "maintenance_actions"("tenantId", "actionDate");

-- CreateIndex
CREATE INDEX "maintenance_actions_tenantId_requestId_idx" ON "maintenance_actions"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "bank_guarantees_tenantId_expiryDate_idx" ON "bank_guarantees"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "bank_guarantees_tenantId_status_idx" ON "bank_guarantees"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_guarantees_tenantId_bgNumber_key" ON "bank_guarantees"("tenantId", "bgNumber");

-- CreateIndex
CREATE INDEX "form_12bb_tenantId_status_idx" ON "form_12bb"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form_12bb_tenantId_employeeId_fiscalYearId_key" ON "form_12bb"("tenantId", "employeeId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "savings_tenantId_employeeId_savingType_idx" ON "savings"("tenantId", "employeeId", "savingType");

-- CreateIndex
CREATE INDEX "savings_tenantId_investmentDate_idx" ON "savings"("tenantId", "investmentDate");

-- CreateIndex
CREATE INDEX "form_16_tenantId_status_idx" ON "form_16"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "form_16_tenantId_employeeId_fiscalYearId_key" ON "form_16"("tenantId", "employeeId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "etds_details_tenantId_quarter_fiscalYearName_idx" ON "etds_details"("tenantId", "quarter", "fiscalYearName");

-- CreateIndex
CREATE INDEX "etds_details_tenantId_employeeId_idx" ON "etds_details"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "etds_details_tenantId_isAnnexure2_idx" ON "etds_details"("tenantId", "isAnnexure2");

-- CreateIndex
CREATE INDEX "pf_details_tenantId_postingDate_idx" ON "pf_details"("tenantId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "pf_details_tenantId_employeeId_postingDate_key" ON "pf_details"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "super_annuation_funds_tenantId_employeeId_postingDate_idx" ON "super_annuation_funds"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "adhoc_payment_recoveries_tenantId_employeeId_postingDate_idx" ON "adhoc_payment_recoveries"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "adhoc_payment_recoveries_tenantId_entryType_category_idx" ON "adhoc_payment_recoveries"("tenantId", "entryType", "category");

-- CreateIndex
CREATE UNIQUE INDEX "house_rent_details_tenantId_employeeId_fiscalYearId_key" ON "house_rent_details"("tenantId", "employeeId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "company_accommodations_tenantId_employeeId_fromDate_idx" ON "company_accommodations"("tenantId", "employeeId", "fromDate");

-- CreateIndex
CREATE INDEX "previous_employer_details_tenantId_employeeId_idx" ON "previous_employer_details"("tenantId", "employeeId");

-- CreateIndex
CREATE INDEX "final_settlements_tenantId_status_idx" ON "final_settlements"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_tenantId_employeeId_settlementDate_key" ON "final_settlements"("tenantId", "employeeId", "settlementDate");

-- CreateIndex
CREATE INDEX "outside_payroll_details_tenantId_postingDate_idx" ON "outside_payroll_details"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "outside_payroll_details_tenantId_category_idx" ON "outside_payroll_details"("tenantId", "category");

-- CreateIndex
CREATE INDEX "salary_jvs_tenantId_postingDate_idx" ON "salary_jvs"("tenantId", "postingDate");

-- CreateIndex
CREATE INDEX "salary_jvs_tenantId_payrollEntryId_idx" ON "salary_jvs"("tenantId", "payrollEntryId");

-- CreateIndex
CREATE INDEX "bonuses_tenantId_employeeId_postingDate_idx" ON "bonuses"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "bonuses_tenantId_bonusType_status_idx" ON "bonuses"("tenantId", "bonusType", "status");

-- CreateIndex
CREATE INDEX "esic_details_tenantId_postingDate_idx" ON "esic_details"("tenantId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "esic_details_tenantId_employeeId_postingDate_key" ON "esic_details"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "pay_codes_tenantId_componentType_idx" ON "pay_codes"("tenantId", "componentType");

-- CreateIndex
CREATE UNIQUE INDEX "pay_codes_tenantId_code_key" ON "pay_codes"("tenantId", "code");

-- CreateIndex
CREATE INDEX "professional_tax_details_tenantId_stateName_idx" ON "professional_tax_details"("tenantId", "stateName");

-- CreateIndex
CREATE UNIQUE INDEX "professional_tax_details_tenantId_employeeId_postingDate_key" ON "professional_tax_details"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "ctcs_tenantId_name_key" ON "ctcs"("tenantId", "name");

-- CreateIndex
CREATE INDEX "employee_ctcs_tenantId_employeeId_effectiveFrom_idx" ON "employee_ctcs"("tenantId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "payable_days_tenantId_periodStart_idx" ON "payable_days"("tenantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "payable_days_tenantId_employeeId_periodStart_key" ON "payable_days"("tenantId", "employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "lwf_details_tenantId_stateName_idx" ON "lwf_details"("tenantId", "stateName");

-- CreateIndex
CREATE UNIQUE INDEX "lwf_details_tenantId_employeeId_postingDate_key" ON "lwf_details"("tenantId", "employeeId", "postingDate");

-- CreateIndex
CREATE INDEX "letters_of_credit_tenantId_expiryDate_idx" ON "letters_of_credit"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "letters_of_credit_tenantId_status_idx" ON "letters_of_credit"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "letters_of_credit_tenantId_lcNumber_key" ON "letters_of_credit"("tenantId", "lcNumber");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_workGroupId_fkey" FOREIGN KEY ("workGroupId") REFERENCES "work_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_employeeCategoryId_fkey" FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_workGroupId_fkey" FOREIGN KEY ("workGroupId") REFERENCES "work_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_employeeCategoryId_fkey" FOREIGN KEY ("employeeCategoryId") REFERENCES "employee_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_groups" ADD CONSTRAINT "work_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_categories" ADD CONSTRAINT "employee_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_hierarchies" ADD CONSTRAINT "approver_hierarchies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_hierarchies" ADD CONSTRAINT "approver_hierarchies_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approver_hierarchies" ADD CONSTRAINT "approver_hierarchies_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_warranties" ADD CONSTRAINT "purchase_warranties_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_warranties" ADD CONSTRAINT "purchase_warranties_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_warranties" ADD CONSTRAINT "purchase_warranties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_captures" ADD CONSTRAINT "location_captures_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_dealers" ADD CONSTRAINT "auto_dealers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_targets" ADD CONSTRAINT "crm_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_target_actuals" ADD CONSTRAINT "crm_target_actuals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plans" ADD CONSTRAINT "work_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_plan_items" ADD CONSTRAINT "work_plan_items_workPlanId_fkey" FOREIGN KEY ("workPlanId") REFERENCES "work_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_worksheets" ADD CONSTRAINT "daily_worksheets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_processes" ADD CONSTRAINT "crm_processes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plannings" ADD CONSTRAINT "project_plannings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_plannings" ADD CONSTRAINT "project_plannings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_items" ADD CONSTRAINT "material_issue_items_materialIssueId_fkey" FOREIGN KEY ("materialIssueId") REFERENCES "material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_items" ADD CONSTRAINT "material_issue_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transfers" ADD CONSTRAINT "material_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transfers" ADD CONSTRAINT "material_transfers_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transfers" ADD CONSTRAINT "material_transfers_targetWarehouseId_fkey" FOREIGN KEY ("targetWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transfer_items" ADD CONSTRAINT "material_transfer_items_materialTransferId_fkey" FOREIGN KEY ("materialTransferId") REFERENCES "material_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_transfer_items" ADD CONSTRAINT "material_transfer_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_returns" ADD CONSTRAINT "material_returns_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_return_items" ADD CONSTRAINT "material_return_items_materialReturnId_fkey" FOREIGN KEY ("materialReturnId") REFERENCES "material_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_return_items" ADD CONSTRAINT "material_return_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weighments" ADD CONSTRAINT "weighments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weighments" ADD CONSTRAINT "weighments_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weighments" ADD CONSTRAINT "weighments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weighments" ADD CONSTRAINT "weighments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_outward_notes" ADD CONSTRAINT "inward_outward_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_outward_notes" ADD CONSTRAINT "inward_outward_notes_weighmentId_fkey" FOREIGN KEY ("weighmentId") REFERENCES "weighments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiry_items" ADD CONSTRAINT "sales_enquiry_items_salesEnquiryId_fkey" FOREIGN KEY ("salesEnquiryId") REFERENCES "sales_enquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiry_items" ADD CONSTRAINT "sales_enquiry_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_runs" ADD CONSTRAINT "mrp_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_suggestions" ADD CONSTRAINT "mrp_suggestions_mrpRunId_fkey" FOREIGN KEY ("mrpRunId") REFERENCES "mrp_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mrp_suggestions" ADD CONSTRAINT "mrp_suggestions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_site_plannings" ADD CONSTRAINT "item_site_plannings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_site_plannings" ADD CONSTRAINT "item_site_plannings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_site_plannings" ADD CONSTRAINT "item_site_plannings_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_site_plannings" ADD CONSTRAINT "item_site_plannings_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_masters" ADD CONSTRAINT "routing_masters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_masters" ADD CONSTRAINT "routing_masters_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "routing_masters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_operations" ADD CONSTRAINT "routing_operations_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_loggers" ADD CONSTRAINT "machine_loggers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_loggers" ADD CONSTRAINT "machine_loggers_workstationId_fkey" FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_actions" ADD CONSTRAINT "maintenance_actions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_actions" ADD CONSTRAINT "maintenance_actions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_guarantees" ADD CONSTRAINT "bank_guarantees_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_12bb" ADD CONSTRAINT "form_12bb_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_12bb" ADD CONSTRAINT "form_12bb_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings" ADD CONSTRAINT "savings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_16" ADD CONSTRAINT "form_16_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_16" ADD CONSTRAINT "form_16_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etds_details" ADD CONSTRAINT "etds_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etds_details" ADD CONSTRAINT "etds_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pf_details" ADD CONSTRAINT "pf_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pf_details" ADD CONSTRAINT "pf_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_annuation_funds" ADD CONSTRAINT "super_annuation_funds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "super_annuation_funds" ADD CONSTRAINT "super_annuation_funds_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_payment_recoveries" ADD CONSTRAINT "adhoc_payment_recoveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_payment_recoveries" ADD CONSTRAINT "adhoc_payment_recoveries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_rent_details" ADD CONSTRAINT "house_rent_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_rent_details" ADD CONSTRAINT "house_rent_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_accommodations" ADD CONSTRAINT "company_accommodations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_accommodations" ADD CONSTRAINT "company_accommodations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previous_employer_details" ADD CONSTRAINT "previous_employer_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previous_employer_details" ADD CONSTRAINT "previous_employer_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outside_payroll_details" ADD CONSTRAINT "outside_payroll_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_jvs" ADD CONSTRAINT "salary_jvs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esic_details" ADD CONSTRAINT "esic_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esic_details" ADD CONSTRAINT "esic_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_codes" ADD CONSTRAINT "pay_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_tax_details" ADD CONSTRAINT "professional_tax_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_tax_details" ADD CONSTRAINT "professional_tax_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ctcs" ADD CONSTRAINT "ctcs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_ctcs" ADD CONSTRAINT "employee_ctcs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_ctcs" ADD CONSTRAINT "employee_ctcs_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_days" ADD CONSTRAINT "payable_days_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payable_days" ADD CONSTRAINT "payable_days_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lwf_details" ADD CONSTRAINT "lwf_details_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lwf_details" ADD CONSTRAINT "lwf_details_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
