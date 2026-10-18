import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// CostCenter + BankGuarantee + LetterOfCredit routes.
//
// CostCenter is a hierarchical master (like Account) — supports parentId
// tree-style organization. BankGuarantee + LetterOfCredit are flat records
// covering the trade-finance side of the LC/BG dashboard.

// -------- CostCenter --------

export const costCenterRouter = Router();
const pCC = perms("CostCenter");

const ccSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
  disabled: z.boolean().default(false),
  budget: z.coerce.number().optional().nullable(),
});

costCenterRouter.get("/", pCC.read, async (req, res) => {
  const rows = await prisma.costCenter.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ isGroup: "desc" }, { name: "asc" }],
    include: { parent: { select: { name: true } } },
  });
  res.json(rows);
});

costCenterRouter.post("/", pCC.create, async (req, res) => {
  const p = ccSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  if (p.data.parentId) {
    const parent = await prisma.costCenter.findFirst({
      where: { id: p.data.parentId, tenantId: req.auth!.tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
  }
  try {
    const row = await prisma.costCenter.create({
      data: { tenantId: req.auth!.tenantId, ...p.data },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
  }
});

costCenterRouter.put("/:id", pCC.write, async (req, res) => {
  const p = ccSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.costCenter.update({ where: { id: existing.id }, data: p.data });
  res.json(row);
});

costCenterRouter.delete("/:id", pCC.delete, async (req, res) => {
  const existing = await prisma.costCenter.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { children: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.children > 0)
    return res.status(400).json({ error: "Cannot delete a cost center with children" });
  await prisma.costCenter.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// -------- BankGuarantee --------

export const bankGuaranteeRouter = Router();
const pBG = perms("BankGuarantee");

const bgSchema = z.object({
  bgNumber: z.string().min(1),
  bankName: z.string().min(1),
  bgType: z.enum(["Performance", "Financial", "Bid", "Advance"]),
  beneficiaryName: z.string().optional().nullable(),
  issueDate: z.string().datetime(),
  expiryDate: z.string().datetime(),
  amount: z.coerce.number().positive(),
  currency: z.string().default("INR"),
  marginPct: z.coerce.number().optional().nullable(),
  commissionAmount: z.coerce.number().optional().nullable(),
  purpose: z.string().optional().nullable(),
  status: z.enum(["Active", "Extended", "Cancelled", "Expired", "Invoked"]).default("Active"),
  linkedProject: z.string().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
});

bankGuaranteeRouter.get("/", pBG.read, async (req, res) => {
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (typeof req.query.status === "string") where.status = req.query.status;
  const rows = await prisma.bankGuarantee.findMany({
    where,
    orderBy: [{ expiryDate: "asc" }],
    include: {
      supplier: { select: { id: true, supplierName: true } },
      customer: { select: { id: true, customerName: true } },
    },
  });
  res.json(rows);
});

bankGuaranteeRouter.post("/", pBG.create, async (req, res) => {
  const p = bgSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    const row = await prisma.bankGuarantee.create({
      data: {
        tenantId: req.auth!.tenantId,
        ...p.data,
        issueDate: new Date(p.data.issueDate),
        expiryDate: new Date(p.data.expiryDate),
      },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate BG#" });
  }
});

bankGuaranteeRouter.put("/:id", pBG.write, async (req, res) => {
  const p = bgSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.bankGuarantee.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = { ...p.data };
  if (p.data.issueDate) data.issueDate = new Date(p.data.issueDate);
  if (p.data.expiryDate) data.expiryDate = new Date(p.data.expiryDate);
  const row = await prisma.bankGuarantee.update({ where: { id: existing.id }, data });
  res.json(row);
});

bankGuaranteeRouter.delete("/:id", pBG.delete, async (req, res) => {
  const existing = await prisma.bankGuarantee.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.bankGuarantee.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// -------- LetterOfCredit --------

export const letterOfCreditRouter = Router();
const pLC = perms("LetterOfCredit");

const lcSchema = z.object({
  lcNumber: z.string().min(1),
  lcType: z.enum(["Import", "Export", "Sight", "Usance", "Revolving"]),
  issuingBank: z.string().min(1),
  advisingBank: z.string().optional().nullable(),
  beneficiaryName: z.string().optional().nullable(),
  applicantName: z.string().optional().nullable(),
  issueDate: z.string().datetime(),
  expiryDate: z.string().datetime(),
  amount: z.coerce.number().positive(),
  currency: z.string().default("INR"),
  utilizationPct: z.coerce.number().min(0).max(100).default(0),
  goodsDescription: z.string().optional().nullable(),
  status: z.enum(["Active", "Utilized", "Expired", "Amended", "Cancelled"]).default("Active"),
  supplierId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
});

letterOfCreditRouter.get("/", pLC.read, async (req, res) => {
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (typeof req.query.status === "string") where.status = req.query.status;
  const rows = await prisma.letterOfCredit.findMany({
    where,
    orderBy: [{ expiryDate: "asc" }],
    include: {
      supplier: { select: { id: true, supplierName: true } },
      customer: { select: { id: true, customerName: true } },
    },
  });
  res.json(rows);
});

letterOfCreditRouter.post("/", pLC.create, async (req, res) => {
  const p = lcSchema.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  try {
    const row = await prisma.letterOfCredit.create({
      data: {
        tenantId: req.auth!.tenantId,
        ...p.data,
        issueDate: new Date(p.data.issueDate),
        expiryDate: new Date(p.data.expiryDate),
      },
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate LC#" });
  }
});

letterOfCreditRouter.put("/:id", pLC.write, async (req, res) => {
  const p = lcSchema.partial().safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const existing = await prisma.letterOfCredit.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data: Record<string, unknown> = { ...p.data };
  if (p.data.issueDate) data.issueDate = new Date(p.data.issueDate);
  if (p.data.expiryDate) data.expiryDate = new Date(p.data.expiryDate);
  const row = await prisma.letterOfCredit.update({ where: { id: existing.id }, data });
  res.json(row);
});

letterOfCreditRouter.delete("/:id", pLC.delete, async (req, res) => {
  const existing = await prisma.letterOfCredit.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.letterOfCredit.delete({ where: { id: existing.id } });
  res.status(204).send();
});
