-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "archiveEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archiveSlug" TEXT,
ADD COLUMN     "rateLimitPerMin" INTEGER,
ADD COLUMN     "testSentAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'Draft';

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "fromEmail" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trackingId" TEXT;

-- CreateTable
CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "detail" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "emailMessageId" TEXT,
    "type" TEXT NOT NULL,
    "targetUrl" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'root',
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppressions_tenantId_reason_idx" ON "suppressions"("tenantId", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_tenantId_email_key" ON "suppressions"("tenantId", "email");

-- CreateIndex
CREATE INDEX "tracking_events_tenantId_campaignId_type_idx" ON "tracking_events"("tenantId", "campaignId", "type");

-- CreateIndex
CREATE INDEX "tracking_events_tenantId_occurredAt_idx" ON "tracking_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "tracking_events_recipientId_idx" ON "tracking_events"("recipientId");

-- CreateIndex
CREATE INDEX "tracking_events_emailMessageId_idx" ON "tracking_events"("emailMessageId");

-- CreateIndex
CREATE INDEX "media_assets_tenantId_folder_idx" ON "media_assets"("tenantId", "folder");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_tenantId_sha256_key" ON "media_assets"("tenantId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_archiveSlug_key" ON "campaigns"("archiveSlug");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_trackingId_key" ON "email_messages"("trackingId");

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "campaign_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

