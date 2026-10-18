"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { CustomFieldsForm } from "../../lib/custom-fields";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  money,
  type Column,
} from "../../components/ui";
import { InlineEditCell, useListPageCommands, Tour, type TourStep, SavedViewsControls } from "@lumaara/web-ui";
import { Icon } from "../../components/app-shell";

interface Employee {
  id: string;
  employeeCode: string;
  employeeName: string;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  dateOfJoining: string | null;
  baseSalary: string;
  status: string;
  managerId: string | null;
  bankAccountNo: string | null;
  ifscCode: string | null;
  bankName: string | null;
  customData?: Record<string, unknown> | null;
}

// Every field the hr-service POST /employees zod schema accepts. See
// services/hr-service/src/routes/employees.ts:10.
const emptyForm = {
  employeeName: "",
  email: "",
  mobile: "",
  designation: "",
  department: "",
  dateOfJoining: "",
  baseSalary: 0,
  status: "Active",
  managerId: "",
  bankAccountNo: "",
  ifscCode: "",
  bankName: "",
  // Payroll / leave / org-hierarchy pickers — all optional in the schema
  // but critical for downstream calculations (payroll can't run without
  // salaryStructureId; leave entitlements need leavePolicyId).
  salaryStructureId: "",
  defaultShiftId: "",
  holidayListId: "",
  leavePolicyId: "",
  gradeId: "",
  employmentTypeId: "",
  branchId: "",
};

interface OptionRow { id: string; name: string }

type StatusFilter = "all" | "Active" | "Inactive" | "Left";

function InnerEmployeesPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [customData, setCustomData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Dropdown option lists — loaded lazily on drawer open so the list-page
  // render doesn't fan out into 7 extra requests.
  const [salaryStructures, setSalaryStructures] = useState<OptionRow[]>([]);
  const [shiftTypes, setShiftTypes] = useState<OptionRow[]>([]);
  const [holidayLists, setHolidayLists] = useState<OptionRow[]>([]);
  const [leavePolicies, setLeavePolicies] = useState<OptionRow[]>([]);
  const [grades, setGrades] = useState<OptionRow[]>([]);
  const [employmentTypes, setEmploymentTypes] = useState<OptionRow[]>([]);
  const [branches, setBranches] = useState<OptionRow[]>([]);

  useEffect(() => {
    if (!showForm) return;
    if (salaryStructures.length + shiftTypes.length > 0) return; // already loaded
    Promise.allSettled([
      api.get<Array<{ id: string; name: string }>>("/salary-structures").then((r) =>
        setSalaryStructures(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/shift-types").then((r) =>
        setShiftTypes(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/holiday-lists").then((r) =>
        setHolidayLists(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/leave-policies").then((r) =>
        setLeavePolicies(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/employee-grades").then((r) =>
        setGrades(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/employment-types").then((r) =>
        setEmploymentTypes(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
      api.get<Array<{ id: string; name: string }>>("/branches").then((r) =>
        setBranches(r.map((x) => ({ id: x.id, name: x.name }))),
      ),
    ]).catch(() => {}); // silent — dropdowns just stay empty on failure
  }, [showForm, salaryStructures.length, shiftTypes.length]);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<Employee[]>("/employees"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  useListPageCommands({
    singular: "Employee",
    plural: "Employees",
    newHref: "/hr/employees/new",
    refresh: load,
  });
  const tourSteps: TourStep[] = [
    { target: "[data-tour=hr-employees-v1-header]", title: "Employees", body: "This is where you manage employees. Filter by status, search by name, and drill into any row for details.", placement: "bottom" },
    { target: "[data-tour=hr-employees-v1-new]", title: "Create a new employee", body: "Click here to add your first employee. The form captures all the required fields and lets you save as draft or submit immediately.", placement: "bottom" },
    { target: "[data-tour=hr-employees-v1-filter]", title: "Save a filtered view", body: "Narrow down with the filters, then use the Views menu to save and name the filter set so it's one click next time.", placement: "bottom" },
  ];

  useEffect(() => {
    if (!editId) return;
    api.get<Employee>(`/employees/${editId}`)
      .then((emp) => {
        setForm({
          employeeName: emp.employeeName,
          email: emp.email ?? "",
          mobile: emp.mobile ?? "",
          designation: emp.designation ?? "",
          department: emp.department ?? "",
          dateOfJoining: emp.dateOfJoining ? emp.dateOfJoining.slice(0, 10) : "",
          baseSalary: Number(emp.baseSalary),
          status: emp.status,
          managerId: emp.managerId ?? "",
          bankAccountNo: emp.bankAccountNo ?? "",
          ifscCode: emp.ifscCode ?? "",
          bankName: emp.bankName ?? "",
          salaryStructureId:
            (emp as { salaryStructureId?: string | null }).salaryStructureId ?? "",
          defaultShiftId:
            (emp as { defaultShiftId?: string | null }).defaultShiftId ?? "",
          holidayListId:
            (emp as { holidayListId?: string | null }).holidayListId ?? "",
          leavePolicyId:
            (emp as { leavePolicyId?: string | null }).leavePolicyId ?? "",
          gradeId: (emp as { gradeId?: string | null }).gradeId ?? "",
          employmentTypeId:
            (emp as { employmentTypeId?: string | null }).employmentTypeId ?? "",
          branchId: (emp as { branchId?: string | null }).branchId ?? "",
        });
        setCustomData((emp.customData as Record<string, unknown>) ?? {});
        setEditingId(editId);
        setEditingCode(emp.employeeCode);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = {
        ...form,
        managerId: form.managerId || null,
        salaryStructureId: form.salaryStructureId || null,
        defaultShiftId: form.defaultShiftId || null,
        holidayListId: form.holidayListId || null,
        leavePolicyId: form.leavePolicyId || null,
        gradeId: form.gradeId || null,
        employmentTypeId: form.employmentTypeId || null,
        branchId: form.branchId || null,
        dateOfJoining: form.dateOfJoining
          ? new Date(form.dateOfJoining).toISOString()
          : undefined,
        customData,
      };
      if (editingId) await api.put(`/employees/${editingId}`, body);
      else await api.post("/employees", body);
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  function close() {
    setForm(emptyForm);
    setCustomData({});
    setEditingId(null);
    setEditingCode(null);
    setShowForm(false);
    if (editId) window.history.replaceState({}, "", "/hr/employees");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && ![r.employeeCode, r.employeeName, r.email, r.designation, r.department]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => ({
    all:      rows.length,
    Active:   rows.filter((r) => r.status === "Active").length,
    Inactive: rows.filter((r) => r.status === "Inactive").length,
    Left:     rows.filter((r) => r.status === "Left").length,
  }), [rows]);

  const columns: Column<Employee>[] = [
    {
      header: "Code",
      cell: (e) => (
        <a
          href={`/hr/employees/${e.id}`}
          className="font-mono text-sm text-brand-600 hover:text-brand-700"
          onClick={(ev) => ev.stopPropagation()}
        >
          {e.employeeCode}
        </a>
      ),
    },
    {
      header: "Name",
      cell: (e) => (
        <div onClick={(ev) => ev.stopPropagation()}>
          <InlineEditCell
            value={e.employeeName}
            save={async (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === e.employeeName) return;
              await api.put(`/employees/${e.id}`, { employeeName: trimmed });
              await load();
            }}
            display={(v) => <span className="font-medium text-ink">{v}</span>}
          />
          {e.email && <div className="text-xs text-ink-muted">{e.email}</div>}
        </div>
      ),
    },
    { header: "Designation", cell: (e) => <span className="text-ink-soft">{e.designation ?? "—"}</span> },
    { header: "Department", cell: (e) => <span className="text-ink-soft">{e.department ?? "—"}</span> },
    {
      header: "Base Salary",
      align: "right",
      cell: (e) => (
        <span className="tabular-nums font-medium text-ink">
          {money(Number(e.baseSalary))}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (e) => <StatusBadge status={e.status} />,
    },
  ];

  return (
    <>
      <Tour id="hr-web.employees.v1" steps={tourSteps} />
      <div data-tour="hr-employees-v1-header">
      <PageHeader
        title="Employees"
        subtitle={`${rows.length} employee${rows.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>+ New employee</Button>
        }
      />
      </div>

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}

      <div className="space-y-4">
        <div data-tour="hr-employees-v1-filter">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search code, name, email…" }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all",      label: "All",      count: counts.all },
                { value: "Active",   label: "Active",   count: counts.Active },
                { value: "Inactive", label: "Inactive", count: counts.Inactive },
                { value: "Left",     label: "Left",     count: counts.Left },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="hr-web:employees" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
          </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(e) => e.id}
          onRowClick={(e) => (window.location.href = `/hr/employees/${e.id}`)}
          loading={loading}
          empty={{
            icon: Icon.users,
            title: search || statusFilter !== "all" ? "No matching employees" : "No employees yet",
            description: search || statusFilter !== "all"
              ? "Try changing your search or filter."
              : "Add your first employee to start tracking headcount.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>+ Add employee</Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        title={editingId ? `Edit employee${editingCode ? ` · ${editingCode}` : ""}` : "New employee"}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Create employee"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="Employee name" required>
            <input
              className="input"
              placeholder="Jane Doe"
              value={form.employeeName}
              onChange={(e) => setForm({ ...form, employeeName: e.target.value })}
              required
              autoFocus
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            <FormField label="Mobile">
              <input
                className="input"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Designation">
              <input
                className="input"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
              />
            </FormField>
            <FormField label="Department">
              <input
                className="input"
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Date of joining">
              <input
                className="input"
                type="date"
                value={form.dateOfJoining}
                onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })}
              />
            </FormField>
            <FormField label="Base salary">
              <input
                className="input"
                type="number"
                step="any"
                min={0}
                value={form.baseSalary}
                onChange={(e) => setForm({ ...form, baseSalary: Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {/* Values MUST match hr-service upsertSchema enum
                    (services/hr-service/src/routes/employees.ts:21).
                    "Inactive" was a UI-only value not accepted by the API. */}
                <option value="Active">Active</option>
                <option value="On Leave">On Leave</option>
                <option value="Left">Left</option>
              </select>
            </FormField>
          </div>
          <FormField label="Manager" hint="Reports-to. Powers the org chart. Leave blank for top-level.">
            <select
              className="input"
              value={form.managerId}
              onChange={(e) => setForm({ ...form, managerId: e.target.value })}
            >
              <option value="">— No manager —</option>
              {rows
                .filter((r) => r.id !== editingId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.employeeName} ({r.employeeCode})
                  </option>
                ))}
            </select>
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Bank account no." hint="Used for NEFT / RTGS bank advice files.">
              <input
                className="input"
                value={form.bankAccountNo}
                onChange={(e) => setForm({ ...form, bankAccountNo: e.target.value })}
              />
            </FormField>
            <FormField label="IFSC" hint="11 chars: 4 letters + 0 + 6 alphanumeric.">
              <input
                className="input"
                value={form.ifscCode}
                onChange={(e) => setForm({ ...form, ifscCode: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="Bank name">
              <input
                className="input"
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </FormField>
          </div>

          {/* Payroll & leave — optional, but nearly every payroll operation
              (salary slip run, leave entitlement carry-forward) depends on
              at least salaryStructureId + leavePolicyId being set. */}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Salary structure">
              <select
                className="input"
                value={form.salaryStructureId}
                onChange={(e) => setForm({ ...form, salaryStructureId: e.target.value })}
              >
                <option value="">— None —</option>
                {salaryStructures.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Default shift">
              <select
                className="input"
                value={form.defaultShiftId}
                onChange={(e) => setForm({ ...form, defaultShiftId: e.target.value })}
              >
                <option value="">— None —</option>
                {shiftTypes.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Holiday list">
              <select
                className="input"
                value={form.holidayListId}
                onChange={(e) => setForm({ ...form, holidayListId: e.target.value })}
              >
                <option value="">— None —</option>
                {holidayLists.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Leave policy">
              <select
                className="input"
                value={form.leavePolicyId}
                onChange={(e) => setForm({ ...form, leavePolicyId: e.target.value })}
              >
                <option value="">— None —</option>
                {leavePolicies.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
          </div>

          {/* Org hierarchy — powers per-branch reporting, grade-based comp
              bands, and per-employment-type policy variances. */}
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Grade">
              <select
                className="input"
                value={form.gradeId}
                onChange={(e) => setForm({ ...form, gradeId: e.target.value })}
              >
                <option value="">— None —</option>
                {grades.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Employment type">
              <select
                className="input"
                value={form.employmentTypeId}
                onChange={(e) => setForm({ ...form, employmentTypeId: e.target.value })}
              >
                <option value="">— None —</option>
                {employmentTypes.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Branch">
              <select
                className="input"
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              >
                <option value="">— None —</option>
                {branches.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </FormField>
          </div>

          <CustomFieldsForm doctype="Employee" value={customData} onChange={setCustomData} />
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={null}>
      <InnerEmployeesPage />
    </Suspense>
  );
}
