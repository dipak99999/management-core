import { Button, Card, PageHeader } from "../components/ui";

const modules = [
  { href: "/hr/dashboard",        label: "Dashboard",        desc: "Live KPIs, alerts, headcount" },
  { href: "/hr/employees",        label: "Employees",        desc: "Directory & profiles" },
  { href: "/hr/attendance",       label: "Attendance",       desc: "Daily attendance & regularizations" },
  { href: "/hr/employee-checkins", label: "Check-ins",       desc: "Punch-in / out log" },
  { href: "/hr/leave-applications", label: "Leave",          desc: "Applications, allocations, types" },
  { href: "/hr/salary-slips",     label: "Salary Slips",     desc: "Payroll slips & payments" },
  { href: "/hr/payroll-entries",  label: "Payroll",          desc: "Bulk payroll runs" },
  { href: "/hr/salary-structures", label: "Salary structures", desc: "Component templates" },
  { href: "/hr/loans",            label: "Loans",            desc: "Employee loans & EMI" },
  { href: "/hr/employee-advances", label: "Advances",        desc: "Cash / bank advances" },
  { href: "/hr/expense-claims",   label: "Expense claims",   desc: "Reimbursements" },
  { href: "/hr/onboarding",       label: "Onboarding",       desc: "Joining & separation checklists" },
  { href: "/hr/job-openings",     label: "Job openings",     desc: "Recruitment pipeline" },
  { href: "/hr/job-applicants",   label: "Applicants",       desc: "Candidate tracker" },
  { href: "/hr/appraisals",       label: "Appraisals",       desc: "Reviews & KRA scoring" },
  { href: "/hr/training-events",  label: "Training",         desc: "Sessions & feedback" },
  { href: "/hr/holiday-lists",    label: "Holiday lists",    desc: "Public holidays & weekly offs" },
  { href: "/hr/hr-masters",       label: "HR masters",       desc: "Departments, designations, grades" },
];

export default function HRHome() {
  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "HR & Payroll" }]}
        title="HR & Payroll"
        subtitle="Choose a module below"
        actions={
          <a href="/hr/dashboard">
            <Button variant="primary" type="button">
              Open dashboard
            </Button>
          </a>
        }
      />

      <section className="grid grid-cols-3 gap-3">
        {modules.map((m) => (
          <a key={m.href} href={m.href} className="block">
            <Card className="p-4 hover:border-brand-300 transition-colors cursor-pointer h-full">
              <div className="font-medium text-ink">{m.label}</div>
              <div className="text-xs text-ink-muted mt-1">{m.desc}</div>
            </Card>
          </a>
        ))}
      </section>
    </main>
  );
}
