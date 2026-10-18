import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "HR";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/hr",                          label: "Overview",         icon: Icon.home },
      { href: "/hr/dashboard",                label: "HR Dashboard",     icon: Icon.bar },
    ],
  },
  {
    label: "People",
    links: [
      { href: "/hr/employees",                label: "Employees",        icon: Icon.users },
      { href: "/hr/org-chart",                label: "Org Chart",        icon: Icon.layers },
      { href: "/hr/onboardings",              label: "Onboardings",      icon: Icon.clipboard },
      { href: "/hr/separations",              label: "Separations",      icon: Icon.clipboard },
      { href: "/hr/onboarding",               label: "Checklists",       icon: Icon.clipboard },
      { href: "/hr/onboarding/templates",     label: "Checklist Templates", icon: Icon.clipboard },
      { href: "/hr/skills-certs",             label: "Skills & Certs",   icon: Icon.tag },
      { href: "/hr/hr-masters",               label: "HR Masters",       icon: Icon.settings },
    ],
  },
  {
    label: "Attendance",
    links: [
      { href: "/hr/attendance",               label: "Attendance",       icon: Icon.calendar },
      { href: "/hr/employee-checkins",        label: "Check-ins",        icon: Icon.clock },
      { href: "/hr/checkin",                  label: "Mobile Check-in",  icon: Icon.clock },
      { href: "/hr/attendance-regularizations", label: "Regularizations", icon: Icon.calendar },
      { href: "/hr/shift-types",              label: "Shift Types",      icon: Icon.clock },
      { href: "/hr/holiday-lists",            label: "Holiday Lists",    icon: Icon.calendar },
    ],
  },
  {
    label: "Leave",
    links: [
      { href: "/hr/leave-applications",       label: "Applications",     icon: Icon.calendar },
      { href: "/hr/leave-allocations",        label: "Allocations",      icon: Icon.calendar },
      { href: "/hr/leave-ledger",             label: "Ledger",           icon: Icon.book },
      { href: "/hr/leave-policies",           label: "Policies",         icon: Icon.shield },
      { href: "/hr/leave-types",              label: "Types",            icon: Icon.tag },
      { href: "/hr/leave-encashments",        label: "Encashments",      icon: Icon.cash },
      { href: "/hr/work-groups",              label: "Work Groups",      icon: Icon.users },
      { href: "/hr/employee-categories",      label: "Categories",       icon: Icon.tag },
      { href: "/hr/approver-hierarchies",     label: "Approvers",        icon: Icon.shield },
    ],
  },
  {
    label: "Payroll",
    links: [
      { href: "/hr/salary-slips",             label: "Salary Slips",     icon: Icon.invoice },
      { href: "/hr/salary-structures",        label: "Structures",       icon: Icon.layers },
      { href: "/hr/payroll-entries",          label: "Payroll Entries",  icon: Icon.book },
      { href: "/hr/statutory-components",     label: "Statutory",        icon: Icon.shield },
      { href: "/hr/pay-codes",                label: "Pay Codes",        icon: Icon.tag },
      { href: "/hr/ctcs",                     label: "CTC Templates",    icon: Icon.book },
      { href: "/hr/employee-ctcs",            label: "Employee CTC",     icon: Icon.users },
      { href: "/hr/payable-days",             label: "Payable Days",     icon: Icon.calendar },
      { href: "/hr/adhoc-payment-recoveries", label: "Ad-hoc Pay/Recov", icon: Icon.cash },
      { href: "/hr/salary-jvs",               label: "Salary JV",        icon: Icon.book },
      { href: "/hr/final-settlements",        label: "Final Settlements",icon: Icon.cash },
      { href: "/hr/outside-payroll-details",  label: "Outside Payroll",  icon: Icon.cash },
    ],
  },
  {
    label: "Statutory",
    links: [
      { href: "/hr/pf-details",               label: "PF Details",       icon: Icon.shield },
      { href: "/hr/esic-details",             label: "ESIC Details",     icon: Icon.shield },
      { href: "/hr/professional-tax-details", label: "Professional Tax", icon: Icon.shield },
      { href: "/hr/lwf-details",              label: "LWF Details",      icon: Icon.shield },
      { href: "/hr/super-annuation-funds",    label: "SuperAnnuation",   icon: Icon.shield },
      { href: "/hr/etds-details",             label: "ETDS Details",     icon: Icon.book },
    ],
  },
  {
    label: "Tax & Benefits",
    links: [
      { href: "/hr/form-12bb",                label: "Form 12BB",        icon: Icon.clipboard },
      { href: "/hr/form-16",                  label: "Form 16",          icon: Icon.book },
      { href: "/hr/savings",                  label: "Savings",          icon: Icon.cash },
      { href: "/hr/house-rent-details",       label: "House Rent",       icon: Icon.book },
      { href: "/hr/company-accommodations",   label: "Accommodation",    icon: Icon.box },
      { href: "/hr/previous-employer-details",label: "Prev Employer",    icon: Icon.book },
      { href: "/hr/bonuses",                  label: "Bonuses",          icon: Icon.cash },
    ],
  },
  {
    label: "Analytics",
    links: [
      { href: "/hr/payroll-analytics",        label: "Payroll Dashboards", icon: Icon.bar },
    ],
  },
  {
    label: "Expenses & Loans",
    links: [
      { href: "/hr/expense-claims",           label: "Expense Claims",   icon: Icon.cash },
      { href: "/hr/expense-claim-types",      label: "Expense Types",    icon: Icon.tag },
      { href: "/hr/employee-advances",        label: "Advances",         icon: Icon.cash },
      { href: "/hr/loans",                    label: "Loans",            icon: Icon.bank },
      { href: "/hr/loan-types",               label: "Loan Types",       icon: Icon.tag },
      { href: "/hr/overtime-requests",        label: "Overtime",         icon: Icon.clock },
    ],
  },
  {
    label: "Talent",
    links: [
      { href: "/hr/job-openings",             label: "Job Openings",     icon: Icon.briefcase },
      { href: "/hr/job-applicants",           label: "Applicants",       icon: Icon.users },
      { href: "/hr/appraisals",               label: "Appraisals",       icon: Icon.target },
      { href: "/hr/training-events",          label: "Training",         icon: Icon.book },
    ],
  },
];
