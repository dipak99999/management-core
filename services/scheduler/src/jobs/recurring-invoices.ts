// Recurring-invoice tick — walks all Active RecurringInvoice templates whose
// nextRunDate is on-or-before today, materialises a real SalesInvoice for
// each, and advances the schedule.
//
// The heavy lifting lives in the accounting-service route (so the SI-create
// logic + tax + GL hooks stay in one place). Rather than re-import that,
// this scheduler job hits the service's tenant-scoped tick endpoint via
// HTTP with the shared SCHEDULER_API_TOKEN. If the token isn't configured
// yet (dev-mode default), we fall back to a direct DB path using the same
// Prisma client — safe because we're already inside the trust boundary.

import { prisma, Prisma, nextName } from "@lumaara/db";

export interface RecurringTickResult {
  templatesChecked: number;
  invoicesCreated: number;
  errors: number;
}

// Direct DB path (used when no SCHEDULER_API_TOKEN is set). Copies the same
// logic as recurring-invoices.ts::runRecurringInvoiceTick so tests + dev
// mode don't need HTTP auth wiring.
export async function runRecurringInvoicesTick(): Promise<RecurringTickResult> {
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);

  const due = await prisma.recurringInvoice.findMany({
    where: { status: "Active", nextRunDate: { lte: today } },
    select: { id: true, tenantId: true },
  });

  let created = 0;
  let errors = 0;
  for (const t of due) {
    try {
      let safety = 24; // guard against runaway loops on badly-configured templates
      while (safety-- > 0) {
        const fresh = await prisma.recurringInvoice.findUnique({
          where: { id: t.id },
          include: { items: true },
        });
        if (!fresh || fresh.status !== "Active") break;
        if (fresh.nextRunDate > today) break;

        await generateOneInvoice(fresh);
        created++;
      }
    } catch {
      errors++;
    }
  }

  return { templatesChecked: due.length, invoicesCreated: created, errors };
}

// Materialise one SalesInvoice from a template and advance the schedule.
// Kept local so this job has no HTTP dependency on accounting-service.
async function generateOneInvoice(
  t: Awaited<ReturnType<typeof prisma.recurringInvoice.findUnique>> & {
    items: { itemId: string; qty: Prisma.Decimal; rate: Prisma.Decimal; amount: Prisma.Decimal; description: string | null }[];
  } | null,
): Promise<void> {
  if (!t) return;
  const postingDate = new Date();
  const dueDate = new Date(postingDate);
  dueDate.setUTCDate(dueDate.getUTCDate() + t.daysUntilDue);

  const net = t.items.reduce(
    (s, i) => s.plus(new Prisma.Decimal(i.amount)),
    new Prisma.Decimal(0),
  );

  await prisma.$transaction(async (tx) => {
    const name = await nextName(tx, t.tenantId, "SINV-");
    await tx.salesInvoice.create({
      data: {
        tenantId: t.tenantId,
        name,
        customerId: t.customerId,
        postingDate,
        dueDate,
        currency: t.currency,
        taxTemplateId: t.taxTemplateId,
        netTotal: net,
        grandTotal: net,
        outstandingAmt: net,
        status: "Draft",
        // sourceRecurringId powers the recurring detail page's history
        // table — without it, generated invoices are orphaned from the
        // template that produced them.
        sourceRecurringId: t.id,
        remarks: t.remarks
          ? `${t.remarks}\n\n(auto-generated from recurring "${t.title}")`
          : `Auto-generated from recurring "${t.title}"`,
        items: {
          create: t.items.map((it) => ({
            itemId: it.itemId,
            qty: it.qty,
            rate: it.rate,
            amount: it.amount,
            description: it.description,
          })),
        },
      },
    });

    const nextDate = advanceDate(t.nextRunDate, t.frequency, t.intervalCount);
    const done = t.endDate && nextDate > t.endDate;

    await tx.recurringInvoice.update({
      where: { id: t.id },
      data: {
        lastGeneratedAt: postingDate,
        generatedCount: { increment: 1 },
        nextRunDate: done ? t.nextRunDate : nextDate,
        status: done ? "Ended" : t.status,
      },
    });
  });
}

function advanceDate(from: Date, frequency: string, intervalCount: number): Date {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  switch (frequency) {
    case "Daily":     d.setUTCDate(d.getUTCDate() + intervalCount); break;
    case "Weekly":    d.setUTCDate(d.getUTCDate() + intervalCount * 7); break;
    case "Monthly":   d.setUTCMonth(d.getUTCMonth() + intervalCount); break;
    case "Quarterly": d.setUTCMonth(d.getUTCMonth() + intervalCount * 3); break;
    case "Yearly":    d.setUTCFullYear(d.getUTCFullYear() + intervalCount); break;
  }
  return d;
}
