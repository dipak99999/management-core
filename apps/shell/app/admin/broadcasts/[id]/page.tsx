"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../../lib/api";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../../components/ui";

interface Broadcast {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience: string;
  status: string;
  recipientCount: number;
  sentAt: string | null;
}
interface Recipient {
  email: string;
  name: string;
}

export default function BroadcastDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Broadcast | null>(null);
  const [preview, setPreview] = useState<{ count: number; recipients: Recipient[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Broadcast>(`/broadcasts/${params.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function doPreview() {
    setBusy(true);
    try {
      setPreview(
        await api.get<{ count: number; recipients: Recipient[] }>(
          `/broadcasts/${params.id}/recipients`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (!confirm("Launch broadcast? This enqueues one email per recipient.")) return;
    setBusy(true);
    try {
      await api.post(`/broadcasts/${params.id}/launch`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm("Cancel draft broadcast?")) return;
    setBusy(true);
    try {
      await api.post(`/broadcasts/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const breadcrumb = [
    { label: "Admin", href: "/admin" },
    { label: "Broadcasts", href: "/admin/broadcasts" },
    { label: data?.name ?? "Broadcast" },
  ];

  if (error && !data) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader
          breadcrumb={breadcrumb}
          title="Broadcast"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell moduleName="Home" nav={SHELL_NAV}>
        <PageHeader breadcrumb={breadcrumb} title="Loading…" />
        <div className="space-y-3">
          <Skeleton className="h-20" rounded="rounded-lg" />
          <Skeleton className="h-40" rounded="rounded-lg" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={data.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            <span className="text-ink-muted">·</span>
            <span>Audience: {data.audience}</span>
            <span className="text-ink-muted">·</span>
            <span>{data.recipientCount} recipient{data.recipientCount === 1 ? "" : "s"}</span>
            {data.sentAt && (
              <>
                <span className="text-ink-muted">·</span>
                <span>Sent {dateShort(data.sentAt)}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {data.status === "Draft" && (
              <>
                <Button variant="secondary" onClick={doPreview} disabled={busy} type="button">
                  Preview recipients
                </Button>
                <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                  Cancel draft
                </Button>
                <Button variant="brand" onClick={launch} disabled={busy} type="button">
                  Launch
                </Button>
              </>
            )}
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-6 max-w-3xl">
        <Card className="p-4 space-y-3">
          <SectionHeader title="Email content" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
              Subject
            </div>
            <div className="text-sm font-medium text-ink mt-0.5">{data.subject}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1">
              Body
            </div>
            <div
              className="whitespace-pre-wrap border-t border-ink-muted/10 pt-2 max-h-96 overflow-y-auto text-sm text-ink"
              dangerouslySetInnerHTML={{ __html: data.body }}
            />
          </div>
        </Card>

        {preview && (
          <Card className="p-4">
            <SectionHeader
              title={`${preview.count} recipient${preview.count === 1 ? "" : "s"} (showing first ${preview.recipients.length})`}
            />
            <ul className="text-sm divide-y divide-ink-muted/10">
              {preview.recipients.map((r) => (
                <li key={r.email} className="py-1.5 flex justify-between">
                  <span className="text-ink">{r.name}</span>
                  <span className="text-ink-muted font-mono text-xs">{r.email}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    
      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="Broadcast" docId={params.id} />
      </div>
</AppShell>
  );
}
