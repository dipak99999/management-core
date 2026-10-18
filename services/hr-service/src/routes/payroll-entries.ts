import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  cancelGLEntries,
  generateBankAdvice,
  generateForm24Q,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
  evaluateComponents,
  type BankAdviceFormat,
  type BankAdviceRow,
  type Form24QChallan,
  type Form24QDeductee,
  type Quarter,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";

// E2: Payroll Entry — batch generation + submission of SalarySlips for a
// period. On submit: for every included employee, generate a slip (using their
// SalaryStructure if set, else "Basic = baseSalary"), submit it (posts GL per
// slip), then post ONE consolidated payout JE
//   DR Employee Payable  (totalNet, per employee)
//   CR Bank | Cash       (totalNet)
// so operations only need one bank transfer to close all payables.

export const payrollEntryRouter = Router();

const p = perms("PayrollEntry");

const createSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  postingDate: z.string().datetime().optional(),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  paymentMode: z.enum(["Bank", "Cash"]).default("Bank"),
  employeeIds: z.array(z.string()).optional().nullable(),
});

function totals(components: { type: string; amount: number }[]) {
  const gross = components
    .filter((c) => c.type === "Earning")
    .reduce((s, c) => s + c.amount, 0);
  const deduction = components
    .filter((c) => c.type === "Deduction")
    .reduce((s, c) => s + c.amount, 0);
  return { gross, deduction, net: gross - deduction };
}

// E9: derive statutory (PF/ESI/PT/TDS) deduction lines from active
// StatutoryComponents. Called per employee after structure evaluation, before
// slip creation.
async function computeStatutoryDeductions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  slipEndDate: Date,
  gross: number,
): Promise<{ componentName: string; type: string; amount: number; sortOrder: number }[]> {
  const stats = await tx.statutoryComponent.findMany({
    where: {
      tenantId,
      enabled: true,
      applicableFrom: { lte: slipEndDate },
      OR: [{ applicableTo: null }, { applicableTo: { gte: slipEndDate } }],
    },
  });
  return stats.map((s, i) => {
    let amount: number;
    if (s.flatAmount != null) {
      amount = Number(s.flatAmount);
    } else {
      const ceiling = s.monthlyGrossCeiling != null ? Number(s.monthlyGrossCeiling) : null;
      const base = ceiling != null ? Math.min(gross, ceiling) : gross;
      amount = (base * Number(s.employeeSharePercent)) / 100;
    }
    amount = Math.round(amount * 100) / 100;
    return {
      componentName: s.slipComponentName,
      type: "Deduction",
      amount,
      sortOrder: 1000 + i,
    };
  });
}

payrollEntryRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.payrollEntry.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

payrollEntryRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.payrollEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      employees: {
        include: {
          employee: { select: { employeeCode: true, employeeName: true } },
          salarySlip: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Preview: list of employees matching filters (does NOT create anything).
payrollEntryRouter.post("/preview", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const employees = await prisma.employee.findMany({
    where: {
      tenantId,
      status: "Active",
      ...(parsed.data.department ? { department: parsed.data.department } : {}),
      ...(parsed.data.designation ? { designation: parsed.data.designation } : {}),
      ...(parsed.data.employeeIds?.length
        ? { id: { in: parsed.data.employeeIds } }
        : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      employeeName: true,
      department: true,
      designation: true,
      baseSalary: true,
    },
    orderBy: { employeeCode: "asc" },
  });
  res.json({ employees, count: employees.length });
});

// Create a Draft PayrollEntry with the selected employees. Does NOT generate
// slips yet — that happens on submit.
payrollEntryRouter.post("/", p.create, idempotency("POST /payroll-entries"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);
  if (endDate < startDate)
    return res.status(400).json({ error: "endDate must be >= startDate" });

  const employees = await prisma.employee.findMany({
    where: {
      tenantId,
      status: "Active",
      ...(parsed.data.department ? { department: parsed.data.department } : {}),
      ...(parsed.data.designation ? { designation: parsed.data.designation } : {}),
      ...(parsed.data.employeeIds?.length
        ? { id: { in: parsed.data.employeeIds } }
        : {}),
    },
    select: { id: true },
    orderBy: { employeeCode: "asc" },
  });
  if (employees.length === 0)
    return res.status(400).json({ error: "No matching active employees" });

  const name = await nextName(prisma, tenantId, "PYE-");
  const row = await prisma.payrollEntry.create({
    data: {
      tenantId,
      name,
      startDate,
      endDate,
      postingDate: parsed.data.postingDate ? new Date(parsed.data.postingDate) : new Date(),
      department: parsed.data.department ?? null,
      designation: parsed.data.designation ?? null,
      paymentMode: parsed.data.paymentMode,
      employees: {
        create: employees.map((e) => ({ employeeId: e.id })),
      },
    },
    include: { employees: true },
  });
  res.status(201).json(row);
});

// Bank advice / NEFT file for the batch. Reads every included employee's
// net + bank details, runs generateBankAdvice, streams the CSV/TXT with
// a Content-Disposition. Rows missing a bank account or invalid IFSC
// are skipped (surfaced in the X-Skipped-Rows header for the UI).
//
//   GET /payroll-entries/:id/bank-advice?format=Generic|HDFC|SBI
//
// Perm: PayrollEntry.read — the file exposes only fields the operator
// can already see on the entry detail page.
payrollEntryRouter.get("/:id/bank-advice", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const format = ((typeof req.query.format === "string" ? req.query.format : "Generic")) as BankAdviceFormat;
  if (!["Generic", "HDFC", "SBI", "ICICI", "Axis", "YesBank"].includes(format)) {
    return res.status(400).json({ error: `Unsupported format ${format}` });
  }
  const entry = await prisma.payrollEntry.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      employees: {
        include: {
          employee: {
            select: {
              employeeCode: true,
              employeeName: true,
              bankAccountNo: true,
              ifscCode: true,
              bankName: true,
            },
          },
          salarySlip: { select: { name: true } },
        },
      },
    },
  });
  if (!entry) return res.status(404).json({ error: "Not found" });

  const rows: BankAdviceRow[] = entry.employees.map((pe) => ({
    employeeName: pe.employee.employeeName,
    employeeCode: pe.employee.employeeCode,
    bankAccountNo: pe.employee.bankAccountNo,
    ifscCode: pe.employee.ifscCode,
    bankName: pe.employee.bankName,
    netAmount: Number(pe.net),
    reference: `Salary ${entry.name}${pe.salarySlip ? ` ${pe.salarySlip.name}` : ""}`,
  }));

  const result = generateBankAdvice(rows, format, {
    entryName: entry.name,
    postingDate: entry.postingDate,
  });

  const disposition = req.query.download === "1" ? "attachment" : "inline";
  const mime = (format === "HDFC" || format === "Axis") ? "text/plain" : "text/csv";
  res.setHeader("Content-Type", `${mime}; charset=utf-8`);
  res.setHeader("Content-Disposition", `${disposition}; filename="${result.filename}"`);
  res.setHeader("X-Skipped-Rows", String(result.skipped.length));
  res.setHeader("X-Row-Count", String(result.rowCount));
  res.setHeader("X-Total-Amount", result.totalAmount.toFixed(2));
  res.end(result.csv);
});

// Form 24Q — quarterly TDS return (India). Aggregates PayrollEntry TDS
// deductions in the given quarter into the NSDL FVU text format that
// protean's e-TDS FVU accepts.
//
//   GET /payroll-entries/form-24q?fy=2026-27&quarter=Q2
//     → text/plain, one file covering every entry whose postingDate
//       falls in the quarter.
//
// Deductor identity is read from Tenant + Company. Challan info is
// pulled from TdsChallan rows keyed by challanSerialNo — the caller
// must have created those rows first (they map to the actual TDS
// remittances to the government).
payrollEntryRouter.get("/form-24q", p.read, async (req, res) => {
  const fy = typeof req.query.fy === "string" ? req.query.fy : "";
  const quarter =
    typeof req.query.quarter === "string" && ["Q1", "Q2", "Q3", "Q4"].includes(req.query.quarter)
      ? (req.query.quarter as Quarter)
      : null;
  if (!fy || !quarter) {
    return res.status(400).json({ error: "fy (e.g. 2026-27) + quarter (Q1..Q4) required" });
  }
  const tenantId = req.auth!.tenantId;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      slug: true,
      homeStateCode: true,
      companyPan: true,
      companyTan: true,
    },
  });
  if (!tenant?.companyTan || !tenant.companyPan) {
    return res
      .status(400)
      .json({ error: "Tenant is missing companyTan / companyPan — set them under settings" });
  }

  // Compute quarter's date range in the given FY. Q1=Apr-Jun, Q2=Jul-Sep,
  // Q3=Oct-Dec, Q4=Jan-Mar of next calendar year.
  const [fyStartYear] = fy.split("-").map(Number);
  const qMap: Record<Quarter, [number, number, number]> = {
    Q1: [fyStartYear, 3, 6],  // Apr..Jun
    Q2: [fyStartYear, 6, 9],  // Jul..Sep
    Q3: [fyStartYear, 9, 12], // Oct..Dec
    Q4: [fyStartYear + 1, 0, 3], // Jan..Mar (next year)
  };
  const [qYear, qStartMonth, qEndMonth] = qMap[quarter];
  const from = new Date(Date.UTC(qYear, qStartMonth, 1));
  const to = new Date(Date.UTC(qYear, qEndMonth, 1));

  const entries = await prisma.payrollEntry.findMany({
    where: { tenantId, status: "Submitted", postingDate: { gte: from, lt: to } },
    include: {
      employees: {
        include: {
          employee: { select: { employeeCode: true, employeeName: true, customData: true } },
          salarySlip: {
            include: { components: true },
          },
        },
      },
    },
    orderBy: { postingDate: "asc" },
  });

  // Collect deductees + challan aggregates. We use one synthetic
  // challan per PayrollEntry (challanSerialNo = PYE-name last 5 digits).
  const challans: Form24QChallan[] = [];
  const deductees: Form24QDeductee[] = [];
  let serial = 0;
  for (const entry of entries) {
    let entryTds = 0;
    const challanKey = entry.name.slice(-5).padStart(5, "0");
    for (const pe of entry.employees) {
      if (!pe.salarySlip) continue;
      const tdsLines = pe.salarySlip.components.filter(
        (c) => c.type === "Deduction" && /tds/i.test(c.componentName),
      );
      const tds = tdsLines.reduce((s, c) => s + Number(c.amount), 0);
      if (tds <= 0) continue;
      const cd = (pe.employee.customData as Record<string, unknown> | null) ?? {};
      const pan = typeof cd.pan === "string" ? cd.pan.toUpperCase() : "";
      serial++;
      deductees.push({
        serial,
        employeeCode: pe.employee.employeeCode,
        pan,
        name: pe.employee.employeeName,
        section: "192",
        paymentDate: entry.postingDate,
        amountPaid: Number(pe.gross),
        tdsDeducted: tds,
        challanSerialNo: challanKey,
      });
      entryTds += tds;
    }
    if (entryTds > 0) {
      challans.push({
        challanSerialNo: challanKey,
        bsrCode: "0000000",
        tenderedDate: entry.postingDate,
        tdsAmount: entryTds,
        totalTax: entryTds,
      });
    }
  }

  try {
    const file = generateForm24Q({
      deductor: {
        tan: tenant.companyTan,
        pan: tenant.companyPan,
        name: tenant.name,
        address: {
          town: "-",
          state: tenant.homeStateCode ?? "-",
          pinCode: "000000",
        },
        responsiblePersonName: tenant.name,
        responsiblePersonDesignation: "Authorised Signatory",
        email: `${tenant.slug}@lumaara.local`,
        phone: "-",
      },
      financialYear: fy,
      quarter,
      challans,
      deductees,
    });
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `${disposition}; filename="${file.filename}"`);
    res.setHeader("X-Challan-Count", String(file.challanCount));
    res.setHeader("X-Deductee-Count", String(file.deducteeCount));
    res.setHeader("X-Total-Tds", file.totalTds.toFixed(2));
    if (file.warnings.length > 0) {
      res.setHeader("X-Warnings", file.warnings.slice(0, 3).join(" | "));
    }
    res.end(file.text);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Form 24Q generation failed" });
  }
});

payrollEntryRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.payrollEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot delete ${existing.status} payroll entry` });
  await prisma.payrollEntry.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Submit: iterate employees, generate + submit their slip, then post one
// consolidated payout JE against Employee Payable → Bank/Cash.
payrollEntryRouter.post("/:id/submit", p.submit, idempotency("POST /payroll-entries/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const entry = await tx.payrollEntry.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            employees: {
              include: {
                employee: {
                  include: {
                    salaryStructure: { include: { components: true } },
                  },
                },
              },
            },
          },
        });
        if (!entry) throw new Error("Not found");
        if (entry.status !== "Draft")
          throw new Error(`Cannot submit entry in status ${entry.status}`);

        const defaults = await requireTenantDefaults(tx, tenantId, [
          "defaultSalaryExpenseAccountId",
          "defaultEmployeePayableAccountId",
          "defaultStatutoryPayableAccountId",
          entry.paymentMode === "Cash" ? "defaultCashAccountId" : "defaultBankAccountId",
        ]);

        const payoutLines: { accountId: string; debit: number; credit: number; partyType?: string; partyId?: string }[] = [];
        let totalGross = 0;
        let totalDeduction = 0;
        let totalNet = 0;
        let slipsCount = 0;

        for (const row of entry.employees) {
          const emp = row.employee;
          // Skip employees who already have a slip for this period.
          const existingSlip = await tx.salarySlip.findUnique({
            where: {
              tenantId_employeeId_startDate_endDate: {
                tenantId,
                employeeId: emp.id,
                startDate: entry.startDate,
                endDate: entry.endDate,
              },
            },
          });
          if (existingSlip) continue;

          // Build components from salary structure (formula-aware) or fall
          // back to Basic = baseSalary.
          let components: { componentName: string; type: string; amount: number; sortOrder: number }[];
          if (emp.salaryStructure) {
            const ordered = [...emp.salaryStructure.components].sort(
              (a, b) => a.sortOrder - b.sortOrder,
            );
            const evaluated = evaluateComponents(
              ordered.map((c) => ({
                componentName: c.componentName,
                type: c.type as "Earning" | "Deduction",
                amount: Number(c.amount ?? 0),
                formula: c.formula ?? null,
              })),
            );
            components = evaluated.map((c, i) => ({
              componentName: c.componentName,
              type: c.type,
              amount: c.amount,
              sortOrder: i,
            }));
          } else {
            const base = Number(emp.baseSalary);
            if (base <= 0) continue;
            components = [
              { componentName: "Basic", type: "Earning", amount: base, sortOrder: 0 },
            ];
          }
          // E9: append statutory deductions (PF/ESI/PT/TDS) computed against
          // gross earnings.
          const grossBeforeStat = components
            .filter((c) => c.type === "Earning")
            .reduce((s, c) => s + c.amount, 0);
          const statLines = await computeStatutoryDeductions(
            tx,
            tenantId,
            entry.endDate,
            grossBeforeStat,
          );
          components = [...components, ...statLines];

          // E9c: append Loan EMI deductions. One line per Disbursed loan
          // whose earliest unpaid installment is due on/before slip end.
          // Submit path (salary-slips.ts) matches these back by loan name
          // and marks the installment paid + decrements outstanding.
          const activeLoans = await tx.loan.findMany({
            where: { tenantId, employeeId: emp.id, status: "Disbursed" },
            include: {
              schedule: {
                where: { isPaid: false, dueDate: { lte: entry.endDate } },
                orderBy: { installmentNo: "asc" },
                take: 1,
              },
            },
          });
          const nextSort = components.length;
          for (const [i, loan] of activeLoans.entries()) {
            const inst = loan.schedule[0];
            if (!inst) continue;
            components.push({
              componentName: `Loan Repayment · ${loan.name}`,
              type: "Deduction",
              amount: Number(inst.totalAmount),
              sortOrder: nextSort + i,
            });
          }

          const { gross, deduction, net } = totals(components);

          const slipName = await nextName(tx, tenantId, "SS-");
          const slip = await tx.salarySlip.create({
            data: {
              tenantId,
              name: slipName,
              employeeId: emp.id,
              startDate: entry.startDate,
              endDate: entry.endDate,
              grossPay: new Prisma.Decimal(gross),
              totalDeduction: new Prisma.Decimal(deduction),
              netPay: new Prisma.Decimal(net),
              status: "Submitted",
              components: {
                create: components.map((c) => ({
                  componentName: c.componentName,
                  type: c.type,
                  amount: new Prisma.Decimal(c.amount),
                })),
              },
            },
          });

          // Post per-slip GL: DR Salary Expense / CR Employee Payable / CR Statutory Payable.
          const slipLines = [
            {
              accountId: defaults.defaultSalaryExpenseAccountId!,
              debit: gross,
              credit: 0,
            },
            {
              accountId: defaults.defaultEmployeePayableAccountId!,
              debit: 0,
              credit: net,
              partyType: "Employee",
              partyId: emp.id,
            },
          ];
          if (deduction > 0)
            slipLines.push({
              accountId: defaults.defaultStatutoryPayableAccountId!,
              debit: 0,
              credit: deduction,
            });
          await postGLEntries(tx, {
            tenantId,
            postingDate: entry.endDate,
            voucherType: "SalarySlip",
            voucherId: slip.id,
            voucherName: slip.name,
            lines: slipLines,
          });

          await tx.payrollEntryEmployee.update({
            where: { id: row.id },
            data: {
              salarySlipId: slip.id,
              gross: new Prisma.Decimal(gross),
              deduction: new Prisma.Decimal(deduction),
              net: new Prisma.Decimal(net),
            },
          });

          // Mark the loan installments we just deducted as Paid, matching
          // by loan name embedded in "Loan Repayment · <loanName>". Skips
          // gracefully if the loan schedule was manually paid meanwhile.
          for (const loan of activeLoans) {
            const inst = loan.schedule[0];
            if (!inst) continue;
            const line = components.find(
              (c) => c.componentName === `Loan Repayment · ${loan.name}`,
            );
            if (!line) continue;
            await tx.loanRepaymentSchedule.update({
              where: { id: inst.id },
              data: {
                isPaid: true,
                paidAt: new Date(),
                paidBy: req.auth!.userId,
                paidVoucherType: "SalarySlip",
                paidVoucherId: slip.id,
              },
            });
            await tx.loan.update({
              where: { id: loan.id },
              data: { outstanding: { decrement: Number(inst.principalAmount) } },
            });
          }

          payoutLines.push({
            accountId: defaults.defaultEmployeePayableAccountId!,
            debit: net,
            credit: 0,
            partyType: "Employee",
            partyId: emp.id,
          });
          totalGross += gross;
          totalDeduction += deduction;
          totalNet += net;
          slipsCount += 1;
        }

        if (slipsCount === 0)
          throw new Error("No slips generated (all already existed or no eligible employees)");

        // Consolidated payout JE: DR Employee Payable per employee / CR Bank|Cash.
        const bankAccountId =
          entry.paymentMode === "Cash"
            ? defaults.defaultCashAccountId!
            : defaults.defaultBankAccountId!;
        const payoutJE = await tx.journalEntry.create({
          data: {
            tenantId,
            name: await nextName(tx, tenantId, "JV-"),
            postingDate: entry.postingDate,
            remarks: `Payroll payout for ${entry.name}`,
            status: "Submitted",
          },
        });
        await postGLEntries(tx, {
          tenantId,
          postingDate: entry.postingDate,
          voucherType: "PayrollEntry",
          voucherId: entry.id,
          voucherName: entry.name,
          lines: [
            ...payoutLines,
            { accountId: bankAccountId, debit: 0, credit: totalNet },
          ],
        });

        // Flip generated slips to Paid.
        await tx.salarySlip.updateMany({
          where: {
            tenantId,
            employeeId: { in: entry.employees.map((e) => e.employeeId) },
            startDate: entry.startDate,
            endDate: entry.endDate,
            status: "Submitted",
          },
          data: { status: "Paid" },
        });

        return tx.payrollEntry.update({
          where: { id: entry.id },
          data: {
            status: "Submitted",
            totalGross: new Prisma.Decimal(totalGross),
            totalDeduction: new Prisma.Decimal(totalDeduction),
            totalNet: new Prisma.Decimal(totalNet),
            slipsCount,
            payoutJournalEntryId: payoutJE.id,
          },
          include: { employees: true },
        });
      },
      { timeout: 60000 },
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Cancel: reverses payout GL + cancels all attached slips + reverses their GL.
payrollEntryRouter.post("/:id/cancel", p.cancel, idempotency("POST /payroll-entries/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const entry = await tx.payrollEntry.findFirst({
          where: { id: req.params.id, tenantId },
          include: { employees: { include: { salarySlip: true } } },
        });
        if (!entry) throw new Error("Not found");
        if (entry.status !== "Submitted")
          throw new Error(`Cannot cancel entry in status ${entry.status}`);

        // Reverse payout JE GL.
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "PayrollEntry",
          voucherId: entry.id,
        });

        // Cancel each slip: reverse GL and flip to Cancelled.
        for (const row of entry.employees) {
          if (!row.salarySlip) continue;
          await cancelGLEntries(tx, {
            tenantId,
            voucherType: "SalarySlip",
            voucherId: row.salarySlip.id,
          });
          await tx.salarySlip.update({
            where: { id: row.salarySlip.id },
            data: { status: "Cancelled" },
          });
        }

        return tx.payrollEntry.update({
          where: { id: entry.id },
          data: { status: "Cancelled" },
        });
      },
      { timeout: 60000 },
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
