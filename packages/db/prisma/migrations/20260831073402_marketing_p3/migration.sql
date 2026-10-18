-- CreateTable
CREATE TABLE "webinar_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "joinUrl" TEXT,
    "hostUrl" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "capacity" INTEGER,
    "registerFormId" TEXT,
    "actualAttendees" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webinar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webinar_registrations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "webinarId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "mobile" TEXT,
    "contactType" TEXT,
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Registered',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "webinar_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_approvals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctype" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "marketing_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "faviconAssetId" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#1e40af',
    "secondaryColor" TEXT NOT NULL DEFAULT '#0ea5e9',
    "accentColor" TEXT NOT NULL DEFAULT '#f59e0b',
    "neutralColor" TEXT NOT NULL DEFAULT '#111827',
    "headingFont" TEXT NOT NULL DEFAULT 'Inter, sans-serif',
    "bodyFont" TEXT NOT NULL DEFAULT 'Inter, sans-serif',
    "footerHtml" TEXT,
    "socialLinks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_touchpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributedRevenue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "attributedInvoiceId" TEXT,

    CONSTRAINT "attribution_touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editorial_notes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "plannedFor" TIMESTAMP(3) NOT NULL,
    "channels" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'Idea',
    "ownerUserId" TEXT,
    "colorTag" TEXT,
    "convertedToDoctype" TEXT,
    "convertedToDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editorial_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webinar_events_tenantId_status_startAt_idx" ON "webinar_events"("tenantId", "status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_events_tenantId_name_startAt_key" ON "webinar_events"("tenantId", "name", "startAt");

-- CreateIndex
CREATE INDEX "webinar_registrations_tenantId_webinarId_status_idx" ON "webinar_registrations"("tenantId", "webinarId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "webinar_registrations_webinarId_email_key" ON "webinar_registrations"("webinarId", "email");

-- CreateIndex
CREATE INDEX "marketing_approvals_tenantId_doctype_docId_idx" ON "marketing_approvals"("tenantId", "doctype", "docId");

-- CreateIndex
CREATE INDEX "marketing_approvals_tenantId_status_requestedAt_idx" ON "marketing_approvals"("tenantId", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kits_tenantId_key" ON "brand_kits"("tenantId");

-- CreateIndex
CREATE INDEX "attribution_touchpoints_tenantId_contactType_contactId_occu_idx" ON "attribution_touchpoints"("tenantId", "contactType", "contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "attribution_touchpoints_tenantId_sourceType_sourceId_idx" ON "attribution_touchpoints"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "attribution_touchpoints_attributedInvoiceId_idx" ON "attribution_touchpoints"("attributedInvoiceId");

-- CreateIndex
CREATE INDEX "editorial_notes_tenantId_plannedFor_idx" ON "editorial_notes"("tenantId", "plannedFor");

-- CreateIndex
CREATE INDEX "editorial_notes_tenantId_status_idx" ON "editorial_notes"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "webinar_events" ADD CONSTRAINT "webinar_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webinar_registrations" ADD CONSTRAINT "webinar_registrations_webinarId_fkey" FOREIGN KEY ("webinarId") REFERENCES "webinar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_approvals" ADD CONSTRAINT "marketing_approvals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_touchpoints" ADD CONSTRAINT "attribution_touchpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editorial_notes" ADD CONSTRAINT "editorial_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

