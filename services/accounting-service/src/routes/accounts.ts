import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const accountRouter = Router();

const p = perms("Account");

const upsertSchema = z.object({
  accountName: z.string().min(1),
  rootType: z.enum(["Asset", "Liability", "Equity", "Income", "Expense"]),
  accountType: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
  disabled: z.boolean().default(false),
  companyId: z.string().optional().nullable(),
  // Multi-company Phase 4: intercompany elimination flag. Flip via PATCH
  // /accounts/:id/intercompany or set at create time.
  isIntercompany: z.boolean().default(false),
});

// Flat list (for dropdowns).
accountRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.account.findMany({
    where: { tenantId: req.auth!.tenantId, disabled: false },
    orderBy: [{ rootType: "asc" }, { accountName: "asc" }],
  });
  res.json(rows);
});

// Tree view: returns roots (parentId=null) with nested children.
accountRouter.get("/tree", p.read, async (req, res) => {
  const rows = await prisma.account.findMany({
    where: { tenantId: req.auth!.tenantId, disabled: false },
    orderBy: { accountName: "asc" },
  });

  type Node = (typeof rows)[number] & { children: Node[] };
  const byId = new Map<string, Node>();
  const roots: Node[] = [];
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parentId && byId.has(r.parentId)) {
      byId.get(r.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  res.json(roots);
});

accountRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;

  if (p.parentId) {
    const parent = await prisma.account.findFirst({
      where: { id: p.parentId, tenantId: req.auth!.tenantId },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent account" });
    if (!parent.isGroup) return res.status(400).json({ error: "Parent must be a group" });
    if (parent.rootType !== p.rootType)
      return res.status(400).json({ error: "Child rootType must match parent" });
  }

  try {
    const row = await prisma.account.create({
      data: { ...p, tenantId: req.auth!.tenantId },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Account name already exists" });
    }
    throw e;
  }
});

// Multi-company Phase 4: flip Account.isIntercompany. When true, the
// account's balance is auto-eliminated from the /consolidation report.
// Typical usage: paired "IC Receivable — Company B" (Asset) + "IC Payable
// — Company B" (Liability) accounts, both flagged. Their per-company
// balances net to zero at the consolidated level, so eliminating both
// removes the intercompany noise from the rollup.
const intercompanyFlagSchema = z.object({ isIntercompany: z.boolean() });
accountRouter.patch("/:id/intercompany", p.write, async (req, res) => {
  const parsed = intercompanyFlagSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.account.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, isGroup: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.isGroup) {
    return res.status(400).json({ error: "Cannot flag a group account as intercompany" });
  }
  const row = await prisma.account.update({
    where: { id: existing.id },
    data: { isIntercompany: parsed.data.isIntercompany },
  });
  res.json(row);
});

// B16: CoA export as CSV. One row per account. Parent is stored by name (not
// id) so the file is portable across tenants + human-readable. Roundtrips
// through the import route below.
accountRouter.get("/export.csv", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.account.findMany({
    where: { tenantId },
    include: { parent: { select: { accountName: true } } },
    orderBy: [{ rootType: "asc" }, { accountName: "asc" }],
  });
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  const header = "accountName,rootType,accountType,parentAccountName,isGroup,disabled";
  const body = rows
    .map((r) =>
      [
        esc(r.accountName),
        esc(r.rootType),
        esc(r.accountType ?? ""),
        esc(r.parent?.accountName ?? ""),
        r.isGroup ? "1" : "0",
        r.disabled ? "1" : "0",
      ].join(","),
    )
    .join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="chart-of-accounts.csv"`,
  );
  res.send(`${header}\n${body}\n`);
});

// B16: CoA import. Accepts `{rows: Row[]}` (JSON — CSV parsing happens in
// the UI so this route stays simple). Two-pass:
//   1. All rows with `isGroup=true` and no parentAccountName (roots).
//   2. Then each subsequent depth level — a row is creatable once its parent
//      exists in DB. Loops until nothing more can be created; refuses on
//      cycle / unknown parent.
// Idempotency: existing accounts with the same `accountName` in the tenant
// are skipped (not updated) — safer than accidentally rewriting a live CoA.
const importRowSchema = z.object({
  accountName: z.string().min(1),
  rootType: z.enum(["Asset", "Liability", "Equity", "Income", "Expense"]),
  accountType: z.string().optional().nullable(),
  parentAccountName: z.string().optional().nullable(),
  isGroup: z.boolean().default(false),
  disabled: z.boolean().default(false),
});
const importSchema = z.object({ rows: z.array(importRowSchema).min(1) });

accountRouter.post("/import", p.create, async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.account.findMany({
    where: { tenantId },
    select: { id: true, accountName: true },
  });
  const nameToId = new Map(existing.map((a) => [a.accountName, a.id]));

  const pending = parsed.data.rows.filter((r) => !nameToId.has(r.accountName));
  const skipped = parsed.data.rows.length - pending.length;
  const created: { accountName: string }[] = [];

  // Loop: on each pass, create any row whose parent (or no parent) is
  // resolvable. Terminate when no progress is made.
  let madeProgress = true;
  while (pending.length > 0 && madeProgress) {
    madeProgress = false;
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const parentId = r.parentAccountName
        ? nameToId.get(r.parentAccountName)
        : null;
      if (r.parentAccountName && !parentId) continue; // parent not yet available
      // Validate against the parent (if any) that rootType matches.
      if (parentId) {
        const parent = await prisma.account.findFirst({
          where: { id: parentId, tenantId },
        });
        if (!parent || parent.rootType !== r.rootType) {
          return res.status(400).json({
            error: `${r.accountName}: rootType mismatch with parent ${r.parentAccountName}`,
          });
        }
      }
      try {
        const acc = await prisma.account.create({
          data: {
            tenantId,
            accountName: r.accountName,
            rootType: r.rootType,
            accountType: r.accountType ?? null,
            parentId: parentId ?? null,
            isGroup: r.isGroup,
            disabled: r.disabled,
          },
        });
        nameToId.set(r.accountName, acc.id);
        created.push({ accountName: r.accountName });
      } catch (e) {
        if (e instanceof Error && e.message.includes("Unique constraint")) continue;
        throw e;
      }
      pending.splice(i, 1);
      i -= 1;
      madeProgress = true;
    }
  }
  if (pending.length > 0) {
    return res.status(400).json({
      error: `Could not resolve parents for: ${pending.map((r) => r.accountName).join(", ")}`,
      created,
      skipped,
    });
  }
  res.json({ created: created.length, skipped });
});
