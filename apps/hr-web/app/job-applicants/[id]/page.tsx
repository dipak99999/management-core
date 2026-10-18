"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Field,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
} from "../../../components/ui";

interface Applicant {
  id: string;
  name: string;
  applicantName: string;
  email: string | null;
  mobile: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  resumeUrl: string | null;
  coverLetter: string | null;
  createdAt: string;
  jobOpening: { id: string; name: string; title: string } | null;
  hiredEmployee: { id: string; employeeCode: string; employeeName: string } | null;
}

export default function ApplicantDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Applicant | null>(null);
  const [hireForm, setHireForm] = useState({
    designation: "",
    department: "",
    baseSalary: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get<Applicant>(`/job-applicants/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function hire() {
    if (!confirm("Create Employee record from this applicant?")) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ employeeCode: string; employeeId: string }>(
        `/job-applicants/${params.id}/hire`,
        {
          designation: hireForm.designation || null,
          department: hireForm.department || null,
          baseSalary: Number(hireForm.baseSalary || 0),
          dateOfJoining: new Date().toISOString(),
        },
      );
      setMsg(`Hired as ${r.employeeCode}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Job Applicants", href: "/hr/job-applicants" }]}
          title="Applicant"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Job Applicants", href: "/hr/job-applicants" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className="font-mono">{data.name}</span>
      <StatusBadge status={data.status} />
      <span className="text-ink-muted">
        {data.jobOpening ? (
          <>
            Applied for{" "}
            <a
              href={`/hr/job-openings/${data.jobOpening.id}`}
              className="text-brand-600 hover:underline"
            >
              {data.jobOpening.title}
            </a>
          </>
        ) : (
          "General application"
        )}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Job Applicants", href: "/hr/job-applicants" },
          { label: data.applicantName },
        ]}
        title={data.applicantName}
        subtitle={subtitle}
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {msg && (
        <Card className="p-3 text-green-800 border-green-200 bg-green-50 text-sm">
          {msg}
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="Contact & profile" />
        <div className="grid grid-cols-2 gap-4">
          {data.email && <Field label="Email" value={data.email} />}
          {data.mobile && <Field label="Mobile" value={data.mobile} />}
          {data.source && <Field label="Source" value={data.source} />}
          {data.resumeUrl && (
            <Field
              label="Resume"
              value={
                <a
                  href={data.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:underline break-all"
                >
                  {data.resumeUrl}
                </a>
              }
            />
          )}
        </div>
        {data.coverLetter && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Cover letter
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">
              {data.coverLetter}
            </div>
          </div>
        )}
        {data.notes && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Notes
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{data.notes}</div>
          </div>
        )}
      </Card>

      {data.hiredEmployee ? (
        <Card className="p-4">
          <SectionHeader title="Hired" />
          <div className="text-sm">
            Employee:{" "}
            <a
              href={`/hr/employees/${data.hiredEmployee.id}`}
              className="text-brand-600 hover:underline font-mono"
            >
              {data.hiredEmployee.employeeCode}
            </a>{" "}
            — {data.hiredEmployee.employeeName}
          </div>
        </Card>
      ) : (
        <Card className="p-4 space-y-3">
          <SectionHeader title="Hire this applicant" />
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Designation">
              <input
                className="input"
                value={hireForm.designation}
                onChange={(e) =>
                  setHireForm({ ...hireForm, designation: e.target.value })
                }
              />
            </FormField>
            <FormField label="Department">
              <input
                className="input"
                value={hireForm.department}
                onChange={(e) =>
                  setHireForm({ ...hireForm, department: e.target.value })
                }
              />
            </FormField>
            <FormField label="Base salary">
              <input
                type="number"
                step="0.01"
                className="input"
                value={hireForm.baseSalary}
                onChange={(e) =>
                  setHireForm({ ...hireForm, baseSalary: e.target.value })
                }
              />
            </FormField>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={hire}
              disabled={busy}
              type="button"
            >
              {busy ? "Hiring…" : "Hire → Create Employee"}
            </Button>
          </div>
        </Card>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="JobApplicant" docId={params.id} />
      </div>
</main>
  );
}
