"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
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

interface WhatsappMessage {
  id: string;
  direction: string; // outbound | inbound
  toMobile: string;
  fromMobile: string | null;
  templateId: string | null;
  body: string;
  mediaUrl: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

type DirFilter = "all" | "outbound" | "inbound";
type StatusFilter =
  | "all"
  | "Pending"
  | "Sending"
  | "Sent"
  | "Delivered"
  | "Read"
  | "Failed";

// WhatsApp workflow badges — Read is the "green tick" milestone; Delivered
// is single-green; Sent is blue (single tick). Failed/rejected = red.
function WaStatus({ status }: { status: string }) {
  if (status === "Read") {
    return (
      <span className="badge-green inline-flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
          <path
            d="M2 10l4 4 6-8M8 14l4 4 6-11"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Read
      </span>
    );
  }
  if (status === "Delivered") return <span className="badge-green">Delivered</span>;
  if (status === "Sent") return <span className="badge-blue">Sent</span>;
  return <StatusBadge status={status} />;
}

function DirectionBadge({ dir }: { dir: string }) {
  if (dir === "inbound") {
    return (
      <span className="badge-brand inline-flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
          <path
            d="M15 5L5 15M5 15h7M5 15V8"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        In
      </span>
    );
  }
  return (
    <span className="badge-violet inline-flex items-center gap-1">
      <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
        <path
          d="M5 15L15 5M15 5H8M15 5v7"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Out
    </span>
  );
}

export default function WhatsappListPage() {
  const [rows, setRows] = useState<WhatsappMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<WhatsappMessage[]>("/whatsapp/messages");
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (/404|500|Request failed/.test(msg)) {
        setNotice(
          "WhatsApp service is not fully wired yet. Showing an empty list.",
        );
        setRows([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Whatsapp",
    plural: "Whatsapp",
    newHref: "/crm/whatsapp/new",
    refresh: load,
  });
  const counts = useMemo(
    () => ({
      all: rows.length,
      Pending: rows.filter((r) => r.status === "Pending").length,
      Sending: rows.filter((r) => r.status === "Sending").length,
      Sent: rows.filter((r) => r.status === "Sent").length,
      Delivered: rows.filter((r) => r.status === "Delivered").length,
      Read: rows.filter((r) => r.status === "Read").length,
      Failed: rows.filter((r) => r.status === "Failed").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (dirFilter !== "all" && r.direction !== dirFilter) return false;
      if (
        q &&
        !`${r.toMobile} ${r.fromMobile ?? ""} ${r.body}`
          .toLowerCase()
          .includes(q)
      )
        return false;
      return true;
    });
  }, [rows, statusFilter, dirFilter, search]);

  const columns: Column<WhatsappMessage>[] = [
    {
      header: "Dir",
      cell: (r) => <DirectionBadge dir={r.direction} />,
    },
    {
      header: "Contact",
      cell: (r) => (
        <span className="font-mono text-ink">
          {r.direction === "inbound" ? r.fromMobile ?? "—" : r.toMobile}
        </span>
      ),
    },
    {
      header: "Body / Template",
      cell: (r) => (
        <div className="flex flex-col">
          <span
            className="text-ink-soft truncate max-w-[380px]"
            title={r.body}
          >
            {r.body || (r.mediaUrl ? "[media]" : "—")}
          </span>
          {r.templateId && (
            <span className="text-[11px] text-ink-muted font-mono">
              tpl:{r.templateId.slice(0, 8)}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Status",
      cell: (r) => <WaStatus status={r.status} />,
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
      header: "Read",
      cell: (r) => (
        <span className="text-xs text-ink-muted tabular-nums">
          {relativeTime(r.readAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "WhatsApp" },
        ]}
        title="WhatsApp"
        subtitle={
          rows.length > 0
            ? `${rows.length} message${rows.length === 1 ? "" : "s"} · ${counts.Read} read · ${counts.Delivered} delivered`
            : undefined
        }
        actions={
          <>
            <a href="/crm/whatsapp/inbox">
              <Button variant="secondary" type="button">
                Inbox
              </Button>
            </a>
            <a href="/crm/whatsapp/templates">
              <Button variant="secondary" type="button">
                Templates
              </Button>
            </a>
            <a href="/crm/whatsapp/new">
              <Button variant="brand" type="button">
                + New message
              </Button>
            </a>
          </>
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
            placeholder: "Search mobile or body…",
          }}
          filters={
            <>
              <Segmented
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "Sent", label: "Sent", count: counts.Sent },
                  {
                    value: "Delivered",
                    label: "Delivered",
                    count: counts.Delivered,
                  },
                  { value: "Read", label: "Read", count: counts.Read },
                  { value: "Failed", label: "Failed", count: counts.Failed },
                ]}
              />
              <Segmented
                value={dirFilter}
                onChange={setDirFilter}
                options={[
                  { value: "all", label: "Both" },
                  { value: "outbound", label: "Sent" },
                  { value: "inbound", label: "Received" },
                ]}
              />
            </>
          }
          actions={<SavedViewsControls listKey="crm-web:whatsapp" current={{ search, statusFilter, dirFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); setDirFilter(fv.dirFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.megaphone,
            title:
              search || statusFilter !== "all" || dirFilter !== "all"
                ? "No matching messages"
                : "No WhatsApp messages yet",
            description:
              search || statusFilter !== "all" || dirFilter !== "all"
                ? "Try a different filter."
                : "Send a message from a Meta-approved template to start a conversation.",
            action:
              !search && statusFilter === "all" && dirFilter === "all" ? (
                <a href="/crm/whatsapp/new">
                  <Button variant="brand" type="button">
                    + New message
                  </Button>
                </a>
              ) : undefined,
          }}
        />
      </div>
    </>
  );
}
