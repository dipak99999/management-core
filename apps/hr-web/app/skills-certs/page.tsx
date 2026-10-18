"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  dateShort,
} from "../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Skill {
  id: string;
  skillName: string;
  proficiency: string;
  yearsOfExperience: string | null;
  employee: { employeeCode: string; employeeName: string };
}
interface Cert {
  id: string;
  certificationName: string;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  credentialId: string | null;
  employee: { employeeCode: string; employeeName: string };
}

export default function SkillsCertsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filterEmp, setFilterEmp] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [skillForm, setSkillForm] = useState({
    employeeId: "",
    skillName: "",
    proficiency: "Intermediate",
    yearsOfExperience: "",
  });
  const [certForm, setCertForm] = useState({
    employeeId: "",
    certificationName: "",
    issuer: "",
    issueDate: "",
    expiryDate: "",
    credentialId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const q = filterEmp ? `?employeeId=${filterEmp}` : "";
      const [es, sk, ce] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<Skill[]>(`/employee-skills${q}`),
        api.get<Cert[]>(`/employee-certifications${q}`),
      ]);
      setEmployees(es);
      setSkills(sk);
      setCerts(ce);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmp]);

  async function addSkill(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/employee-skills", {
        employeeId: skillForm.employeeId,
        skillName: skillForm.skillName,
        proficiency: skillForm.proficiency,
        yearsOfExperience: skillForm.yearsOfExperience
          ? Number(skillForm.yearsOfExperience)
          : null,
      });
      setSkillForm({ ...skillForm, skillName: "", yearsOfExperience: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function addCert(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/employee-certifications", {
        employeeId: certForm.employeeId,
        certificationName: certForm.certificationName,
        issuer: certForm.issuer || null,
        issueDate: certForm.issueDate ? new Date(certForm.issueDate).toISOString() : null,
        expiryDate: certForm.expiryDate ? new Date(certForm.expiryDate).toISOString() : null,
        credentialId: certForm.credentialId || null,
      });
      setCertForm({
        ...certForm,
        certificationName: "",
        issuer: "",
        issueDate: "",
        expiryDate: "",
        credentialId: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(path: string) {
    if (!confirm("Delete?")) return;
    try {
      await api.del(path);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <PageHeader
        breadcrumb={[
          { label: "HR & Payroll", href: "/hr" },
          { label: "Skills & certifications" },
        ]}
        title="Skills & certifications"
        actions={
          <select
            className="input"
            value={filterEmp}
            onChange={(e) => setFilterEmp(e.target.value)}
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employeeCode} — {e.employeeName}
              </option>
            ))}
          </select>
        }
      />

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <SectionHeader title="Skills" />
          <form onSubmit={addSkill} className="grid grid-cols-4 gap-2 items-end">
            <FormField label="Employee" required>
              <select
                className="input"
                value={skillForm.employeeId}
                onChange={(e) =>
                  setSkillForm({ ...skillForm, employeeId: e.target.value })
                }
                required
              >
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employeeCode} — {e.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Skill" required>
              <input
                className="input"
                value={skillForm.skillName}
                onChange={(e) =>
                  setSkillForm({ ...skillForm, skillName: e.target.value })
                }
                required
              />
            </FormField>
            <FormField label="Proficiency">
              <select
                className="input"
                value={skillForm.proficiency}
                onChange={(e) =>
                  setSkillForm({ ...skillForm, proficiency: e.target.value })
                }
              >
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
                <option>Expert</option>
              </select>
            </FormField>
            <FormField label="Yrs">
              <input
                type="number"
                step="0.5"
                className="input"
                value={skillForm.yearsOfExperience}
                onChange={(e) =>
                  setSkillForm({
                    ...skillForm,
                    yearsOfExperience: e.target.value,
                  })
                }
              />
            </FormField>
            <div className="col-span-4 flex justify-end">
              <Button variant="primary" size="sm" type="submit" disabled={busy}>
                Add skill
              </Button>
            </div>
          </form>
          <ul className="divide-y divide-ink-muted/10">
            {skills.map((s) => (
              <li key={s.id} className="py-2 flex justify-between text-sm">
                <div>
                  <div className="font-medium">{s.skillName}</div>
                  <div className="text-xs text-ink-muted">
                    {s.employee.employeeCode} · {s.proficiency}
                    {s.yearsOfExperience &&
                      ` · ${Number(s.yearsOfExperience).toFixed(1)}y`}
                  </div>
                </div>
                <button
                  onClick={() => del(`/employee-skills/${s.id}`)}
                  className="text-red-600 text-xs hover:underline"
                >
                  remove
                </button>
              </li>
            ))}
            {skills.length === 0 && (
              <li className="py-2 text-ink-muted text-xs">No skills</li>
            )}
          </ul>
        </Card>

        <Card className="p-4 space-y-3">
          <SectionHeader title="Certifications" />
          <form onSubmit={addCert} className="grid grid-cols-2 gap-2 items-end">
            <FormField label="Employee" required>
              <select
                className="input"
                value={certForm.employeeId}
                onChange={(e) =>
                  setCertForm({ ...certForm, employeeId: e.target.value })
                }
                required
              >
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.employeeCode} — {e.employeeName}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Certification name" required>
              <input
                className="input"
                value={certForm.certificationName}
                onChange={(e) =>
                  setCertForm({
                    ...certForm,
                    certificationName: e.target.value,
                  })
                }
                required
              />
            </FormField>
            <FormField label="Issuer">
              <input
                className="input"
                value={certForm.issuer}
                onChange={(e) =>
                  setCertForm({ ...certForm, issuer: e.target.value })
                }
              />
            </FormField>
            <FormField label="Credential ID">
              <input
                className="input"
                value={certForm.credentialId}
                onChange={(e) =>
                  setCertForm({ ...certForm, credentialId: e.target.value })
                }
              />
            </FormField>
            <FormField label="Issue date">
              <input
                type="date"
                className="input"
                value={certForm.issueDate}
                onChange={(e) =>
                  setCertForm({ ...certForm, issueDate: e.target.value })
                }
              />
            </FormField>
            <FormField label="Expiry date">
              <input
                type="date"
                className="input"
                value={certForm.expiryDate}
                onChange={(e) =>
                  setCertForm({ ...certForm, expiryDate: e.target.value })
                }
              />
            </FormField>
            <div className="col-span-2 flex justify-end">
              <Button variant="primary" size="sm" type="submit" disabled={busy}>
                Add certification
              </Button>
            </div>
          </form>
          <ul className="divide-y divide-ink-muted/10">
            {certs.map((c) => (
              <li key={c.id} className="py-2 flex justify-between text-sm">
                <div>
                  <div className="font-medium">{c.certificationName}</div>
                  <div className="text-xs text-ink-muted">
                    {c.employee.employeeCode}
                    {c.issuer && ` · ${c.issuer}`}
                    {c.expiryDate && ` · exp ${dateShort(c.expiryDate)}`}
                  </div>
                </div>
                <button
                  onClick={() => del(`/employee-certifications/${c.id}`)}
                  className="text-red-600 text-xs hover:underline"
                >
                  remove
                </button>
              </li>
            ))}
            {certs.length === 0 && (
              <li className="py-2 text-ink-muted text-xs">No certifications</li>
            )}
          </ul>
        </Card>
      </div>
    </main>
  );
}
