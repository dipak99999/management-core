"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  SectionHeader,
  Segmented,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// Marketing P3 — WebinarEvent detail. KPIs + join URLs + registrations table
// + lifecycle actions. Mirrors the pattern from the exemplar customers/[id].

interface Webinar {
  id: string;
  name: string;
  description: string | null;
  status: string;
  provider: string;
  externalId: string | null;
  joinUrl: string | null;
  hostUrl: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  capacity: number | null;
  registerFormId: string | null;
  actualAttendees: number;
  createdAt: string;
}

interface DetailPayload {
  webinar: Webinar;
  registrationBreakdown: Record<string, number>;
  totals: {
    registered: number;
    attended: number;
    attendanceRate: number;
  };
}

interface Registration {
  id: string;
  email: string;
  name: string | null;
  mobile: string | null;
  status: string;
  registeredAt: string;
  attendedAt: string | null;
  notes: string | null;
}

type RegStatusFilter =
  | "all"
  | "Registered"
  | "Reminded"
  | "Attended"
  | "NoShow"
  | "Cancelled";

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
        {label}
      </div>
      <div className="font-semibold text-lg text-ink mt-0.5">{value}</div>
      {hint && <div className="text-xs mt-0.5 text-ink-muted">{hint}</div>}
    </Card>
  );
}

// Human-readable duration or "in X" — never fires more than once per second
// on re-render because it's derived from Date.now() at render time.
function timeUntil(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  const suffix = diffSec >= 0 ? "" : " ago";
  const prefix = diffSec >= 0 ? "in " : "";
  if (absSec < 60) return `${prefix}${absSec}s${suffix}`;
  if (absSec < 3600) return `${prefix}${Math.round(absSec / 60)} min${suffix}`;
  if (absSec < 86_400) return `${prefix}${Math.round(absSec / 3600)} hr${suffix}`;
  return `${prefix}${Math.round(absSec / 86_400)} d${suffix}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export default function WebinarDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [regs, setRegs] = useState<Registration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [regStatusFilter, setRegStatusFilter] = useState<RegStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api.get<DetailPayload>(`/webinars/${params.id}`);
      setData(payload);
      const rows = await api.get<Registration[]>(
        `/webinars/${params.id}/registrations`,
      );
      setRegs(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refs to avoid stale closures on setInterval below.
  const dataRef = useRef(data);
  dataRef.current = data;

  // Re-render each 30 s while the webinar is Live or Scheduled so the
  // "starts in / running for" hint stays fresh without a full refetch.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!data) return;
    if (data.webinar.status !== "Scheduled" && data.webinar.status !== "Live")
      return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [data]);

  async function callAction(path: string, body?: unknown, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      await api.post(`/webinars/${params.id}${path}`, body ?? {});
      await load();
      setToast(`Done: ${path.replace("/", "")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function updateReg(regId: string, patch: Partial<Registration>) {
    try {
      const updated = await api.patch<Registration>(
        `/webinars/${params.id}/registrations/${regId}`,
        patch,
      );
      setRegs((prev) => prev.map((r) => (r.id === regId ? updated : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function runImport() {
    setImporting(true);
    try {
      // Accept both CSV (first column = email, optional second = name) and
      // one-email-per-line pastes. Header row is auto-detected + skipped.
      const lines = importText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedRows: Array<{ email: string; name?: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        const cols = lines[i].split(/,\s*/);
        const first = cols[0] ?? "";
        // Skip a header row.
        if (i === 0 && first.toLowerCase() === "email") continue;
        if (!first.includes("@")) continue; // skip blank/junk lines
        parsedRows.push({ email: first, name: cols[1] || undefined });
      }
      if (parsedRows.length === 0) {
        setError("No valid email rows found in the paste.");
        setImporting(false);
        return;
      }
      const result = await api.post<{ created: number; skipped: number }>(
        `/webinars/${params.id}/registrations/import`,
        { rows: parsedRows },
      );
      setToast(`Imported ${result.created} (skipped ${result.skipped} duplicates)`);
      setImportOpen(false);
      setImportText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const filteredRegs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return regs.filter((r) => {
      if (regStatusFilter !== "all" && r.status !== regStatusFilter) return false;
      if (q && !`${r.email} ${r.name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [regs, search, regStatusFilter]);

  const regCounts = useMemo(
    () => ({
      all: regs.length,
      Registered: regs.filter((r) => r.status === "Registered").length,
      Reminded: regs.filter((r) => r.status === "Reminded").length,
      Attended: regs.filter((r) => r.status === "Attended").length,
      NoShow: regs.filter((r) => r.status === "NoShow").length,
      Cancelled: regs.filter((r) => r.status === "Cancelled").length,
    }),
    [regs],
  );

  if (error && !data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Webinars", href: "/crm/webinars" }]}
          title="Webinar"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Webinars", href: "/crm/webinars" }]}
          title="Loading…"
        />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" rounded="rounded-lg" />
          ))}
        </div>
      </main>
    );
  }

  const w = data.webinar;
  const past = new Date(w.endAt).getTime() < Date.now();
  const durationMin = Math.max(
    1,
    Math.round((new Date(w.endAt).getTime() - new Date(w.startAt).getTime()) / 60_000),
  );

  // Which action buttons are enabled depends on the current lifecycle state.
  const actions: React.ReactNode[] = [];
  actions.push(
    <Button
      key="back"
      variant="secondary"
      type="button"
      onClick={() => history.back()}
    >
      ← Back
    </Button>,
  );
  if (w.status === "Draft") {
    actions.push(
      <Button
        key="publish"
        variant="brand"
        type="button"
        onClick={() => callAction("/publish")}
      >
        Publish
      </Button>,
    );
  }
  if (w.status === "Scheduled") {
    actions.push(
      <Button
        key="live"
        variant="primary"
        type="button"
        onClick={() => callAction("/mark-live")}
      >
        Mark live
      </Button>,
    );
  }
  if (w.status === "Live") {
    actions.push(
      <Button
        key="end"
        variant="primary"
        type="button"
        onClick={() => callAction("/mark-ended", {}, "Mark this webinar as ended?")}
      >
        Mark ended
      </Button>,
    );
  }
  if (w.status === "Scheduled" || w.status === "Live") {
    actions.push(
      <Button
        key="cancel"
        variant="danger"
        type="button"
        onClick={() => callAction("/cancel", {}, "Cancel this webinar?")}
      >
        Cancel
      </Button>,
    );
  }

  const regColumns: Column<Registration>[] = [
    {
      header: "Attendee",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-ink">{r.name ?? r.email}</span>
          {r.name && (
            <span className="text-[11px] text-ink-muted">{r.email}</span>
          )}
        </div>
      ),
    },
    { header: "Mobile", cell: (r) => r.mobile ?? "—" },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "Registered",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{dateShort(r.registeredAt)}</span>
      ),
    },
    {
      header: "Attended at",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.attendedAt ? dateShort(r.attendedAt) : "—"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status !== "Attended" && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => updateReg(r.id, { status: "Attended" })}
            >
              Mark attended
            </button>
          )}
          {r.status !== "NoShow" && r.status !== "Attended" && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => updateReg(r.id, { status: "NoShow" })}
            >
              No-show
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Webinars", href: "/crm/webinars" },
          { label: w.name },
        ]}
        title={w.name}
        subtitle={
          <div className="flex items-center gap-3 text-ink-muted">
            <StatusBadge status={w.status} />
            <span>{w.provider}</span>
            <span>·</span>
            <span>
              {dateShort(w.startAt)} — {w.timezone}
            </span>
          </div>
        }
        actions={actions}
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}
      {toast && (
        <Toast kind="success" message={toast} onDismiss={() => setToast(null)} />
      )}

      <section className="grid grid-cols-4 gap-3">
        <Kpi
          label="Registrations"
          value={data.totals.registered}
          hint={w.capacity ? `Capacity ${w.capacity}` : "No cap"}
        />
        <Kpi
          label="Attendees"
          value={w.actualAttendees > 0 ? w.actualAttendees : data.totals.attended}
        />
        <Kpi
          label="Attendance rate"
          value={
            data.totals.registered > 0
              ? `${(data.totals.attendanceRate * 100).toFixed(0)}%`
              : "—"
          }
        />
        <Kpi
          label={past ? "Duration" : "Starts"}
          value={past ? `${durationMin} min` : timeUntil(w.startAt)}
          hint={past ? undefined : dateShort(w.startAt)}
        />
      </section>

      {w.description && (
        <Card className="p-4">
          <SectionHeader title="Description" />
          <div className="text-sm text-ink whitespace-pre-wrap">
            {w.description}
          </div>
        </Card>
      )}

      {(w.joinUrl || w.hostUrl) && (
        <Card className="p-4 space-y-3">
          <SectionHeader title="Join URLs" />
          {w.joinUrl && (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                  Attendee join URL
                </div>
                <div className="mt-0.5 font-mono text-xs text-ink truncate">
                  {w.joinUrl}
                </div>
              </div>
              <CopyButton text={w.joinUrl} />
              <a
                href={w.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost btn-sm"
              >
                Open
              </a>
            </div>
          )}
          {w.hostUrl && (
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-amber-700">
                  Host URL (do not share)
                </div>
                <div className="mt-0.5 font-mono text-xs text-ink truncate">
                  {w.hostUrl}
                </div>
              </div>
              <CopyButton text={w.hostUrl} />
              <a
                href={w.hostUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost btn-sm"
              >
                Open
              </a>
            </div>
          )}
        </Card>
      )}

      <section className="space-y-3">
        <SectionHeader
          title="Registrations"
          actions={
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setImportOpen(true)}
              >
                Import CSV
              </Button>
              <Button
                variant="primary"
                type="button"
                disabled={regCounts.Registered === 0}
                onClick={() =>
                  callAction(
                    "/send-reminder",
                    {},
                    `Send reminder email to ${regCounts.Registered} registered address${regCounts.Registered === 1 ? "" : "es"}?`,
                  )
                }
              >
                Send reminder
              </Button>
            </>
          }
        />

        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search attendee email or name…",
          }}
          filters={
            <Segmented
              value={regStatusFilter}
              onChange={setRegStatusFilter}
              options={[
                { value: "all", label: "All", count: regCounts.all },
                { value: "Registered", label: "Registered", count: regCounts.Registered },
                { value: "Reminded", label: "Reminded", count: regCounts.Reminded },
                { value: "Attended", label: "Attended", count: regCounts.Attended },
                { value: "NoShow", label: "No-show", count: regCounts.NoShow },
                { value: "Cancelled", label: "Cancelled", count: regCounts.Cancelled },
              ]}
            />
          }
        />

        <div className="hidden md:block">
          <DataTable
            columns={regColumns}
            rows={filteredRegs}
            rowKey={(r) => r.id}
            empty={{
              icon: Icon.users,
              title:
                search || regStatusFilter !== "all"
                  ? "No matching registrations"
                  : "No registrations yet",
              description:
                search || regStatusFilter !== "all"
                  ? "Try changing your search or filter."
                  : w.registerFormId
                    ? "Share the public registration form to start collecting sign-ups."
                    : "Link a WebForm on Edit to enable public sign-up, or import a CSV.",
            }}
          />
        </div>
        {filteredRegs.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            {search || regStatusFilter !== "all" ? "No matching registrations" : "No registrations yet"}
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {filteredRegs.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink truncate">{r.name ?? r.email}</div>
                    <div className="text-xs text-ink-muted truncate">
                      {r.email}
                      {r.mobile && ` · ${r.mobile}`}
                    </div>
                  </div>
                  <span className="text-xs text-ink-muted rounded bg-surface-sunken px-2 py-0.5">
                    {r.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Drawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import registrations"
        width="w-[560px]"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setImportOpen(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={runImport}
              disabled={importing || !importText.trim()}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField
            label="Paste CSV"
            hint="First column = email, optional second column = name. Header row auto-detected. Duplicates (same email) are skipped silently."
          >
            <textarea
              className="input font-mono text-xs"
              rows={12}
              placeholder="email,name&#10;alice@example.com,Alice Kim&#10;bob@example.com,Bob Ray"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
          </FormField>
        </div>
      </Drawer>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Webinar" docId={params.id} />
      </div>
</main>
  );
}
