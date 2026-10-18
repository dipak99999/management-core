/* eslint-disable no-console */
// Rich demo data for the P1–P6 analytics tables. Layers on top of the
// existing seed-demo.ts (which sets up tenant + a handful of Customer /
// Supplier / Item / Employee rows).
//
// Populates every table that the 74 seeded dashboards / 397 charts read
// from, so "No data" doesn't dominate the UI.
//
// Idempotent: each section checks whether the tenant already has that
// doctype's rows and skips if so. Delete the rows first if you want to
// re-run with fresh values.
//
// Usage: pnpm --filter @lumaara/db seed:demo-analytics [tenant-slug]

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n.toFixed(4));

// ---------- Tiny deterministic RNG so the seed produces the same values ----------

let _seed = 0xdead_beef;
function rand(): number {
  _seed = (_seed * 1664525 + 1013904223) | 0;
  return Math.abs(_seed) / 2147483648;
}
function ri(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

// ---------- Date helpers ----------

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
function daysAgo(n: number): Date {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
function monthsAgo(n: number): Date {
  const d = new Date(today);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(1);
  return d;
}

// ==========================================================================

async function main() {
  const slug = process.argv[2] ?? "demo";
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`No tenant '${slug}'. Run 'pnpm db:seed' first.`);
  console.log(`Seeding analytics data for tenant '${slug}' (${tenant.id})…`);
  const T = tenant.id;

  const owner = await prisma.user.findFirst({ where: { tenantId: T } });
  if (!owner) throw new Error(`No user for tenant '${slug}'`);
  const userId = owner.id;

  await seedHRLeave(T, userId);
  await seedPayroll(T, userId);
  await seedFinance(T);
  await seedCRM(T, userId);
  await seedManufacturing(T);

  console.log("\n✓ Demo analytics data seeded.");
}

// ==========================================================================
// HR / LEAVE
// ==========================================================================

async function seedHRLeave(T: string, userId: string) {
  console.log("\n[HR/Leave] …");

  // WorkGroups
  const wgNames = ["Engineering", "Sales", "Operations", "Finance", "Support"];
  const workGroups = await Promise.all(
    wgNames.map((n) =>
      prisma.workGroup.upsert({
        where: { tenantId_name: { tenantId: T, name: n } },
        update: {},
        create: { tenantId: T, name: n, code: n.slice(0, 3).toUpperCase() },
      }),
    ),
  );
  console.log(`  workGroups: ${workGroups.length}`);

  // EmployeeCategories
  const catNames = ["Permanent", "Contract", "Intern", "Consultant"];
  const cats = await Promise.all(
    catNames.map((n) =>
      prisma.employeeCategory.upsert({
        where: { tenantId_name: { tenantId: T, name: n } },
        update: {},
        create: { tenantId: T, name: n },
      }),
    ),
  );
  console.log(`  employeeCategories: ${cats.length}`);

  // Employees: ensure at least 30 with workGroup + category assigned
  let employees = await prisma.employee.findMany({ where: { tenantId: T } });
  if (employees.length < 30) {
    const firstNames = ["Aarav", "Priya", "Rohan", "Sneha", "Arjun", "Ananya", "Vivaan", "Ishaan", "Kavya", "Aditya", "Meera", "Karan", "Riya", "Neel", "Diya", "Sam", "Alex", "Jordan", "Taylor", "Morgan"];
    const lastNames = ["Sharma", "Patel", "Kumar", "Singh", "Gupta", "Rao", "Iyer", "Nair", "Khan", "Das"];
    for (let i = employees.length; i < 30; i++) {
      const emp = await prisma.employee.create({
        data: {
          tenantId: T,
          employeeCode: `EMP-${String(1000 + i).padStart(4, "0")}`,
          employeeName: `${pick(firstNames)} ${pick(lastNames)}`,
          email: `emp${i}@demo.local`,
          designation: pick(["Engineer", "Senior Engineer", "Manager", "Analyst", "Team Lead", "Executive"]),
          department: pick(["Product", "Sales", "Ops", "Finance", "Support"]),
          workGroupId: pick(workGroups).id,
          employeeCategoryId: pick(cats).id,
          dateOfJoining: daysAgo(ri(90, 1800)),
          baseSalary: D(ri(30_000, 250_000)),
        },
      });
      employees.push(emp);
    }
  } else {
    // Backfill workGroupId / employeeCategoryId on employees that lack them.
    for (const e of employees) {
      if (!e.workGroupId || !e.employeeCategoryId) {
        await prisma.employee.update({
          where: { id: e.id },
          data: {
            workGroupId: e.workGroupId ?? pick(workGroups).id,
            employeeCategoryId: e.employeeCategoryId ?? pick(cats).id,
          },
        });
      }
    }
  }
  employees = await prisma.employee.findMany({ where: { tenantId: T } });
  console.log(`  employees: ${employees.length}`);

  // LeaveTypes
  const leaveTypeDefs = [
    { name: "Casual Leave", encashable: false, max: 12, color: "badge-blue" },
    { name: "Sick Leave", encashable: false, max: 10, color: "badge-amber" },
    { name: "Earned Leave", encashable: true, max: 24, color: "badge-green" },
    { name: "Paternity Leave", encashable: false, max: 15, color: "badge-purple" },
  ];
  for (const l of leaveTypeDefs) {
    await prisma.leaveType.upsert({
      where: { tenantId_leaveTypeName: { tenantId: T, leaveTypeName: l.name } },
      update: {},
      create: {
        tenantId: T,
        leaveTypeName: l.name,
        isEncashable: l.encashable,
        maxDaysPerYear: l.max,
        color: l.color,
      },
    });
  }
  const leaveTypes = await prisma.leaveType.findMany({ where: { tenantId: T } });
  console.log(`  leaveTypes: ${leaveTypes.length}`);

  // LeaveAllocations for each employee × type this FY
  const fyStart = new Date(today.getUTCFullYear(), 3, 1); // Apr 1
  const fyEnd = new Date(today.getUTCFullYear() + 1, 2, 31);
  const allocCount = await prisma.leaveAllocation.count({ where: { tenantId: T } });
  if (allocCount < employees.length * leaveTypes.length / 2) {
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        const already = await prisma.leaveAllocation.findFirst({
          where: { tenantId: T, employeeId: emp.id, leaveTypeId: lt.id, fromDate: fyStart },
        });
        if (already) continue;
        await prisma.leaveAllocation.create({
          data: {
            tenantId: T,
            employeeId: emp.id,
            leaveTypeId: lt.id,
            fromDate: fyStart,
            toDate: fyEnd,
            totalLeaves: D(lt.maxDaysPerYear),
            notes: "Annual allocation",
          },
        });
      }
    }
    console.log(`  leaveAllocations: seeded`);
  } else {
    console.log(`  leaveAllocations: ${allocCount} (skipped)`);
  }

  // LeaveApplications — 2 per employee (mix approved / draft / rejected)
  const appCount = await prisma.leaveApplication.count({ where: { tenantId: T } });
  if (appCount < employees.length) {
    for (const emp of employees) {
      for (let i = 0; i < 2; i++) {
        const days = ri(1, 5);
        const from = daysAgo(ri(1, 180));
        const to = new Date(from);
        to.setUTCDate(from.getUTCDate() + days - 1);
        await prisma.leaveApplication.create({
          data: {
            tenantId: T,
            employeeId: emp.id,
            leaveTypeId: pick(leaveTypes).id,
            fromDate: from,
            toDate: to,
            halfDay: false,
            totalLeaveDays: D(days),
            reason: pick(["Vacation", "Personal", "Family", "Medical", "Wedding"]),
            status: pick(["Approved", "Approved", "Approved", "Draft", "Rejected"]),
            approvedBy: userId,
            approvedAt: new Date(),
          },
        });
      }
    }
    console.log(`  leaveApplications: seeded`);
  } else {
    console.log(`  leaveApplications: ${appCount} (skipped)`);
  }

  // Backfill LeaveLedgerEntries from allocations + approved apps
  const ledgerCount = await prisma.leaveLedgerEntry.count({ where: { tenantId: T } });
  if (ledgerCount === 0) {
    const allocs = await prisma.leaveAllocation.findMany({
      where: { tenantId: T },
      include: { employee: { select: { workGroupId: true, employeeCategoryId: true } } },
    });
    const apps = await prisma.leaveApplication.findMany({
      where: { tenantId: T, status: "Approved" },
      include: { employee: { select: { workGroupId: true, employeeCategoryId: true } } },
    });
    const running = new Map<string, number>();
    const rows: Prisma.LeaveLedgerEntryCreateManyInput[] = [];
    const events: Array<{ empId: string; ltId: string; date: Date; leaves: number; type: string; from: Date | null; to: Date | null; wgId: string | null; ecId: string | null; srcType: string; srcId: string; reason: string }> = [];
    for (const a of allocs) {
      events.push({
        empId: a.employeeId, ltId: a.leaveTypeId, date: a.fromDate, leaves: Number(a.totalLeaves),
        type: "Allocation", from: a.fromDate, to: a.toDate,
        wgId: a.employee?.workGroupId ?? null, ecId: a.employee?.employeeCategoryId ?? null,
        srcType: "LeaveAllocation", srcId: a.id, reason: a.notes ?? "Allocation",
      });
    }
    for (const app of apps) {
      events.push({
        empId: app.employeeId, ltId: app.leaveTypeId, date: app.fromDate, leaves: -Number(app.totalLeaveDays),
        type: "Consumption", from: app.fromDate, to: app.toDate,
        wgId: app.employee?.workGroupId ?? null, ecId: app.employee?.employeeCategoryId ?? null,
        srcType: "LeaveApplication", srcId: app.id, reason: app.reason ?? "Approved leave",
      });
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const e of events) {
      const key = `${e.empId}::${e.ltId}`;
      const bal = (running.get(key) ?? 0) + e.leaves;
      running.set(key, bal);
      rows.push({
        tenantId: T, employeeId: e.empId, leaveTypeId: e.ltId,
        postingDate: e.date, entryType: e.type,
        leaves: D(e.leaves), balanceAfter: D(bal),
        fromDate: e.from, toDate: e.to,
        workGroupId: e.wgId, employeeCategoryId: e.ecId,
        isCarryForward: false, isExpired: false, isEncashment: false,
        sourceDoctype: e.srcType, sourceDocId: e.srcId, reason: e.reason,
      });
    }
    if (rows.length > 0) await prisma.leaveLedgerEntry.createMany({ data: rows });
    console.log(`  leaveLedgerEntries: ${rows.length}`);
  } else {
    console.log(`  leaveLedgerEntries: ${ledgerCount} (skipped)`);
  }

  // ApproverHierarchies — every employee has 2 approvers (level 1 + 2)
  const ahCount = await prisma.approverHierarchy.count({ where: { tenantId: T } });
  if (ahCount === 0) {
    const managers = employees.filter((e) => (e.designation ?? "").includes("Manager") || (e.designation ?? "").includes("Lead"));
    const pool = managers.length >= 4 ? managers : employees.slice(0, 6);
    for (const emp of employees) {
      const [l1, l2] = [pick(pool), pick(pool)];
      if (l1.id !== emp.id) {
        await prisma.approverHierarchy.upsert({
          where: { tenantId_employeeId_approverEmployeeId_scope: { tenantId: T, employeeId: emp.id, approverEmployeeId: l1.id, scope: "Leave" } },
          update: {}, create: { tenantId: T, employeeId: emp.id, approverEmployeeId: l1.id, level: 1, scope: "Leave" },
        });
      }
      if (l2.id !== emp.id && l2.id !== l1.id) {
        await prisma.approverHierarchy.upsert({
          where: { tenantId_employeeId_approverEmployeeId_scope: { tenantId: T, employeeId: emp.id, approverEmployeeId: l2.id, scope: "Leave" } },
          update: {}, create: { tenantId: T, employeeId: emp.id, approverEmployeeId: l2.id, level: 2, scope: "Leave" },
        });
      }
    }
    console.log(`  approverHierarchies: seeded`);
  } else {
    console.log(`  approverHierarchies: ${ahCount} (skipped)`);
  }
}

// ==========================================================================
// PAYROLL
// ==========================================================================

async function seedPayroll(T: string, userId: string) {
  console.log("\n[Payroll] …");
  const employees = await prisma.employee.findMany({ where: { tenantId: T } });
  const fyStart = new Date(today.getUTCFullYear(), 3, 1);

  // CTC templates
  const ctcNames = ["Junior M1", "Mid M2", "Senior M3", "Manager M4", "Director M5"];
  for (const n of ctcNames) {
    const totalBase = 300_000 * (ctcNames.indexOf(n) + 1);
    await prisma.cTC.upsert({
      where: { tenantId_name: { tenantId: T, name: n } },
      update: {},
      create: {
        tenantId: T, name: n,
        annualBase: D(totalBase * 0.5), annualHra: D(totalBase * 0.2),
        annualLta: D(totalBase * 0.05), annualPfEmployer: D(totalBase * 0.06),
        annualGratuity: D(totalBase * 0.048), annualBonus: D(totalBase * 0.08),
        otherAllowances: D(totalBase * 0.062), totalCTC: D(totalBase),
      },
    });
  }
  const ctcs = await prisma.cTC.findMany({ where: { tenantId: T } });
  console.log(`  ctcs: ${ctcs.length}`);

  // EmployeeCTC (one active per employee)
  const empCtcCount = await prisma.employeeCTC.count({ where: { tenantId: T } });
  if (empCtcCount === 0) {
    for (const emp of employees) {
      const ctc = pick(ctcs);
      await prisma.employeeCTC.create({
        data: {
          tenantId: T, employeeId: emp.id,
          effectiveFrom: emp.dateOfJoining ?? daysAgo(365),
          ctcTemplateId: ctc.id,
          annualBase: ctc.annualBase, annualHra: ctc.annualHra, annualLta: ctc.annualLta,
          annualPfEmployer: ctc.annualPfEmployer, annualGratuity: ctc.annualGratuity,
          annualBonus: ctc.annualBonus, otherAllowances: ctc.otherAllowances,
          totalCTC: ctc.totalCTC,
        },
      });
    }
    console.log(`  employeeCTCs: seeded`);
  } else console.log(`  employeeCTCs: ${empCtcCount} (skipped)`);

  // PayCodes (statutory + earning + deduction)
  const codes = [
    { code: "BASIC", desc: "Basic Salary", type: "Earning", taxable: true },
    { code: "HRA", desc: "House Rent Allowance", type: "Earning", taxable: true },
    { code: "SPECIAL", desc: "Special Allowance", type: "Earning", taxable: true },
    { code: "PF-EE", desc: "PF Employee Contribution", type: "Deduction", taxable: false },
    { code: "ESIC-EE", desc: "ESIC Employee Contribution", type: "Deduction", taxable: false },
    { code: "PT", desc: "Professional Tax", type: "Statutory", taxable: false },
    { code: "TDS", desc: "TDS", type: "Statutory", taxable: false },
    { code: "LWF", desc: "Labour Welfare Fund", type: "Statutory", taxable: false },
  ];
  for (const c of codes) {
    await prisma.payCode.upsert({
      where: { tenantId_code: { tenantId: T, code: c.code } },
      update: {}, create: { tenantId: T, code: c.code, description: c.desc, componentType: c.type, isTaxable: c.taxable },
    });
  }
  console.log(`  payCodes: ${codes.length}`);

  // 3 months of monthly statutory records per employee
  const monthsBack = 3;
  const pfCount = await prisma.pFDetail.count({ where: { tenantId: T } });
  if (pfCount === 0) {
    for (const emp of employees) {
      const monthly = Number(emp.baseSalary) / 12;
      for (let m = 0; m < monthsBack; m++) {
        const date = monthsAgo(m);
        const pfBase = Math.min(monthly * 0.5, 15000);
        const eeContrib = pfBase * 0.12;
        const erContrib = pfBase * 0.12;
        const esicBase = Math.min(monthly, 21000);
        const esicApplicable = esicBase < 21000;

        await prisma.pFDetail.create({
          data: {
            tenantId: T, employeeId: emp.id, postingDate: date,
            wages: D(pfBase),
            employeeContribution: D(eeContrib),
            employerContribution: D(erContrib * 0.833), // 3.67% goes to EPF
            epsContribution: D(erContrib * 0.167), // 8.33% to EPS
            adminCharges: D(pfBase * 0.005),
            uanNumber: `UAN${String(100000 + employees.indexOf(emp)).padStart(12, "0")}`,
          },
        });
        if (esicApplicable) {
          await prisma.eSICDetail.create({
            data: {
              tenantId: T, employeeId: emp.id, postingDate: date,
              esicNumber: `ESIC${String(500000 + employees.indexOf(emp)).padStart(10, "0")}`,
              wages: D(esicBase),
              employeeContribution: D(esicBase * 0.0075),
              employerContribution: D(esicBase * 0.0325),
            },
          });
        }
        await prisma.professionalTaxDetail.create({
          data: {
            tenantId: T, employeeId: emp.id, postingDate: date,
            stateName: pick(["Maharashtra", "Karnataka", "Tamil Nadu", "West Bengal", "Gujarat"]),
            wages: D(monthly), ptAmount: D(monthly > 40000 ? 200 : monthly > 25000 ? 175 : 150),
          },
        });
        await prisma.lWFDetail.create({
          data: {
            tenantId: T, employeeId: emp.id, postingDate: date,
            stateName: pick(["Maharashtra", "Karnataka", "Gujarat"]),
            employeeContribution: D(20), employerContribution: D(50),
          },
        });
      }
    }
    console.log(`  PF/ESIC/PT/LWF: seeded (${employees.length} × ${monthsBack} months)`);
  } else console.log(`  PF/ESIC/PT/LWF: skipped (${pfCount} existing)`);

  // PayableDays per employee per month
  const pdCount = await prisma.payableDays.count({ where: { tenantId: T } });
  if (pdCount === 0) {
    for (const emp of employees) {
      for (let m = 0; m < monthsBack; m++) {
        const start = monthsAgo(m);
        const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
        const paid = ri(0, 2), unpaid = ri(0, 1);
        const workingDays = 26 - paid - unpaid;
        await prisma.payableDays.create({
          data: {
            tenantId: T, employeeId: emp.id, periodStart: start, periodEnd: end,
            totalDays: 30, workingDays, leavesPaid: D(paid), leavesUnpaid: D(unpaid),
            weekOffs: 4, holidays: 0, absences: unpaid,
            payableDays: D(workingDays + paid),
          },
        });
      }
    }
    console.log(`  payableDays: seeded`);
  } else console.log(`  payableDays: ${pdCount} (skipped)`);

  // Form 12BB + Savings + Form 16 + HouseRent (one per employee)
  const fyCount = await prisma.form12BB.count({ where: { tenantId: T } });
  if (fyCount === 0) {
    for (const emp of employees) {
      const gross = Number(emp.baseSalary);
      const rent = ri(15_000, 45_000);
      const s80c = ri(50_000, 150_000);
      const s80d = ri(15_000, 30_000);
      await prisma.form12BB.create({
        data: {
          tenantId: T, employeeId: emp.id, submittedDate: daysAgo(60),
          hraLandlordName: `${pick(["Rajesh", "Priya", "Anand"])} ${pick(["Landlord", "Owner"])}`,
          hraAmount: D(rent * 12),
          ltaAmount: D(ri(0, 25_000)),
          homeLoanInterest: D(ri(0, 200_000)),
          section80CTotal: D(s80c), section80DTotal: D(s80d),
          section80GTotal: D(ri(0, 20_000)),
          otherDeductions: D(ri(0, 30_000)),
          totalClaimed: D(s80c + s80d + ri(50_000, 200_000)),
          status: pick(["Verified", "Submitted", "Submitted"]),
        },
      });
      await prisma.houseRentDetail.create({
        data: {
          tenantId: T, employeeId: emp.id,
          cityType: pick(["Metro", "NonMetro"]),
          monthlyRent: D(rent),
          landlordName: `${pick(["Rajesh", "Priya", "Anand"])} Kumar`,
          hraReceived: D(gross * 0.2),
          fortyPctBasic: D(gross * 0.4),
          rentMinusTenPct: D(rent * 12 - gross * 0.1),
          hraExemption: D(Math.min(rent * 12, gross * 0.4, rent * 12 - gross * 0.1)),
        },
      });
      const savingsBuckets = ["PPF", "ELSS", "LIC", "NSC", "Bank FD"];
      for (let i = 0; i < ri(1, 3); i++) {
        await prisma.saving.create({
          data: {
            tenantId: T, employeeId: emp.id,
            savingType: pick(savingsBuckets),
            isInternal: false, section: "80C",
            investmentDate: daysAgo(ri(30, 300)),
            amount: D(ri(20_000, 150_000)),
            provider: pick(["HDFC", "ICICI", "SBI", "LIC"]),
            isVerified: rand() > 0.4,
          },
        });
      }
      // Form 16 for prior FY
      const grossAnnual = gross;
      const s80cCap = Math.min(s80c, 150_000);
      const stdDed = 50_000;
      const taxable = Math.max(0, grossAnnual - stdDed - s80cCap - s80d);
      const tax = taxable < 250_000 ? 0 : taxable < 500_000 ? (taxable - 250_000) * 0.05 : (taxable - 500_000) * 0.2 + 12_500;
      const cess = tax * 0.04;
      await prisma.form16.create({
        data: {
          tenantId: T, employeeId: emp.id,
          panNumber: `ABCDE${String(1000 + employees.indexOf(emp)).padStart(4, "0")}F`,
          tanNumber: "MUMB01234E",
          grossSalary: D(grossAnnual), exemptions: D(gross * 0.1),
          standardDeduction: D(stdDed), section80CDeduction: D(s80cCap),
          otherDeductions: D(s80d), taxableIncome: D(taxable),
          taxOnIncome: D(tax), cessAmount: D(cess),
          surchargeAmount: D(taxable > 5_000_000 ? tax * 0.1 : 0),
          totalTaxLiability: D(tax + cess),
          tdsDeducted: D(tax + cess),
          refundOrDue: D(0),
          status: pick(["Issued", "Finalized", "Draft"]),
          issuedDate: daysAgo(30),
        },
      });
    }
    console.log(`  Form12BB / HouseRent / Savings / Form16: seeded`);
  } else console.log(`  Form12BB: ${fyCount} (skipped)`);

  // Bonus
  const bonusCount = await prisma.bonus.count({ where: { tenantId: T } });
  if (bonusCount === 0) {
    for (const emp of employees) {
      if (rand() > 0.6) continue;
      await prisma.bonus.create({
        data: {
          tenantId: T, employeeId: emp.id,
          bonusType: pick(["Diwali", "Annual", "Performance", "Retention"]),
          postingDate: daysAgo(ri(10, 200)),
          amount: D(ri(20_000, 200_000)),
          taxableAmount: D(ri(20_000, 200_000)),
          status: pick(["Paid", "Paid", "Approved", "Draft"]),
          paidAt: new Date(),
        },
      });
    }
    console.log(`  bonuses: seeded`);
  } else console.log(`  bonuses: ${bonusCount} (skipped)`);

  // AdhocPaymentRecovery
  const adhocCount = await prisma.adhocPaymentRecovery.count({ where: { tenantId: T } });
  if (adhocCount === 0) {
    for (let i = 0; i < employees.length * 2; i++) {
      await prisma.adhocPaymentRecovery.create({
        data: {
          tenantId: T, employeeId: pick(employees).id,
          postingDate: daysAgo(ri(1, 90)),
          entryType: pick(["Payment", "Recovery"]),
          category: pick(["Bonus", "Incentive", "Reimbursement", "Fine", "Damage", "AdvanceRecovery"]),
          amount: D(ri(1_000, 25_000)),
          reason: "Auto-generated",
          isProcessed: rand() > 0.4,
        },
      });
    }
    console.log(`  adhocPaymentRecoveries: seeded`);
  }

  // ETDSDetail
  const etdsCount = await prisma.eTDSDetail.count({ where: { tenantId: T } });
  if (etdsCount === 0) {
    const quarters = ["Q1", "Q2", "Q3", "Q4"] as const;
    for (const emp of employees) {
      for (const q of quarters.slice(0, ri(1, 4))) {
        const tds = Number(emp.baseSalary) * 0.05;
        await prisma.eTDSDetail.create({
          data: {
            tenantId: T, employeeId: emp.id,
            quarter: q, fiscalYearName: "FY26-27",
            section: pick(["192", "192", "194"]),
            challanNumber: `CH${ri(10000, 99999)}`,
            challanDate: daysAgo(ri(5, 90)),
            bsrCode: "0510308",
            paidAmount: D(Number(emp.baseSalary)),
            tdsAmount: D(tds),
            isAnnexure2: true,
            status: pick(["Filed", "Draft"]),
          },
        });
      }
    }
    console.log(`  etdsDetails: seeded`);
  }

  // SalaryJV — one per submitted payroll month
  const jvCount = await prisma.salaryJV.count({ where: { tenantId: T } });
  if (jvCount === 0) {
    for (let m = 0; m < monthsBack; m++) {
      const total = employees.reduce((s, e) => s + Number(e.baseSalary) / 12, 0);
      await prisma.salaryJV.create({
        data: {
          tenantId: T, postingDate: monthsAgo(m),
          totalDebit: D(total), totalCredit: D(total),
          status: "Posted", narration: `Salary run ${monthsAgo(m).toISOString().slice(0, 7)}`,
        },
      });
    }
    console.log(`  salaryJVs: seeded`);
  }

  // OutsidePayroll
  const opCount = await prisma.outsidePayrollDetail.count({ where: { tenantId: T } });
  if (opCount === 0) {
    for (let i = 0; i < 20; i++) {
      const gross = ri(15_000, 200_000);
      const tds = gross * 0.1;
      await prisma.outsidePayrollDetail.create({
        data: {
          tenantId: T,
          payeeName: `${pick(["Neo Consult", "TechVision", "SpotFix Ltd", "AceHR", "Bright Services", "AlphaCon"])}`,
          panNumber: `PANAB${ri(1000, 9999)}F`,
          category: pick(["Contractor", "Consultant", "Trainer", "Vendor"]),
          postingDate: daysAgo(ri(10, 90)),
          invoiceNumber: `INV-${ri(1000, 9999)}`,
          grossAmount: D(gross), tdsAmount: D(tds), netAmount: D(gross - tds),
          paymentMode: pick(["NEFT", "RTGS", "Cheque"]),
          status: pick(["Paid", "Draft"]),
        },
      });
    }
    console.log(`  outsidePayrollDetails: seeded`);
  }

  // FinalSettlement — 3
  const fsCount = await prisma.finalSettlement.count({ where: { tenantId: T } });
  if (fsCount === 0) {
    for (let i = 0; i < 3; i++) {
      const emp = employees[i * 3];
      const gross = Number(emp.baseSalary);
      await prisma.finalSettlement.create({
        data: {
          tenantId: T, employeeId: emp.id,
          settlementDate: daysAgo(ri(5, 60)),
          leavingDate: daysAgo(ri(30, 90)),
          reasonForLeaving: pick(["Resignation", "Retirement", "Contract Ended"]),
          salaryPayable: D(gross / 12 * 0.5),
          leaveEncashment: D(ri(10_000, 40_000)),
          gratuityAmount: D(gross * 0.048 * ri(2, 5)),
          bonusPayable: D(ri(0, 30_000)),
          reimbursements: D(ri(0, 15_000)),
          deductionsTotal: D(ri(0, 5_000)),
          netPayable: D(gross / 12 * 0.5 + 30_000),
          status: pick(["Paid", "Approved"]),
        },
      });
    }
    console.log(`  finalSettlements: seeded`);
  }

  // CompanyAccommodation
  const caCount = await prisma.companyAccommodation.count({ where: { tenantId: T } });
  if (caCount === 0) {
    for (let i = 0; i < 5; i++) {
      const emp = employees[i * 5];
      await prisma.companyAccommodation.create({
        data: {
          tenantId: T, employeeId: emp.id,
          fromDate: daysAgo(ri(180, 720)),
          accommodationType: pick(["Owned", "Leased", "HotelStay"]),
          location: pick(["Mumbai", "Bangalore", "Chennai", "Pune"]),
          perquisiteValue: D(ri(180_000, 400_000)),
          employeeContribution: D(ri(24_000, 60_000)),
          taxablePerquisite: D(ri(120_000, 300_000)),
          status: "Active",
        },
      });
    }
    console.log(`  companyAccommodations: seeded`);
  }

  // PreviousEmployerDetail
  const peCount = await prisma.previousEmployerDetail.count({ where: { tenantId: T } });
  if (peCount === 0) {
    for (let i = 0; i < 8; i++) {
      const emp = employees[i * 3];
      const gross = ri(300_000, 800_000);
      await prisma.previousEmployerDetail.create({
        data: {
          tenantId: T, employeeId: emp.id,
          previousEmployerName: pick(["Infosys", "TCS", "Wipro", "Accenture", "Cognizant"]),
          fromDate: daysAgo(ri(600, 1800)),
          toDate: emp.dateOfJoining ?? daysAgo(365),
          grossSalary: D(gross),
          taxableIncome: D(gross * 0.85),
          section80C: D(150_000),
          otherDeductions: D(50_000),
          tdsDeducted: D(gross * 0.06),
        },
      });
    }
    console.log(`  previousEmployerDetails: seeded`);
  }

  // SuperAnnuationFund
  const safCount = await prisma.superAnnuationFund.count({ where: { tenantId: T } });
  if (safCount === 0) {
    for (const emp of employees) {
      if (rand() > 0.4) continue;
      const monthly = Number(emp.baseSalary) / 12;
      for (let m = 0; m < 2; m++) {
        await prisma.superAnnuationFund.create({
          data: {
            tenantId: T, employeeId: emp.id, postingDate: monthsAgo(m),
            fundName: pick(["LIC Super Annuation", "HDFC SAF", "SBI Life SAF"]),
            contributionAmount: D(monthly * 0.15),
            employerContribution: D(monthly * 0.15),
            taxExemption: D(150_000),
          },
        });
      }
    }
    console.log(`  superAnnuationFunds: seeded`);
  }
}

// ==========================================================================
// FINANCE
// ==========================================================================

async function seedFinance(T: string) {
  console.log("\n[Finance] …");

  // CostCenters
  const ccCount = await prisma.costCenter.count({ where: { tenantId: T } });
  if (ccCount === 0) {
    const root = await prisma.costCenter.create({
      data: { tenantId: T, name: "Root", isGroup: true, code: "ROOT" },
    });
    const groups = ["Operations", "Sales", "R&D", "Support"];
    for (const g of groups) {
      const gr = await prisma.costCenter.create({
        data: { tenantId: T, name: g, isGroup: true, parentId: root.id, code: g.slice(0, 3).toUpperCase() },
      });
      for (const sub of ["North", "South", "East", "West"]) {
        await prisma.costCenter.create({
          data: { tenantId: T, name: `${g} · ${sub}`, isGroup: false, parentId: gr.id, code: `${g.slice(0,3).toUpperCase()}-${sub[0]}`, budget: D(ri(500_000, 5_000_000)) },
        });
      }
    }
    console.log(`  costCenters: seeded`);
  } else console.log(`  costCenters: ${ccCount} (skipped)`);

  // BankGuarantees
  const bgCount = await prisma.bankGuarantee.count({ where: { tenantId: T } });
  if (bgCount === 0) {
    for (let i = 0; i < 10; i++) {
      const amount = ri(500_000, 5_000_000);
      await prisma.bankGuarantee.create({
        data: {
          tenantId: T, bgNumber: `BG${new Date().getFullYear()}${String(i + 1).padStart(4, "0")}`,
          bankName: pick(["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank", "Kotak Mahindra"]),
          bgType: pick(["Performance", "Financial", "Bid", "Advance"]),
          beneficiaryName: pick(["Ministry of Ports", "NHAI", "Reliance Industries", "TATA Steel", "L&T"]),
          issueDate: daysAgo(ri(30, 400)),
          expiryDate: daysAgo(ri(-365, -30)),
          amount: D(amount), currency: "INR",
          commissionAmount: D(amount * 0.005),
          purpose: "Performance guarantee",
          status: pick(["Active", "Active", "Active", "Extended", "Expired"]),
        },
      });
    }
    console.log(`  bankGuarantees: 10`);
  }

  // LettersOfCredit
  const lcCount = await prisma.letterOfCredit.count({ where: { tenantId: T } });
  if (lcCount === 0) {
    for (let i = 0; i < 10; i++) {
      const amount = ri(50_000, 500_000);
      await prisma.letterOfCredit.create({
        data: {
          tenantId: T, lcNumber: `LC${new Date().getFullYear()}${String(i + 1).padStart(4, "0")}`,
          lcType: pick(["Import", "Export", "Sight", "Usance"]),
          issuingBank: pick(["HDFC Bank", "ICICI Bank", "SBI", "Axis Bank"]),
          advisingBank: pick(["Citibank NY", "HSBC London", "Standard Chartered SG"]),
          beneficiaryName: pick(["Shenzhen Trading Co", "Alibaba Import Ltd", "European Foods GmbH"]),
          applicantName: "Demo Company",
          issueDate: daysAgo(ri(20, 300)),
          expiryDate: daysAgo(ri(-180, -20)),
          amount: D(amount), currency: "USD",
          utilizationPct: D(ri(0, 90)),
          goodsDescription: pick(["Steel Coils", "Electronic Components", "Textile Machinery", "Chemicals"]),
          status: pick(["Active", "Active", "Utilized", "Expired"]),
        },
      });
    }
    console.log(`  lettersOfCredit: 10`);
  }
}

// ==========================================================================
// CRM
// ==========================================================================

async function seedCRM(T: string, userId: string) {
  console.log("\n[CRM] …");
  const customers = await prisma.customer.findMany({ where: { tenantId: T } });
  const items = await prisma.item.findMany({ where: { tenantId: T } });
  const employees = await prisma.employee.findMany({ where: { tenantId: T } });

  // Warranties — mix of the 4 types
  const wCount = await prisma.warranty.count({ where: { tenantId: T } });
  if (wCount === 0 && customers.length > 0 && items.length > 0) {
    const types = ["Definition", "ClaimInward", "ClaimOutward", "Helpdesk"] as const;
    for (let i = 0; i < 60; i++) {
      const t = pick([...types]);
      const start = daysAgo(ri(30, 400));
      const end = new Date(start); end.setUTCFullYear(end.getUTCFullYear() + ri(1, 3));
      await prisma.warranty.create({
        data: {
          tenantId: T, warrantyType: t,
          serialNo: `SN-${ri(10000, 99999)}`,
          itemId: pick(items).id,
          customerId: t === "Helpdesk" || t === "ClaimInward" ? pick(customers).id : null,
          startDate: t === "Definition" ? start : null,
          endDate: t === "Definition" ? end : null,
          claimNo: t.startsWith("Claim") ? `CLM-${ri(1000, 9999)}` : null,
          claimDate: t.startsWith("Claim") ? daysAgo(ri(1, 60)) : null,
          amount: t.startsWith("Claim") ? D(ri(2_000, 50_000)) : null,
          status: pick(["Open", "InProgress", "Resolved", "Closed"]),
          resolution: pick(["Replaced part", "Refunded", "In review", "Escalated"]),
          assignedTo: userId,
          description: "Auto-generated warranty record",
        },
      });
    }
    console.log(`  warranties: 60`);
  }

  // PurchaseWarranty
  const pwCount = await prisma.purchaseWarranty.count({ where: { tenantId: T } });
  if (pwCount === 0) {
    const suppliers = await prisma.supplier.findMany({ where: { tenantId: T } });
    for (let i = 0; i < 25; i++) {
      const pDate = daysAgo(ri(30, 600));
      const months = ri(6, 36);
      const expiry = new Date(pDate); expiry.setUTCMonth(expiry.getUTCMonth() + months);
      const daysToExp = (expiry.getTime() - today.getTime()) / 86400000;
      await prisma.purchaseWarranty.create({
        data: {
          tenantId: T,
          supplierId: suppliers.length > 0 ? pick(suppliers).id : null,
          itemId: items.length > 0 ? pick(items).id : null,
          purchaseDate: pDate,
          warrantyMonths: months,
          expiryDate: expiry,
          invoiceNo: `INV-${ri(1000, 9999)}`,
          amount: D(ri(10_000, 500_000)),
          status: daysToExp < 0 ? "Expired" : daysToExp < 60 ? "Expiring" : "Active",
        },
      });
    }
    console.log(`  purchaseWarranties: 25`);
  }

  // LocationCapture
  const lcCount = await prisma.locationCapture.count({ where: { tenantId: T } });
  if (lcCount === 0) {
    for (let i = 0; i < 150; i++) {
      // Random pin around India
      const lat = 12 + rand() * 24; // 12°N–36°N
      const lng = 68 + rand() * 20; // 68°E–88°E
      await prisma.locationCapture.create({
        data: {
          tenantId: T, userId,
          employeeId: employees.length > 0 ? pick(employees).id : null,
          capturedAt: daysAgo(ri(0, 30)),
          latitude: D(lat), longitude: D(lng),
          accuracyM: D(ri(5, 50)),
          purpose: pick(["Visit", "DayTrip", "CheckIn", "CheckOut"]),
        },
      });
    }
    console.log(`  locationCaptures: 150`);
  }

  // AutoDealers
  const adCount = await prisma.autoDealer.count({ where: { tenantId: T } });
  if (adCount === 0) {
    const regions = ["North", "South", "East", "West", "Central"];
    for (let i = 0; i < 20; i++) {
      await prisma.autoDealer.create({
        data: {
          tenantId: T,
          dealerCode: `AD-${String(1000 + i).padStart(4, "0")}`,
          dealerName: `${pick(["Star", "Elite", "Prime", "Best", "Alpha", "Metro"])} ${pick(["Motors", "Autos", "Wheels", "Cars"])}`,
          dealerType: pick(["Authorized", "Sub-dealer", "Direct"]),
          region: pick(regions),
          territory: pick(["Zone 1", "Zone 2", "Zone 3"]),
          contactPerson: pick(["Rajeev K", "Anjali M", "Suresh P"]),
          phone: `9${ri(100_000_000, 999_999_999)}`,
          email: `dealer${i}@auto.local`,
          status: pick(["Active", "Active", "Active", "Inactive"]),
          registeredAt: daysAgo(ri(30, 1200)),
        },
      });
    }
    console.log(`  autoDealers: 20`);
  }

  // CrmTarget + CrmTargetActual
  const targetCount = await prisma.crmTarget.count({ where: { tenantId: T } });
  if (targetCount === 0) {
    for (const emp of employees.slice(0, 15)) {
      const targetAmt = ri(500_000, 5_000_000);
      const start = monthsAgo(2);
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 3);
      const target = await prisma.crmTarget.create({
        data: {
          tenantId: T, ownerUserId: userId, employeeId: emp.id,
          periodType: "Quarterly",
          periodStart: start, periodEnd: end,
          targetQty: D(ri(50, 500)), targetAmount: D(targetAmt),
        },
      });
      // Actuals over the period
      for (let m = 0; m < 3; m++) {
        await prisma.crmTargetActual.create({
          data: {
            tenantId: T, targetId: target.id, ownerUserId: userId, employeeId: emp.id,
            postingDate: monthsAgo(2 - m),
            actualQty: D(ri(10, 150)), actualAmount: D(ri(100_000, targetAmt / 2)),
            sourceDoctype: "SalesInvoice",
          },
        });
      }
    }
    console.log(`  crmTargets + actuals: seeded`);
  }

  // WorkPlan + DailyWorksheet
  const wpCount = await prisma.workPlan.count({ where: { tenantId: T } });
  if (wpCount === 0) {
    for (const emp of employees.slice(0, 10)) {
      for (let w = 0; w < 4; w++) {
        const monday = daysAgo(w * 7 + (today.getUTCDay() || 7) - 1);
        const wp = await prisma.workPlan.create({
          data: {
            tenantId: T, ownerUserId: userId, employeeId: emp.id,
            weekStartDate: monday, planTitle: `Week of ${monday.toISOString().slice(0, 10)}`,
            summary: pick(["Customer visits + demos", "New territory expansion", "Renewal follow-ups"]),
            status: pick(["Approved", "InProgress", "Completed"]),
          },
        });
        for (let d = 0; d < 5; d++) {
          await prisma.workPlanItem.create({
            data: {
              workPlanId: wp.id, dayOffset: d,
              activity: pick(["Client visit", "Demo call", "Proposal writing", "Follow-up", "Site inspection"]),
              status: pick(["Done", "Done", "Planned", "Skipped"]), sortOrder: d,
            },
          });
        }
      }
    }
    console.log(`  workPlans + items: seeded`);
  }

  const dwCount = await prisma.dailyWorksheet.count({ where: { tenantId: T } });
  if (dwCount === 0) {
    // Unique key is (tenantId, ownerUserId, postingDate) → one row per day per user.
    // Cycle employees across days so the roster still shows variety.
    for (let d = 0; d < 30; d++) {
      const emp = employees[d % Math.max(employees.length, 1)];
      await prisma.dailyWorksheet.create({
        data: {
          tenantId: T, ownerUserId: userId, employeeId: emp.id,
          postingDate: daysAgo(d),
          visitCount: ri(0, 8), callsMade: ri(0, 25),
          quotesGiven: ri(0, 5), ordersBooked: ri(0, 3),
          amountBooked: D(ri(0, 500_000)),
          distanceKm: D(ri(0, 200)),
          notes: pick(["Productive day", "Follow-ups pending", "New leads captured"]),
        },
      });
    }
    console.log(`  dailyWorksheets: 30`);
  }

  // CrmProcess
  const cpCount = await prisma.crmProcess.count({ where: { tenantId: T } });
  if (cpCount === 0) {
    for (let i = 0; i < 15; i++) {
      await prisma.crmProcess.create({
        data: {
          tenantId: T,
          processName: pick(["Customer Onboarding", "Contract Renewal", "Escalation Handling", "VIP Support"]),
          category: pick(["Onboarding", "Renewal", "Escalation", "Custom"]),
          ownerUserId: userId,
          currentStep: pick(["Kickoff", "Discovery", "Draft Proposal", "Approval", "Closed"]),
          status: pick(["Active", "Active", "OnHold", "Completed"]),
          slaTargetDate: daysAgo(ri(-30, -1)),
        },
      });
    }
    console.log(`  crmProcesses: 15`);
  }

  // ProjectPlanning
  const ppCount = await prisma.projectPlanning.count({ where: { tenantId: T } });
  if (ppCount === 0 && customers.length > 0) {
    for (let i = 0; i < 12; i++) {
      await prisma.projectPlanning.create({
        data: {
          tenantId: T,
          projectName: `${pick(["Alpha", "Beta", "Gamma", "Delta", "Phoenix", "Titan", "Nova"])} Project`,
          customerId: pick(customers).id, ownerUserId: userId,
          startDate: daysAgo(ri(30, 300)),
          targetDate: daysAgo(ri(-120, -30)),
          budgetAmount: D(ri(100_000, 5_000_000)),
          currentStage: pick(["Enquiry", "Proposal", "Approved", "InExecution", "Handover"]),
          progressPct: D(ri(10, 95)),
          status: pick(["Open", "Open", "OnHold", "Completed"]),
        },
      });
    }
    console.log(`  projectPlannings: 12`);
  }
}

// ==========================================================================
// MANUFACTURING
// ==========================================================================

async function seedManufacturing(T: string) {
  console.log("\n[Manufacturing] …");
  const items = await prisma.item.findMany({ where: { tenantId: T } });
  let warehouses = await prisma.warehouse.findMany({ where: { tenantId: T } });
  const suppliers = await prisma.supplier.findMany({ where: { tenantId: T } });
  const customers = await prisma.customer.findMany({ where: { tenantId: T } });
  let workstations = await prisma.workstation.findMany({ where: { tenantId: T } });

  if (items.length === 0) {
    console.log(`  skipping — no Items yet. Run 'pnpm db:seed:demo' first.`);
    return;
  }

  // Bootstrap a second warehouse so MaterialTransfer has a source + target.
  const needExtraWH = ["Finished Goods", "In-Transit", "Scrap"];
  for (const n of needExtraWH) {
    if (warehouses.length >= 4) break;
    const exists = warehouses.find((w) => w.warehouseName === n);
    if (exists) continue;
    const w = await prisma.warehouse.create({
      data: { tenantId: T, warehouseName: n, isGroup: false },
    });
    warehouses.push(w);
  }

  // Bootstrap workstations so RoutingMaster can seed.
  if (workstations.length === 0) {
    for (const n of ["Assembly Line 1", "CNC Cell", "QA Bench", "Packing"]) {
      const w = await prisma.workstation.create({
        data: { tenantId: T, name: n, hourRate: D(ri(250, 1200)), workingHoursPerDay: D(8) },
      });
      workstations.push(w);
    }
    console.log(`  bootstrapped ${workstations.length} workstations`);
  }

  // MaterialIssue
  const miCount = await prisma.materialIssue.count({ where: { tenantId: T } });
  if (miCount === 0) {
    for (let i = 0; i < 15; i++) {
      const mi = await prisma.materialIssue.create({
        data: {
          tenantId: T,
          issueNo: `MI-${String(1000 + i).padStart(4, "0")}`,
          postingDate: daysAgo(ri(1, 90)),
          sourceWarehouseId: pick(warehouses).id,
          purpose: pick(["Consumption", "Production", "Sample", "Damage"]),
          requestedBy: "System",
          status: pick(["Submitted", "Submitted", "Draft"]),
          totalQty: D(0), totalValue: D(0),
        },
      });
      let qty = 0, val = 0;
      for (let j = 0; j < ri(1, 4); j++) {
        const item = pick(items);
        const q = ri(5, 100);
        const rate = Number(item.standardRate);
        qty += q; val += q * rate;
        await prisma.materialIssueItem.create({
          data: { materialIssueId: mi.id, itemId: item.id, qty: D(q), rate: D(rate), amount: D(q * rate) },
        });
      }
      await prisma.materialIssue.update({ where: { id: mi.id }, data: { totalQty: D(qty), totalValue: D(val) } });
    }
    console.log(`  materialIssues: 15`);
  }

  // MaterialTransfer
  const mtCount = await prisma.materialTransfer.count({ where: { tenantId: T } });
  if (mtCount === 0 && warehouses.length >= 2) {
    for (let i = 0; i < 12; i++) {
      const [src, dst] = [pick(warehouses), pick(warehouses)];
      if (src.id === dst.id) continue;
      const mt = await prisma.materialTransfer.create({
        data: {
          tenantId: T,
          transferNo: `MT-${String(1000 + i).padStart(4, "0")}`,
          postingDate: daysAgo(ri(1, 90)),
          sourceWarehouseId: src.id, targetWarehouseId: dst.id,
          status: pick(["Received", "InTransit", "Draft"]),
          totalQty: D(0), totalValue: D(0),
        },
      });
      let qty = 0, val = 0;
      for (let j = 0; j < ri(1, 3); j++) {
        const item = pick(items);
        const q = ri(10, 200);
        const rate = Number(item.standardRate);
        qty += q; val += q * rate;
        await prisma.materialTransferItem.create({
          data: { materialTransferId: mt.id, itemId: item.id, qty: D(q), rate: D(rate), amount: D(q * rate) },
        });
      }
      await prisma.materialTransfer.update({ where: { id: mt.id }, data: { totalQty: D(qty), totalValue: D(val) } });
    }
    console.log(`  materialTransfers: seeded`);
  }

  // MaterialReturn
  const mrCount = await prisma.materialReturn.count({ where: { tenantId: T } });
  if (mrCount === 0) {
    for (let i = 0; i < 8; i++) {
      const returnType = pick(["ToSupplier", "ToWarehouse"] as const);
      const mr = await prisma.materialReturn.create({
        data: {
          tenantId: T,
          returnNo: `MR-${String(1000 + i).padStart(4, "0")}`,
          postingDate: daysAgo(ri(1, 60)),
          returnType,
          supplierId: returnType === "ToSupplier" && suppliers.length > 0 ? pick(suppliers).id : null,
          warehouseId: pick(warehouses).id,
          reason: pick(["Defective", "Wrong quantity", "Over-supply", "Damaged in transit"]),
          status: pick(["Submitted", "Draft"]),
          totalQty: D(0), totalValue: D(0),
        },
      });
      let qty = 0, val = 0;
      for (let j = 0; j < ri(1, 2); j++) {
        const item = pick(items);
        const q = ri(1, 30);
        const rate = Number(item.standardRate);
        qty += q; val += q * rate;
        await prisma.materialReturnItem.create({
          data: { materialReturnId: mr.id, itemId: item.id, qty: D(q), rate: D(rate), amount: D(q * rate) },
        });
      }
      await prisma.materialReturn.update({ where: { id: mr.id }, data: { totalQty: D(qty), totalValue: D(val) } });
    }
    console.log(`  materialReturns: 8`);
  }

  // Weighments
  const wCount = await prisma.weighment.count({ where: { tenantId: T } });
  if (wCount === 0) {
    for (let i = 0; i < 40; i++) {
      const gross = ri(15000, 35000);
      const tare = ri(4000, 8000);
      const net = gross - tare;
      const rate = ri(5, 20);
      await prisma.weighment.create({
        data: {
          tenantId: T,
          weighmentNo: `WB-${String(10000 + i).padStart(6, "0")}`,
          postingDate: daysAgo(ri(0, 30)),
          vehicleNo: `MH${ri(10, 30)}AB${ri(1000, 9999)}`,
          driverName: pick(["Ramesh K", "Suresh P", "Vinod S", "Manoj R"]),
          transporter: pick(["ABC Logistics", "SpeedFreight", "MoveIt Ltd"]),
          itemId: pick(items).id,
          supplierId: suppliers.length > 0 ? pick(suppliers).id : null,
          customerId: customers.length > 0 ? pick(customers).id : null,
          weighmentType: pick(["Inward", "Outward"]),
          grossWeight: D(gross), tareWeight: D(tare), netWeight: D(net),
          moisturePct: D(rand() * 15),
          quality: pick(["Grade A", "Grade B", "Grade C"]),
          rate: D(rate), amount: D(net * rate / 1000),
          status: pick(["Weighed", "Verified", "Billed"]),
        },
      });
    }
    console.log(`  weighments: 40`);
  }

  // InwardOutwardNote
  const ionCount = await prisma.inwardOutwardNote.count({ where: { tenantId: T } });
  if (ionCount === 0) {
    for (let i = 0; i < 20; i++) {
      await prisma.inwardOutwardNote.create({
        data: {
          tenantId: T,
          noteNo: `ION-${String(1000 + i).padStart(4, "0")}`,
          postingDate: daysAgo(ri(0, 30)),
          noteType: pick(["Inward", "Outward"]),
          vehicleNo: `KA${ri(1, 55)}CD${ri(1000, 9999)}`,
          driverName: pick(["Kumar", "Ramesh", "Shivam"]),
          purpose: pick(["Raw material delivery", "Finished goods dispatch", "Sample return"]),
          gatePassNo: `GP-${ri(10000, 99999)}`,
          status: pick(["Closed", "Open", "Open"]),
        },
      });
    }
    console.log(`  inwardOutwardNotes: 20`);
  }

  // SalesEnquiry
  const seCount = await prisma.salesEnquiry.count({ where: { tenantId: T } });
  if (seCount === 0 && customers.length > 0) {
    for (let i = 0; i < 30; i++) {
      const se = await prisma.salesEnquiry.create({
        data: {
          tenantId: T,
          enquiryNo: `ENQ-${String(1000 + i).padStart(4, "0")}`,
          enquiryDate: daysAgo(ri(1, 120)),
          customerId: pick(customers).id,
          channel: pick(["Direct", "Distributor", "Website", "Referral"]),
          source: pick(["Trade Show", "Cold Call", "Referral", "Website"]),
          itemDescription: pick(["Custom machinery", "Bulk order inquiry", "Spare parts", "Service quotation"]),
          totalQty: D(ri(10, 500)),
          status: pick(["Open", "Quoted", "Quoted", "Won", "Lost"]),
          followUpDate: daysAgo(ri(-30, -1)),
          closingReason: pick(["Price high", "Won on price", "Won on quality", "Competitor"]),
        },
      });
      for (let j = 0; j < ri(1, 3); j++) {
        await prisma.salesEnquiryItem.create({
          data: {
            salesEnquiryId: se.id, itemId: pick(items).id,
            itemDescription: "Line item",
            qty: D(ri(5, 100)),
            targetRate: D(ri(500, 5000)),
            targetAmount: D(ri(10_000, 500_000)),
          },
        });
      }
    }
    console.log(`  salesEnquiries: 30`);
  }

  // MrpRun
  const mrpCount = await prisma.mrpRun.count({ where: { tenantId: T } });
  if (mrpCount === 0) {
    for (let i = 0; i < 5; i++) {
      const run = await prisma.mrpRun.create({
        data: {
          tenantId: T,
          runNo: `MRP-${String(100 + i).padStart(4, "0")}`,
          runDate: daysAgo(i * 7),
          horizonDays: 30, scope: "AllItems",
          status: "Completed", suggestionsCount: 0,
        },
      });
      let count = 0;
      for (const item of items.slice(0, 10)) {
        const req = ri(50, 500);
        const onHand = ri(0, req);
        if (req <= onHand) continue;
        await prisma.mrpSuggestion.create({
          data: {
            mrpRunId: run.id, itemId: item.id,
            warehouseId: pick(warehouses).id,
            requiredQty: D(req), onHandQty: D(onHand),
            suggestedQty: D(req - onHand),
            actionType: pick(["Purchase", "Manufacture", "Transfer"]),
            requiredBy: daysAgo(-ri(7, 30)),
            status: "Suggested",
          },
        });
        count++;
      }
      await prisma.mrpRun.update({ where: { id: run.id }, data: { suggestionsCount: count } });
    }
    console.log(`  mrpRuns + suggestions: seeded`);
  }

  // ItemSitePlanning
  const ispCount = await prisma.itemSitePlanning.count({ where: { tenantId: T } });
  if (ispCount === 0) {
    for (const item of items.slice(0, 15)) {
      for (const wh of warehouses.slice(0, 2)) {
        await prisma.itemSitePlanning.upsert({
          where: { tenantId_itemId_warehouseId: { tenantId: T, itemId: item.id, warehouseId: wh.id } },
          update: {},
          create: {
            tenantId: T, itemId: item.id, warehouseId: wh.id,
            reorderLevel: D(ri(20, 100)), reorderQty: D(ri(50, 300)),
            maxLevel: D(ri(500, 2000)), safetyStock: D(ri(10, 50)),
            leadTimeDays: ri(3, 30),
            supplierId: suppliers.length > 0 ? pick(suppliers).id : null,
          },
        });
      }
    }
    console.log(`  itemSitePlannings: seeded`);
  }

  // RoutingMaster
  const rmCount = await prisma.routingMaster.count({ where: { tenantId: T } });
  if (rmCount === 0 && workstations.length > 0) {
    for (let i = 0; i < 8; i++) {
      const r = await prisma.routingMaster.create({
        data: {
          tenantId: T,
          routingName: `${pick(["Standard", "Fast-track", "Precision", "Bulk"])} Route ${i + 1}`,
          itemId: items.length > 0 ? pick(items).id : null,
          description: "Auto-generated routing",
          isActive: rand() > 0.15,
        },
      });
      const ops = ["Cutting", "Assembly", "Testing", "Packing"];
      for (let j = 0; j < ri(2, 4); j++) {
        await prisma.routingOperation.create({
          data: {
            routingId: r.id, sortOrder: j,
            operationName: ops[j],
            workstationId: pick(workstations).id,
            timeInMins: D(ri(5, 60)),
            setupTimeMins: D(ri(2, 15)),
            scrapPct: D(rand() * 3),
          },
        });
      }
    }
    console.log(`  routingMasters + operations: seeded`);
  }

  // MaintenanceRequest + Actions
  const mreqCount = await prisma.maintenanceRequest.count({ where: { tenantId: T } });
  if (mreqCount === 0) {
    for (let i = 0; i < 25; i++) {
      const req = await prisma.maintenanceRequest.create({
        data: {
          tenantId: T,
          requestNo: `MREQ-${String(1000 + i).padStart(4, "0")}`,
          requestDate: daysAgo(ri(0, 60)),
          machineName: pick(["CNC-01", "Press-02", "Boiler-03", "Compressor-04", "Motor-05", "Conveyor-06"]),
          workstationId: workstations.length > 0 ? pick(workstations).id : null,
          priority: pick(["Low", "Medium", "Medium", "High", "Critical"]),
          requestType: pick(["Breakdown", "Preventive", "Predictive", "Improvement"]),
          description: pick(["Unusual vibration observed", "Preventive maintenance due", "Oil leak detected", "Efficiency drop"]),
          status: pick(["Completed", "InProgress", "Acknowledged", "Open"]),
        },
      });
      if (rand() > 0.4) {
        await prisma.maintenanceAction.create({
          data: {
            tenantId: T, requestId: req.id,
            actionDate: daysAgo(ri(0, 30)),
            actionType: pick(["Inspect", "Replace", "Repair", "Adjust", "Lubricate"]),
            performedBy: pick(["Ramesh (Tech)", "Kumar (Tech)", "Suresh (Sr)"]),
            timeSpentMins: ri(30, 480),
            partsUsed: pick(["Bearing", "V-belt", "Sensor", "Oil filter"]),
            costAmount: D(ri(500, 25_000)),
            notes: "Auto-generated action log",
          },
        });
      }
    }
    console.log(`  maintenanceRequests + actions: seeded`);
  }

  // MaintenanceSchedule
  const msCount = await prisma.maintenanceSchedule.count({ where: { tenantId: T } });
  if (msCount === 0) {
    for (let i = 0; i < 15; i++) {
      const nextDue = daysAgo(ri(-60, -1));
      await prisma.maintenanceSchedule.create({
        data: {
          tenantId: T,
          scheduleName: `${pick(["Monthly", "Weekly", "Quarterly"])} ${pick(["Oil change", "Belt inspection", "Calibration"])}`,
          workstationId: workstations.length > 0 ? pick(workstations).id : null,
          machineName: pick(["CNC-01", "Press-02", "Boiler-03"]),
          intervalDays: pick([7, 30, 60, 90]),
          nextDueDate: nextDue,
          lastDoneDate: daysAgo(ri(30, 180)),
          scheduleType: pick(["Preventive", "Calibration", "Inspection"]),
          status: pick(["Active", "Active", "Paused"]),
        },
      });
    }
    console.log(`  maintenanceSchedules: 15`);
  }

  // MachineLogger — 300 events
  const mlCount = await prisma.machineLogger.count({ where: { tenantId: T } });
  if (mlCount === 0) {
    for (let i = 0; i < 300; i++) {
      const eventType = pick(["Startup", "Shutdown", "Alarm", "ProductionRate", "Maintenance", "Idle"]);
      const isAlarm = eventType === "Alarm";
      await prisma.machineLogger.create({
        data: {
          tenantId: T,
          workstationId: workstations.length > 0 ? pick(workstations).id : null,
          machineName: pick(["CNC-01", "Press-02", "Boiler-03", "Compressor-04"]),
          loggedAt: daysAgo(ri(0, 30)),
          eventType,
          parameter: isAlarm ? pick(["Temperature", "Pressure", "Vibration"]) : eventType === "ProductionRate" ? "Units/hr" : null,
          value: isAlarm ? D(ri(85, 120)) : eventType === "ProductionRate" ? D(ri(20, 100)) : null,
          unit: isAlarm ? pick(["°C", "bar", "mm/s"]) : eventType === "ProductionRate" ? "units/hr" : null,
          isAlarm,
          severity: isAlarm ? pick(["Warning", "Warning", "Critical"]) : "Info",
        },
      });
    }
    console.log(`  machineLoggers: 300`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
