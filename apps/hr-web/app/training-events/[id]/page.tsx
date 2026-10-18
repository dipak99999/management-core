"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  type Column,
} from "../../../components/ui";

interface Employee { id: string; employeeCode: string; employeeName: string }
interface Attendee {
  id: string;
  attended: boolean;
  rating: number | null;
  feedback: string | null;
  employee: Employee;
}
interface Event {
  id: string;
  name: string;
  subject: string;
  description: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  trainerName: string | null;
  status: string;
  attendees: Attendee[];
}

export default function TrainingEventDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Event | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [addEmp, setAddEmp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [d, es] = await Promise.all([
        api.get<Event>(`/training-events/${params.id}`),
        api.get<Employee[]>("/employees"),
      ]);
      setData(d);
      setEmployees(es);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function addAttendee(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmp) return;
    setBusy(true);
    try {
      await api.post(`/training-events/${params.id}/attendees`, { employeeId: addEmp });
      setAddEmp("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateAttendee(id: string, patch: Partial<Attendee>) {
    setBusy(true);
    try {
      await api.put(`/training-events/${params.id}/attendees/${id}`, patch);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    setBusy(true);
    try {
      await api.post(`/training-events/${params.id}/status`, { status });
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
          breadcrumb={[{ label: "Training Events", href: "/hr/training-events" }]}
          title="Training Event"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Training Events", href: "/hr/training-events" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const alreadyIn = new Set(data.attendees.map((a) => a.employee.id));

  const cols: Column<Attendee>[] = [
    {
      header: "Employee",
      cell: (a) => (
        <div>
          <div className="text-xs font-mono text-ink-muted">
            {a.employee.employeeCode}
          </div>
          <div>{a.employee.employeeName}</div>
        </div>
      ),
    },
    {
      header: "Attended",
      cell: (a) => (
        <input
          type="checkbox"
          checked={a.attended}
          disabled={busy}
          onChange={(e) => updateAttendee(a.id, { attended: e.target.checked })}
        />
      ),
    },
    {
      header: "Rating",
      cell: (a) => (
        <select
          disabled={busy}
          value={a.rating ?? ""}
          onChange={(e) =>
            updateAttendee(a.id, {
              rating: e.target.value ? Number(e.target.value) : null,
            })
          }
          className="input py-1 text-xs"
        >
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      ),
    },
    {
      header: "Feedback",
      cell: (a) => (
        <input
          disabled={busy}
          defaultValue={a.feedback ?? ""}
          onBlur={(e) => {
            if (e.target.value !== (a.feedback ?? "")) {
              updateAttendee(a.id, { feedback: e.target.value });
            }
          }}
          className="input py-1 text-xs w-full"
          placeholder="Feedback"
        />
      ),
    },
  ];

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className="font-mono">{data.name}</span>
      <StatusBadge status={data.status} />
      <span className="text-ink-muted">
        {new Date(data.startAt).toLocaleString()} →{" "}
        {new Date(data.endAt).toLocaleTimeString()}
        {data.location && ` · ${data.location}`}
        {data.trainerName && ` · ${data.trainerName}`}
      </span>
    </span>
  );

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <PageHeader
        breadcrumb={[
          { label: "Training Events", href: "/hr/training-events" },
          { label: data.subject },
        ]}
        title={data.subject}
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
            <select
              value={data.status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value)}
              className="input"
            >
              <option>Scheduled</option>
              <option>InProgress</option>
              <option>Completed</option>
              <option>Cancelled</option>
            </select>
          </>
        }
      />

      {data.description && (
        <Card className="p-4">
          <SectionHeader title="Description" />
          <div className="whitespace-pre-wrap text-sm">{data.description}</div>
        </Card>
      )}

      <Card className="p-4">
        <SectionHeader title="Register attendee" />
        <form onSubmit={addAttendee} className="flex gap-2">
          <select
            className="input flex-1"
            value={addEmp}
            onChange={(e) => setAddEmp(e.target.value)}
          >
            <option value="">Add employee…</option>
            {employees
              .filter((e) => !alreadyIn.has(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.employeeName}
                </option>
              ))}
          </select>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !addEmp}
          >
            + Register
          </Button>
        </form>
      </Card>

      <section>
        <SectionHeader title={`Attendees (${data.attendees.length})`} />
        <div className="hidden md:block">
          <DataTable<Attendee>
            columns={cols}
            rows={data.attendees}
            rowKey={(a) => a.id}
            empty={{ title: "No attendees yet" }}
          />
        </div>
        {data.attendees.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No attendees yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.attendees.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{a.employee.employeeName}</div>
                    <div className="text-xs text-ink-muted font-mono truncate">{a.employee.employeeCode}</div>
                  </div>
                  <div className="text-end text-xs">
                    <span className={a.attended ? "text-green-700" : "text-ink-muted"}>
                      {a.attended ? "Attended" : "Pending"}
                    </span>
                    {a.rating != null && (
                      <div className="text-ink-muted tabular-nums">★ {a.rating}</div>
                    )}
                  </div>
                </div>
                {a.feedback && (
                  <div className="mt-1 text-xs text-ink-muted">{a.feedback}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="TrainingEvent" docId={params.id} />
      </div>
</main>
  );
}
