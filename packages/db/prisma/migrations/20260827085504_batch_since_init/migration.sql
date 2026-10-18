-- AlterTable
ALTER TABLE "backup_jobs" ADD COLUMN     "s3Key" TEXT,
ADD COLUMN     "s3UploadedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "pan" TEXT,
ADD COLUMN     "taxCollectionCategoryId" TEXT;

-- AlterTable
ALTER TABLE "payment_entries" ADD COLUMN     "withholdingSection" TEXT;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "tcsAccountId" TEXT,
ADD COLUMN     "tcsAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "tcsCategoryId" TEXT,
ADD COLUMN     "tcsRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
ADD COLUMN     "tcsSection" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "pan" TEXT;

-- AlterTable
ALTER TABLE "tax_withholding_categories" ADD COLUMN     "cumulativeYtd" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sectionCode" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "companyPan" TEXT,
ADD COLUMN     "companyTan" TEXT,
ADD COLUMN     "defaultLocale" TEXT DEFAULT 'en';

-- CreateTable
CREATE TABLE "tax_collection_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectionCode" TEXT,
    "rate" DECIMAL(9,4) NOT NULL,
    "cumulativeYtd" BOOLEAN NOT NULL DEFAULT true,
    "thresholdAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accountId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_collection_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_challans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "bsrCode" TEXT NOT NULL,
    "challanSerialNo" TEXT NOT NULL,
    "paidDate" DATE NOT NULL,
    "amountPaid" DECIMAL(18,4) NOT NULL,
    "fyLabel" TEXT NOT NULL,
    "quarter" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tds_challans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_verifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "backupJobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "backup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_collection_categories_tenantId_idx" ON "tax_collection_categories"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_collection_categories_tenantId_name_key" ON "tax_collection_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tds_challans_tenantId_fyLabel_quarter_idx" ON "tds_challans"("tenantId", "fyLabel", "quarter");

-- CreateIndex
CREATE INDEX "tds_challans_tenantId_categoryId_idx" ON "tds_challans"("tenantId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "tds_challans_tenantId_bsrCode_challanSerialNo_paidDate_key" ON "tds_challans"("tenantId", "bsrCode", "challanSerialNo", "paidDate");

-- CreateIndex
CREATE INDEX "backup_verifications_tenantId_verifiedAt_idx" ON "backup_verifications"("tenantId", "verifiedAt");

-- CreateIndex
CREATE INDEX "backup_verifications_backupJobId_idx" ON "backup_verifications"("backupJobId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_taxCollectionCategoryId_fkey" FOREIGN KEY ("taxCollectionCategoryId") REFERENCES "tax_collection_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_collection_categories" ADD CONSTRAINT "tax_collection_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_collection_categories" ADD CONSTRAINT "tax_collection_categories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_challans" ADD CONSTRAINT "tds_challans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_challans" ADD CONSTRAINT "tds_challans_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "tax_withholding_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tcsCategoryId_fkey" FOREIGN KEY ("tcsCategoryId") REFERENCES "tax_collection_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tcsAccountId_fkey" FOREIGN KEY ("tcsAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_verifications" ADD CONSTRAINT "backup_verifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_verifications" ADD CONSTRAINT "backup_verifications_backupJobId_fkey" FOREIGN KEY ("backupJobId") REFERENCES "backup_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

