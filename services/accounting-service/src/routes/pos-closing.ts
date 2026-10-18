import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  emitEvent,
  buildClosingReconciliationLines,
  computeDifferences,
  computeExpectedRows,
} from "@lumaara/db";
import { postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { idempotency, perms } from "@lumaara/service-auth";

export const posClosingRouter = Router();

const p = perms("POSClosingEntry");

// GET /expected/:openingId — compute expected-by-mode from posted invoices
// so the cashier UI can render the reconciliation form pre-filled with
// (opening float + sales) per method, with counted blank. Called just
// before rendering the close-session form.
posClosingRouter.get("/expected/:openingId", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const opening = await prisma.pOSOpeningEntry.findFirst({
    where: { id: req.params.openingId, tenantId },
    include: { posProfile: true },
  });
  if (!opening) return res.status(404).json({ error: "Not found" });
  if (opening.status !== "Open")
    return res.status(400).json({ error: `Session is ${opening.status}, not Open` });

  const expected = await computeExpectedByMode(tenantId, opening.id);
  res.json({ opening, expected });
});

async function computeExpectedByMode(
  tenantId: string,
  openingId: string,
): Promise<{
  rows: { mode: string; opening: number; sales: number; expected: number }[];
  totalSales: number;
  invoiceCount: number;
}> {
  const opening = await prisma.pOSOpeningEntry.findFirst({
    where: { id: openingId, tenantId },
    select: { openingBalances: true },
  });
  if (!opening) throw new Error("Not found");
  const openingRows = (opening.openingBalances as unknown as {
    mode: string;
    amount: number;
  }[]) ?? [];

  // POS invoices posted in this session, joined to their applied Payment
  // Entries. Aggregation is by PE.modeOfPayment so a split-tender checkout
  // shows up in both buckets.
  const invoices = await prisma.salesInvoice.findMany({
    where: { tenantId, posOpeningId: openingId, status: { in: ["Submitted", "Paid"] } },
    select: { id: true, grandTotal: true },
  });
  const invoiceIds = invoices.map((i) => i.id);
  const invoiceCount = invoices.length;
  const totalSales = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);

  const salesByMode: Record<string, number> = {};
  if (invoiceIds.length > 0) {
    const refs = await prisma.paymentEntryReference.findMany({
      where: {
        referenceDoctype: "SalesInvoice",
        referenceId: { in: invoiceIds },
        paymentEntry: { tenantId, status: "Submitted" },
      },
      select: {
        allocatedAmount: true,
        paymentEntry: { select: { modeOfPayment: true } },
      },
    });
    for (const r of refs) {
      const mode = r.paymentEntry.modeOfPayment;
      salesByMode[mode] = (salesByMode[mode] ?? 0) + Number(r.allocatedAmount);
    }
  }

  const rows = computeExpectedRows(
    openingRows.map((o) => ({ mode: o.mode, amount: Number(o.amount) })),
    salesByMode,
  );
  return { rows, totalSales, invoiceCount };
}

const countedSchema = z.object({
  openingEntryId: z.string().min(1),
  counted: z.array(z.object({ mode: z.string().min(1), counted: z.coerce.number() })).min(1),
  notes: z.string().optional().nullable(),
});

// POST /  — creates a Draft POSClosingEntry with the counted amounts. Does
// NOT close the opening or post GL. Manager reviews the Draft (checks the
// difference is within tolerance), then POSTs /:id/submit to book the
// Cash Short/Over JE and flip both the closing and the source opening to
// Closed. This matches the two-step "print-and-verify" flow physical cash
// counting demands in practice.
posClosingRouter.post("/", p.create, async (req, res) => {
  const parsed = countedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const opening = await prisma.pOSOpeningEntry.findFirst({
    where: { id: parsed.data.openingEntryId, tenantId, userId },
    include: { closing: true },
  });
  if (!opening) return res.status(404).json({ error: "Opening not found for this user" });
  if (opening.status !== "Open")
    return res.status(400).json({ error: `Session already ${opening.status}` });
  if (opening.closing)
    return res.status(400).json({ error: "Closing already drafted for this session" });

  const { rows, totalSales, invoiceCount } = await computeExpectedByMode(tenantId, opening.id);

  const countedByMode = rows.map((r) => {
    const found = parsed.data.counted.find((c) => c.mode === r.mode);
    return { mode: r.mode, counted: found ? found.counted : 0 };
  });
  const differenceByMode = computeDifferences(rows, countedByMode);
  const totalDifference = differenceByMode.reduce(
    (s, d) => s + Math.abs(d.difference),
    0,
  );

  const name = await nextName(prisma, tenantId, "POS-CLOSE-");
  const row = await prisma.pOSClosingEntry.create({
    data: {
      tenantId,
      name,
      posProfileId: opening.posProfileId,
      openingEntryId: opening.id,
      userId,
      status: "Draft",
      expectedByMode: rows as unknown as Prisma.InputJsonValue,
      countedByMode: countedByMode as unknown as Prisma.InputJsonValue,
      differenceByMode: differenceByMode as unknown as Prisma.InputJsonValue,
      totalSales: new Prisma.Decimal(totalSales),
      invoiceCount,
      totalDifference: new Prisma.Decimal(totalDifference),
      notes: parsed.data.notes ?? null,
    },
  });
  res.status(201).json(row);
});

// Submit: books the reconciliation JE (Cash Short/Over) if any method shows
// a nonzero difference, then flips both this closing and the source opening
// to Closed. Wrapped in a single transaction so a mid-submit crash leaves
// the session Open (recoverable) rather than partially-posted.
//
// GL semantics per mode with difference d = counted − expected:
//   d > 0  (surplus, extra cash in the drawer):
//     Dr <mode account>  d
//     Cr Round Off       d          — booked as an income adjustment
//   d < 0  (shortage):
//     Dr Round Off       |d|        — booked as an expense
//     Cr <mode account>  |d|
// The round-off account is reused as the Cash Short/Over holding account.
// If a tenant wants a dedicated account, they can point defaultRoundOffAccountId
// at "Cash Short/Over" in their CoA.
posClosingRouter.post("/:id/submit", p.submit, idempotency("POST /pos-closing/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const closing = await tx.pOSClosingEntry.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          openingEntry: true,
          posProfile: true,
        },
      });
      if (!closing) throw new Error("Not found");
      if (closing.status !== "Draft")
        throw new Error(`Cannot submit closing in status ${closing.status}`);
      if (closing.openingEntry.status !== "Open")
        throw new Error(
          `Source session ${closing.openingEntry.name} is already ${closing.openingEntry.status}`,
        );

      const diffs = (closing.differenceByMode as unknown as {
        mode: string;
        difference: number;
      }[]) ?? [];
      const nonzero = diffs.filter((d) => Math.abs(d.difference) > 0.0001);

      if (nonzero.length > 0) {
        const defaults = await requireTenantDefaults(tx, tenantId, [
          "defaultRoundOffAccountId",
        ]);
        const methods = (closing.posProfile.paymentMethods as unknown as {
          mode: string;
          accountId: string;
        }[]) ?? [];
        // Pure line-builder + balanced-books invariant covered by pos.test.ts.
        // Note: the JournalEntry voucher type is used directly (no JV row)
        // because the closing itself is the audit trail.
        const lines = buildClosingReconciliationLines(
          nonzero,
          methods,
          defaults.defaultRoundOffAccountId!,
          closing.name,
        );
        await postGLEntries(tx, {
          tenantId,
          postingDate: new Date(),
          voucherType: "JournalEntry",
          voucherId: closing.id,
          voucherName: closing.name,
          lines,
        });
      }

      await tx.pOSOpeningEntry.update({
        where: { id: closing.openingEntry.id },
        data: { status: "Closed", closeTime: new Date() },
      });
      return tx.pOSClosingEntry.update({
        where: { id: closing.id },
        data: { status: "Submitted" },
      });
    });

    void emitEvent(prisma, tenantId, "POSClosingEntry.submit", {
      id: result.id,
      name: result.name,
      totalSales: Number(result.totalSales),
      totalDifference: Number(result.totalDifference),
      invoiceCount: result.invoiceCount,
    }).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({
        level: "warn", kind: "emitEvent.failed", event: "POSClosingEntry.submit",
        tenantId, id: result.id,
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      }));
    });

    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

posClosingRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.pOSClosingEntry.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      posProfile: { select: { title: true } },
      user: { select: { fullName: true } },
    },
    orderBy: { postingDate: "desc" },
    take: 100,
  });
  res.json(rows);
});

posClosingRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pOSClosingEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      posProfile: true,
      openingEntry: true,
      user: { select: { fullName: true, email: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});
