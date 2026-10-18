"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import {
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

// SalesIQ Chat Inbox — the operator's live queue. Polls every 5s so new
// visitor chats surface without a manual refresh. Rows link into the
// conversation view.

interface ChatSessionVisitor {
  displayName: string | null;
  email: string | null;
  currentUrl: string | null;
  country: string | null;
}

interface ChatSession {
  id: string;
  visitorId: string;
  operatorUserId: string | null;
  status: "Open" | "Assigned" | "Closed" | "Bot";
  subject: string | null;
  startedAt: string;
  closedAt: string | null;
  unreadForOperator: number;
  visitor: ChatSessionVisitor;
  _count: { messages: number };
}

type StatusFilter = "all" | "Open" | "Assigned" | "Closed";

export default function ChatInboxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<ChatSession[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      setRows(await api.get<ChatSession[]>(`/siq/chat-sessions${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chats");
    }
  }, [filter]);

  // Poll every 5s so the inbox stays live. Refetches immediately whenever
  // the filter changes.
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useListPageCommands({
    singular: "Inbox",
    plural: "Inbox",
    refresh: load,
  });

  const counts = useMemo(() => {
    const c = { open: 0, assigned: 0, closed: 0, bot: 0 };
    for (const r of rows) {
      if (r.status === "Open") c.open++;
      else if (r.status === "Assigned") c.assigned++;
      else if (r.status === "Closed") c.closed++;
      else if (r.status === "Bot") c.bot++;
    }
    return c;
  }, [rows]);

  const columns: Column<ChatSession>[] = [
    {
      header: "Visitor",
      cell: (r) => (
        <span className="font-medium text-ink">
          {r.visitor?.displayName || "Anonymous"}
        </span>
      ),
    },
    {
      header: "Subject",
      cell: (r) => (
        <span className="text-sm text-ink-soft">{r.subject || "—"}</span>
      ),
    },
    {
      header: "Current URL",
      cell: (r) => (
        <span
          className="text-xs text-ink-muted truncate block max-w-[280px]"
          title={r.visitor?.currentUrl ?? ""}
        >
          {r.visitor?.currentUrl || "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "Unread",
      align: "center",
      cell: (r) =>
        r.unreadForOperator > 0 ? (
          <span className="badge-red">{r.unreadForOperator}</span>
        ) : (
          <span className="text-ink-muted/40">—</span>
        ),
    },
    {
      header: "Started",
      cell: (r) => (
        <span className="text-xs text-ink-muted">{dateShort(r.startedAt)}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Chat Inbox"
        subtitle={
          <span>
            {counts.open} open · {counts.assigned} assigned · {counts.closed} closed
          </span>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          filters={
            <Segmented<StatusFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "Open", label: "Open" },
                { value: "Assigned", label: "Assigned" },
                { value: "Closed", label: "Closed" },
              ]}
            />
          }
          actions={<SavedViewsControls listKey="crm-web:salesiq-inbox" current={{ filter }} onApply={(fv) => { setFilter(fv.filter); }} />}
        />

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/crm/salesiq/chats/${r.id}`)}
          empty={{
            icon: Icon.megaphone,
            title: "No chats in queue",
            description:
              "New visitor conversations will appear here in real time.",
          }}
        />
      </div>
    </>
  );
}
