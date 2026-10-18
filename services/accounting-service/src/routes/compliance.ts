import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  anonymizeCustomer,
  anonymizeEmployee,
  anonymizeSupplier,
  buildEwayBillPayload,
  decryptSecrets,
  exportCustomerData,
  exportEmployeeData,
  exportSupplierData,
  gstr1,
  gstr1Hsn,
  gstr3b,
  gstr9,
  nextName,
  prisma,
  toCsvRow,
  verifyChainForTenant,
  type SubSupplyType,
  type TransactionType,
  type TransMode,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// O1: Audit log export
// O2: Data Subject Request CRUD
// O3: Erasure endpoint (per-subject anonymize)
// O4: Data Retention Policy CRUD + purge runner
// O5-O6: GSTR-1 + GSTR-3B report endpoints

export const auditRouter = Router();
export const dsrRouter = Router();
export const retentionRouter = Router();
export const gstRouter = Router();
export const archiveRouter = Router();

const pA = perms("AuditLog");
const pD = perms("DataSubjectRequest");
const pR = perms("DataRetentionPolicy");
const pArch = perms("AnonymizationArchive");

// ---------- O1: Audit log viewer + export ----------

auditRouter.get("/", pA.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(doctype ? { doctype } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json(rows);
});

auditRouter.get("/export", pA.read, async (req, res) => {
  const format = (req.query.format === "json" ? "json" : "csv") as "csv" | "json";
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  const filename = `audit-${new Date().toISOString().slice(0, 10)}`;
  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  }
  const header = toCsvRow([
    "createdAt",
    "userId",
    "userEmail",
    "method",
    "path",
    "doctype",
    "docId",
    "statusCode",
    "ip",
    "userAgent",
  ]);
  const csv = [
    header,
    ...rows.map((r) =>
      toCsvRow([
        r.createdAt.toISOString(),
        r.userId ?? "",
        r.userEmail ?? "",
        r.method,
        r.path,
        r.doctype ?? "",
        r.docId ?? "",
        r.statusCode,
        r.ipAddress ?? "",
        r.userAgent?.slice(0, 200) ?? "",
      ]),
    ),
  ].join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  res.send(csv);
});

// ---------- O1b: Audit chain verifier (SOC 2 Type II) ----------
//
// Walk every chained AuditLog row for the caller's tenant, recompute the
// hash, and confirm it matches. Reports the first broken row on failure.
// Read-only + idempotent — safe to call every day from a compliance job.
// See packages/db/src/audit-chain.ts for the design + threat model.
auditRouter.get("/verify", pA.read, async (req, res) => {
  const result = await verifyChainForTenant(prisma, req.auth!.tenantId);
  res.status(result.ok ? 200 : 409).json(result);
});

// ---------- O2 + O3: Data Subject Requests ----------

const dsrSchema = z.object({
  kind: z.enum(["Export", "Erasure"]),
  subjectType: z.enum(["Customer", "Supplier", "Employee", "PortalUser"]),
  subjectId: z.string().min(1),
  subjectEmail: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
});

dsrRouter.get("/", pD.read, async (req, res) => {
  const rows = await prisma.dataSubjectRequest.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

dsrRouter.post("/", pD.create, async (req, res) => {
  const parsed = dsrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "DSR-");
  const row = await prisma.dataSubjectRequest.create({
    data: {
      tenantId,
      name,
      requestedBy: req.auth!.userId,
      ...parsed.data,
      subjectEmail: parsed.data.subjectEmail ?? null,
      notes: parsed.data.notes ?? null,
    },
  });
  res.status(201).json(row);
});

// Fulfil: dispatch on kind. Export → build data blob + return JSON body
// (kept inline for MVP; a production path would write to storage + email a
// signed link). Erasure → anonymize the subject via helper.
dsrRouter.post("/:id/fulfil", pD.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const dsr = await prisma.dataSubjectRequest.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!dsr) return res.status(404).json({ error: "Not found" });
  if (dsr.status === "Completed" || dsr.status === "Rejected")
    return res.status(400).json({ error: `Already ${dsr.status}` });

  try {
    let payload: Record<string, unknown> | null = null;
    if (dsr.kind === "Export") {
      if (dsr.subjectType === "Customer")
        payload = await exportCustomerData(prisma, tenantId, dsr.subjectId);
      else if (dsr.subjectType === "Supplier")
        payload = await exportSupplierData(prisma, tenantId, dsr.subjectId);
      else if (dsr.subjectType === "Employee")
        payload = await exportEmployeeData(prisma, tenantId, dsr.subjectId);
      else
        return res
          .status(400)
          .json({ error: `Export not implemented for ${dsr.subjectType}` });
    } else {
      // Erasure
      const opts = { dsrId: dsr.id, createdBy: req.auth!.userId };
      await prisma.$transaction(async (tx) => {
        if (dsr.subjectType === "Customer")
          await anonymizeCustomer(tx, tenantId, dsr.subjectId, opts);
        else if (dsr.subjectType === "Supplier")
          await anonymizeSupplier(tx, tenantId, dsr.subjectId, opts);
        else if (dsr.subjectType === "Employee")
          await anonymizeEmployee(tx, tenantId, dsr.subjectId, opts);
        else if (dsr.subjectType === "PortalUser") {
          await tx.portalUser.update({
            where: { id: dsr.subjectId },
            data: { isActive: false, passwordHash: null },
          });
        }
      });
    }
    await prisma.dataSubjectRequest.update({
      where: { id: dsr.id },
      data: { status: "Completed", completedAt: new Date() },
    });
    res.json({ ok: true, kind: dsr.kind, payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    await prisma.dataSubjectRequest.update({
      where: { id: dsr.id },
      data: { status: "Rejected", rejectedReason: msg.slice(0, 500) },
    });
    res.status(400).json({ error: msg });
  }
});

dsrRouter.post("/:id/reject", pD.submit, async (req, res) => {
  const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.dataSubjectRequest.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.dataSubjectRequest.update({
    where: { id: existing.id },
    data: { status: "Rejected", rejectedReason: parsed.data.reason },
  });
  res.json(row);
});

// ---------- O4: Data Retention Policy + purge ----------

const policySchema = z.object({
  doctype: z.enum(["Customer", "Supplier", "Employee", "AuditLog", "ErrorLog"]),
  retainDays: z.coerce.number().int().positive(),
  strategy: z.enum(["delete", "anonymize", "archive"]).default("anonymize"),
  enabled: z.boolean().default(true),
});

retentionRouter.get("/", pR.read, async (req, res) => {
  const rows = await prisma.dataRetentionPolicy.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { doctype: "asc" },
  });
  res.json(rows);
});

retentionRouter.post("/", pR.create, async (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.dataRetentionPolicy.create({
      data: { tenantId: req.auth!.tenantId, ...parsed.data },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Policy already exists for this doctype" });
    throw e;
  }
});

retentionRouter.put("/:id", pR.write, async (req, res) => {
  const parsed = policySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.dataRetentionPolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.dataRetentionPolicy.update({
    where: { id: existing.id },
    data: parsed.data,
  });
  res.json(row);
});

retentionRouter.delete("/:id", pR.delete, async (req, res) => {
  const existing = await prisma.dataRetentionPolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.dataRetentionPolicy.delete({ where: { id: existing.id } });
  res.status(204).send();
});

retentionRouter.post("/run", pR.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const policies = await prisma.dataRetentionPolicy.findMany({
    where: { tenantId, enabled: true },
  });
  const results: { doctype: string; strategy: string; affected: number }[] = [];
  for (const p of policies) {
    const cutoff = new Date(Date.now() - p.retainDays * 24 * 3600_000);
    let affected = 0;
    if (p.doctype === "AuditLog") {
      const r = await prisma.auditLog.deleteMany({
        where: { tenantId, createdAt: { lt: cutoff } },
      });
      affected = r.count;
    } else if (p.doctype === "ErrorLog") {
      const r = await prisma.errorLog.deleteMany({
        where: { tenantId, createdAt: { lt: cutoff } },
      });
      affected = r.count;
    } else if (p.doctype === "Customer" && p.strategy === "anonymize") {
      const candidates = await prisma.customer.findMany({
        where: {
          tenantId,
          createdAt: { lt: cutoff },
          NOT: [{ customerName: "[REDACTED]" }],
        },
        select: { id: true },
      });
      for (const c of candidates) {
        try {
          await anonymizeCustomer(prisma, tenantId, c.id);
          affected += 1;
        } catch {
          // skip
        }
      }
    } else if (p.doctype === "Supplier" && p.strategy === "anonymize") {
      const candidates = await prisma.supplier.findMany({
        where: {
          tenantId,
          createdAt: { lt: cutoff },
          NOT: [{ supplierName: "[REDACTED]" }],
        },
        select: { id: true },
      });
      for (const c of candidates) {
        try {
          await anonymizeSupplier(prisma, tenantId, c.id);
          affected += 1;
        } catch {
          // skip
        }
      }
    } else if (p.doctype === "Employee" && p.strategy === "anonymize") {
      const candidates = await prisma.employee.findMany({
        where: {
          tenantId,
          status: "Left",
          updatedAt: { lt: cutoff },
          NOT: [{ employeeName: "[REDACTED]" }],
        },
        select: { id: true },
      });
      for (const c of candidates) {
        try {
          await anonymizeEmployee(prisma, tenantId, c.id);
          affected += 1;
        } catch {
          // skip
        }
      }
    }
    await prisma.dataRetentionPolicy.update({
      where: { id: p.id },
      data: { lastRunAt: new Date() },
    });
    results.push({ doctype: p.doctype, strategy: p.strategy, affected });
  }
  res.json({ policiesEvaluated: policies.length, results });
});

// ---------- O5 + O6: GST reports ----------

gstRouter.get("/gstr1", perms("Report").read, async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  if (!fromStr || !toStr)
    return res.status(400).json({ error: "from + to (YYYY-MM-DD) required" });
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const r = await gstr1(prisma, req.auth!.tenantId, from, to);
  res.json(r);
});

gstRouter.get("/gstr3b", perms("Report").read, async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  if (!fromStr || !toStr)
    return res.status(400).json({ error: "from + to (YYYY-MM-DD) required" });
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const r = await gstr3b(prisma, req.auth!.tenantId, from, to);
  res.json(r);
});

// O5: GSTR-1 HSN summary — one row per (hsnCode, uom) with qty + taxable
// value + IGST/CGST/SGST split, following the standard GSTR-1 filing format.
gstRouter.get("/gstr1-hsn", perms("Report").read, async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  if (!fromStr || !toStr)
    return res.status(400).json({ error: "from + to (YYYY-MM-DD) required" });
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const r = await gstr1Hsn(prisma, req.auth!.tenantId, from, to);
  res.json(r);
});

// GSTR-9 annual return — consolidates a full financial year of GSTR-1 +
// GSTR-3B numbers into a single filing document. Callers pass a
// financial-year window (e.g. from=2025-04-01, to=2026-03-31); the
// aggregator slices into monthly rows internally so the numbers reconcile
// with each month's GSTR-3B.
gstRouter.get("/gstr9", perms("Report").read, async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : "";
  const toStr = typeof req.query.to === "string" ? req.query.to : "";
  if (!fromStr || !toStr)
    return res.status(400).json({ error: "from + to (YYYY-MM-DD) required" });
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const r = await gstr9(prisma, req.auth!.tenantId, from, to);
  res.json(r);
});

// ---------- E-way bill payload generator ----------
// Assembles the NIC-spec JSON for a single SalesInvoice. Response is the
// payload the operator uploads/proxies to the e-way bill portal (via GSP
// or the government's own portal). Live submission is out of scope —
// matches the IRP e-invoice pattern where LiveIrpAdapter exists but per-
// tenant TenantIntegration wiring is the operator's task.

const ewayInputSchema = z.object({
  subSupplyType: z.enum([
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
  ]),
  transactionType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  transMode: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  transDistance: z.coerce.number().int().positive(),
  transporterId: z.string().max(15).optional().nullable(),
  transporterName: z.string().max(100).optional().nullable(),
  vehicleNo: z.string().max(20).optional().nullable(),
  transDocNo: z.string().max(50).optional().nullable(),
  transDocDate: z.string().optional().nullable(),
  // "Ship-to" override — for Bill-To-Ship-To (transactionType=2) the
  // buyer party is different from the ship-to address. If absent, the SI's
  // customer address doubles as the ship-to.
  shipTo: z
    .object({
      legalName: z.string().min(1),
      address: z.string().min(1),
      place: z.string().min(1),
      pincode: z.string().min(6).max(6),
      stateCode: z.string().min(2).max(2),
      gstin: z.string().max(15).nullable().optional(),
    })
    .optional(),
});

gstRouter.post(
  "/eway-bill/:invoiceId",
  perms("SalesInvoice").read,
  async (req, res) => {
    const parsed = ewayInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const tenantId = req.auth!.tenantId;

    const [tenant, invoice] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          companyGstin: true,
          homeStateCode: true,
        },
      }),
      prisma.salesInvoice.findFirst({
        where: { id: req.params.invoiceId, tenantId },
        include: {
          customer: {
            select: {
              customerName: true,
              gstin: true,
            },
          },
          items: {
            include: {
              item: {
                select: {
                  itemName: true,
                  description: true,
                  hsnCode: true,
                  stockUom: true,
                },
              },
            },
          },
          taxes: true,
        },
      }),
    ]);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    if (invoice.status !== "Submitted" && invoice.status !== "Paid") {
      return res.status(400).json({
        error: `E-way bill can only be generated for Submitted or Paid invoices (current: ${invoice.status})`,
      });
    }

    // Seller party — pulled from Tenant. If either the GSTIN or the home
    // state is missing, we can't produce a valid payload — the portal will
    // reject it. Fail early with a clear message.
    if (!tenant.companyGstin) {
      return res
        .status(400)
        .json({ error: "Tenant is missing companyGstin — set it in Company Settings first" });
    }
    const homeState =
      tenant.homeStateCode ?? tenant.companyGstin.slice(0, 2);

    // Address details for tenant + customer aren't in the base models (both
    // link out to the Address doctype). For MVP we ask the operator to
    // supply seller + ship-to details as query params on the portal side,
    // and we stamp placeholder text so the payload validates locally.
    // A follow-up ticket wires an Address lookup by (tenantId, ownerId).
    const payload = buildEwayBillPayload(
      {
        name: invoice.name,
        postingDate: invoice.postingDate,
        netTotal: Number(invoice.netTotal),
        totalTaxes: Number(invoice.totalTaxes),
        grandTotal: Number(invoice.grandTotal),
        items: invoice.items.map((line) => ({
          itemName: line.item.itemName,
          itemDescription: line.description ?? line.item.description,
          hsnCode: line.item.hsnCode,
          qty: Number(line.qty),
          uom: line.item.stockUom ?? "Nos",
          amount: Number(line.amount),
        })),
        taxes: invoice.taxes.map((t) => ({
          description: t.description,
          rate: Number(t.rate),
          taxAmount: Number(t.taxAmount),
        })),
      },
      {
        gstin: tenant.companyGstin,
        legalName: tenant.name,
        address: "Registered office address",
        place: "—",
        pincode: "000000",
        stateCode: homeState,
      },
      parsed.data.shipTo
        ? {
            gstin: parsed.data.shipTo.gstin ?? null,
            legalName: parsed.data.shipTo.legalName,
            address: parsed.data.shipTo.address,
            place: parsed.data.shipTo.place,
            pincode: parsed.data.shipTo.pincode,
            stateCode: parsed.data.shipTo.stateCode,
          }
        : {
            gstin: invoice.customer.gstin ?? null,
            legalName: invoice.customer.customerName,
            address: "Buyer address on file",
            place: "—",
            pincode: "000000",
            stateCode:
              invoice.customer.gstin && invoice.customer.gstin.length >= 2
                ? invoice.customer.gstin.slice(0, 2)
                : homeState,
          },
      {
        subSupplyType: parsed.data.subSupplyType as SubSupplyType,
        transactionType: parsed.data.transactionType as TransactionType,
        transMode: parsed.data.transMode as TransMode | undefined,
        transDistance: parsed.data.transDistance,
        transporterId: parsed.data.transporterId ?? null,
        transporterName: parsed.data.transporterName ?? null,
        vehicleNo: parsed.data.vehicleNo ?? null,
        transDocNo: parsed.data.transDocNo ?? null,
        transDocDate: parsed.data.transDocDate ?? null,
      },
    );

    if (req.query.download === "1") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="eway-${invoice.name}.json"`,
      );
      return res.send(JSON.stringify(payload, null, 2));
    }
    res.json({ payload, invoiceName: invoice.name });
  },
);

// ---------- O3b: Anonymization archives (encrypted PII snapshots) ----------
//
// List metadata for every pre-anonymization snapshot in the tenant. Decrypt
// endpoint is gated on DSR:submit — same authority level as running the
// erasure itself — and every decrypt is written to the audit log by the
// standard middleware.

archiveRouter.get("/", pArch.read, async (req, res) => {
  const rows = await prisma.anonymizationArchive.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: {
      id: true,
      subjectType: true,
      subjectId: true,
      dsrId: true,
      fieldsChanged: true,
      createdBy: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  res.json(rows);
});

archiveRouter.get("/:id/decrypt", pArch.submit, async (req, res) => {
  const row = await prisma.anonymizationArchive.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  try {
    const plain = decryptSecrets(row.cipher);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="archive-${row.subjectType}-${row.id}.json"`,
    );
    res.send(
      JSON.stringify(
        {
          archiveId: row.id,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          fieldsChanged: row.fieldsChanged,
          decryptedAt: new Date().toISOString(),
          decryptedBy: req.auth!.userId,
          snapshot: plain,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    res
      .status(500)
      .json({ error: e instanceof Error ? e.message : "Decrypt failed" });
  }
});

// Void satisfies Prisma import (kept for future compliance features).
void Prisma;
