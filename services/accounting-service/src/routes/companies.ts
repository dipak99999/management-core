import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  backfillLegacyCompanyIds,
  backfillUserCompanyAccess,
  cloneCoAForCompany,
  prisma,
} from "@lumaara/db";
import { getAllowedCompanyIds, perms } from "@lumaara/service-auth";

// Multi-company Phase 1: CRUD for the Company doctype. Every tenant should
// have exactly one Company with isDefault=true, seeded on tenant creation
// (see seedTenantDefaults + the ensureDefaultCompany helper below).
//
// Reused permission surface: `Account` — the users who can create/edit
// accounts are the same ones who should manage legal entities.

export const companyRouter = Router();
const p = perms("Account");

// Multi-company Phase 4: every default account override is optional.
// Setting a field here overrides the same-named Tenant.default*AccountId
// on any voucher whose companyId points at this Company. Leave null to
// inherit from the tenant. See packages/db/src/gl-posting.ts:
// requireTenantDefaults for the resolution chain.
const DEFAULT_ACCOUNT_KEYS = [
  "defaultReceivableAccountId",
  "defaultPayableAccountId",
  "defaultCashAccountId",
  "defaultBankAccountId",
  "defaultIncomeAccountId",
  "defaultExpenseAccountId",
  "defaultStockInHandAccountId",
  "defaultCogsAccountId",
  "defaultStockReceivedButNotBilledAccountId",
  "defaultSalaryExpenseAccountId",
  "defaultEmployeePayableAccountId",
  "defaultStatutoryPayableAccountId",
  "defaultFxGainLossAccountId",
  "defaultLoanReceivableAccountId",
  "defaultInterestIncomeAccountId",
  "defaultRetainedEarningsAccountId",
  "defaultRoundOffAccountId",
  "defaultStockAdjustmentAccountId",
  "defaultLoyaltyDiscountAccountId",
  "defaultDeferredRevenueAccountId",
] as const;

const defaultAccountShape = Object.fromEntries(
  DEFAULT_ACCOUNT_KEYS.map((k) => [k, z.string().optional().nullable()]),
) as unknown as { [K in (typeof DEFAULT_ACCOUNT_KEYS)[number]]: z.ZodOptional<z.ZodNullable<z.ZodString>> };

const upsertSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(24),
  gstin: z.string().max(15).optional().nullable(),
  homeStateCode: z.string().max(2).optional().nullable(),
  pan: z.string().max(10).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  baseCurrency: z.string().min(3).max(3).default("INR"),
  isDefault: z.boolean().default(false),
  disabled: z.boolean().default(false),
  ...defaultAccountShape,
});

// Validate every non-null default*AccountId in the payload actually points
// at a leaf Account owned by this tenant. Runs once at create/update.
async function validateDefaultAccounts(
  tenantId: string,
  data: Partial<Record<(typeof DEFAULT_ACCOUNT_KEYS)[number], string | null | undefined>>,
): Promise<string | null> {
  const ids = DEFAULT_ACCOUNT_KEYS.map((k) => data[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length === 0) return null;
  const found = await prisma.account.findMany({
    where: { id: { in: ids }, tenantId, isGroup: false },
    select: { id: true },
  });
  if (found.length !== new Set(ids).size) {
    return "One or more default account IDs are invalid or point at group accounts";
  }
  return null;
}

function pickDefaultOverrides(
  body: Partial<Record<(typeof DEFAULT_ACCOUNT_KEYS)[number], string | null | undefined>>,
): Partial<Record<(typeof DEFAULT_ACCOUNT_KEYS)[number], string | null>> {
  const out: Partial<Record<(typeof DEFAULT_ACCOUNT_KEYS)[number], string | null>> = {};
  for (const k of DEFAULT_ACCOUNT_KEYS) {
    if (body[k] !== undefined) out[k] = body[k] ?? null;
  }
  return out;
}

companyRouter.get("/", p.read, async (req, res) => {
  // Multi-company Phase 6: filter by allowed companies for non-admins.
  // `null` from the helper means bypass (admin/oauth-client) — no filter.
  const allowed = await getAllowedCompanyIds(req.auth!);
  const rows = await prisma.company.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(allowed === null ? {} : { id: { in: allowed } }),
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

// Multi-company Phase 6: list all users in the tenant with their
// current company-access rows. Powers the admin matrix UI. MUST come
// BEFORE the `/:id` handler or Express will match `/user-access` as
// `id="user-access"` first.
companyRouter.get("/user-access", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [users, access] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.userCompanyAccess.findMany({
      where: { tenantId },
      select: { userId: true, companyId: true },
    }),
  ]);
  const byUser = new Map<string, string[]>();
  for (const a of access) {
    const arr = byUser.get(a.userId) ?? [];
    arr.push(a.companyId);
    byUser.set(a.userId, arr);
  }
  res.json(
    users.map((u) => ({
      ...u,
      isAdmin: u.role === "admin",
      companyIds: byUser.get(u.id) ?? [],
    })),
  );
});

// Multi-company Phase 8: bulk grant/revoke company access.
// Payload: { companyId, userIds[], action: "grant"|"revoke" }
//
// Semantics:
//   * "grant"  → upserts one UserCompanyAccess row per user (idempotent
//                via skipDuplicates on the @@unique).
//   * "revoke" → deletes matching rows.
// Admins are silently skipped (their access is bypass-based). Every
// change lands one structured AuditLog entry so ops can trace bulk
// operations back to a single API call. MUST come before /:userId or
// Express matches the wrong route (route-order guard).
const bulkAccessSchema = z.object({
  companyId: z.string().min(1),
  userIds: z.array(z.string()).min(1),
  action: z.enum(["grant", "revoke"]),
});
companyRouter.post("/user-access/bulk", p.write, async (req, res) => {
  const parsed = bulkAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { companyId, userIds, action } = parsed.data;
  const tenantId = req.auth!.tenantId;

  const [company, users] = await Promise.all([
    prisma.company.findFirst({
      where: { id: companyId, tenantId },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { id: { in: Array.from(new Set(userIds)) }, tenantId },
      select: { id: true, role: true, email: true },
    }),
  ]);
  if (!company) return res.status(400).json({ error: "companyId does not belong to this tenant" });
  const nonAdminUsers = users.filter((u) => u.role !== "admin");
  const adminsSkipped = users.length - nonAdminUsers.length;

  if (nonAdminUsers.length === 0) {
    return res.json({ action, companyId, changed: 0, adminsSkipped });
  }

  const result = await prisma.$transaction(async (tx) => {
    let changed = 0;
    if (action === "grant") {
      const r = await tx.userCompanyAccess.createMany({
        data: nonAdminUsers.map((u) => ({ tenantId, userId: u.id, companyId })),
        skipDuplicates: true,
      });
      changed = r.count;
    } else {
      const r = await tx.userCompanyAccess.deleteMany({
        where: {
          tenantId,
          companyId,
          userId: { in: nonAdminUsers.map((u) => u.id) },
        },
      });
      changed = r.count;
    }
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: req.auth!.userId,
        userEmail: req.auth!.email,
        method: "POST-user-access-bulk",
        path: req.originalUrl,
        doctype: "UserCompanyAccess",
        docId: companyId,
        statusCode: 200,
        payload: {
          action,
          companyId,
          companyName: company.name,
          targetUserIds: nonAdminUsers.map((u) => u.id),
          targetUserEmails: nonAdminUsers.map((u) => u.email),
          changed,
          adminsSkipped,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return { changed };
  });

  res.json({
    action,
    companyId,
    changed: result.changed,
    adminsSkipped,
    usersConsidered: users.length,
  });
});

companyRouter.put("/user-access/:userId", p.write, async (req, res) => {
  const parsed = z.object({ companyIds: z.array(z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.params.userId;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, role: true, email: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role === "admin") {
    return res.status(400).json({
      error: "Admins bypass company access — no rows needed. Change the user's role first.",
    });
  }
  const companyIds = Array.from(new Set(parsed.data.companyIds));
  if (companyIds.length > 0) {
    const found = await prisma.company.count({
      where: { id: { in: companyIds }, tenantId },
    });
    if (found !== companyIds.length) {
      return res.status(400).json({ error: "One or more companyIds don't belong to this tenant" });
    }
  }

  // Multi-company Phase 7: capture BEFORE state so we can write a
  // structured audit-log entry with a real added/removed diff, not
  // just the raw request payload. Handy when a compliance auditor
  // asks "who lost access to Company X and when?"
  const before = await prisma.userCompanyAccess.findMany({
    where: { tenantId, userId },
    select: { companyId: true },
  });
  const beforeSet = new Set(before.map((b) => b.companyId));
  const afterSet = new Set(companyIds);
  const added = companyIds.filter((c) => !beforeSet.has(c));
  const removed = [...beforeSet].filter((c) => !afterSet.has(c));

  await prisma.$transaction(async (tx) => {
    await tx.userCompanyAccess.deleteMany({ where: { tenantId, userId } });
    if (companyIds.length > 0) {
      await tx.userCompanyAccess.createMany({
        data: companyIds.map((cid) => ({ tenantId, userId, companyId: cid })),
      });
    }
    // Belt-and-suspenders audit entry with the diff. Fire in the same
    // tx so it's atomic with the state change — if the write rolls
    // back, no misleading "granted access" log persists.
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: req.auth!.userId,
        userEmail: req.auth!.email,
        method: "PUT-user-access",
        path: req.originalUrl,
        doctype: "UserCompanyAccess",
        docId: userId,
        statusCode: 200,
        payload: {
          targetUserId: userId,
          targetUserEmail: user.email,
          before: [...beforeSet],
          after: [...afterSet],
          added,
          removed,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
  res.json({ userId, companyIds, added, removed });
});

companyRouter.get("/:id", p.read, async (req, res) => {
  const allowed = await getAllowedCompanyIds(req.auth!);
  if (allowed !== null && !allowed.includes(req.params.id)) {
    return res.status(403).json({ error: "You don't have access to that company" });
  }
  const row = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

companyRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const body = parsed.data;

  const accountsErr = await validateDefaultAccounts(tenantId, body);
  if (accountsErr) return res.status(400).json({ error: accountsErr });

  await prisma.$transaction(async (tx) => {
    if (body.isDefault) {
      await tx.company.updateMany({
        where: { tenantId, isDefault: true },
        data: { isDefault: false },
      });
    }
    try {
      const row = await tx.company.create({
        data: {
          tenantId,
          name: body.name,
          code: body.code,
          gstin: body.gstin ?? null,
          homeStateCode: body.homeStateCode ?? null,
          pan: body.pan ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          postalCode: body.postalCode ?? null,
          baseCurrency: body.baseCurrency,
          isDefault: body.isDefault,
          disabled: body.disabled,
          ...pickDefaultOverrides(body),
        },
      });
      res.status(201).json(row);
    } catch (e) {
      if (e instanceof Error && e.message.includes("Unique constraint")) {
        return res.status(409).json({
          error: "Company with that name or code already exists",
        });
      }
      throw e;
    }
  });
});

companyRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const body = parsed.data;

  const accountsErr = await validateDefaultAccounts(tenantId, body);
  if (accountsErr) return res.status(400).json({ error: accountsErr });

  await prisma.$transaction(async (tx) => {
    // If this update flips isDefault true, unset any other default first.
    if (body.isDefault === true && !existing.isDefault) {
      await tx.company.updateMany({
        where: { tenantId, isDefault: true, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }
    // Guard: prevent flipping the ONLY default company to non-default —
    // leaves the tenant without a fallback for GLEntry.companyId stamping.
    if (body.isDefault === false && existing.isDefault) {
      const otherDefault = await tx.company.count({
        where: { tenantId, isDefault: true, NOT: { id: existing.id } },
      });
      if (otherDefault === 0) {
        throw new Error(
          "Cannot un-set the only default company. Mark another company default first.",
        );
      }
    }
    const row = await tx.company.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.gstin !== undefined ? { gstin: body.gstin } : {}),
        ...(body.homeStateCode !== undefined
          ? { homeStateCode: body.homeStateCode }
          : {}),
        ...(body.pan !== undefined ? { pan: body.pan } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.postalCode !== undefined
          ? { postalCode: body.postalCode }
          : {}),
        ...(body.baseCurrency !== undefined
          ? { baseCurrency: body.baseCurrency }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
        ...pickDefaultOverrides(body),
      },
    });
    res.json(row);
  }).catch((e) => {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  });
});

// Multi-company Phase 3: seed this Company's Chart of Accounts by cloning
// the tenant's shared CoA (all accounts with companyId=null). Non-
// destructive + idempotent — accounts already present under the target
// company (by accountName) are left alone. Useful for a new branch/legal
// entity that starts with the same account structure but needs its own
// per-company posting so reports scope cleanly.
companyRouter.post("/:id/clone-coa", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const target = await prisma.company.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!target) return res.status(404).json({ error: "Not found" });
  try {
    const result = await prisma.$transaction((tx) =>
      cloneCoAForCompany(tx, tenantId, target.id),
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(400).json({ error: msg });
  }
});

// Multi-company Phase 4: one-shot backfill. Stamps `companyId = tenant
// default` on every SI/PI/PE/JE + GLEntry row where it is currently null
// (rows created before Phase 2 shipped the FKs). Idempotent — a second
// call returns zero counts. Guarded by the Account.write perm since it
// mutates a lot of rows across doctypes.
companyRouter.post("/backfill-legacy", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction((tx) =>
    backfillLegacyCompanyIds(tx, tenantId),
  );
  res.json(result);
});

// Multi-company Phase 6: grandfather every existing non-admin user by
// writing one UserCompanyAccess row per (user, company). Idempotent
// via the @@unique constraint + createMany skipDuplicates. Admins are
// bypassed (they never need explicit rows).
companyRouter.post("/backfill-user-access", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const result = await prisma.$transaction((tx) =>
    backfillUserCompanyAccess(tx, tenantId),
  );
  res.json(result);
});

// Multi-company Phase 7: hard-delete with reference guard.
//
// Rules:
//   * Refuse if any transactional row references this Company:
//     GLEntry, SalesInvoice, PurchaseInvoice, PaymentEntry,
//     JournalEntry, IntercompanyJournalEntry. Operators should
//     `disabled=true` instead so historical ledger stays intact.
//   * Refuse if this is the tenant's only default Company OR if it's
//     the only Company period (leaves the tenant without a fallback).
//   * Cascades:
//       - UserCompanyAccess rows are hard-deleted (Company FK has
//         onDelete: Cascade so this is automatic on delete, but we
//         count them first so the caller sees the impact in the
//         response for audit).
//       - Company-scoped Account rows: NOT touched. If any exist
//         with companyId=this.id, refuse the delete and direct
//         the operator to re-scope them first (null out or move to
//         another Company via a manual PATCH).
//   * The whole thing runs in a single transaction so a partial
//     failure rolls back cleanly.
companyRouter.delete("/:id", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const id = req.params.id;
  const company = await prisma.company.findFirst({
    where: { id, tenantId },
    select: { id: true, name: true, isDefault: true },
  });
  if (!company) return res.status(404).json({ error: "Not found" });

  // Access check (an admin action, but reuse the standard guard).
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ok = await prisma.company.findFirst({ where: { id, tenantId } });
  } catch {
    return res.status(500).json({ error: "Company lookup failed" });
  }

  const [glCount, siCount, piCount, peCount, jeCount, icCount, accountCount, totalCompanies] =
    await Promise.all([
      prisma.gLEntry.count({ where: { tenantId, companyId: id } }),
      prisma.salesInvoice.count({ where: { tenantId, companyId: id } }),
      prisma.purchaseInvoice.count({ where: { tenantId, companyId: id } }),
      prisma.paymentEntry.count({ where: { tenantId, companyId: id } }),
      prisma.journalEntry.count({ where: { tenantId, companyId: id } }),
      prisma.intercompanyJournalEntry.count({
        where: { tenantId, OR: [{ fromCompanyId: id }, { toCompanyId: id }] },
      }),
      prisma.account.count({ where: { tenantId, companyId: id } }),
      prisma.company.count({ where: { tenantId } }),
    ]);

  const txnRefs = glCount + siCount + piCount + peCount + jeCount + icCount;
  if (txnRefs > 0) {
    return res.status(400).json({
      error: `Cannot delete — ${txnRefs} transactional record(s) reference this company (GL: ${glCount}, SI: ${siCount}, PI: ${piCount}, PE: ${peCount}, JE: ${jeCount}, IC: ${icCount}). Disable the company instead.`,
    });
  }
  if (accountCount > 0) {
    return res.status(400).json({
      error: `Cannot delete — ${accountCount} Account(s) are scoped to this company. Re-scope them to another company (or null) first.`,
    });
  }
  if (totalCompanies <= 1) {
    return res.status(400).json({
      error: "Cannot delete the only Company in the tenant.",
    });
  }
  if (company.isDefault) {
    return res.status(400).json({
      error: "Cannot delete the default Company. Mark another company default first.",
    });
  }

  const userAccessCount = await prisma.userCompanyAccess.count({
    where: { tenantId, companyId: id },
  });
  await prisma.$transaction(async (tx) => {
    // Cascade fires automatically via schema onDelete: Cascade on
    // UserCompanyAccess.company; explicit deleteMany here is
    // belt-and-suspenders + surfaces the count via response.
    await tx.userCompanyAccess.deleteMany({ where: { tenantId, companyId: id } });
    await tx.company.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: req.auth!.userId,
        userEmail: req.auth!.email,
        method: "DELETE",
        path: req.originalUrl,
        doctype: "Company",
        docId: id,
        statusCode: 200,
        payload: {
          deletedName: company.name,
          userAccessRowsRemoved: userAccessCount,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  });
  res.json({ ok: true, userAccessRowsRemoved: userAccessCount });
});

/**
 * Ensure the tenant has at least one default Company. Called from tenant
 * seed + as a safety net from any code path that needs a defaultCompanyId.
 * Idempotent.
 */
export async function ensureDefaultCompany(
  tenantId: string,
  tenantName: string,
): Promise<string> {
  const existing = await prisma.company.findFirst({
    where: { tenantId, isDefault: true, disabled: false },
    select: { id: true },
  });
  if (existing) return existing.id;
  const row = await prisma.company.create({
    data: {
      tenantId,
      name: tenantName,
      code: tenantName.slice(0, 24).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "MAIN",
      isDefault: true,
      baseCurrency: "INR",
    },
  });
  return row.id;
}
