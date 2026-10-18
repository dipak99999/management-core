// Seeds the 18 Payroll dashboards (~140 charts) across all payroll-adjacent
// doctypes (SalarySlip, SalarySlipComponent, PayrollEntry, Loan,
// EmployeeAdvance, ExpenseClaim, Attendance, LeaveApplication + the 20 P6
// entities). Idempotent per (tenantId, name).

import { PrismaClient } from "@prisma/client";

interface CardSpec {
  kind: string;
  title: string;
  subtitle?: string;
  config: Record<string, unknown>;
}

interface DashboardSpec {
  name: string;
  description: string;
  cards: CardSpec[];
}

function specs(): DashboardSpec[] {
  return [
    // 1. Payroll Summary Reports (8)
    { name: "Payroll Summary", description: "Topline gross / net / deductions and headcount",
      cards: [
        { kind: "Bar", title: "SalarySlip gross by month", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "startDate", limit: 12 } },
        { kind: "Gauge", title: "This month coverage %", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Net trend", config: { doctype: "SalarySlip", aggregate: "sum", field: "netPay", groupBy: "startDate", dateField: "startDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Slip status", config: { doctype: "SalarySlip", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Payroll KPIs", config: { cards: [
          { label: "Slips MTD", doctype: "SalarySlip", aggregate: "count", period: "mtd", dateField: "startDate" },
          { label: "Gross MTD", doctype: "SalarySlip", aggregate: "sum", field: "grossPay", period: "mtd", dateField: "startDate", format: "currency" },
          { label: "Net MTD", doctype: "SalarySlip", aggregate: "sum", field: "netPay", period: "mtd", dateField: "startDate", format: "currency" },
        ] } },
        { kind: "StackedBar", title: "Gross vs deductions by month", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "startDate", seriesBy: "status" } },
        { kind: "Column", title: "Slips per employee", config: { doctype: "SalarySlip", aggregate: "count", groupBy: "employeeId", limit: 20 } },
        { kind: "Donut", title: "Payroll entries by status", config: { doctype: "PayrollEntry", aggregate: "count", groupBy: "status" } },
      ] },

    // 2. Statutory Compliance Reports (12)
    { name: "Statutory Compliance", description: "PF, ESIC, PT, LWF, TDS compliance",
      cards: [
        { kind: "Bar", title: "PF EE contribution by month", config: { doctype: "PFDetail", aggregate: "sum", field: "employeeContribution", groupBy: "postingDate", limit: 12 } },
        { kind: "Gauge", title: "PF filing status", config: { value: 0, min: 0, max: 100 } },
        { kind: "Heatmap", title: "PF wages × month", config: { doctype: "PFDetail", xField: "postingDate", yField: "employeeId", aggregate: "sum", valueField: "wages" } },
        { kind: "Line", title: "ESIC contribution trend", config: { doctype: "ESICDetail", aggregate: "sum", field: "employeeContribution", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "ETDS Section share", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "section" } },
        { kind: "KPICards", title: "Statutory KPIs", config: { cards: [
          { label: "PF Records", doctype: "PFDetail", aggregate: "count" },
          { label: "ESIC Records", doctype: "ESICDetail", aggregate: "count" },
          { label: "PT Records", doctype: "ProfessionalTaxDetail", aggregate: "count" },
          { label: "LWF Records", doctype: "LWFDetail", aggregate: "count" },
        ] } },
        { kind: "StackedBar", title: "PT state × amount", config: { doctype: "ProfessionalTaxDetail", aggregate: "sum", field: "ptAmount", groupBy: "stateName", seriesBy: "employeeId" } },
        { kind: "Bar", title: "LWF by state", config: { doctype: "LWFDetail", aggregate: "sum", field: "employeeContribution", groupBy: "stateName" } },
        { kind: "Column", title: "ETDS challans by quarter", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "quarter" } },
        { kind: "Waterfall", title: "TDS by section", config: { doctype: "ETDSDetail", aggregate: "sum", field: "tdsAmount", groupBy: "section" } },
        { kind: "Timeline", title: "Challan calendar", config: { doctype: "ETDSDetail", nameField: "challanNumber", startField: "challanDate", endField: "challanDate", groupField: "section", limit: 100 } },
        { kind: "Donut", title: "ETDS status", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "status" } },
      ] },

    // 3. Salary Slip Reports (8)
    { name: "Salary Slips", description: "Slip volume and payout mix",
      cards: [
        { kind: "Bar", title: "Slip count by month", config: { doctype: "SalarySlip", aggregate: "count", groupBy: "startDate", limit: 12 } },
        { kind: "Gauge", title: "Approval rate", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Gross vs Net trend", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "startDate", dateField: "startDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Slip status mix", config: { doctype: "SalarySlip", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Slip KPIs", config: { cards: [
          { label: "Draft", doctype: "SalarySlip", aggregate: "count", filters: { status: "Draft" } },
          { label: "Submitted", doctype: "SalarySlip", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Cancelled", doctype: "SalarySlip", aggregate: "count", filters: { status: "Cancelled" } },
        ] } },
        { kind: "StackedColumn", title: "Employee × status", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "employeeId", seriesBy: "status" } },
        { kind: "Scatter", title: "Gross vs deductions", config: { doctype: "SalarySlip", xField: "grossPay", yField: "totalDeduction", limit: 500 } },
        { kind: "Bar", title: "Top earners", config: { doctype: "SalarySlip", aggregate: "sum", field: "netPay", groupBy: "employeeId", limit: 15 } },
      ] },

    // 4. Leave and Attendance Reports (9)
    { name: "Payroll · Leave & Attendance", description: "Impact of leave and attendance on payable days",
      cards: [
        { kind: "Bar", title: "Attendance by status", config: { doctype: "Attendance", aggregate: "count", groupBy: "status" } },
        { kind: "Heatmap", title: "Employee × date attendance", config: { doctype: "Attendance", xField: "employeeId", yField: "date", aggregate: "count" } },
        { kind: "Line", title: "Attendance trend", config: { doctype: "Attendance", aggregate: "count", groupBy: "date", dateField: "date", period: "last30", orderDir: "asc" } },
        { kind: "Pie", title: "Leave apps by status", config: { doctype: "LeaveApplication", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Absence KPIs", config: { cards: [
          { label: "Working days", doctype: "PayableDays", aggregate: "sum", field: "workingDays" },
          { label: "Paid leaves", doctype: "PayableDays", aggregate: "sum", field: "leavesPaid" },
          { label: "Unpaid leaves", doctype: "PayableDays", aggregate: "sum", field: "leavesUnpaid" },
        ] } },
        { kind: "StackedBar", title: "Payable days composition", config: { doctype: "PayableDays", aggregate: "sum", field: "payableDays", groupBy: "employeeId", seriesBy: "periodStart" } },
        { kind: "Bar", title: "Total absences per employee", config: { doctype: "PayableDays", aggregate: "sum", field: "absences", groupBy: "employeeId", limit: 20 } },
        { kind: "Timeline", title: "Approved leaves", config: { doctype: "LeaveApplication", nameField: "reason", startField: "fromDate", endField: "toDate", groupField: "leaveTypeId", filters: { status: "Approved" }, limit: 100 } },
        { kind: "Donut", title: "Regularization applied", config: { doctype: "AttendanceRegularization", aggregate: "count", groupBy: "status" } },
      ] },

    // 5. Employee Benefits (8)
    { name: "Employee Benefits", description: "Loans, advances, reimbursements, accommodation",
      cards: [
        { kind: "Bar", title: "Loans outstanding by employee", config: { doctype: "Loan", aggregate: "sum", field: "outstanding", groupBy: "employeeId", limit: 15 } },
        { kind: "Line", title: "Advance disbursement trend", config: { doctype: "EmployeeAdvance", aggregate: "sum", field: "amount", groupBy: "postingDate", dateField: "postingDate", period: "ytd" } },
        { kind: "Pie", title: "Expense claim status", config: { doctype: "ExpenseClaim", aggregate: "count", groupBy: "status" } },
        { kind: "Radar", title: "Benefits shape", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "employeeId", seriesBy: "category" } },
        { kind: "KPICards", title: "Benefits KPIs", config: { cards: [
          { label: "Active loans", doctype: "Loan", aggregate: "count", filters: { status: "Disbursed" } },
          { label: "Open advances", doctype: "EmployeeAdvance", aggregate: "count" },
          { label: "Accommodations", doctype: "CompanyAccommodation", aggregate: "count", filters: { status: "Active" } },
        ] } },
        { kind: "StackedBar", title: "Perquisite value by type", config: { doctype: "CompanyAccommodation", aggregate: "sum", field: "perquisiteValue", groupBy: "accommodationType", seriesBy: "status" } },
        { kind: "Bar", title: "Bonus by type", config: { doctype: "Bonus", aggregate: "sum", field: "amount", groupBy: "bonusType" } },
        { kind: "Column", title: "Ad-hoc payments by category", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "category" } },
      ] },

    // 6. Bonus and Incentive Reports (7)
    { name: "Bonus & Incentive", description: "Bonus program payouts and mix",
      cards: [
        { kind: "Bar", title: "Bonus by type", config: { doctype: "Bonus", aggregate: "sum", field: "amount", groupBy: "bonusType" } },
        { kind: "Gauge", title: "Approval rate", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Bonus trend", config: { doctype: "Bonus", aggregate: "sum", field: "amount", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Bonus status", config: { doctype: "Bonus", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Bonus KPIs", config: { cards: [
          { label: "This year", doctype: "Bonus", aggregate: "sum", field: "amount", period: "ytd", dateField: "postingDate", format: "currency" },
          { label: "Approved", doctype: "Bonus", aggregate: "count", filters: { status: "Approved" } },
          { label: "Paid", doctype: "Bonus", aggregate: "count", filters: { status: "Paid" } },
        ] } },
        { kind: "StackedBar", title: "Employee × type", config: { doctype: "Bonus", aggregate: "sum", field: "amount", groupBy: "employeeId", seriesBy: "bonusType" } },
        { kind: "Column", title: "Bonus taxable share", config: { doctype: "Bonus", aggregate: "sum", field: "taxableAmount", groupBy: "bonusType" } },
      ] },

    // 7. Reimbursement Reports (7)
    { name: "Reimbursements", description: "Expense claims + ad-hoc reimbursements",
      cards: [
        { kind: "Bar", title: "Claim volume by employee", config: { doctype: "ExpenseClaim", aggregate: "sum", field: "totalAmount", groupBy: "employeeId", limit: 15 } },
        { kind: "Donut", title: "Claim status", config: { doctype: "ExpenseClaim", aggregate: "count", groupBy: "status" } },
        { kind: "Line", title: "Claim trend", config: { doctype: "ExpenseClaim", aggregate: "sum", field: "totalAmount", groupBy: "createdAt", dateField: "createdAt", period: "ytd" } },
        { kind: "Pie", title: "Ad-hoc reimbursement mix", config: { doctype: "AdhocPaymentRecovery", aggregate: "count", groupBy: "category", filters: { entryType: "Payment" } } },
        { kind: "KPICards", title: "Reimbursement KPIs", config: { cards: [
          { label: "Open claims", doctype: "ExpenseClaim", aggregate: "count", filters: { status: "Draft" } },
          { label: "Approved MTD", doctype: "ExpenseClaim", aggregate: "count", filters: { status: "Approved" }, period: "mtd", dateField: "updatedAt" },
        ] } },
        { kind: "StackedBar", title: "Claim status × employee", config: { doctype: "ExpenseClaim", aggregate: "sum", field: "totalAmount", groupBy: "employeeId", seriesBy: "status" } },
        { kind: "Bar", title: "Top categories", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "category", filters: { entryType: "Payment" } } },
      ] },

    // 8. Payroll Cost Analysis (8)
    { name: "Payroll Cost Analysis", description: "CTC composition and cost drivers",
      cards: [
        { kind: "Bar", title: "Total CTC by grade", config: { doctype: "CTC", aggregate: "sum", field: "totalCTC", groupBy: "gradeId" } },
        { kind: "Line", title: "Salary trend", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "startDate", dateField: "startDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "CTC component share", config: { doctype: "CTC", aggregate: "sum", field: "annualBase", groupBy: "name", limit: 12 } },
        { kind: "Report", title: "Employee CTC snapshot", config: { doctype: "EmployeeCTC", aggregate: "count", groupBy: "ctcTemplateId" } },
        { kind: "StackedBar", title: "EmpCTC by month × template", config: { doctype: "EmployeeCTC", aggregate: "sum", field: "totalCTC", groupBy: "effectiveFrom", seriesBy: "ctcTemplateId" } },
        { kind: "KPICards", title: "Cost KPIs", config: { cards: [
          { label: "Avg CTC", doctype: "EmployeeCTC", aggregate: "avg", field: "totalCTC", format: "currency" },
          { label: "Employees on CTC", doctype: "EmployeeCTC", aggregate: "count" },
        ] } },
        { kind: "TreeMap", title: "CTC by template → employee", config: { doctype: "EmployeeCTC", rootGroupBy: "ctcTemplateId", leafGroupBy: "employeeId", aggregate: "sum", valueField: "totalCTC", rootLabel: "CTC" } },
        { kind: "Waterfall", title: "Salary JV posting", config: { doctype: "SalaryJV", aggregate: "sum", field: "totalDebit", groupBy: "postingDate" } },
      ] },

    // 9. Tax and Audit Reports (8)
    { name: "Tax & Audit", description: "Income tax + TDS + audit trail",
      cards: [
        { kind: "Bar", title: "TDS by employee", config: { doctype: "Form16", aggregate: "sum", field: "tdsDeducted", groupBy: "employeeId", limit: 15 } },
        { kind: "Heatmap", title: "TDS section × quarter", config: { doctype: "ETDSDetail", xField: "quarter", yField: "section", aggregate: "sum", valueField: "tdsAmount" } },
        { kind: "Line", title: "Tax collected trend", config: { doctype: "ETDSDetail", aggregate: "sum", field: "tdsAmount", groupBy: "challanDate", dateField: "challanDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Form16 status", config: { doctype: "Form16", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Tax KPIs", config: { cards: [
          { label: "TDS this year", doctype: "ETDSDetail", aggregate: "sum", field: "tdsAmount", period: "ytd", dateField: "challanDate", format: "currency" },
          { label: "Form16 issued", doctype: "Form16", aggregate: "count", filters: { status: "Issued" } },
        ] } },
        { kind: "StackedBar", title: "Section × quarter", config: { doctype: "ETDSDetail", aggregate: "sum", field: "tdsAmount", groupBy: "section", seriesBy: "quarter" } },
        { kind: "Timeline", title: "Challan timeline", config: { doctype: "ETDSDetail", nameField: "challanNumber", startField: "challanDate", endField: "challanDate", groupField: "section", limit: 100 } },
        { kind: "Column", title: "Refund vs due", config: { doctype: "Form16", aggregate: "sum", field: "refundOrDue", groupBy: "status" } },
      ] },

    // 10. Compliance and Statutory Filing (8)
    { name: "Compliance & Filing", description: "Filing readiness — PF/ESIC/PT/LWF/TDS challans",
      cards: [
        { kind: "Bar", title: "Filings by section", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "section" } },
        { kind: "Gauge", title: "Filing completeness", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "New filings trend", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "challanDate", dateField: "challanDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Filing status", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Filing KPIs", config: { cards: [
          { label: "Filed", doctype: "ETDSDetail", aggregate: "count", filters: { status: "Filed" } },
          { label: "Draft", doctype: "ETDSDetail", aggregate: "count", filters: { status: "Draft" } },
          { label: "Annexure II", doctype: "ETDSDetail", aggregate: "count", filters: { isAnnexure2: true } },
        ] } },
        { kind: "StackedColumn", title: "Filing count × quarter", config: { doctype: "ETDSDetail", aggregate: "count", groupBy: "fiscalYearName", seriesBy: "quarter" } },
        { kind: "Bar", title: "PF filing coverage", config: { doctype: "PFDetail", aggregate: "count", groupBy: "postingDate", limit: 12 } },
        { kind: "Timeline", title: "Challan schedule", config: { doctype: "ETDSDetail", nameField: "challanNumber", startField: "challanDate", endField: "challanDate", groupField: "quarter", limit: 100 } },
      ] },

    // 11. Year-End (7)
    { name: "Year-End", description: "Form 16 issuance + FY summary",
      cards: [
        { kind: "Bar", title: "Form 16 by status", config: { doctype: "Form16", aggregate: "count", groupBy: "status" } },
        { kind: "Gauge", title: "Issuance progress", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Total gross by FY", config: { doctype: "Form16", aggregate: "sum", field: "grossSalary", groupBy: "fiscalYearId" } },
        { kind: "Pie", title: "TDS vs refund", config: { doctype: "Form16", aggregate: "sum", field: "tdsDeducted", groupBy: "status" } },
        { kind: "KPICards", title: "Year-end KPIs", config: { cards: [
          { label: "Form16 issued", doctype: "Form16", aggregate: "count", filters: { status: "Issued" } },
          { label: "Form 12BB", doctype: "Form12BB", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Savings", doctype: "Saving", aggregate: "count" },
        ] } },
        { kind: "StackedBar", title: "Form16 gross by FY × status", config: { doctype: "Form16", aggregate: "sum", field: "grossSalary", groupBy: "fiscalYearId", seriesBy: "status" } },
        { kind: "Bar", title: "Previous employer inflow", config: { doctype: "PreviousEmployerDetail", aggregate: "sum", field: "grossSalary", groupBy: "previousEmployerName", limit: 10 } },
      ] },

    // 12. Custom (3)
    { name: "Payroll · Custom", description: "Reserved slot for ad-hoc analysis",
      cards: [
        { kind: "Bar", title: "Custom slice", config: { doctype: "SalarySlip", aggregate: "sum", field: "netPay", groupBy: "employeeId", limit: 15 } },
        { kind: "Line", title: "Custom trend", config: { doctype: "SalarySlip", aggregate: "sum", field: "netPay", groupBy: "startDate", dateField: "startDate", period: "ytd", orderDir: "asc" } },
        { kind: "KPICards", title: "Custom KPIs", config: { cards: [
          { label: "Employees", doctype: "Employee", aggregate: "count", filters: { status: "Active" } },
          { label: "Slips", doctype: "SalarySlip", aggregate: "count" },
        ] } },
      ] },

    // 13. Attendance (10)
    { name: "Payroll · Attendance", description: "Payable-days engine and attendance signals",
      cards: [
        { kind: "Bar", title: "Payable days by employee", config: { doctype: "PayableDays", aggregate: "sum", field: "payableDays", groupBy: "employeeId", limit: 20 } },
        { kind: "Heatmap", title: "Employee × period", config: { doctype: "PayableDays", xField: "employeeId", yField: "periodStart", aggregate: "sum", valueField: "payableDays" } },
        { kind: "Line", title: "Absence trend", config: { doctype: "PayableDays", aggregate: "sum", field: "absences", groupBy: "periodStart", dateField: "periodStart", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Attendance status share", config: { doctype: "Attendance", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Attendance KPIs", config: { cards: [
          { label: "Present today", doctype: "Attendance", aggregate: "count", filters: { status: "Present" }, period: "today", dateField: "date" },
          { label: "Absent today", doctype: "Attendance", aggregate: "count", filters: { status: "Absent" }, period: "today", dateField: "date" },
          { label: "On leave today", doctype: "Attendance", aggregate: "count", filters: { status: "On Leave" }, period: "today", dateField: "date" },
        ] } },
        { kind: "StackedBar", title: "Working vs leaves per period", config: { doctype: "PayableDays", aggregate: "sum", field: "workingDays", groupBy: "periodStart", seriesBy: "employeeId" } },
        { kind: "Bar", title: "Regularizations by status", config: { doctype: "AttendanceRegularization", aggregate: "count", groupBy: "status" } },
        { kind: "Column", title: "Overtime requests by status", config: { doctype: "OvertimeRequest", aggregate: "count", groupBy: "status" } },
        { kind: "Histogram", title: "Payable-days distribution", config: { doctype: "PayableDays", field: "payableDays", bins: 10 } },
        { kind: "Timeline", title: "Leave calendar", config: { doctype: "LeaveApplication", nameField: "reason", startField: "fromDate", endField: "toDate", groupField: "status", limit: 100 } },
      ] },

    // 14. Monthly Payroll (8)
    { name: "Monthly Payroll", description: "Per-month payroll roll-up + drill-in",
      cards: [
        { kind: "Bar", title: "Slip gross by month", config: { doctype: "SalarySlip", aggregate: "sum", field: "grossPay", groupBy: "startDate", limit: 12 } },
        { kind: "Gauge", title: "Payroll run coverage", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Ad-hoc payments trend", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "HRA vs base share", config: { doctype: "HouseRentDetail", aggregate: "sum", field: "hraExemption", groupBy: "cityType" } },
        { kind: "KPICards", title: "Monthly KPIs", config: { cards: [
          { label: "Slips MTD", doctype: "SalarySlip", aggregate: "count", period: "mtd", dateField: "startDate" },
          { label: "Payroll entries", doctype: "PayrollEntry", aggregate: "count" },
          { label: "Ad-hoc processed", doctype: "AdhocPaymentRecovery", aggregate: "count", filters: { isProcessed: true } },
        ] } },
        { kind: "StackedBar", title: "Ad-hoc × entryType", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "postingDate", seriesBy: "entryType" } },
        { kind: "Bar", title: "House rent by employee", config: { doctype: "HouseRentDetail", aggregate: "sum", field: "hraReceived", groupBy: "employeeId", limit: 15 } },
        { kind: "Column", title: "Final settlements by status", config: { doctype: "FinalSettlement", aggregate: "count", groupBy: "status" } },
      ] },

    // 15. Income Tax (7)
    { name: "Income Tax", description: "Tax computation + investments",
      cards: [
        { kind: "Bar", title: "Tax liability by employee", config: { doctype: "Form16", aggregate: "sum", field: "totalTaxLiability", groupBy: "employeeId", limit: 15 } },
        { kind: "Gauge", title: "Filing progress", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "TDS trend", config: { doctype: "Form16", aggregate: "sum", field: "tdsDeducted", groupBy: "issuedDate", dateField: "issuedDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Refund vs due", config: { doctype: "Form16", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Tax KPIs", config: { cards: [
          { label: "Total gross", doctype: "Form16", aggregate: "sum", field: "grossSalary", format: "currency" },
          { label: "Total tax", doctype: "Form16", aggregate: "sum", field: "totalTaxLiability", format: "currency" },
        ] } },
        { kind: "StackedColumn", title: "Deduction stack", config: { doctype: "Form16", aggregate: "sum", field: "section80CDeduction", groupBy: "fiscalYearId", seriesBy: "status" } },
        { kind: "Bar", title: "Previous employer amounts", config: { doctype: "PreviousEmployerDetail", aggregate: "sum", field: "grossSalary", groupBy: "employeeId", limit: 15 } },
      ] },

    // 16. Savings (7)
    { name: "Payroll · Savings", description: "12BB submissions + investment declarations",
      cards: [
        { kind: "Bar", title: "Savings by type", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "savingType" } },
        { kind: "Line", title: "Savings trend", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "investmentDate", dateField: "investmentDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Section share", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "section" } },
        { kind: "Radar", title: "Employee investment shape", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "employeeId", seriesBy: "savingType" } },
        { kind: "KPICards", title: "Savings KPIs", config: { cards: [
          { label: "12BB submitted", doctype: "Form12BB", aggregate: "count", filters: { status: "Submitted" } },
          { label: "Verified", doctype: "Form12BB", aggregate: "count", filters: { status: "Verified" } },
          { label: "Total invested", doctype: "Saving", aggregate: "sum", field: "amount", format: "currency" },
        ] } },
        { kind: "StackedBar", title: "Type × verified", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "savingType", seriesBy: "isVerified" } },
        { kind: "Column", title: "Internal vs external", config: { doctype: "Saving", aggregate: "sum", field: "amount", groupBy: "isInternal" } },
      ] },

    // 17. Financial (8)
    { name: "Payroll · Financial", description: "CTC vs actuals, JV posting reconciliation",
      cards: [
        { kind: "Bar", title: "CTC by template", config: { doctype: "CTC", aggregate: "sum", field: "totalCTC", groupBy: "name" } },
        { kind: "Gauge", title: "CTC coverage %", config: { value: 0, min: 0, max: 100 } },
        { kind: "Line", title: "Salary JV total trend", config: { doctype: "SalaryJV", aggregate: "sum", field: "totalDebit", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "Salary JV by status", config: { doctype: "SalaryJV", aggregate: "count", groupBy: "status" } },
        { kind: "KPICards", title: "Financial KPIs", config: { cards: [
          { label: "Templates", doctype: "CTC", aggregate: "count" },
          { label: "Employees on CTC", doctype: "EmployeeCTC", aggregate: "count" },
          { label: "JV posted", doctype: "SalaryJV", aggregate: "count", filters: { status: "Posted" } },
        ] } },
        { kind: "StackedBar", title: "Base + HRA + PF stack", config: { doctype: "EmployeeCTC", aggregate: "sum", field: "annualBase", groupBy: "employeeId", seriesBy: "ctcTemplateId" } },
        { kind: "Column", title: "Ad-hoc payments vs recovery", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "entryType" } },
        { kind: "Waterfall", title: "JV debit waterfall", config: { doctype: "SalaryJV", aggregate: "sum", field: "totalDebit", groupBy: "postingDate" } },
      ] },

    // 18. Deductions (7)
    { name: "Deductions", description: "All deductions applied to gross pay",
      cards: [
        { kind: "Bar", title: "PF deductions by month", config: { doctype: "PFDetail", aggregate: "sum", field: "employeeContribution", groupBy: "postingDate", limit: 12 } },
        { kind: "Line", title: "ESIC trend", config: { doctype: "ESICDetail", aggregate: "sum", field: "employeeContribution", groupBy: "postingDate", dateField: "postingDate", period: "ytd", orderDir: "asc" } },
        { kind: "Pie", title: "PT by state", config: { doctype: "ProfessionalTaxDetail", aggregate: "sum", field: "ptAmount", groupBy: "stateName" } },
        { kind: "Report", title: "Recovery detail", config: { doctype: "AdhocPaymentRecovery", aggregate: "count", groupBy: "category" } },
        { kind: "Scatter", title: "Wages vs PF", config: { doctype: "PFDetail", xField: "wages", yField: "employeeContribution", limit: 300 } },
        { kind: "KPICards", title: "Deduction KPIs", config: { cards: [
          { label: "PF total", doctype: "PFDetail", aggregate: "sum", field: "employeeContribution", format: "currency" },
          { label: "ESIC total", doctype: "ESICDetail", aggregate: "sum", field: "employeeContribution", format: "currency" },
          { label: "PT total", doctype: "ProfessionalTaxDetail", aggregate: "sum", field: "ptAmount", format: "currency" },
          { label: "LWF total", doctype: "LWFDetail", aggregate: "sum", field: "employeeContribution", format: "currency" },
        ] } },
        { kind: "StackedBar", title: "Deduction categories per employee", config: { doctype: "AdhocPaymentRecovery", aggregate: "sum", field: "amount", groupBy: "employeeId", seriesBy: "category", filters: { entryType: "Recovery" } } },
      ] },
  ];
}

export async function seedPayrollAnalytics(
  prisma: PrismaClient,
  tenantId: string,
  ownerUserId: string,
): Promise<{ dashboards: Array<{ name: string; id: string; cards: number }> }> {
  const dashboards = specs();
  const results: Array<{ name: string; id: string; cards: number }> = [];
  for (let i = 0; i < dashboards.length; i++) {
    const spec = dashboards[i];
    const existing = await prisma.dashboard.findFirst({
      where: { tenantId, name: spec.name },
      include: { cards: true },
    });
    let dashId: string;
    if (existing) {
      await prisma.dashboardCard.deleteMany({ where: { dashboardId: existing.id } });
      await prisma.dashboard.update({
        where: { id: existing.id },
        data: { description: spec.description, ownerUserId, isShared: true, sortOrder: 900 + i },
      });
      dashId = existing.id;
    } else {
      const d = await prisma.dashboard.create({
        data: { tenantId, ownerUserId, name: spec.name, description: spec.description, isShared: true, sortOrder: 900 + i },
      });
      dashId = d.id;
    }
    for (let j = 0; j < spec.cards.length; j++) {
      const c = spec.cards[j];
      await prisma.dashboardCard.create({
        data: {
          dashboardId: dashId,
          kind: c.kind === "Report" ? "SummaryTable" : c.kind,
          title: c.title,
          subtitle: c.subtitle ?? null,
          config: c.config as object,
          gridCol: (j * 4) % 12,
          gridRow: Math.floor((j * 4) / 12),
          gridWidth: 4,
          gridHeight: 3,
          sortOrder: j,
        },
      });
    }
    results.push({ name: spec.name, id: dashId, cards: spec.cards.length });
  }
  return { dashboards: results };
}
