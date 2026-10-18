import type { Prisma, PrismaClient } from "@prisma/client";
import { findDuplicatePairs, type MatchCandidate } from "./duplicate-match";

// Module 55 — Duplicate detection scanner + merger.
//
// Scanner:
//   * Loads all rows of a supported doctype for a tenant.
//   * Maps each row to a MatchCandidate (name/email/gstin/pan/phone).
//   * Runs findDuplicatePairs to get candidate pairs above threshold.
//   * Upserts DuplicateReview rows (idempotent per (tenant, doctype,
//     leftId, rightId) — normalized ordering).
//
// Merger:
//   * Given (doctype, keeperId, mergedId), re-points every FK column
//     that references the eliminated row to point at the keeper.
//   * Writes a DuplicateMerge audit row with per-model counts.
//   * Deletes the eliminated row.
//   * All inside a single $transaction so a partial failure rolls back.
//
// FK maps are hand-maintained (below) — one entry per doctype telling
// the merger which tables reference it and by which column. Not
// derived from prisma schema introspection because we don't want to
// touch every FK — some references (e.g. audit_log.docId) should
// remain pointing at the old ID as historical fact.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export type DuplicateDoctype = "Customer" | "Supplier" | "Item";

// Rows in these tables should be re-pointed on merge. Order matters
// insofar as the last operation must be deleting the eliminated row
// (handled by the merger, not this list).
interface FKReference {
  model: keyof PrismaClient;
  fkColumn: string;
}

const FK_MAP: Record<DuplicateDoctype, FKReference[]> = {
  Customer: [
    { model: "salesInvoice", fkColumn: "customerId" },
    { model: "salesOrder", fkColumn: "customerId" },
    { model: "quotation", fkColumn: "customerId" },
    { model: "deliveryNote", fkColumn: "customerId" },
    { model: "paymentEntry", fkColumn: "partyId" }, // party-typed
    { model: "loyaltyPointEntry", fkColumn: "customerId" },
    { model: "recurringInvoice", fkColumn: "customerId" },
    { model: "subscription", fkColumn: "customerId" },
    { model: "bankGuarantee", fkColumn: "beneficiaryCustomerId" },
    { model: "letterOfCredit", fkColumn: "beneficiaryCustomerId" },
    { model: "opportunity", fkColumn: "customerId" },
    { model: "salesEnquiry", fkColumn: "customerId" },
    { model: "salesEnquiry", fkColumn: "distributorId" },
    { model: "projectPlanning", fkColumn: "customerId" },
    { model: "pOSProfile", fkColumn: "defaultCustomerId" },
    { model: "blanketOrder", fkColumn: "customerId" },
    { model: "serviceContract", fkColumn: "customerId" },
  ],
  Supplier: [
    { model: "purchaseInvoice", fkColumn: "supplierId" },
    { model: "purchaseOrder", fkColumn: "supplierId" },
    { model: "purchaseReceipt", fkColumn: "supplierId" },
    { model: "paymentEntry", fkColumn: "partyId" },
    { model: "requestForQuotation", fkColumn: "supplierId" }, // no direct FK; via RFQSupplier
    { model: "rFQSupplier", fkColumn: "supplierId" },
    { model: "supplierQuotation", fkColumn: "supplierId" },
    { model: "supplierScorecard", fkColumn: "supplierId" },
    { model: "warranty", fkColumn: "supplierId" },
    { model: "purchaseWarranty", fkColumn: "supplierId" },
    { model: "materialReturn", fkColumn: "supplierId" },
    { model: "weighment", fkColumn: "supplierId" },
    { model: "itemSitePlanning", fkColumn: "supplierId" },
    { model: "bankGuarantee", fkColumn: "beneficiarySupplierId" },
    { model: "letterOfCredit", fkColumn: "beneficiarySupplierId" },
    { model: "blanketOrder", fkColumn: "supplierId" },
  ],
  Item: [
    { model: "salesInvoiceItem", fkColumn: "itemId" },
    { model: "purchaseInvoiceItem", fkColumn: "itemId" },
    { model: "salesOrderItem", fkColumn: "itemId" },
    { model: "quotationItem", fkColumn: "itemId" },
    { model: "purchaseOrderItem", fkColumn: "itemId" },
    { model: "purchaseReceiptItem", fkColumn: "itemId" },
    { model: "deliveryNoteItem", fkColumn: "itemId" },
    { model: "materialRequestItem", fkColumn: "itemId" },
    { model: "stockEntryItem", fkColumn: "itemId" },
    { model: "stockLedgerEntry", fkColumn: "itemId" },
    { model: "bin", fkColumn: "itemId" },
    { model: "itemPrice", fkColumn: "itemId" },
    { model: "bOMItem", fkColumn: "itemId" },
    { model: "bOM", fkColumn: "itemId" },
    { model: "itemReorderRule", fkColumn: "itemId" },
    { model: "recurringInvoiceItem", fkColumn: "itemId" },
    { model: "subscriptionItem", fkColumn: "itemId" },
    { model: "rFQItem", fkColumn: "itemId" },
    { model: "supplierQuotationItem", fkColumn: "itemId" },
    { model: "blanketOrderItem", fkColumn: "itemId" },
    { model: "pickListItem", fkColumn: "itemId" },
    { model: "itemUOMConversion", fkColumn: "itemId" },
    { model: "batch", fkColumn: "itemId" },
    { model: "serialNo", fkColumn: "itemId" },
    { model: "materialIssueItem", fkColumn: "itemId" },
    { model: "materialTransferItem", fkColumn: "itemId" },
    { model: "materialReturnItem", fkColumn: "itemId" },
    { model: "itemAlternate", fkColumn: "itemId" },
    { model: "itemAlternate", fkColumn: "alternateItemId" },
  ],
};

// ---------- Scanner ----------

export interface ScanResult {
  doctype: DuplicateDoctype;
  candidatesScanned: number;
  pairsFound: number;
  pairsUpserted: number;
}

async function loadCandidates(
  db: AnyClient,
  tenantId: string,
  doctype: DuplicateDoctype,
): Promise<MatchCandidate[]> {
  switch (doctype) {
    case "Customer": {
      const rows = await db.customer.findMany({
        where: { tenantId },
        select: { id: true, customerName: true, email: true, gstin: true, pan: true, mobile: true },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.customerName,
        email: r.email,
        gstin: r.gstin,
        pan: r.pan,
        phone: r.mobile,
      }));
    }
    case "Supplier": {
      const rows = await db.supplier.findMany({
        where: { tenantId },
        select: { id: true, supplierName: true, email: true, gstin: true, pan: true, mobile: true },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.supplierName,
        email: r.email,
        gstin: r.gstin,
        pan: r.pan,
        phone: r.mobile,
      }));
    }
    case "Item": {
      const rows = await db.item.findMany({
        where: { tenantId },
        select: { id: true, itemName: true, itemCode: true },
      });
      // For items we compare name + code (code is exact-match on GSTIN slot).
      return rows.map((r) => ({
        id: r.id,
        name: r.itemName,
        gstin: r.itemCode, // reuses the exact-match slot
      }));
    }
  }
}

export async function scanDuplicates(
  db: AnyClient,
  tenantId: string,
  doctype: DuplicateDoctype,
  threshold = 70,
): Promise<ScanResult> {
  const candidates = await loadCandidates(db, tenantId, doctype);
  const pairs = findDuplicatePairs(candidates, threshold);

  let upserted = 0;
  for (const pair of pairs) {
    // Normalize ordering so re-scans upsert instead of creating dup rows.
    const [leftId, rightId] = pair.a.id < pair.b.id ? [pair.a.id, pair.b.id] : [pair.b.id, pair.a.id];
    await db.duplicateReview.upsert({
      where: {
        tenantId_doctype_leftId_rightId: { tenantId, doctype, leftId, rightId },
      },
      create: {
        tenantId,
        doctype,
        leftId,
        rightId,
        score: pair.result.score,
        breakdown: pair.result.breakdown as unknown as Prisma.InputJsonValue,
        status: "Pending",
      },
      update: {
        // Refresh score on re-scan (data may have changed).
        score: pair.result.score,
        breakdown: pair.result.breakdown as unknown as Prisma.InputJsonValue,
        scannedAt: new Date(),
      },
    });
    upserted += 1;
  }

  return {
    doctype,
    candidatesScanned: candidates.length,
    pairsFound: pairs.length,
    pairsUpserted: upserted,
  };
}

// ---------- Merger ----------

export interface MergeResult {
  auditId: string;
  doctype: DuplicateDoctype;
  keeperId: string;
  mergedId: string;
  fkCounts: Record<string, number>;
}

export async function mergeDuplicates(
  db: AnyClient,
  tenantId: string,
  doctype: DuplicateDoctype,
  keeperId: string,
  mergedId: string,
  mergedBy: string | null,
): Promise<MergeResult> {
  if (keeperId === mergedId) {
    throw new Error("keeper and merged must be different rows");
  }
  // Verify both rows belong to the tenant.
  const [keeper, merged] = await Promise.all([
    fetchOne(db, doctype, tenantId, keeperId),
    fetchOne(db, doctype, tenantId, mergedId),
  ]);
  if (!keeper) throw new Error("keeper not found");
  if (!merged) throw new Error("merged row not found");

  const fkCounts: Record<string, number> = {};
  const refs = FK_MAP[doctype];
  for (const ref of refs) {
    // Every FK column is re-pointed via updateMany. Prisma requires
    // dynamic model access via bracket notation; casting is unavoidable
    // here since the model name is dynamic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (db as any)[ref.model as string];
    if (!model?.updateMany) continue;
    const r = await model.updateMany({
      where: { [ref.fkColumn]: mergedId },
      data: { [ref.fkColumn]: keeperId },
    });
    if (r.count > 0) {
      const key = `${String(ref.model)}.${ref.fkColumn}`;
      fkCounts[key] = (fkCounts[key] ?? 0) + r.count;
    }
  }

  // Delete the eliminated row.
  await deleteOne(db, doctype, mergedId);

  // Also close any pending DuplicateReview rows involving mergedId.
  const [minId, maxId] = keeperId < mergedId ? [keeperId, mergedId] : [mergedId, keeperId];
  await db.duplicateReview.updateMany({
    where: {
      tenantId,
      doctype,
      OR: [{ leftId: mergedId }, { rightId: mergedId }],
      status: "Pending",
    },
    data: {
      status: "Merged",
      reviewedAt: new Date(),
      reviewedBy: mergedBy,
    },
  });
  // Also close the specific keeper-merged pair (in case it was Snoozed).
  await db.duplicateReview.updateMany({
    where: {
      tenantId,
      doctype,
      leftId: minId,
      rightId: maxId,
    },
    data: {
      status: "Merged",
      reviewedAt: new Date(),
      reviewedBy: mergedBy,
    },
  });

  const audit = await db.duplicateMerge.create({
    data: {
      tenantId,
      doctype,
      keeperId,
      mergedId,
      fkCounts: fkCounts as unknown as Prisma.InputJsonValue,
      mergedSnapshot: merged as unknown as Prisma.InputJsonValue,
      mergedBy,
    },
  });

  return {
    auditId: audit.id,
    doctype,
    keeperId,
    mergedId,
    fkCounts,
  };
}

async function fetchOne(
  db: AnyClient,
  doctype: DuplicateDoctype,
  tenantId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  switch (doctype) {
    case "Customer":
      return db.customer.findFirst({ where: { id, tenantId } });
    case "Supplier":
      return db.supplier.findFirst({ where: { id, tenantId } });
    case "Item":
      return db.item.findFirst({ where: { id, tenantId } });
  }
}

async function deleteOne(
  db: AnyClient,
  doctype: DuplicateDoctype,
  id: string,
): Promise<void> {
  switch (doctype) {
    case "Customer":
      await db.customer.delete({ where: { id } });
      return;
    case "Supplier":
      await db.supplier.delete({ where: { id } });
      return;
    case "Item":
      await db.item.delete({ where: { id } });
      return;
  }
}
