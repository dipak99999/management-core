import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const reportsRouter = Router();

// Dashboard summary for the shell home page.
reportsRouter.get("/dashboard-summary", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const [
    activeEmployees,
    mtdPayroll,
    draftSlips,
    absentToday,
    onLeaveToday,
  ] = await Promise.all([
    prisma.employee.count({
      where: { tenantId, status: "Active" },
    }),
    // Submitted or Paid slips whose period end falls in this month.
    prisma.salarySlip.aggregate({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        endDate: { gte: monthStart, lte: now },
      },
      _sum: { grossPay: true, netPay: true },
      _count: true,
    }),
    prisma.salarySlip.count({
      where: { tenantId, status: "Draft" },
    }),
    prisma.attendance.count({
      where: {
        tenantId,
        status: "Absent",
        date: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.attendance.count({
      where: {
        tenantId,
        status: "On Leave",
        date: { gte: todayStart, lt: todayEnd },
      },
    }),
  ]);

  res.json({
    activeEmployees,
    mtdPayrollGross: Number(mtdPayroll._sum.grossPay ?? 0),
    mtdPayrollNet: Number(mtdPayroll._sum.netPay ?? 0),
    mtdSlipsSubmitted: mtdPayroll._count,
    draftSlips,
    absentToday,
    onLeaveToday,
  });
});

// E15: Deeper HR dashboard — extends dashboard-summary with headcount by dept,
// pending workflows, upcoming certification expiries, recent hires.
reportsRouter.get("/hr-dashboard", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30 = new Date();
  in30.setUTCDate(in30.getUTCDate() + 30);

  const [
    headcount,
    byDepartment,
    onLeaveEmp,
    mtdSlips,
    activeLoans,
    pendingExpenseClaims,
    pendingLeaveApps,
    pendingOnboarding,
    expiringCerts,
    openOpenings,
    recentHires,
  ] = await Promise.all([
    prisma.employee.groupBy({
      by: ["status"],
      where: { tenantId },
      _count: true,
    }),
    prisma.employee.groupBy({
      by: ["department"],
      where: { tenantId, status: "Active" },
      _count: true,
    }),
    prisma.employee.count({ where: { tenantId, status: "On Leave" } }),
    prisma.salarySlip.aggregate({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        endDate: { gte: monthStart, lte: now },
      },
      _sum: { grossPay: true, netPay: true, totalDeduction: true },
    }),
    prisma.loan.aggregate({
      where: { tenantId, status: "Disbursed" },
      _sum: { outstanding: true },
      _count: true,
    }),
    prisma.expenseClaim.aggregate({
      where: { tenantId, status: "Draft" },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.leaveApplication.count({
      where: { tenantId, status: "Draft" },
    }),
    prisma.employeeChecklist.count({
      where: { tenantId, type: "Onboarding", status: "InProgress" },
    }),
    prisma.employeeCertification.findMany({
      where: { tenantId, expiryDate: { gte: now, lte: in30 } },
      include: { employee: { select: { employeeCode: true, employeeName: true } } },
      orderBy: { expiryDate: "asc" },
      take: 10,
    }),
    prisma.jobOpening.count({ where: { tenantId, status: "Open" } }),
    prisma.employee.findMany({
      where: { tenantId, status: "Active", dateOfJoining: { not: null } },
      select: { id: true, employeeCode: true, employeeName: true, dateOfJoining: true, department: true },
      orderBy: { dateOfJoining: "desc" },
      take: 5,
    }),
  ]);

  const headcountBy = headcount.reduce<Record<string, number>>((a, r) => {
    a[r.status] = r._count;
    return a;
  }, {});
  const deptBreakdown = byDepartment
    .map((r) => ({ department: r.department ?? "Unassigned", count: r._count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    headcount: headcountBy,
    byDepartment: deptBreakdown,
    onLeave: onLeaveEmp,
    mtdPayroll: {
      gross: Number(mtdSlips._sum.grossPay ?? 0),
      deduction: Number(mtdSlips._sum.totalDeduction ?? 0),
      net: Number(mtdSlips._sum.netPay ?? 0),
    },
    loans: {
      activeCount: activeLoans._count,
      outstanding: Number(activeLoans._sum.outstanding ?? 0),
    },
    pending: {
      expenseClaims: pendingExpenseClaims._count,
      expenseClaimsAmount: Number(pendingExpenseClaims._sum.totalAmount ?? 0),
      leaveApplications: pendingLeaveApps,
      onboarding: pendingOnboarding,
      jobOpenings: openOpenings,
    },
    expiringCertifications: expiringCerts,
    recentHires,
  });
});
