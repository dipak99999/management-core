"use client";

import { useEffect, useState } from "react";
import { useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
} from "../../../components/ui";

interface HolidayRow {
  holidayDate: string;
  description: string;
  isWeeklyOff: boolean;
}

const emptyRow: HolidayRow = { holidayDate: "", description: "", isWeeklyOff: false };

const WEEKDAYS = [
  { value: "", label: "(none)" },
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

export default function NewHolidayListPage() {
  const thisYear = new Date().getUTCFullYear();
  const [name, setName] = useState(`Holidays ${thisYear}`);
  const [fromDate, setFromDate] = useState(`${thisYear}-01-01`);
  const [toDate, setToDate] = useState(`${thisYear}-12-31`);
  const [weeklyOffDay, setWeeklyOffDay] = useState("0");
  const [holidays, setHolidays] = useState<HolidayRow[]>([{ ...emptyRow }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart defaults: creating multiple holiday lists usually reuses the same
  // weekly-off day (org-wide policy). Remember so admins don't re-pick.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ weeklyOffDay: string }>(
    "hr-web:holiday-list-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (smart.last?.weeklyOffDay) setWeeklyOffDay(smart.last.weeklyOffDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.weeklyOffDay]);

  function updateRow(idx: number, patch: Partial<HolidayRow>) {
    setHolidays((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const cleaned = holidays.filter((h) => h.holidayDate && h.description);
      const r = await api.post<{ id: string }>("/holiday-lists", {
        name,
        fromDate: new Date(fromDate).toISOString(),
        toDate: new Date(toDate).toISOString(),
        weeklyOffDay: weeklyOffDay || null,
        holidays: cleaned.map((h) => ({
          holidayDate: new Date(h.holidayDate).toISOString(),
          description: h.description,
          isWeeklyOff: h.isWeeklyOff,
        })),
      });
      smart.remember({ weeklyOffDay });
      window.location.href = `/hr/holiday-lists/${r.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 space-y-6 max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Holiday Lists", href: "/hr/holiday-lists" },
          { label: "New" },
        ]}
        title="New holiday list"
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

      {error && (
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 text-sm">
          {error}
        </Card>
      )}

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Name" required>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Auto-add weekly off">
              <select
                className="input"
                value={weeklyOffDay}
                onChange={(e) => setWeeklyOffDay(e.target.value)}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="From" required>
              <input
                type="date"
                className="input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                required
              />
            </FormField>
            <FormField label="To" required>
              <input
                type="date"
                className="input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                required
              />
            </FormField>
          </div>

          <div>
            <SectionHeader
              title="Public / explicit holidays"
              actions={
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() => setHolidays([...holidays, { ...emptyRow }])}
                >
                  + Add row
                </button>
              }
            />
            <table className="table">
              <thead>
                <tr>
                  <th className="text-start">Date</th>
                  <th className="text-start">Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="date"
                        className="input"
                        value={h.holidayDate}
                        onChange={(e) =>
                          updateRow(i, { holidayDate: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        placeholder="e.g. Republic Day"
                        value={h.description}
                        onChange={(e) =>
                          updateRow(i, { description: e.target.value })
                        }
                      />
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="text-red-500 text-xs"
                        onClick={() =>
                          setHolidays((rows) =>
                            rows.filter((_, idx) => idx !== i),
                          )
                        }
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-ink-muted mt-2">
              Weekly offs (if selected above) are added automatically for every date
              in the range.
            </p>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
