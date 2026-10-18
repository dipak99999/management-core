import { initOtel } from "@lumaara/service-auth";
initOtel("hr-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("hr-service");

import express from "express";
import { employeeRouter } from "./routes/employees";
import { attendanceRouter } from "./routes/attendance";
import { salarySlipRouter } from "./routes/salary-slips";
import { reportsRouter } from "./routes/reports";
import { leaveTypeRouter } from "./routes/leave-types";
import { leaveAllocationRouter } from "./routes/leave-allocations";
import { leaveApplicationRouter } from "./routes/leave-applications";
import { salaryStructureRouter } from "./routes/salary-structures";
import { expenseClaimTypeRouter } from "./routes/expense-claim-types";
import { expenseClaimRouter } from "./routes/expense-claims";
import { shiftTypeRouter } from "./routes/shift-types";
import { loanTypeRouter } from "./routes/loan-types";
import { loanRouter } from "./routes/loans";
import { holidayListRouter } from "./routes/holiday-lists";
import { payrollEntryRouter } from "./routes/payroll-entries";
import {
  employeeChecklistTemplateRouter,
  employeeChecklistRouter,
} from "./routes/employee-checklists";
import {
  employeeOnboardingRouter,
  employeeSeparationRouter,
} from "./routes/employee-onboarding";
import { employeeAdvanceRouter } from "./routes/employee-advances";
import { appraisalTemplateRouter, appraisalRouter } from "./routes/appraisals";
import {
  programRouter,
  courseRouter,
  studentRouter,
  enrollmentRouter,
  feeScheduleRouter,
  assessmentRouter,
  patientRouter,
  appointmentRouter,
  encounterRouter,
  donorRouter,
  donationRouter,
  grantRouter,
  membershipRouter,
} from "./routes/verticals";
import { employeeCheckinRouter } from "./routes/employee-checkins";
import { overtimeRouter, attendanceRegRouter } from "./routes/overtime";
import { leavePolicyRouter } from "./routes/leave-policies";
import { statutoryComponentRouter } from "./routes/statutory-components";
import { jobOpeningRouter, jobApplicantRouter } from "./routes/recruitment";
import { trainingEventRouter } from "./routes/training-events";
import {
  employeeGradeRouter,
  employmentTypeRouter,
  branchRouter,
} from "./routes/hr-masters";
import { employeeSkillRouter, employeeCertRouter } from "./routes/employee-skills";
import { leaveEncashmentRouter } from "./routes/leave-encashments";
import { leaveLedgerRouter } from "./routes/leave-ledger";
import {
  workGroupRouter,
  employeeCategoryRouter,
  approverHierarchyRouter,
} from "./routes/hr-masters-leave";
import {
  form12bbRouter,
  savingRouter,
  form16Router,
  etdsDetailRouter,
  pfDetailRouter,
  superAnnuationFundRouter,
  adhocPaymentRecoveryRouter,
  houseRentDetailRouter,
  companyAccommodationRouter,
  previousEmployerDetailRouter,
  finalSettlementRouter,
  outsidePayrollDetailRouter,
  salaryJvRouter,
  bonusRouter,
  esicDetailRouter,
  payCodeRouter,
  professionalTaxDetailRouter,
  ctcRouter,
  employeeCTCRouter,
  payableDaysRouter,
  lwfDetailRouter,
} from "./routes/payroll-p6-masters";
import { payrollAnalyticsRouter } from "./routes/payroll-analytics";
import { printRouter } from "./routes/print";
import { requireAuth } from "./middleware/require-auth";
import {
  auditMiddleware,
  corsMiddleware,
  customFieldsReadRouter,
  errorCapture,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  validateEnv,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  pdfLimiter,
  apiLimiter,
  requestLogger,
  securityHeaders,
  workflowEndpoints,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4005" },
});
installCrashHandlers("hr-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("hr-service"));
app.use(apiLimiter);
app.use(express.json());
app.use(normalizeBody);
app.use(
  auditMiddleware({
    routeMap: {
      "employees": "Employee",
      "attendance": "Attendance",
      "salary-slips": "SalarySlip",
      "leave-types": "LeaveType",
      "leave-allocations": "LeaveAllocation",
      "leave-applications": "LeaveApplication",
      "salary-structures": "SalaryStructure",
      "expense-claim-types": "ExpenseClaimType",
      "expense-claims": "ExpenseClaim",
      "shift-types": "ShiftType",
      "loan-types": "LoanType",
      "loans": "Loan",
      "holiday-lists": "HolidayList",
      "payroll-entries": "PayrollEntry",
      "employee-checklist-templates": "EmployeeChecklistTemplate",
      "employee-checklists": "EmployeeChecklist",
      "employee-onboardings": "EmployeeOnboarding",
      "employee-separations": "EmployeeSeparation",
      "employee-advances": "EmployeeAdvance",
      "appraisal-templates": "AppraisalTemplate",
      "appraisals": "Appraisal",
      "programs": "Program",
      "courses": "Course",
      "students": "Student",
      "student-enrollments": "StudentEnrollment",
      "fee-schedules": "FeeSchedule",
      "assessments": "Assessment",
      "patients": "Patient",
      "patient-appointments": "PatientAppointment",
      "patient-encounters": "PatientEncounter",
      "donors": "Donor",
      "donations": "Donation",
      "grants": "Grant",
      "memberships": "Membership",
      "employee-checkins": "EmployeeCheckin",
      "overtime-requests": "OvertimeRequest",
      "attendance-regularizations": "AttendanceRegularization",
      "leave-policies": "LeavePolicy",
      "statutory-components": "StatutoryComponent",
      "job-openings": "JobOpening",
      "job-applicants": "JobApplicant",
      "training-events": "TrainingEvent",
      "employee-grades": "EmployeeGrade",
      "employment-types": "EmploymentType",
      "branches": "Branch",
      "employee-skills": "EmployeeSkill",
      "employee-certifications": "EmployeeCertification",
      "leave-encashments": "LeaveEncashment",
    },
  }),
);

mountBasicOps(app, "hr-service");

app.use("/employees", requireAuth, employeeRouter);
app.use("/attendance", requireAuth, attendanceRouter);
app.use("/salary-slips", requireAuth, salarySlipRouter);
app.use("/leave-types", requireAuth, leaveTypeRouter);
app.use("/leave-allocations", requireAuth, leaveAllocationRouter);
app.use("/leave-applications", requireAuth, leaveApplicationRouter);
app.use("/salary-structures", requireAuth, salaryStructureRouter);
app.use("/expense-claim-types", requireAuth, expenseClaimTypeRouter);
app.use("/expense-claims", requireAuth, expenseClaimRouter);
app.use("/shift-types", requireAuth, shiftTypeRouter);
app.use("/loan-types", requireAuth, loanTypeRouter);
app.use("/loans", requireAuth, loanRouter);
app.use("/holiday-lists", requireAuth, holidayListRouter);
app.use("/payroll-entries", requireAuth, payrollEntryRouter);
app.use("/employee-checklist-templates", requireAuth, employeeChecklistTemplateRouter);
app.use("/employee-checklists", requireAuth, employeeChecklistRouter);
app.use("/employee-onboardings", requireAuth, employeeOnboardingRouter);
app.use("/employee-separations", requireAuth, employeeSeparationRouter);
app.use("/employee-advances", requireAuth, employeeAdvanceRouter);
app.use("/appraisal-templates", requireAuth, appraisalTemplateRouter);
app.use("/appraisals", requireAuth, appraisalRouter);
// Education vertical.
app.use("/programs",           requireAuth, programRouter);
app.use("/courses",            requireAuth, courseRouter);
app.use("/students",           requireAuth, studentRouter);
app.use("/student-enrollments", requireAuth, enrollmentRouter);
app.use("/fee-schedules",      requireAuth, feeScheduleRouter);
app.use("/assessments",        requireAuth, assessmentRouter);
// Healthcare vertical.
app.use("/patients",           requireAuth, patientRouter);
app.use("/patient-appointments", requireAuth, appointmentRouter);
app.use("/patient-encounters",   requireAuth, encounterRouter);
// Non-profit vertical.
app.use("/donors",             requireAuth, donorRouter);
app.use("/donations",          requireAuth, donationRouter);
app.use("/grants",             requireAuth, grantRouter);
app.use("/memberships",        requireAuth, membershipRouter);
app.use("/employee-checkins", requireAuth, employeeCheckinRouter);
app.use("/overtime-requests", requireAuth, overtimeRouter);
app.use("/attendance-regularizations", requireAuth, attendanceRegRouter);
app.use("/leave-policies", requireAuth, leavePolicyRouter);
app.use("/statutory-components", requireAuth, statutoryComponentRouter);
app.use("/job-openings", requireAuth, jobOpeningRouter);
app.use("/job-applicants", requireAuth, jobApplicantRouter);
app.use("/training-events", requireAuth, trainingEventRouter);
app.use("/employee-grades", requireAuth, employeeGradeRouter);
app.use("/employment-types", requireAuth, employmentTypeRouter);
app.use("/branches", requireAuth, branchRouter);
app.use("/employee-skills", requireAuth, employeeSkillRouter);
app.use("/employee-certifications", requireAuth, employeeCertRouter);
app.use("/leave-encashments", requireAuth, leaveEncashmentRouter);
app.use("/leave-ledger", requireAuth, leaveLedgerRouter);
app.use("/work-groups", requireAuth, workGroupRouter);
app.use("/employee-categories", requireAuth, employeeCategoryRouter);
app.use("/approver-hierarchies", requireAuth, approverHierarchyRouter);
// P6 Payroll
app.use("/form-12bb",                requireAuth, form12bbRouter);
app.use("/savings",                  requireAuth, savingRouter);
app.use("/form-16",                  requireAuth, form16Router);
app.use("/etds-details",             requireAuth, etdsDetailRouter);
app.use("/pf-details",               requireAuth, pfDetailRouter);
app.use("/super-annuation-funds",    requireAuth, superAnnuationFundRouter);
app.use("/adhoc-payment-recoveries", requireAuth, adhocPaymentRecoveryRouter);
app.use("/house-rent-details",       requireAuth, houseRentDetailRouter);
app.use("/company-accommodations",   requireAuth, companyAccommodationRouter);
app.use("/previous-employer-details",requireAuth, previousEmployerDetailRouter);
app.use("/final-settlements",        requireAuth, finalSettlementRouter);
app.use("/outside-payroll-details",  requireAuth, outsidePayrollDetailRouter);
app.use("/salary-jvs",               requireAuth, salaryJvRouter);
app.use("/bonuses",                  requireAuth, bonusRouter);
app.use("/esic-details",             requireAuth, esicDetailRouter);
app.use("/pay-codes",                requireAuth, payCodeRouter);
app.use("/professional-tax-details", requireAuth, professionalTaxDetailRouter);
app.use("/ctcs",                     requireAuth, ctcRouter);
app.use("/employee-ctcs",            requireAuth, employeeCTCRouter);
app.use("/payable-days",             requireAuth, payableDaysRouter);
app.use("/lwf-details",              requireAuth, lwfDetailRouter);
app.use("/payroll-analytics",        requireAuth, payrollAnalyticsRouter);
app.use("/print", requireAuth, pdfLimiter, printRouter);
app.use("/custom-fields-for", customFieldsReadRouter());
app.use("/reports", requireAuth, reportsRouter);
app.use("/workflow-actions", workflowEndpoints());

app.use(errorCapture("hr-service"));
app.use(jsonErrorHandler("hr-service"));

const port = Number(process.env.PORT) || 4005;
const server = app.listen(port, () => getLogger("hr-service").info("service listening", { port }));
installGracefulShutdown(server, "hr-service");
