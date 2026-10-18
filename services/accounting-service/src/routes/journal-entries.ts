import { Router } from "express";
import { z } from "zod";
import { prisma, nextName, resolveCompanyForVoucher, companyPrefix } from "@lumaara/db";
import { cancelGLEntries, postGLEntries } from "../lib/gl-posting";
import { getAllowedCompanyIds, idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const journalEntryRouter = Router();

const p = perms("JournalEntry");

const lineSchema = z
  .object({
    accountId: z.string().min(1),
    debit: z.coerce.number().nonnegative().default(0),
    credit: z.coerce.number().nonnegative().default(0),
    partyType: z.enum(["Customer", "Supplier"]).optional().nullable(),
    partyId: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
  })
  .refine((l) => l.debit > 0 || l.credit > 0, {
    message: "each line must have either debit or credit > 0",
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), {
    message: "a single line cannot have both debit and credit",
  });

const createSchema = z.object({
  postingDate: z.string().datetime().optional(),
  currency: z.string().default("INR"),
  remarks: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  accounts: z.array(lineSchema).min(2), // must have at least a debit and a credit
});


journalEntryRouter.get("/", p.read, async (req, res) => {
  // Multi-company Phase 7: honor global scope + user allowlist.
  const requested =
    typeof req.query.companyId === "string" && req.query.companyId.length > 0
      ? req.query.companyId
      : null;
  const allowed = await getAllowedCompanyIds(req.auth!);
  if (requested && allowed !== null && !allowed.includes(requested)) {
    return res.status(403).json({ error: "You don't have access to that company" });
  }
  const companyWhere = requested
    ? { companyId: requested }
    : allowed !== null
      ? { companyId: { in: allowed } }
      : {};
  const rows = await prisma.journalEntry.findMany({
    where: { tenantId: req.auth!.tenantId, ...companyWhere },
    include: { accounts: { include: { account: { select: { accountName: true } } } } },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

journalEntryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.journalEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { accounts: { include: { account: true } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: JE with balanced lines + GL entries posted by submit.
// GL entries mirror the JE lines 1:1 after submit — showing both is redundant
// but useful as a sanity check that the posting matched the source of truth.
journalEntryRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const je = await prisma.journalEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      accounts: { include: { account: { select: { accountName: true, rootType: true } } } },
    },
  });
  if (!je) return res.status(404).json({ error: "Not found" });

  const glEntries = await prisma.gLEntry.findMany({
    where: {
      tenantId,
      voucherType: "JournalEntry",
      voucherId: je.id,
      isCancelled: false,
    },
    include: { account: { select: { accountName: true, rootType: true } } },
    orderBy: { createdAt: "asc" },
  });

  res.json({ journalEntry: je, glEntries });
});

// Update a Draft JE. Server enforces status=Draft. Replaces child lines
// wholesale — Draft has no GL to worry about.
journalEntryRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.journalEntry.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit JE in status ${existing.status}` });

  const totalDebit = p.accounts.reduce((s, a) => s + a.debit, 0);
  const totalCredit = p.accounts.reduce((s, a) => s + a.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    return res.status(400).json({
      error: `Journal entry is unbalanced: debit=${totalDebit} credit=${totalCredit}`,
    });
  }

  const accountIds = [...new Set(p.accounts.map((a) => a.accountId))];
  const validAccounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, isGroup: false },
    select: { id: true },
  });
  if (validAccounts.length !== accountIds.length) {
    return res.status(400).json({ error: "One or more accounts are invalid (or are groups)" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.journalEntryAccount.deleteMany({
      where: { journalEntryId: existing.id },
    });
    return tx.journalEntry.update({
      where: { id: existing.id },
      data: {
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        currency: p.currency,
        remarks: p.remarks ?? null,
        ...(p.companyId !== undefined ? { companyId: p.companyId } : {}),
        accounts: {
          create: p.accounts.map((a) => ({
            accountId: a.accountId,
            debit: a.debit,
            credit: a.credit,
            partyType: a.partyType ?? null,
            partyId: a.partyId ?? null,
            remarks: a.remarks ?? null,
          })),
        },
      },
      include: { accounts: true },
    });
  });
  res.json(updated);
});

journalEntryRouter.post("/", p.create, idempotency("POST /journal-entries"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const totalDebit = p.accounts.reduce((s, a) => s + a.debit, 0);
  const totalCredit = p.accounts.reduce((s, a) => s + a.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    return res.status(400).json({
      error: `Journal entry is unbalanced: debit=${totalDebit} credit=${totalCredit}`,
    });
  }

  const accountIds = [...new Set(p.accounts.map((a) => a.accountId))];
  const validAccounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, isGroup: false },
    select: { id: true },
  });
  if (validAccounts.length !== accountIds.length) {
    return res.status(400).json({ error: "One or more accounts are invalid (or are groups)" });
  }

  let company;
  try {
    company = await resolveCompanyForVoucher(prisma, tenantId, p.companyId);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const name = await nextName(prisma, tenantId, companyPrefix("JV-", company?.code));
  const row = await prisma.journalEntry.create({
    data: {
      tenantId,
      name,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      currency: p.currency,
      remarks: p.remarks ?? null,
      status: "Draft",
      companyId: company?.id ?? null,
      accounts: {
        create: p.accounts.map((a) => ({
          accountId: a.accountId,
          debit: a.debit,
          credit: a.credit,
          partyType: a.partyType ?? null,
          partyId: a.partyId ?? null,
          remarks: a.remarks ?? null,
        })),
      },
    },
    include: { accounts: true },
  });
  res.status(201).json(row);
});

journalEntryRouter.post("/:id/submit", p.submit, idempotency("POST /journal-entries/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: { accounts: true },
      });
      if (!je) throw new Error("Not found");
      if (je.status !== "Draft") throw new Error(`Cannot submit JE in status ${je.status}`);

      await postGLEntries(tx, {
        tenantId,
        postingDate: je.postingDate,
        voucherType: "JournalEntry",
        voucherId: je.id,
        voucherName: je.name,
        companyId: je.companyId,
        lines: je.accounts.map((a) => ({
          accountId: a.accountId,
          debit: Number(a.debit),
          credit: Number(a.credit),
          partyType: a.partyType,
          partyId: a.partyId,
          remarks: a.remarks,
        })),
      });

      return tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "Submitted" },
        include: { accounts: true },
      });
    });
    void publishRealtime(tenantId, "journal-entry", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

journalEntryRouter.post("/:id/cancel", p.cancel, idempotency("POST /journal-entries/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!je) throw new Error("Not found");
      if (je.status === "Cancelled") throw new Error("Already cancelled");

      if (je.status === "Submitted") {
        await cancelGLEntries(tx, { tenantId, voucherType: "JournalEntry", voucherId: je.id });
      }

      return tx.journalEntry.update({
        where: { id: je.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "journal-entry", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
