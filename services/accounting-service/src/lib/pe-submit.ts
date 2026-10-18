// Shared PaymentEntry submit logic.
//
// Both /payment-entries/:id/submit and the payment-webhook receiver
// (Razorpay auto-submit) call this. Kept inside the accounting-service
// (not packages/db) because it depends on services-local helpers
// (postGLEntries + requireTenantDefaults) that themselves depend on
// service-auth for the fiscal-year close guard.
//
// Contract: caller supplies a Prisma.TransactionClient. This function
// runs the whole submit as part of that transaction — any DB write
// inside is atomic with the caller's own writes (e.g. the webhook's
// PE-create).
//
// Returns the updated PE (with references).

import {
  Prisma,
  allocateToSchedule,
  reverseFromSchedule,
  type AllocatableRow,
} from "@lumaara/db";
import {
  accountForPaymentMode,
  postGLEntries,
  requireTenantDefaults,
} from "./gl-posting";

async function allocatePEToSchedule(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string;
    invoiceType: "SalesInvoice" | "PurchaseInvoice";
    invoiceId: string;
    amount: number;
    direction: "apply" | "reverse";
  },
): Promise<void> {
  const scheduleWhere =
    args.invoiceType === "SalesInvoice"
      ? { tenantId: args.tenantId, salesInvoiceId: args.invoiceId }
      : { tenantId: args.tenantId, purchaseInvoiceId: args.invoiceId };
  const rows = await tx.invoicePaymentSchedule.findMany({ where: scheduleWhere });
  if (rows.length === 0) return;

  const allocRows: AllocatableRow[] = rows.map((r) => ({
    id: r.id,
    dueDate: r.dueDate,
    sortOrder: r.sortOrder,
    amount: Number(r.amount),
    paidAmount: Number(r.paidAmount),
  }));
  const result =
    args.direction === "apply"
      ? allocateToSchedule(allocRows, args.amount)
      : reverseFromSchedule(allocRows, args.amount);

  for (const c of result.changes) {
    const src = rows.find((r) => r.id === c.id)!;
    const newPaid = c.newPaidAmount;
    const amt = Number(src.amount);
    const dueMid = new Date(
      Date.UTC(src.dueDate.getUTCFullYear(), src.dueDate.getUTCMonth(), src.dueDate.getUTCDate()),
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let newStatus: string;
    if (newPaid >= amt && amt > 0) newStatus = "Paid";
    else if (newPaid > 0) newStatus = "Partial";
    else if (today.getTime() > dueMid.getTime()) newStatus = "Overdue";
    else newStatus = "Upcoming";
    await tx.invoicePaymentSchedule.update({
      where: { id: c.id },
      data: { paidAmount: new Prisma.Decimal(newPaid), status: newStatus },
    });
  }
}

// Submit a Draft PaymentEntry: reduce invoice outstandings, allocate to
// schedule, and post the GL (with FX gain/loss + optional TDS split).
export async function submitPaymentEntryTx(
  tx: Prisma.TransactionClient,
  args: { tenantId: string; peId: string },
) {
  const { tenantId, peId } = args;
  const pe = await tx.paymentEntry.findFirst({
    where: { id: peId, tenantId },
    include: { references: true },
  });
  if (!pe) throw new Error("Not found");
  if (pe.status !== "Draft") throw new Error(`Cannot submit payment in status ${pe.status}`);

  for (const ref of pe.references) {
    if (ref.referenceDoctype === "SalesInvoice") {
      const inv = await tx.salesInvoice.findFirst({
        where: { id: ref.referenceId, tenantId },
      });
      if (!inv) throw new Error(`Referenced invoice ${ref.referenceId} not found`);
      if (inv.status === "Cancelled")
        throw new Error(`Cannot allocate to cancelled invoice ${inv.name}`);
      const newOutstanding = new Prisma.Decimal(inv.outstandingAmt).sub(ref.allocatedAmount);
      if (newOutstanding.lt(-0.0001))
        throw new Error(
          `Allocation exceeds outstanding on ${inv.name} (outstanding ${inv.outstandingAmt.toString()})`,
        );
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          outstandingAmt: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
          status: newOutstanding.lte(0.0001) ? "Paid" : inv.status,
        },
      });
      await allocatePEToSchedule(tx, {
        tenantId,
        invoiceType: "SalesInvoice",
        invoiceId: inv.id,
        amount: Number(ref.allocatedAmount),
        direction: "apply",
      });
    } else if (ref.referenceDoctype === "PurchaseInvoice") {
      const inv = await tx.purchaseInvoice.findFirst({
        where: { id: ref.referenceId, tenantId },
      });
      if (!inv) throw new Error(`Referenced invoice ${ref.referenceId} not found`);
      if (inv.status === "Cancelled")
        throw new Error(`Cannot allocate to cancelled invoice ${inv.name}`);
      const newOutstanding = new Prisma.Decimal(inv.outstandingAmt).sub(ref.allocatedAmount);
      if (newOutstanding.lt(-0.0001))
        throw new Error(
          `Allocation exceeds outstanding on ${inv.name} (outstanding ${inv.outstandingAmt.toString()})`,
        );
      await tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: {
          outstandingAmt: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
          status: newOutstanding.lte(0.0001) ? "Paid" : inv.status,
        },
      });
      await allocatePEToSchedule(tx, {
        tenantId,
        invoiceType: "PurchaseInvoice",
        invoiceId: inv.id,
        amount: Number(ref.allocatedAmount),
        direction: "apply",
      });
    }
  }

  // Which party account is used depends on partyType, not just paymentType.
  const partyAccountKey =
    pe.paymentType === "Receive"
      ? "defaultReceivableAccountId"
      : pe.partyType === "Employee"
        ? "defaultEmployeePayableAccountId"
        : "defaultPayableAccountId";
  const defaults = await requireTenantDefaults(
    tx,
    tenantId,
    [partyAccountKey, "defaultCashAccountId", "defaultFxGainLossAccountId"],
    pe.companyId,
  );
  const cashOrBankId = accountForPaymentMode(defaults, pe.modeOfPayment);
  const paidBase = Number(pe.paidAmount) * Number(pe.conversionRate);

  let allocBase = 0;
  for (const ref of pe.references) {
    let invRate = 1;
    if (ref.referenceDoctype === "SalesInvoice") {
      const inv = await tx.salesInvoice.findFirst({
        where: { id: ref.referenceId, tenantId },
        select: { conversionRate: true },
      });
      if (inv) invRate = Number(inv.conversionRate);
    } else if (ref.referenceDoctype === "PurchaseInvoice") {
      const inv = await tx.purchaseInvoice.findFirst({
        where: { id: ref.referenceId, tenantId },
        select: { conversionRate: true },
      });
      if (inv) invRate = Number(inv.conversionRate);
    }
    allocBase += Number(ref.allocatedAmount) * invRate;
  }
  const partyBase = pe.references.length > 0 ? allocBase : paidBase;
  const fxDelta = paidBase - partyBase;

  const lines: {
    accountId: string;
    debit: number;
    credit: number;
    partyType?: string;
    partyId?: string;
    remarks?: string;
  }[] = [];

  if (pe.paymentType === "Receive") {
    lines.push({ accountId: cashOrBankId, debit: paidBase, credit: 0 });
    lines.push({
      accountId: defaults.defaultReceivableAccountId!,
      debit: 0,
      credit: partyBase,
      partyType: "Customer",
      partyId: pe.partyId,
    });
    if (Math.abs(fxDelta) > 0.0001) {
      if (fxDelta > 0)
        lines.push({
          accountId: defaults.defaultFxGainLossAccountId!,
          debit: 0,
          credit: fxDelta,
          remarks: "FX gain on payment settlement",
        });
      else
        lines.push({
          accountId: defaults.defaultFxGainLossAccountId!,
          debit: -fxDelta,
          credit: 0,
          remarks: "FX loss on payment settlement",
        });
    }
  } else {
    const payableAccountId =
      pe.partyType === "Employee"
        ? defaults.defaultEmployeePayableAccountId!
        : defaults.defaultPayableAccountId!;
    lines.push({
      accountId: payableAccountId,
      debit: partyBase,
      credit: 0,
      partyType: pe.partyType,
      partyId: pe.partyId,
    });
    const tdsBase =
      pe.withholdingAmount && Number(pe.withholdingAmount) > 0
        ? Number(pe.withholdingAmount) * Number(pe.conversionRate)
        : 0;
    const cashOut = paidBase - tdsBase;
    if (cashOut > 0) lines.push({ accountId: cashOrBankId, debit: 0, credit: cashOut });
    if (tdsBase > 0) {
      if (!pe.withholdingAccountId)
        throw new Error("Withholding account missing on PE snapshot");
      lines.push({
        accountId: pe.withholdingAccountId,
        debit: 0,
        credit: tdsBase,
        remarks: "TDS withheld",
      });
    }
    if (Math.abs(fxDelta) > 0.0001) {
      if (fxDelta < 0)
        lines.push({
          accountId: defaults.defaultFxGainLossAccountId!,
          debit: 0,
          credit: -fxDelta,
          remarks: "FX gain on payment settlement",
        });
      else
        lines.push({
          accountId: defaults.defaultFxGainLossAccountId!,
          debit: fxDelta,
          credit: 0,
          remarks: "FX loss on payment settlement",
        });
    }
  }

  await postGLEntries(tx, {
    tenantId,
    postingDate: pe.postingDate,
    voucherType: "PaymentEntry",
    voucherId: pe.id,
    voucherName: pe.name,
    companyId: pe.companyId,
    lines,
  });

  return tx.paymentEntry.update({
    where: { id: pe.id },
    data: { status: "Submitted" },
    include: { references: true },
  });
}
