import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  accountForPaymentMode,
  buildSchedule,
  cancelGLEntries,
  computeEmi,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

export const loanRouter = Router();

const p = perms("Loan");

const createSchema = z.object({
  employeeId: z.string().min(1),
  loanTypeId: z.string().min(1),
  principal: z.coerce.number().positive(),
  termMonths: z.coerce.number().int().positive(),
  interestRate: z.coerce.number().nonnegative().optional(),
  remarks: z.string().optional().nullable(),
});

loanRouter.get("/", p.read, async (req, res) => {
  const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.loan.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      loanType: { select: { id: true, loanTypeName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

loanRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.loan.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employee: true,
      loanType: true,
      schedule: { orderBy: { installmentNo: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

loanRouter.post("/", p.create, idempotency("POST /loans"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const p2 = parsed.data;

  const [emp, lt] = await Promise.all([
    prisma.employee.findFirst({ where: { id: p2.employeeId, tenantId } }),
    prisma.loanType.findFirst({ where: { id: p2.loanTypeId, tenantId } }),
  ]);
  if (!emp) return res.status(400).json({ error: "Invalid employee" });
  if (!lt) return res.status(400).json({ error: "Invalid loan type" });

  const rate = p2.interestRate ?? Number(lt.interestRate);
  const emi = computeEmi(p2.principal, rate, p2.termMonths);
  const name = await nextName(prisma, tenantId, "LOAN-");

  const row = await prisma.loan.create({
    data: {
      tenantId,
      name,
      employeeId: p2.employeeId,
      loanTypeId: p2.loanTypeId,
      principal: p2.principal,
      interestRate: rate,
      termMonths: p2.termMonths,
      emi,
      status: "Draft",
      outstanding: p2.principal,
      remarks: p2.remarks ?? null,
    },
    include: {
      employee: { select: { id: true, employeeCode: true, employeeName: true } },
      loanType: { select: { id: true, loanTypeName: true } },
    },
  });
  res.status(201).json(row);
});

// Disburse: mark as Disbursed, generate EMI schedule, post GL
//   DR Loans to Employees (principal)
//   CR Cash | Bank         (principal)
const disburseSchema = z.object({
  disbursementDate: z.string().datetime(),
  modeOfPayment: z.enum(["Cash", "Bank", "UPI", "Card"]).default("Bank"),
});

loanRouter.post("/:id/disburse", p.submit, async (req, res) => {
  const parsed = disburseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!loan) throw new Error("Not found");
      if (loan.status !== "Draft")
        throw new Error(`Cannot disburse in status ${loan.status}`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultLoanReceivableAccountId",
        "defaultCashAccountId",
      ]);
      const cashOrBankId = accountForPaymentMode(defaults, parsed.data.modeOfPayment);

      const disbursementDate = new Date(parsed.data.disbursementDate);
      const scheduleRows = buildSchedule(
        Number(loan.principal),
        Number(loan.interestRate),
        loan.termMonths,
        disbursementDate,
      );

      await tx.loanRepaymentSchedule.createMany({
        data: scheduleRows.map((s) => ({
          loanId: loan.id,
          installmentNo: s.installmentNo,
          dueDate: s.dueDate,
          principalAmount: s.principalAmount,
          interestAmount: s.interestAmount,
          totalAmount: s.totalAmount,
          balanceAfter: s.balanceAfter,
        })),
      });

      await postGLEntries(tx, {
        tenantId,
        postingDate: disbursementDate,
        voucherType: "Loan",
        voucherId: loan.id,
        voucherName: loan.name,
        lines: [
          {
            accountId: defaults.defaultLoanReceivableAccountId!,
            debit: Number(loan.principal),
            credit: 0,
            partyType: "Employee",
            partyId: loan.employeeId,
          },
          {
            accountId: cashOrBankId,
            debit: 0,
            credit: Number(loan.principal),
          },
        ],
      });

      return tx.loan.update({
        where: { id: loan.id },
        data: {
          status: "Disbursed",
          disbursementDate,
        },
        include: {
          employee: { select: { id: true, employeeCode: true, employeeName: true } },
          schedule: { orderBy: { installmentNo: "asc" } },
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Record a repayment against a specific installment. Posts:
//   DR Cash | Bank       (totalAmount)
//   CR Loans to Employees (principalAmount)  [party = employee]
//   CR Interest Income   (interestAmount)    [only if > 0]
// Marks the installment paid; if all installments paid, flips loan to Closed.
const repaymentSchema = z.object({
  installmentNo: z.coerce.number().int().positive(),
  paymentDate: z.string().datetime(),
  modeOfPayment: z.enum(["Cash", "Bank", "UPI", "Card"]).default("Bank"),
});

loanRouter.post("/:id/record-repayment", p.submit, async (req, res) => {
  const parsed = repaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findFirst({
        where: { id: req.params.id, tenantId },
        include: { schedule: { orderBy: { installmentNo: "asc" } } },
      });
      if (!loan) throw new Error("Not found");
      if (loan.status !== "Disbursed")
        throw new Error(`Cannot record repayment for loan in status ${loan.status}`);

      const inst = loan.schedule.find((s) => s.installmentNo === parsed.data.installmentNo);
      if (!inst) throw new Error(`Installment ${parsed.data.installmentNo} not found`);
      if (inst.isPaid) throw new Error(`Installment ${inst.installmentNo} already paid`);

      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultLoanReceivableAccountId",
        "defaultCashAccountId",
        "defaultInterestIncomeAccountId",
      ]);
      const cashOrBankId = accountForPaymentMode(defaults, parsed.data.modeOfPayment);
      const paymentDate = new Date(parsed.data.paymentDate);

      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        partyType?: string;
        partyId?: string;
        remarks?: string;
      }[] = [
        {
          accountId: cashOrBankId,
          debit: Number(inst.totalAmount),
          credit: 0,
        },
        {
          accountId: defaults.defaultLoanReceivableAccountId!,
          debit: 0,
          credit: Number(inst.principalAmount),
          partyType: "Employee",
          partyId: loan.employeeId,
          remarks: `Loan ${loan.name} installment ${inst.installmentNo} principal`,
        },
      ];
      if (Number(inst.interestAmount) > 0) {
        lines.push({
          accountId: defaults.defaultInterestIncomeAccountId!,
          debit: 0,
          credit: Number(inst.interestAmount),
          remarks: `Loan ${loan.name} installment ${inst.installmentNo} interest`,
        });
      }

      await postGLEntries(tx, {
        tenantId,
        postingDate: paymentDate,
        voucherType: "LoanRepayment",
        voucherId: inst.id,
        voucherName: `${loan.name}/${inst.installmentNo}`,
        lines,
      });

      await tx.loanRepaymentSchedule.update({
        where: { id: inst.id },
        data: {
          isPaid: true,
          paidAt: paymentDate,
          paidBy: req.auth!.userId,
          paidVoucherType: "LoanRepayment",
          paidVoucherId: inst.id,
        },
      });

      const newOutstanding = new Prisma.Decimal(loan.outstanding).sub(inst.principalAmount);
      const allPaid = loan.schedule.every(
        (s) => s.id === inst.id || s.isPaid,
      );
      return tx.loan.update({
        where: { id: loan.id },
        data: {
          outstanding: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
          status: allPaid ? "Closed" : loan.status,
        },
        include: {
          schedule: { orderBy: { installmentNo: "asc" } },
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Cancel a Draft loan (no GL to reverse). For Disbursed loans, use a proper
// write-off flow (not implemented in MVP).
loanRouter.post("/:id/cancel", p.cancel, idempotency("POST /loans/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!loan) throw new Error("Not found");
      if (loan.status === "Cancelled") throw new Error("Already cancelled");
      if (loan.status === "Disbursed")
        throw new Error(
          "Cannot cancel a disbursed loan — reversing GL would leave posted repayments dangling. Not implemented in MVP.",
        );
      if (loan.status === "Draft") {
        // Nothing to reverse.
        return tx.loan.update({
          where: { id: loan.id },
          data: { status: "Cancelled" },
        });
      }
      throw new Error(`Cannot cancel loan in status ${loan.status}`);
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
