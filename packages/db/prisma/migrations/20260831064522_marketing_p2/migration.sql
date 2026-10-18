-- AlterTable
ALTER TABLE "campaign_recipients" ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "sms_messages" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "providerName" TEXT;

-- CreateTable
CREATE TABLE "campaign_variants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "weightPercent" INTEGER NOT NULL,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalOpened" INTEGER NOT NULL DEFAULT 0,
    "totalClicked" INTEGER NOT NULL DEFAULT 0,
    "totalBounced" INTEGER NOT NULL DEFAULT 0,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_journeys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB,
    "nodesJson" JSONB NOT NULL DEFAULT '[]',
    "edgesJson" JSONB NOT NULL DEFAULT '[]',
    "totalEnrolled" INTEGER NOT NULL DEFAULT 0,
    "totalCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journey_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "contactType" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailTo" TEXT,
    "mobileTo" TEXT,
    "currentNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "nextTickAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "journey_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "headerType" TEXT,
    "headerText" TEXT,
    "bodyText" TEXT NOT NULL,
    "footerText" TEXT,
    "variables" JSONB,
    "wabaTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "toMobile" TEXT NOT NULL,
    "fromMobile" TEXT,
    "templateId" TEXT,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "senderUserId" TEXT,
    "linkedDoctype" TEXT,
    "linkedId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_variants_tenantId_campaignId_idx" ON "campaign_variants"("tenantId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_variants_campaignId_variantKey_key" ON "campaign_variants"("campaignId", "variantKey");

-- CreateIndex
CREATE INDEX "marketing_journeys_tenantId_status_idx" ON "marketing_journeys"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_journeys_tenantId_name_key" ON "marketing_journeys"("tenantId", "name");

-- CreateIndex
CREATE INDEX "journey_enrollments_tenantId_status_nextTickAt_idx" ON "journey_enrollments"("tenantId", "status", "nextTickAt");

-- CreateIndex
CREATE UNIQUE INDEX "journey_enrollments_journeyId_contactType_contactId_key" ON "journey_enrollments"("journeyId", "contactType", "contactId");

-- CreateIndex
CREATE INDEX "whatsapp_templates_tenantId_status_idx" ON "whatsapp_templates"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenantId_name_language_key" ON "whatsapp_templates"("tenantId", "name", "language");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenantId_status_scheduledFor_idx" ON "whatsapp_messages"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenantId_direction_createdAt_idx" ON "whatsapp_messages"("tenantId", "direction", "createdAt");

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "campaign_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_journeys" ADD CONSTRAINT "marketing_journeys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journey_enrollments" ADD CONSTRAINT "journey_enrollments_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "marketing_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "whatsapp_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

