import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  composeSalarySlipEmail,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const salarySlipRouter = Router();

const p = perms("SalarySlip");

const componentSchema = z.object({
  componentName: z.string().min(1),
  type: z.enum(["Earning", "Deduction"]),
  amount: z.coerce.number().nonnegative(),
});

const createSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string(), // YYYY-MM-DD
  endDate: z.string(),
  components: z.array(componentSchema).min(1),
  remarks: z.string().optional().nullable(),
});

// Decimal accumulator so fractional HRA / PF / TDS lines don't drift the
// payroll totals by paise. The schema fields are Prisma.Decimal.
function totals(components: { type: string; amount: number }[]) {
  const zero = new Prisma.Decimal(0);
  const grossPay = components
    .filter((c) => c.type === "Earning")
    .reduce((s, c) => s.add(new Prisma.Decimal(c.amount)), zero);
  const totalDeduction = components
    .filter((c) => c.type === "Deduction")
    .reduce((s, c) => s.add(new Prisma.Decimal(c.amount)), zero);
  return { grossPay, totalDeduction, netPay: grossPay.sub(totalDeduction) };
}

salarySlipRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.salarySlip.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      employee: { select: { employeeCode: true, employeeName: true } },
      components: true,
    },
    orderBy: [{ startDate: "desc" }, { employeeId: "asc" }],
  });
  res.json(rows);
});

salarySlipRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.salarySlip.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { employee: true, components: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: slip + employee + components + GL entries posted on submit.
salarySlipRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const slip = await prisma.salarySlip.findFirst({
    where: { id: req.params.id, tenantId },
    include: { employee: true, components: true },
  });
  if (!slip) return res.status(404).json({ error: "Not found" });

  const glEntries = await prisma.gLEntry.findMany({
    where: {
      tenantId,
      voucherType: "SalarySlip",
      voucherId: slip.id,
      isCancelled: false,
    },
    include: { account: { select: { accountName: true, rootType: true } } },
    orderBy: { createdAt: "asc" },
  });

  res.json({ salarySlip: slip, glEntries });
});

// Update a Draft salary slip. Wipes components and recreates.
salarySlipRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.salarySlip.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit slip in status ${existing.status}` });

  const employee = await prisma.employee.findFirst({
    where: { id: p.employeeId, tenantId },
  });
  if (!employee) return res.status(400).json({ error: "Invalid employee" });

  const { grossPay, totalDeduction, netPay } = totals(p.components);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salarySlipComponent.deleteMany({ where: { salarySlipId: existing.id } });
    return tx.salarySlip.update({
      where: { id: existing.id },
      data: {
        employeeId: p.employeeId,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        grossPay,
        totalDeduction,
        netPay,
        remarks: p.remarks ?? null,
        components: {
          create: p.components.map((c) => ({
            componentName: c.componentName,
            type: c.type,
            amount: c.amount,
          })),
        },
      },
      include: { components: true },
    });
  });
  res.json(updated);
});

salarySlipRouter.post("/", p.create, idempotency("POST /salary-slips"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const employee = await prisma.employee.findFirst({
    where: { id: p.employeeId, tenantId },
  });
  if (!employee) return res.status(400).json({ error: "Invalid employee" });

  const { grossPay, totalDeduction, netPay } = totals(p.components);
  const name = await nextName(prisma, tenantId, "SS-");

  try {
    const row = await prisma.salarySlip.create({
      data: {
        tenantId,
        name,
        employeeId: p.employeeId,
        startDate: new Date(p.startDate),
        endDate: new Date(p.endDate),
        grossPay,
        totalDeduction,
        netPay,
        remarks: p.remarks ?? null,
        status: "Draft",
        components: {
          create: p.components.map((c) => ({
            componentName: c.componentName,
            type: c.type,
            amount: c.amount,
          })),
        },
      },
      include: { components: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res
        .status(409)
        .json({ error: "A slip already exists for this employee in this period" });
    }
    throw e;
  }
});

// Bulk-generate slips: one per active employee for the given period using
// baseSalary as a single "Basic" earning. Skips employees who already have a
// slip for that exact period.
const bulkSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

salarySlipRouter.post("/bulk-generate", p.create, async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);

  const employees = await prisma.employee.findMany({
    where: { tenantId, status: "Active" },
    orderBy: { employeeCode: "asc" },
  });

  const created: { name: string; employeeCode: string }[] = [];
  const skipped: { employeeCode: string; reason: string }[] = [];

  for (const emp of employees) {
    const base = Number(emp.baseSalary);
    if (base <= 0) {
      skipped.push({ employeeCode: emp.employeeCode, reason: "baseSalary is 0" });
      continue;
    }
    const existing = await prisma.salarySlip.findUnique({
      where: {
        tenantId_employeeId_startDate_endDate: {
          tenantId,
          employeeId: emp.id,
          startDate,
          endDate,
        },
      },
    });
    if (existing) {
      skipped.push({ employeeCode: emp.employeeCode, reason: "slip already exists" });
      continue;
    }

    // E9: Loan EMI auto-deduct. For each of the employee's Disbursed loans,
    // find the earliest un-paid installment whose dueDate falls on/before
    // slip.endDate and inject a "Loan Repayment · <loanName>" deduction line
    // equal to that installment's totalAmount. The schedule row is marked
    // paid at slip-submit time (below) — bulk-generate only prepares Draft.
    const activeLoans = await prisma.loan.findMany({
      where: { tenantId, employeeId: emp.id, status: "Disbursed" },
      include: {
        schedule: {
          where: { isPaid: false, dueDate: { lte: endDate } },
          orderBy: { installmentNo: "asc" },
          take: 1,
        },
      },
    });
    const loanLines: {
      componentName: string;
      type: "Earning" | "Deduction";
      amount: number;
    }[] = [];
    for (const loan of activeLoans) {
      const inst = loan.schedule[0];
      if (!inst) continue;
      loanLines.push({
        componentName: `Loan Repayment · ${loan.name}`,
        type: "Deduction",
        amount: Number(inst.totalAmount),
      });
    }

    const components = [
      { componentName: "Basic", type: "Earning" as const, amount: base },
      ...loanLines,
    ];
    const grossPay = new Prisma.Decimal(base);
    const totalDeduction = loanLines.reduce(
      (s, l) => s.add(new Prisma.Decimal(l.amount)),
      new Prisma.Decimal(0),
    );
    const netPay = grossPay.sub(totalDeduction);

    const name = await nextName(prisma, tenantId, "SS-");
    await prisma.salarySlip.create({
      data: {
        tenantId,
        name,
        employeeId: emp.id,
        startDate,
        endDate,
        grossPay,
        totalDeduction,
        netPay,
        status: "Draft",
        components: { create: components },
      },
    });
    created.push({ name, employeeCode: emp.employeeCode });
  }

  res.json({ created, skipped });
});

// Submit: post GL and lock the slip.
//   Debit  Salary Expense    (grossPay)
//   Credit Employee Payable  (netPay)
//   Credit Statutory Payable (totalDeduction, if > 0)
salarySlipRouter.post("/:id/submit", p.submit, idempotency("POST /salary-slips/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const slip = await tx.salarySlip.findFirst({
        where: { id: req.params.id, tenantId },
        include: { components: true },
      });
      if (!slip) throw new Error("Not found");
      if (slip.status !== "Draft")
        throw new Error(`Cannot submit slip in status ${slip.status}`);

      // Decimal-preserved totals — Number() conversion drops the paise
      // precision that matters when we post GL below.
      const grossPay = new Prisma.Decimal(slip.grossPay);
      const totalDeduction = new Prisma.Decimal(slip.totalDeduction);
      const netPay = new Prisma.Decimal(slip.netPay);
      if (grossPay.sub(totalDeduction).sub(netPay).abs().gt("0.0001")) {
        throw new Error(
          `Slip totals inconsistent: gross ${grossPay.toString()}, deductions ${totalDeduction.toString()}, net ${netPay.toString()}`,
        );
      }

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultSalaryExpenseAccountId",
        "defaultEmployeePayableAccountId",
        "defaultStatutoryPayableAccountId",
      ]);

      // E9b: Statutory GL split. Deductions with componentName starting with
      // "Loan Repayment" credit the tenant's loanReceivableAccount (reduces
      // employee-loan asset). Everything else (PF/ESI/PT/etc) still goes to
      // statutoryPayable. When the loan account isn't configured, loan lines
      // fall back to statutoryPayable with a warning-shaped remark left on
      // the slip; the submit itself doesn't fail.
      const tenantExtras = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { defaultLoanReceivableAccountId: true },
      });

      const loanDeductions: { name: string; amount: Prisma.Decimal }[] = [];
      let statutoryTotal = new Prisma.Decimal(0);
      for (const c of slip.components) {
        if (c.type !== "Deduction") continue;
        const amt = new Prisma.Decimal(c.amount);
        if (c.componentName.startsWith("Loan Repayment")) {
          loanDeductions.push({ name: c.componentName, amount: amt });
        } else {
          statutoryTotal = statutoryTotal.add(amt);
        }
      }
      const loanTotal = loanDeductions.reduce(
        (s, l) => s.add(l.amount),
        new Prisma.Decimal(0),
      );
      const useLoanAccount = !!tenantExtras?.defaultLoanReceivableAccountId;

      const lines: Array<{
        accountId: string;
        debit: number;
        credit: number;
        partyType?: string;
        partyId?: string;
      }> = [
        {
          accountId: defaults.defaultSalaryExpenseAccountId!,
          debit: grossPay.toNumber(),
          credit: 0,
        },
        {
          accountId: defaults.defaultEmployeePayableAccountId!,
          debit: 0,
          credit: netPay.toNumber(),
          partyType: "Employee",
          partyId: slip.employeeId,
        },
      ];
      if (statutoryTotal.gt(0)) {
        lines.push({
          accountId: defaults.defaultStatutoryPayableAccountId!,
          debit: 0,
          credit: statutoryTotal.toNumber(),
        });
      }
      if (loanTotal.gt(0)) {
        if (useLoanAccount) {
          // Reduce the loan receivable — the loan is being repaid via payroll.
          lines.push({
            accountId: tenantExtras!.defaultLoanReceivableAccountId!,
            debit: 0,
            credit: loanTotal.toNumber(),
            partyType: "Employee",
            partyId: slip.employeeId,
          });
        } else {
          // Fallback: fold into statutory payable to keep totals balanced.
          lines.push({
            accountId: defaults.defaultStatutoryPayableAccountId!,
            debit: 0,
            credit: loanTotal.toNumber(),
          });
        }
      }

      await postGLEntries(tx, {
        tenantId,
        postingDate: slip.endDate,
        voucherType: "SalarySlip",
        voucherId: slip.id,
        voucherName: slip.name,
        lines,
      });

      // E9c: Mark the corresponding LoanRepaymentSchedule rows as Paid so we
      // don't double-deduct next period. Match by loan.name embedded in the
      // component name ("Loan Repayment · LOAN-0001").
      //
      // Previous impl was O(N) round-trips (2 queries + 2 writes per loan).
      // Now: one findMany to fetch all matching loans + their earliest unpaid
      // installment, then parallel updateMany + update calls.
      const loanNames = loanDeductions
        .map((d) => d.name.split("·")[1]?.trim())
        .filter((n): n is string => !!n);
      if (loanNames.length > 0) {
        const loans = await tx.loan.findMany({
          where: {
            tenantId,
            employeeId: slip.employeeId,
            name: { in: loanNames },
          },
          include: {
            schedule: {
              where: { isPaid: false },
              orderBy: { installmentNo: "asc" },
              take: 1,
            },
          },
        });
        const now = new Date();
        const scheduleUpdates: Prisma.PrismaPromise<unknown>[] = [];
        for (const loan of loans) {
          const inst = loan.schedule[0];
          if (!inst) continue;
          scheduleUpdates.push(
            tx.loanRepaymentSchedule.update({
              where: { id: inst.id },
              data: {
                isPaid: true,
                paidAt: now,
                paidBy: req.auth!.userId,
                paidVoucherType: "SalarySlip",
                paidVoucherId: slip.id,
              },
            }),
            tx.loan.update({
              where: { id: loan.id },
              data: {
                outstanding: { decrement: Number(inst.principalAmount) },
              },
            }),
          );
        }
        if (scheduleUpdates.length > 0) {
          await Promise.all(scheduleUpdates);
        }
      }

      return tx.salarySlip.update({
        where: { id: slip.id },
        data: { status: "Submitted" },
        include: { components: true },
      });
    });
    void publishRealtime(tenantId, "salary-slip", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// D+: email the slip to the employee. Refuses when slip is Draft (staff
// shouldn't leak in-progress numbers) or Cancelled (misleading). Creates
// an EmailMessage in the outbox (Pending status — the mail-provider tick
// delivers separately, same posture as payment-reminders in module 14).
salarySlipRouter.post("/:id/email", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const slip = await prisma.salarySlip.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        components: true,
        employee: {
          select: { id: true, employeeName: true, email: true },
        },
      },
    });
    if (!slip) return res.status(404).json({ error: "Not found" });
    if (slip.status === "Draft")
      return res.status(400).json({
        error: "Cannot email a Draft slip — submit it first",
      });
    if (slip.status === "Cancelled")
      return res.status(400).json({
        error: "Cannot email a Cancelled slip",
      });
    if (!slip.employee.email)
      return res.status(400).json({
        error: `Employee ${slip.employee.employeeName} has no email on file`,
      });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (!tenant) return res.status(500).json({ error: "Tenant missing" });

    const earnings = slip.components
      .filter((c) => c.type === "Earning")
      .map((c) => ({ componentName: c.componentName, amount: Number(c.amount) }));
    const deductions = slip.components
      .filter((c) => c.type === "Deduction")
      .map((c) => ({ componentName: c.componentName, amount: Number(c.amount) }));

    const { subject, body } = composeSalarySlipEmail({
      slipName: slip.name,
      employeeName: slip.employee.employeeName,
      periodStart: slip.startDate,
      periodEnd: slip.endDate,
      grossPay: Number(slip.grossPay),
      totalDeduction: Number(slip.totalDeduction),
      netPay: Number(slip.netPay),
      tenantName: tenant.name,
      earnings,
      deductions,
    });

    const em = await prisma.emailMessage.create({
      data: {
        tenantId,
        toEmail: slip.employee.email,
        subject,
        body,
        status: "Pending",
        linkedDoctype: "SalarySlip",
        linkedId: slip.id,
      },
    });
    res.json({ ok: true, emailMessageId: em.id });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

salarySlipRouter.post("/:id/cancel", p.cancel, idempotency("POST /salary-slips/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const slip = await tx.salarySlip.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!slip) throw new Error("Not found");
      if (slip.status === "Cancelled") throw new Error("Already cancelled");

      if (slip.status === "Submitted" || slip.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "SalarySlip",
          voucherId: slip.id,
        });
      }

      return tx.salarySlip.update({
        where: { id: slip.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "salary-slip", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
