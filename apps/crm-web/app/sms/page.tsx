"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { smsApi } from "../../lib/sms-api";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  relativeTime,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface SmsMessage {
  id: string;
  toMobile: string;
  body: string;
  status: string;
  attempts: number;
  lastError: string | null;
  templateId: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  providerMessageId: string | null;
  providerName: string | null;
  createdAt: string;
}
interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

type StatusFilter =
  | "all"
  | "Pending"
  | "Sending"
  | "Sent"
  | "Delivered"
  | "Failed"
  | "Undelivered";

// Provider badge — a color code per provider so the operator can spot which
// vendor a batch went through at a glance (Twilio charges differently than
// MSG91). "test" = fake-mode logger; grey it out.
function ProviderBadge({ provider }: { provider: string | null }) {
  if (!provider) return <span className="badge-gray">—</span>;
  const p = provider.toLowerCase();
  const cls =
    p === "twilio"
      ? "badge-blue"
      : p === "msg91"
        ? "badge-violet"
        : p === "plivo"
          ? "badge-amber"
          : "badge-gray";
  return <span className={cls}>{provider}</span>;
}

export default function SmsListPage() {
  const [rows, setRows] = useState<SmsMessage[]>([]);
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [msgs, tpls] = await Promise.all([
        smsApi.get<SmsMessage[]>("/sms").catch((e) => {
          // 404/500 = backend not wired yet; render empty state instead of
          // stranding the user. See task brief.
          if (
            e instanceof Error &&
            /404|500|Request failed/.test(e.message)
          ) {
            setNotice(
              "SMS service is not available right now. Showing an empty list.",
            );
            return [] as SmsMessage[];
          }
          throw e;
        }),
        smsApi.get<SmsTemplate[]>("/sms-templates").catch(() => []),
      ]);
      setRows(msgs);
      setTemplates(tpls);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SMS messages");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Sm",
    plural: "Sms",
    newHref: "/crm/sms/new",
    refresh: load,
  });
  async function retry(row: SmsMessage) {
    try {
      await smsApi.post<SmsMessage>("/sms/send", {
        toMobile: row.toMobile,
        body: row.body,
      });
      setNotice("Message re-queued for delivery.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      Pending: rows.filter((r) => r.status === "Pending").length,
      Sending: rows.filter((r) => r.status === "Sending").length,
      Sent: rows.filter((r) => r.status === "Sent").length,
      Delivered: rows.filter((r) => r.status === "Delivered").length,
      Failed: rows.filter((r) => r.status === "Failed").length,
      Undelivered: rows.filter((r) => r.status === "Undelivered").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (templateFilter !== "all" && r.templateId !== templateFilter)
        return false;
      if (q && !`${r.toMobile} ${r.body}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, statusFilter, templateFilter, search]);

  const columns: Column<SmsMessage>[] = [
    {
      header: "To",
      cell: (r) => (
        <span className="font-mono text-ink">{r.toMobile}</span>
      ),
    },
    {
      header: "Body",
      cell: (r) => (
        <span
          className="text-ink-soft truncate inline-block max-w-[420px] align-middle"
          title={r.body}
        >
          {r.body}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "Provider",
      cell: (r) => <ProviderBadge provider={r.providerName} />,
    },
    {
      header: "Sent",
      cell: (r) => (
        <span className="text-xs text-ink-muted tabular-nums">
          {relativeTime(r.sentAt)}
        </span>
      ),
    },
    {
      header: "Delivered",
      cell: (r) => (
        <span className="text-xs text-ink-muted tabular-nums">
          {relativeTime(r.deliveredAt)}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) =>
        r.status === "Failed" || r.status === "Undelivered" ? (
          <button
            className="btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              void retry(r);
            }}
            title={r.lastError ?? undefined}
          >
            Retry
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "SMS" },
        ]}
        title="SMS"
        subtitle={
          rows.length > 0
            ? `${rows.length} message${rows.length === 1 ? "" : "s"} · ${counts.Delivered} delivered · ${counts.Failed + counts.Undelivered} failed`
            : undefined
        }
        actions={
          <a href="/crm/sms/new">
            <Button variant="brand" type="button">
              + New SMS
            </Button>
          </a>
        }
      />

      {notice && (
        <div className="mb-4">
          <Toast
            kind="info"
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search mobile number or body…",
          }}
          filters={
            <>
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "Pending", label: "Pending", count: counts.Pending },
                  { value: "Sending", label: "Sending", count: counts.Sending },
                  { value: "Sent", label: "Sent", count: counts.Sent },
                  {
                    value: "Delivered",
                    label: "Delivered",
                    count: counts.Delivered,
                  },
                  { value: "Failed", label: "Failed", count: counts.Failed },
                  {
                    value: "Undelivered",
                    label: "Undelivered",
                    count: counts.Undelivered,
                  },
                ]}
              />
              <select
                className="input"
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value)}
                aria-label="Filter by template"
              >
                <option value="all">All templates</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          }
          actions={
            <>
              <a href="/crm/sms/templates">
                <Button variant="secondary" type="button">
                  Manage templates
                </Button>
              </a>
              <SavedViewsControls
                listKey="crm-web:sms"
                current={{ search, statusFilter }}
                onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }}
              />
            </>
          }
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.send,
            title:
              search || statusFilter !== "all" || templateFilter !== "all"
                ? "No matching messages"
                : "No SMS messages yet",
            description:
              search || statusFilter !== "all" || templateFilter !== "all"
                ? "Try changing the filter or search."
                : "Compose a message or wire in a provider to start sending.",
            action:
              !search &&
              statusFilter === "all" &&
              templateFilter === "all" ? (
                <a href="/crm/sms/new">
                  <Button variant="brand" type="button">
                    + New SMS
                  </Button>
                </a>
              ) : undefined,
          }}
        />
      </div>
    </>
  );
}
