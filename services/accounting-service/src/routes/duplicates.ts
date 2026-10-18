import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  mergeDuplicates,
  prisma,
  scanDuplicates,
  type DuplicateDoctype,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 55 — Duplicate detection + merge routes.
//
// Flow:
//   1. POST /duplicates/scan { doctype, threshold? }
//      → runs the scanner, upserts DuplicateReview rows.
//   2. GET /duplicates/pairs?doctype=&status=Pending
//      → returns pairs with each side's full row for side-by-side review.
//   3. POST /duplicates/merge { doctype, keeperId, mergedId }
//      → atomic FK re-point + delete + audit.
//   4. POST /duplicates/:id/dismiss | /snooze
//      → for pairs that aren't actual dups.

export const duplicateRouter = Router();
const p = perms("Account"); // reuse admin perm surface

const DOCTYPES: DuplicateDoctype[] = ["Customer", "Supplier", "Item"];

function parseDoctype(raw: unknown): DuplicateDoctype | null {
  if (typeof raw !== "string") return null;
  return DOCTYPES.includes(raw as DuplicateDoctype) ? (raw as DuplicateDoctype) : null;
}

const scanSchema = z.object({
  doctype: z.enum(["Customer", "Supplier", "Item"]),
  threshold: z.coerce.number().int().min(0).max(100).default(70),
});

duplicateRouter.post("/scan", p.write, async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const result = await scanDuplicates(prisma, tenantId, b.doctype, b.threshold);
  res.json(result);
});

duplicateRouter.get("/pairs", p.read, async (req, res) => {
  const doctype = parseDoctype(req.query.doctype);
  if (!doctype) return res.status(400).json({ error: "doctype query param required" });
  const status =
    typeof req.query.status === "string" && ["Pending", "Merged", "Dismissed", "Snoozed"].includes(req.query.status)
      ? req.query.status
      : "Pending";
  const tenantId = req.auth!.tenantId;

  const pairs = await prisma.duplicateReview.findMany({
    where: {
      tenantId,
      doctype,
      status,
      ...(status === "Snoozed" ? { snoozeUntil: { gt: new Date() } } : {}),
    },
    orderBy: [{ score: "desc" }, { scannedAt: "desc" }],
    take: 200,
  });

  // Enrich with the actual row data for both sides so the UI renders
  // a side-by-side compare without follow-up requests.
  const ids = pairs.flatMap((p) => [p.leftId, p.rightId]);
  const rowsById = await loadRowsByIds(tenantId, doctype, ids);

  res.json(
    pairs.map((p) => ({
      id: p.id,
      doctype: p.doctype,
      score: p.score,
      breakdown: p.breakdown,
      status: p.status,
      scannedAt: p.scannedAt,
      left: rowsById.get(p.leftId) ?? null,
      right: rowsById.get(p.rightId) ?? null,
    })),
  );
});

async function loadRowsByIds(
  tenantId: string,
  doctype: DuplicateDoctype,
  ids: string[],
): Promise<Map<string, unknown>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, unknown>();
  if (unique.length === 0) return map;
  switch (doctype) {
    case "Customer": {
      const rows = await prisma.customer.findMany({ where: { id: { in: unique }, tenantId } });
      for (const r of rows) map.set(r.id, r);
      break;
    }
    case "Supplier": {
      const rows = await prisma.supplier.findMany({ where: { id: { in: unique }, tenantId } });
      for (const r of rows) map.set(r.id, r);
      break;
    }
    case "Item": {
      const rows = await prisma.item.findMany({ where: { id: { in: unique }, tenantId } });
      for (const r of rows) map.set(r.id, r);
      break;
    }
  }
  return map;
}

const mergeSchema = z.object({
  doctype: z.enum(["Customer", "Supplier", "Item"]),
  keeperId: z.string().min(1),
  mergedId: z.string().min(1),
});

duplicateRouter.post("/merge", p.write, async (req, res) => {
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(
      async (tx) =>
        mergeDuplicates(tx, tenantId, b.doctype, b.keeperId, b.mergedId, req.auth!.userId),
      { timeout: 30_000 }, // large tenants may have many FK rows to update
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Merge failed" });
  }
});

duplicateRouter.post("/:id/dismiss", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.duplicateReview.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.duplicateReview.update({
    where: { id: row.id },
    data: {
      status: "Dismissed",
      reviewedAt: new Date(),
      reviewedBy: req.auth!.userId,
    },
  });
  res.json(updated);
});

const snoozeSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
duplicateRouter.post("/:id/snooze", p.write, async (req, res) => {
  const parsed = snoozeSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const row = await prisma.duplicateReview.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const snoozeUntil = new Date(Date.now() + parsed.data.days * 24 * 60 * 60 * 1000);
  const updated = await prisma.duplicateReview.update({
    where: { id: row.id },
    data: {
      status: "Snoozed",
      snoozeUntil,
      reviewedAt: new Date(),
      reviewedBy: req.auth!.userId,
    },
  });
  res.json(updated);
});

// Audit trail for compliance / rollback investigation.
duplicateRouter.get("/merges", p.read, async (req, res) => {
  const rows = await prisma.duplicateMerge.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { mergedAt: "desc" },
    take: 200,
  });
  res.json(rows);
});
// Prisma import kept for the transaction type inference in some codebases.
void Prisma;
