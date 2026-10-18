"use client";

// Visitor detail — shows profile fields, recent page views, and any chat
// sessions the visitor has opened. Reached from the live visitors table.

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  PageHeader,
  StatusBadge,
  relativeTime,
} from "../../../../components/ui";

interface PageView {
  id: string;
  url: string;
  title: string | null;
  referrer: string | null;
  createdAt: string;
}
interface ChatSession {
  id: string;
  status: "Open" | "Pending" | "Closed";
  startedAt: string;
  endedAt: string | null;
}
interface Visitor {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  city: string | null;
  currentUrl: string | null;
  pageCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "Active" | "Idle" | "Chatting" | "Away";
  linkedLeadId: string | null;
  pageViews: PageView[];
  chatSessions: ChatSession[];
}

export default function VisitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setVisitor(await api.get<Visitor>(`/siq/visitors/${id}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load visitor");
      }
    })();
  }, [id]);

  if (error) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Live visitors", href: "/crm/salesiq/visitors" },
          ]}
          title="Visitor"
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50 mt-4">
          {error}
        </Card>
      </>
    );
  }
  if (!visitor) {
    return (
      <>
        <PageHeader
          breadcrumb={[
            { label: "CRM", href: "/crm" },
            { label: "Live visitors", href: "/crm/salesiq/visitors" },
          ]}
          title="Loading…"
        />
      </>
    );
  }

  const openChat = visitor.chatSessions.find((c) => c.status !== "Closed");

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Live visitors", href: "/crm/salesiq/visitors" },
          { label: visitor.displayName ?? "Visitor" },
        ]}
        title={visitor.displayName ?? "Anonymous visitor"}
        subtitle={
          <span className="flex items-center gap-2 text-sm text-ink-muted">
            <StatusBadge status={visitor.status} />
            <span>· {visitor.pageCount} page views</span>
            <span>· First seen {relativeTime(visitor.firstSeenAt)}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {openChat ? (
              <Button
                variant="brand"
                onClick={() => router.push(`/crm/salesiq/chats/${openChat.id}`)}
              >
                Open chat
              </Button>
            ) : null}
            {visitor.linkedLeadId ? (
              <Button
                variant="secondary"
                onClick={() => router.push(`/crm/leads/${visitor.linkedLeadId}`)}
              >
                Lead
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-1">
          <CardHeader title="Profile" />
          <dl className="divide-y divide-ink-outline">
            <Row label="Email"    value={visitor.email ?? "—"} />
            <Row label="Phone"    value={visitor.phone ?? "—"} />
            <Row label="IP"       value={visitor.ipAddress ?? "—"} mono />
            <Row label="Location" value={[visitor.city, visitor.country].filter(Boolean).join(", ") || "—"} />
            <Row label="Current URL" value={visitor.currentUrl ?? "—"} mono truncate />
            <Row label="User agent"  value={visitor.userAgent ?? "—"} mono truncate />
            <Row label="First seen"  value={relativeTime(visitor.firstSeenAt)} />
            <Row label="Last seen"   value={relativeTime(visitor.lastSeenAt)} />
          </dl>
        </Card>

        <Card className="col-span-2">
          <CardHeader title={`Recent page views (${visitor.pageViews.length})`} />
          {visitor.pageViews.length === 0 ? (
            <div className="text-sm text-ink-muted py-8 text-center">No page views yet.</div>
          ) : (
            <ul className="divide-y divide-ink-outline text-sm">
              {visitor.pageViews.map((p) => (
                <li key={p.id} className="py-2">
                  <div className="font-medium truncate">{p.title ?? p.url}</div>
                  <div className="text-xs text-ink-muted truncate font-mono">{p.url}</div>
                  <div className="text-[11px] text-ink-muted mt-0.5">{relativeTime(p.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-3">
          <CardHeader title={`Chat history (${visitor.chatSessions.length})`} />
          {visitor.chatSessions.length === 0 ? (
            <div className="text-sm text-ink-muted py-8 text-center">
              No chat sessions with this visitor yet.
            </div>
          ) : (
            <ul className="divide-y divide-ink-outline text-sm">
              {visitor.chatSessions.map((c) => (
                <li key={c.id} className="py-2 flex items-center gap-3">
                  <StatusBadge status={c.status} />
                  <div className="flex-1 text-xs text-ink-muted">
                    Started {relativeTime(c.startedAt)}
                    {c.endedAt ? ` · ended ${relativeTime(c.endedAt)}` : ""}
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => router.push(`/crm/salesiq/chats/${c.id}`)}
                  >
                    Open →
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Visitor" docId={id} />
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="py-2 flex items-start gap-3 text-sm">
      <dt className="w-28 text-xs uppercase text-ink-muted tracking-wide pt-0.5">{label}</dt>
      <dd
        className={`flex-1 ${mono ? "font-mono text-xs" : ""} ${
          truncate ? "truncate" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
