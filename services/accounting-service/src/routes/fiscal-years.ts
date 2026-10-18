import { Router } from "express";
import { z } from "zod";
import { Prisma, nextName, prisma } from "@lumaara/db";
import { postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { perms } from "@lumaara/service-auth";

export const fiscalYearRouter = Router();

const p = perms("FiscalYear");

const createSchema = z
  .object({
    name: z.string().min(2).max(60),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => new Date(v.endDate) > new Date(v.startDate), {
    message: "endDate must be after startDate",
  });

fiscalYearRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.fiscalYear.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { startDate: "desc" },
  });
  res.json(rows);
});

fiscalYearRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.fiscalYear.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Create a new fiscal year. If isCurrent is set, deactivates any other current.
fiscalYearRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p2 = parsed.data;
  const tenantId = req.auth!.tenantId;

  try {
    const row = await prisma.$transaction(async (tx) => {
      if (p2.isCurrent) {
        await tx.fiscalYear.updateMany({
          where: { tenantId, isCurrent: true },
          data: { isCurrent: false },
        });
      }
      return tx.fiscalYear.create({
        data: {
          tenantId,
          name: p2.name,
          startDate: new Date(p2.startDate),
          endDate: new Date(p2.endDate),
          isCurrent: p2.isCurrent,
        },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Fiscal year name already exists" });
    }
    throw e;
  }
});

const updateSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  isCurrent: z.boolean().optional(),
});

fiscalYearRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.fiscalYear.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.isCurrent === true && !existing.isCurrent) {
      await tx.fiscalYear.updateMany({
        where: { tenantId, isCurrent: true, NOT: { id: existing.id } },
        data: { isCurrent: false },
      });
    }
    return tx.fiscalYear.update({
      where: { id: existing.id },
      data: parsed.data,
    });
  });
  res.json(updated);
});

fiscalYearRouter.delete("/:id", p.delete, async (req, res) => {
  const fy = await prisma.fiscalYear.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!fy) return res.status(404).json({ error: "Not found" });
  if (fy.closedTill)
    return res.status(400).json({ error: "Cannot delete a closed fiscal year" });
  await prisma.fiscalYear.delete({ where: { id: fy.id } });
  res.status(204).send();
});

// Close periods up to a date. Any subsequent GL posting with postingDate <=
// closedTill is rejected by postGLEntries (see packages/db/src/gl-posting.ts).
const closeSchema = z.object({
  closedTill: z.string().datetime(),
});

fiscalYearRouter.post("/:id/close", p.submit, async (req, res) => {
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const fy = await prisma.fiscalYear.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!fy) return res.status(404).json({ error: "Not found" });

  const closedTill = new Date(parsed.data.closedTill);
  if (closedTill < fy.startDate || closedTill > fy.endDate)
    return res.status(400).json({ error: "closedTill must fall within the fiscal year range" });

  // Monotonically forward — never re-open by shrinking closedTill via this endpoint.
  if (fy.closedTill && closedTill < fy.closedTill)
    return res.status(400).json({
      error: `Already closed through ${fy.closedTill.toISOString().slice(0, 10)}; use /reopen to roll back`,
    });

  const updated = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: {
      closedTill,
      closedAt: new Date(),
      closedBy: req.auth!.userId,
    },
  });
  res.json(updated);
});

// Year-end close: generates and auto-submits a closing JE that zeroes every
// Income + Expense account balance and dumps the net into Retained Earnings.
// Preview mode (?preview=1) returns the JE plan without writing.
//
// Sign convention:
//   Income has a CREDIT balance (revenue). To close: DR income, CR retained.
//   Expense has a DEBIT balance. To close: CR expense, DR retained.
// Net effect on Retained Earnings = income − expense = net profit.
fiscalYearRouter.post("/:id/year-end-close", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const preview = req.query.preview === "1";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fy = await tx.fiscalYear.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!fy) throw new Error("Not found");
      if (fy.closedTill && fy.closedTill.getTime() >= fy.endDate.getTime())
        throw new Error("Fiscal year already fully closed");

      // Guard: check no unsubmitted vouchers dated within this FY. Optional
      // strict mode could refuse; MVP just proceeds (user should ensure).

      // Sum each Income/Expense account balance within FY (from GLEntry).
      // We use GLEntry directly since Reports are already report views; this
      // gives us per-account debit − credit for the closing period.
      const rows = await tx.gLEntry.findMany({
        where: {
          tenantId,
          isCancelled: false,
          postingDate: { gte: fy.startDate, lte: fy.endDate },
          account: { rootType: { in: ["Income", "Expense"] } },
        },
        include: {
          account: { select: { id: true, rootType: true, accountName: true } },
        },
      });

      // Aggregate net debit-minus-credit per account.
      const perAcc = new Map<
        string,
        {
          accountId: string;
          accountName: string;
          rootType: string;
          netDebit: number;
        }
      >();
      for (const g of rows) {
        const prev = perAcc.get(g.accountId) ?? {
          accountId: g.accountId,
          accountName: g.account.accountName,
          rootType: g.account.rootType,
          netDebit: 0,
        };
        prev.netDebit += Number(g.debit) - Number(g.credit);
        perAcc.set(g.accountId, prev);
      }

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultRetainedEarningsAccountId",
      ]);
      const retainedId = defaults.defaultRetainedEarningsAccountId!;

      // Build JE lines: reverse each account's balance to zero.
      // Income (typically netDebit < 0): DR income by |netDebit|.
      // Expense (typically netDebit > 0): CR expense by netDebit.
      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        remarks?: string;
      }[] = [];
      let netProfit = 0; // credit-side sign: positive = credit retained earnings
      for (const acc of perAcc.values()) {
        if (Math.abs(acc.netDebit) < 0.0001) continue;
        if (acc.rootType === "Income") {
          // Balance is credit → DR to close.
          const amount = -acc.netDebit; // netDebit is negative, flip
          if (amount > 0) {
            lines.push({
              accountId: acc.accountId,
              debit: amount,
              credit: 0,
              remarks: `YE close ${acc.accountName}`,
            });
            netProfit += amount;
          } else {
            // Income with debit balance (returns exceeded revenue) — CR it to close.
            lines.push({
              accountId: acc.accountId,
              debit: 0,
              credit: -amount,
              remarks: `YE close ${acc.accountName}`,
            });
            netProfit -= -amount;
          }
        } else {
          // Expense: balance is debit → CR to close.
          const amount = acc.netDebit;
          if (amount > 0) {
            lines.push({
              accountId: acc.accountId,
              debit: 0,
              credit: amount,
              remarks: `YE close ${acc.accountName}`,
            });
            netProfit -= amount;
          } else {
            lines.push({
              accountId: acc.accountId,
              debit: -amount,
              credit: 0,
              remarks: `YE close ${acc.accountName}`,
            });
            netProfit += -amount;
          }
        }
      }

      // Balancing entry on Retained Earnings. netProfit>0 → profit → CR retained.
      if (Math.abs(netProfit) > 0.0001) {
        if (netProfit > 0) {
          lines.push({
            accountId: retainedId,
            debit: 0,
            credit: netProfit,
            remarks: `Net profit ${fy.name}`,
          });
        } else {
          lines.push({
            accountId: retainedId,
            debit: -netProfit,
            credit: 0,
            remarks: `Net loss ${fy.name}`,
          });
        }
      }

      if (preview) {
        return { preview: true, netProfit, lines, fy };
      }

      if (lines.length === 0)
        throw new Error(
          "No Income/Expense balances to close — the fiscal year has no P&L activity",
        );

      // Create the closing JE + auto-submit (post GL).
      const jeName = await nextName(tx, tenantId, "JV-");
      const je = await tx.journalEntry.create({
        data: {
          tenantId,
          name: jeName,
          postingDate: fy.endDate,
          currency: "INR",
          remarks: `Year-end closing entry for ${fy.name}`,
          status: "Submitted",
          accounts: {
            create: lines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
              remarks: l.remarks,
            })),
          },
        },
      });

      // Post GL — bypasses period-close guard by using endDate one-day-after,
      // but that's incorrect. Post ON endDate; the close-till check should
      // allow same-day if it's <= closedTill (see gl-posting.ts). At this
      // point closedTill is still null (or < endDate) so no guard triggers.
      await postGLEntries(tx, {
        tenantId,
        postingDate: fy.endDate,
        voucherType: "JournalEntry",
        voucherId: je.id,
        voucherName: je.name,
        lines,
      });

      // Now mark FY fully closed.
      const updatedFy = await tx.fiscalYear.update({
        where: { id: fy.id },
        data: {
          closedTill: fy.endDate,
          closedAt: new Date(),
          closedBy: req.auth!.userId,
        },
      });

      return { preview: false, netProfit, closingJE: je, fy: updatedFy };
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Reopen — reverts the close. Explicit endpoint so it's a deliberate action.
fiscalYearRouter.post("/:id/reopen", p.cancel, async (req, res) => {
  const fy = await prisma.fiscalYear.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!fy) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.fiscalYear.update({
    where: { id: fy.id },
    data: { closedTill: null, closedAt: null, closedBy: null },
  });
  res.json(updated);
});
