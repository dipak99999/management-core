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
  dateShort,
  type Column,
} from "../../../components/ui";

interface Holiday {
  id: string;
  holidayDate: string;
  description: string;
  isWeeklyOff: boolean;
}
interface HolidayList {
  id: string;
  name: string;
  fromDate: string;
  toDate: string;
  weeklyOffDay: string | null;
  holidays: Holiday[];
}

export default function HolidayListDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<HolidayList | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await api.get<HolidayList>(`/holiday-lists/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function del() {
    if (!confirm("Delete this holiday list?")) return;
    try {
      await api.del(`/holiday-lists/${params.id}`);
      window.location.href = "/hr/holiday-lists";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Holiday Lists", href: "/hr/holiday-lists" }]}
          title="Holiday List"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Holiday Lists", href: "/hr/holiday-lists" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const explicit = data.holidays.filter((h) => !h.isWeeklyOff);
  const weeklyOffs = data.holidays.filter((h) => h.isWeeklyOff);

  const cols: Column<Holiday>[] = [
    {
      header: "Date",
      cell: (h) => <span className="font-mono">{dateShort(h.holidayDate)}</span>,
    },
    { header: "Description", cell: (h) => h.description },
  ];

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Holiday Lists", href: "/hr/holiday-lists" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={
          <span>
            {dateShort(data.fromDate)} → {dateShort(data.toDate)} ·{" "}
            {data.holidays.length} holidays ({explicit.length} explicit,{" "}
            {weeklyOffs.length} weekly)
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button variant="danger" onClick={del} type="button">
              Delete
            </Button>
          </>
        }
      />

      <section>
        <SectionHeader title="Explicit holidays" />
        <div className="hidden md:block">
          <DataTable<Holiday>
            columns={cols}
            rows={explicit}
            rowKey={(h) => h.id}
            empty={{ title: "No explicit holidays" }}
          />
        </div>
        {explicit.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            No explicit holidays
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {explicit.map((h) => (
              <li key={h.id} className="px-4 py-3 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{h.description}</div>
                </div>
                <div className="text-xs text-ink-muted tabular-nums">{dateShort(h.holidayDate)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {weeklyOffs.length > 0 && (
        <section>
          <SectionHeader title={`Weekly offs (${weeklyOffs.length})`} />
          <Card className="p-4 text-xs text-ink-muted max-h-64 overflow-y-auto space-y-0.5">
            {weeklyOffs.map((h) => (
              <div key={h.id}>
                <span className="font-mono">{dateShort(h.holidayDate)}</span> —{" "}
                {h.description}
              </div>
            ))}
          </Card>
        </section>
      )}
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="HolidayList" docId={params.id} />
      </div>
</main>
  );
}
