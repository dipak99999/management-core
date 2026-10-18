"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  type Column,
} from "../../../components/ui";

interface Applicant {
  id: string;
  name: string;
  applicantName: string;
  email: string | null;
  mobile: string | null;
  source: string | null;
  status: string;
  createdAt: string;
}
interface Opening {
  id: string;
  name: string;
  title: string;
  department: string | null;
  designation: string | null;
  description: string | null;
  location: string | null;
  employmentType: string | null;
  status: string;
  applicants: Applicant[];
}

const statuses = ["New", "Shortlisted", "Interviewing", "Offer", "Hired", "Rejected", "Withdrawn"];

export default function JobOpeningDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Opening | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ applicantName: "", email: "", mobile: "", source: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Opening>(`/job-openings/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function addApplicant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/job-applicants", {
        applicantName: form.applicantName,
        email: form.email || null,
        mobile: form.mobile || null,
        source: form.source || null,
        jobOpeningId: params.id,
      });
      setForm({ applicantName: "", email: "", mobile: "", source: "" });
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    try {
      await api.post(`/job-applicants/${id}/set-status`, { status });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function closeOpening() {
    if (!confirm("Close this opening?")) return;
    setBusy(true);
    try {
      await api.put(`/job-openings/${params.id}`, { status: "Closed" });
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
          breadcrumb={[{ label: "Job Openings", href: "/hr/job-openings" }]}
          title="Job Opening"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Job Openings", href: "/hr/job-openings" }]}
          title="Loading…"
        />
        <Skeleton className="h-40" rounded="rounded-lg" />
      </main>
    );
  }

  const applicantCols: Column<Applicant>[] = [
    {
      header: "Ref",
      cell: (a) => (
        <a
          href={`/hr/job-applicants/${a.id}`}
          className="font-mono text-brand-600 hover:underline"
        >
          {a.name}
        </a>
      ),
    },
    { header: "Applicant", cell: (a) => <span className="font-medium">{a.applicantName}</span> },
    {
      header: "Contact",
      cell: (a) => (
        <span className="text-xs">
          {[a.email, a.mobile].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    { header: "Source", cell: (a) => <span className="text-xs">{a.source ?? "—"}</span> },
    { header: "Applied", cell: (a) => dateShort(a.createdAt) },
    {
      header: "Status",
      cell: (a) => (
        <select
          disabled={busy}
          value={a.status}
          onChange={(e) => setStatus(a.id, e.target.value)}
          className="input py-1 text-xs"
        >
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      ),
    },
  ];

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className="font-mono">{data.name}</span>
      <StatusBadge status={data.status} />
      <span className="text-ink-muted">
        {[data.department, data.designation, data.employmentType, data.location]
          .filter(Boolean)
          .join(" · ") || "—"}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <PageHeader
        breadcrumb={[
          { label: "Job Openings", href: "/hr/job-openings" },
          { label: data.title },
        ]}
        title={data.title}
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowForm((s) => !s)}
              type="button"
            >
              {showForm ? "Cancel" : "+ Add Applicant"}
            </Button>
            {data.status !== "Closed" && (
              <Button variant="danger" onClick={closeOpening} type="button">
                Close Opening
              </Button>
            )}
          </>
        }
      />

      {data.description && (
        <Card className="p-4">
          <SectionHeader title="Description" />
          <div className="whitespace-pre-wrap text-sm">{data.description}</div>
        </Card>
      )}

      {showForm && (
        <Card className="p-4">
          <SectionHeader title="New applicant" />
          <form onSubmit={addApplicant} className="grid grid-cols-2 gap-3">
            <FormField label="Applicant name" required>
              <input
                className="input"
                value={form.applicantName}
                onChange={(e) => setForm({ ...form, applicantName: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Email">
              <input
                className="input"
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
            <FormField label="Source">
              <input
                className="input"
                placeholder="Referral / LinkedIn / …"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
            </FormField>
            <div className="col-span-2 flex justify-end">
              <Button variant="primary" type="submit" disabled={busy}>
                Add applicant
              </Button>
            </div>
          </form>
        </Card>
      )}

      <section>
        <SectionHeader title={`Applicants (${data.applicants.length})`} />
        <div className="hidden md:block">
          <DataTable<Applicant>
            columns={applicantCols}
            rows={data.applicants}
            rowKey={(a) => a.id}
            empty={{ title: "No applicants yet" }}
          />
        </div>
        {data.applicants.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No applicants yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.applicants.map((a) => (
              <li key={a.id}>
                <a href={`/hr/job-applicants/${a.id}`} className="block px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink truncate">{a.applicantName}</div>
                      <div className="text-xs text-ink-muted truncate">
                        {a.email ?? a.mobile ?? "—"}
                      </div>
                    </div>
                    <div className="text-end text-xs text-ink-muted">
                      <div>{a.status}</div>
                      <div>{dateShort(a.createdAt)}</div>
                    </div>
                  </div>
                  {a.source && (
                    <div className="mt-1 text-xs text-ink-muted">Source: {a.source}</div>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="JobOpening" docId={params.id} />
      </div>
</main>
  );
}
