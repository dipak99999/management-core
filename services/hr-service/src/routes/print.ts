import { Router } from "express";
import React from "react";
import { prisma, resolveLetterhead, resolvePrintFormat } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import {
  SalarySlipDocument,
  ExpenseClaimDocument,
  LoanDocument,
  renderPdf,
} from "@lumaara/print";

export const printRouter = Router();

function servePdf(
  req: import("express").Request,
  res: import("express").Response,
  buf: Buffer,
  filename: string,
) {
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}.pdf"`);
  res.setHeader("Content-Length", buf.length.toString());
  res.end(buf);
}

printRouter.get(
  "/salary-slips/:id",
  perms("SalarySlip").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const queryLocale =
        typeof req.query.locale === "string" ? req.query.locale : null;
      const [tenant, slip, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, defaultLocale: true },
        }),
        prisma.salarySlip.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            employee: true,
            components: { orderBy: { componentName: "asc" } },
          },
        }),
        resolveLetterhead(prisma, tenantId, "SalarySlip", letterheadId),
        resolvePrintFormat(prisma, tenantId, "SalarySlip", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!slip) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(SalarySlipDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        locale: queryLocale ?? tenant.defaultLocale ?? "en",
        slip: {
          name: slip.name,
          startDate: slip.startDate,
          endDate: slip.endDate,
          grossPay: Number(slip.grossPay),
          totalDeduction: Number(slip.totalDeduction),
          netPay: Number(slip.netPay),
          status: slip.status,
          remarks: slip.remarks,
          employee: {
            employeeCode: slip.employee.employeeCode,
            employeeName: slip.employee.employeeName,
            designation: slip.employee.designation,
            department: slip.employee.department,
            bankAccountNo: slip.employee.bankAccountNo,
          },
          components: slip.components.map((c) => ({
            componentName: c.componentName,
            type: c.type as "Earning" | "Deduction",
            amount: Number(c.amount),
          })),
        },
      });

      servePdf(req, res, await renderPdf(doc), slip.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/expense-claims/:id",
  perms("ExpenseClaim").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, claim, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.expenseClaim.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            employee: true,
            items: { include: { expenseClaimType: true } },
          },
        }),
        resolveLetterhead(prisma, tenantId, "ExpenseClaim", letterheadId),
        resolvePrintFormat(prisma, tenantId, "ExpenseClaim", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!claim) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(ExpenseClaimDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        claim: {
          name: claim.name,
          postingDate: claim.postingDate,
          status: claim.status,
          remarks: claim.remarks,
          employee: {
            employeeCode: claim.employee.employeeCode,
            employeeName: claim.employee.employeeName,
            department: claim.employee.department,
          },
          items: claim.items.map((it) => ({
            typeName: it.expenseClaimType.typeName,
            description: it.description,
            amount: Number(it.amount),
          })),
          totalAmount: Number(claim.totalAmount),
        },
      });

      servePdf(req, res, await renderPdf(doc), claim.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/loans/:id",
  perms("Loan").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, loan, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.loan.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            employee: true,
            loanType: true,
            schedule: { orderBy: { installmentNo: "asc" } },
          },
        }),
        resolveLetterhead(prisma, tenantId, "Loan", letterheadId),
        resolvePrintFormat(prisma, tenantId, "Loan", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!loan) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(LoanDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        loan: {
          name: loan.name,
          disbursementDate: loan.disbursementDate,
          status: loan.status,
          principal: Number(loan.principal),
          interestRate: Number(loan.interestRate),
          termMonths: loan.termMonths,
          emi: Number(loan.emi),
          outstanding: Number(loan.outstanding),
          employee: {
            employeeCode: loan.employee.employeeCode,
            employeeName: loan.employee.employeeName,
          },
          loanType: loan.loanType.loanTypeName,
          schedule: loan.schedule.map((s) => ({
            installmentNo: s.installmentNo,
            dueDate: s.dueDate,
            principalAmount: Number(s.principalAmount),
            interestAmount: Number(s.interestAmount),
            totalAmount: Number(s.totalAmount),
            balanceAfter: Number(s.balanceAfter),
            isPaid: s.isPaid,
          })),
        },
      });

      servePdf(req, res, await renderPdf(doc), loan.name);
    } catch (e) {
      next(e);
    }
  },
);
