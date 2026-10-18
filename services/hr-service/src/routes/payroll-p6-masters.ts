import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Compact CRUD for the 20 P6 Payroll entities. Same shape as the CRM and
// Manufacturing p2-masters files.

function crud<TSchema extends z.ZodType>(
  doctype: string,
  delegate: string,
  schema: TSchema,
  options: {
    listInclude?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
    filterKeys?: string[];
  } = {},
) {
  const router = Router();
  const p = perms(doctype);
  const del = (): { findMany: Function; create: Function; findFirst: Function; update: Function; delete: Function } =>
    (prisma as unknown as Record<string, any>)[delegate];

  router.get("/", p.read, async (req, res) => {
    try {
      const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
      for (const k of options.filterKeys ?? []) {
        if (typeof req.query[k] === "string") where[k] = req.query[k];
      }
      const rows = await del().findMany({
        where,
        orderBy: options.orderBy ?? { createdAt: "desc" },
        include: options.listInclude,
        take: 500,
      });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  });

  router.post("/", p.create, async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const row = await del().create({
        data: { tenantId: req.auth!.tenantId, ...(parsed.data as object) },
      });
      res.status(201).json(row);
    } catch (e) {
      res.status(409).json({ error: e instanceof Error ? e.message : "Duplicate" });
    }
  });

  router.put("/:id", p.write, async (req, res) => {
    const parsed = (schema as unknown as { partial: () => z.ZodType }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await del().findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    const row = await del().update({ where: { id: existing.id }, data: parsed.data });
    res.json(row);
  });

  router.delete("/:id", p.delete, async (req, res) => {
    const existing = await del().findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
    if (!existing) return res.status(404).json({ error: "Not found" });
    await del().delete({ where: { id: existing.id } });
    res.status(204).send();
  });

  return router;
}

const isoDate = z.union([z.string().datetime(), z.date()]).transform((v) => (typeof v === "string" ? new Date(v) : v));
const isoDateOpt = z.union([z.string().datetime(), z.date(), z.null()]).transform((v) => (!v ? null : typeof v === "string" ? new Date(v) : v));
const num = z.coerce.number();
const numOpt = z.coerce.number().optional().nullable();

export const form12bbRouter = crud("Form12BB", "form12BB",
  z.object({
    employeeId: z.string().min(1),
    fiscalYearId: z.string().optional().nullable(),
    submittedDate: isoDateOpt.optional(),
    hraLandlordName: z.string().optional().nullable(),
    hraAmount: numOpt, ltaAmount: numOpt, homeLoanInterest: numOpt,
    section80CTotal: numOpt, section80DTotal: numOpt, section80GTotal: numOpt,
    otherDeductions: numOpt, totalClaimed: numOpt,
    status: z.enum(["Draft", "Submitted", "Verified", "Rejected"]).default("Draft"),
    verifiedBy: z.string().optional().nullable(),
  }),
  { filterKeys: ["employeeId", "fiscalYearId", "status"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const savingRouter = crud("Saving", "saving",
  z.object({
    employeeId: z.string().min(1),
    savingType: z.string().min(1),
    isInternal: z.boolean().default(false),
    section: z.string().optional().nullable(),
    investmentDate: isoDate,
    amount: num,
    provider: z.string().optional().nullable(),
    policyNumber: z.string().optional().nullable(),
    maturityDate: isoDateOpt.optional(),
    isVerified: z.boolean().default(false),
  }),
  { filterKeys: ["employeeId", "savingType", "section", "isInternal", "isVerified"], orderBy: { investmentDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const form16Router = crud("Form16", "form16",
  z.object({
    employeeId: z.string().min(1),
    fiscalYearId: z.string().optional().nullable(),
    panNumber: z.string().optional().nullable(),
    tanNumber: z.string().optional().nullable(),
    grossSalary: num.default(0), exemptions: num.default(0), standardDeduction: num.default(0),
    section80CDeduction: num.default(0), otherDeductions: num.default(0),
    taxableIncome: num.default(0), taxOnIncome: num.default(0), cessAmount: num.default(0),
    surchargeAmount: num.default(0), totalTaxLiability: num.default(0),
    tdsDeducted: num.default(0), refundOrDue: num.default(0),
    status: z.enum(["Draft", "Finalized", "Issued"]).default("Draft"),
    issuedDate: isoDateOpt.optional(),
  }),
  { filterKeys: ["employeeId", "fiscalYearId", "status"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const etdsDetailRouter = crud("ETDSDetail", "eTDSDetail",
  z.object({
    employeeId: z.string().min(1),
    quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
    fiscalYearName: z.string().min(1),
    section: z.string().min(1),
    panNumber: z.string().optional().nullable(),
    challanNumber: z.string().optional().nullable(),
    challanDate: isoDateOpt.optional(),
    bsrCode: z.string().optional().nullable(),
    paidAmount: num.default(0), tdsAmount: num.default(0),
    isAnnexure2: z.boolean().default(false),
    status: z.enum(["Draft", "Filed", "Amended"]).default("Draft"),
  }),
  { filterKeys: ["employeeId", "quarter", "fiscalYearName", "section", "isAnnexure2", "status"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const pfDetailRouter = crud("PFDetail", "pFDetail",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    wages: num.default(0),
    employeeContribution: num.default(0),
    employerContribution: num.default(0),
    epsContribution: num.default(0),
    adminCharges: num.default(0),
    uanNumber: z.string().optional().nullable(),
    pfAccountNo: z.string().optional().nullable(),
  }),
  { filterKeys: ["employeeId"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const superAnnuationFundRouter = crud("SuperAnnuationFund", "superAnnuationFund",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    fundName: z.string().optional().nullable(),
    contributionAmount: num.default(0),
    employerContribution: num.default(0),
    taxExemption: num.default(0),
    balanceAfter: numOpt,
  }),
  { filterKeys: ["employeeId", "fundName"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const adhocPaymentRecoveryRouter = crud("AdhocPaymentRecovery", "adhocPaymentRecovery",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    entryType: z.enum(["Payment", "Recovery"]),
    category: z.string().optional().nullable(),
    amount: num,
    reason: z.string().optional().nullable(),
    isProcessed: z.boolean().default(false),
  }),
  { filterKeys: ["employeeId", "entryType", "category", "isProcessed"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const houseRentDetailRouter = crud("HouseRentDetail", "houseRentDetail",
  z.object({
    employeeId: z.string().min(1),
    fiscalYearId: z.string().optional().nullable(),
    cityType: z.enum(["Metro", "NonMetro"]).optional().nullable(),
    monthlyRent: num.default(0),
    landlordName: z.string().optional().nullable(),
    landlordPAN: z.string().optional().nullable(),
    hraReceived: num.default(0),
    fortyPctBasic: num.default(0),
    rentMinusTenPct: num.default(0),
    hraExemption: num.default(0),
  }),
  { filterKeys: ["employeeId", "fiscalYearId", "cityType"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const companyAccommodationRouter = crud("CompanyAccommodation", "companyAccommodation",
  z.object({
    employeeId: z.string().min(1),
    fromDate: isoDate,
    toDate: isoDateOpt.optional(),
    accommodationType: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    perquisiteValue: numOpt,
    employeeContribution: numOpt,
    taxablePerquisite: numOpt,
    status: z.enum(["Active", "Vacated"]).default("Active"),
  }),
  { filterKeys: ["employeeId", "status", "accommodationType"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const previousEmployerDetailRouter = crud("PreviousEmployerDetail", "previousEmployerDetail",
  z.object({
    employeeId: z.string().min(1),
    fiscalYearId: z.string().optional().nullable(),
    previousEmployerName: z.string().min(1),
    fromDate: isoDateOpt.optional(),
    toDate: isoDateOpt.optional(),
    grossSalary: num.default(0),
    taxableIncome: num.default(0),
    section80C: num.default(0),
    otherDeductions: num.default(0),
    tdsDeducted: num.default(0),
  }),
  { filterKeys: ["employeeId", "fiscalYearId"], listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const finalSettlementRouter = crud("FinalSettlement", "finalSettlement",
  z.object({
    employeeId: z.string().min(1),
    settlementDate: isoDate,
    leavingDate: isoDate,
    reasonForLeaving: z.string().optional().nullable(),
    salaryPayable: num.default(0),
    leaveEncashment: num.default(0),
    gratuityAmount: num.default(0),
    bonusPayable: num.default(0),
    reimbursements: num.default(0),
    deductionsTotal: num.default(0),
    loanRecovery: num.default(0),
    advanceRecovery: num.default(0),
    tdsDeduction: num.default(0),
    netPayable: num.default(0),
    status: z.enum(["Draft", "Approved", "Paid", "Cancelled"]).default("Draft"),
    paidAt: isoDateOpt.optional(),
  }),
  { filterKeys: ["employeeId", "status"], orderBy: { settlementDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const outsidePayrollDetailRouter = crud("OutsidePayrollDetail", "outsidePayrollDetail",
  z.object({
    payeeName: z.string().min(1),
    panNumber: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    postingDate: isoDate,
    invoiceNumber: z.string().optional().nullable(),
    grossAmount: num.default(0),
    tdsAmount: num.default(0),
    netAmount: num.default(0),
    paymentMode: z.string().optional().nullable(),
    status: z.enum(["Draft", "Paid", "Cancelled"]).default("Draft"),
  }),
  { filterKeys: ["category", "status"], orderBy: { postingDate: "desc" } },
);

export const salaryJvRouter = crud("SalaryJV", "salaryJV",
  z.object({
    postingDate: isoDate,
    payrollEntryId: z.string().optional().nullable(),
    totalDebit: num.default(0),
    totalCredit: num.default(0),
    journalEntryId: z.string().optional().nullable(),
    status: z.enum(["Draft", "Posted", "Cancelled"]).default("Draft"),
    narration: z.string().optional().nullable(),
  }),
  { filterKeys: ["status", "payrollEntryId"], orderBy: { postingDate: "desc" } },
);

export const bonusRouter = crud("Bonus", "bonus",
  z.object({
    employeeId: z.string().min(1),
    bonusType: z.string().min(1),
    fiscalYearId: z.string().optional().nullable(),
    postingDate: isoDate,
    amount: num,
    taxableAmount: num.default(0),
    status: z.enum(["Draft", "Approved", "Paid", "Cancelled"]).default("Draft"),
    paidAt: isoDateOpt.optional(),
  }),
  { filterKeys: ["employeeId", "bonusType", "status"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const esicDetailRouter = crud("ESICDetail", "eSICDetail",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    esicNumber: z.string().optional().nullable(),
    wages: num.default(0),
    employeeContribution: num.default(0),
    employerContribution: num.default(0),
    isApplicable: z.boolean().default(true),
  }),
  { filterKeys: ["employeeId", "isApplicable"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const payCodeRouter = crud("PayCode", "payCode",
  z.object({
    code: z.string().min(1),
    description: z.string().min(1),
    componentType: z.enum(["Earning", "Deduction", "Reimbursement", "Statutory"]),
    isTaxable: z.boolean().default(true),
    glAccountId: z.string().optional().nullable(),
    formula: z.string().optional().nullable(),
    isActive: z.boolean().default(true),
  }),
  { filterKeys: ["componentType", "isTaxable", "isActive"], orderBy: { code: "asc" } },
);

export const professionalTaxDetailRouter = crud("ProfessionalTaxDetail", "professionalTaxDetail",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    stateName: z.string().min(1),
    wages: num.default(0),
    ptAmount: num.default(0),
  }),
  { filterKeys: ["employeeId", "stateName"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const ctcRouter = crud("CTC", "cTC",
  z.object({
    name: z.string().min(1),
    gradeId: z.string().optional().nullable(),
    annualBase: num.default(0), annualHra: num.default(0), annualLta: num.default(0),
    annualPfEmployer: num.default(0), annualGratuity: num.default(0),
    annualBonus: num.default(0), otherAllowances: num.default(0),
    totalCTC: num.default(0),
    isActive: z.boolean().default(true),
  }),
  { filterKeys: ["gradeId", "isActive"] },
);

export const employeeCTCRouter = crud("EmployeeCTC", "employeeCTC",
  z.object({
    employeeId: z.string().min(1),
    effectiveFrom: isoDate,
    effectiveTo: isoDateOpt.optional(),
    ctcTemplateId: z.string().optional().nullable(),
    annualBase: num.default(0), annualHra: num.default(0), annualLta: num.default(0),
    annualPfEmployer: num.default(0), annualGratuity: num.default(0),
    annualBonus: num.default(0), otherAllowances: num.default(0),
    totalCTC: num.default(0),
  }),
  { filterKeys: ["employeeId", "ctcTemplateId"], orderBy: { effectiveFrom: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const payableDaysRouter = crud("PayableDays", "payableDays",
  z.object({
    employeeId: z.string().min(1),
    periodStart: isoDate,
    periodEnd: isoDate,
    totalDays: z.coerce.number().int().default(30),
    workingDays: z.coerce.number().int().default(0),
    leavesPaid: num.default(0),
    leavesUnpaid: num.default(0),
    weekOffs: z.coerce.number().int().default(0),
    holidays: z.coerce.number().int().default(0),
    absences: z.coerce.number().int().default(0),
    adjustmentDays: num.default(0),
    payableDays: num.default(0),
  }),
  { filterKeys: ["employeeId"], orderBy: { periodStart: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);

export const lwfDetailRouter = crud("LWFDetail", "lWFDetail",
  z.object({
    employeeId: z.string().min(1),
    postingDate: isoDate,
    stateName: z.string().min(1),
    employeeContribution: num.default(0),
    employerContribution: num.default(0),
  }),
  { filterKeys: ["employeeId", "stateName"], orderBy: { postingDate: "desc" }, listInclude: { employee: { select: { employeeCode: true, employeeName: true } } } },
);
