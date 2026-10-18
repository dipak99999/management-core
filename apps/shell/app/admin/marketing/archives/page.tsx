"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { AppShell, Icon } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Toast,
  dateShort,
  type Column,
} from "../../../../components/ui";

// Public archives — the subset of campaigns where `archiveEnabled=true`.
// The archive is served publicly at /a/<slug> on crm-service. This page lists
// every published archive and lets admins copy the URL or unpublish.

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";
const PUBLIC_BASE =
  process.env.NEXT_PUBLIC_CRM_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ??
  "/api/crm";

function crmToken(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}
async function crmReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${crmToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && crmToken()) {
    try {
      localStorage.removeItem("lumaara.session");
    } catch {
      /* ignore */
    }
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      window.location.href = "/login";
    }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Request failed (${res.status})`,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
const crm = {
  get: <T,>(p: string) => crmReq<T>(p),
  post: <T,>(p: string, body: unknown) =>
    crmReq<T>(p, { method: "POST", body: JSON.stringify(body) }),
};

interface Campaign {
  id: string;
  name: string;
  status: string;
  archiveEnabled: boolean;
  archiveSlug: string | null;
  sentAt: string | null;
  totalOpened: number;
}

interface TrackingEvent {
  id: string;
  campaignId: string | null;
}

// Try to derive a simple view count per campaign from TrackingEvent (Open
// events). Not exact — an archive-page-open doesn't currently create a
// TrackingEvent — but it's the closest proxy until Agent E ships a real
// counter.
function useArchiveViews(archiveCampaignIds: string[]) {
  const [viewsByCampaign, setViews] = useState<Record<string, number>>({});
  // Extract the string key so the dep expression is statically analysable;
  // the effect refires only when the set of ids changes (join'd into a
  // single string), not on every parent render.
  const idsKey = archiveCampaignIds.join(",");
  useEffect(() => {
    if (archiveCampaignIds.length === 0) return;
    // Auth-service is behind the shell api client base URL — we call it
    // directly here so this file stays self-contained.
    const AUTH =
      process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
    fetch(`${AUTH}/email/track/events?type=Open&limit=500`, {
      headers: { authorization: `Bearer ${crmToken()}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TrackingEvent[]) => {
        const counts: Record<string, number> = {};
        for (const e of rows) {
          if (e.campaignId) counts[e.campaignId] = (counts[e.campaignId] ?? 0) + 1;
        }
        setViews(counts);
      })
      .catch(() => {
        /* leave empty — table just shows — */
      });
    // archiveCampaignIds is covered via `idsKey`; adding the array itself
    // would re-fire on every parent render (new array reference).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);
  return viewsByCampaign;
}

export default function ArchivesPage() {
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<
    { kind: "info" | "success" | "error"; message: string } | null
  >(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await crm.get<Campaign[]>("/campaigns");
      setRows(all.filter((c) => c.archiveEnabled === true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load archives");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useListPageCommands({
    singular: "Archive",
    plural: "Archives",
    refresh: load,
  });


  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.archiveSlug ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const views = useArchiveViews(rows.map((r) => r.id));

  function publicUrl(slug: string | null): string {
    if (!slug) return "";
    return `${PUBLIC_BASE.replace(/\/+$/, "")}/a/${slug}`;
  }

  async function copyUrl(row: Campaign) {
    const url = publicUrl(row.archiveSlug);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setToast({ kind: "success", message: "Public URL copied" });
    } catch {
      setToast({ kind: "info", message: url });
    }
  }

  async function unpublish(row: Campaign) {
    if (
      !confirm(
        `Unpublish "${row.name}"? The public URL will 404 until you republish.`,
      )
    ) {
      return;
    }
    try {
      await crm.post(`/campaigns/${row.id}/archive-unpublish`, {});
      setToast({ kind: "info", message: "Archive unpublished" });
      await load();
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to unpublish",
      });
    }
  }

  const columns: Column<Campaign>[] = [
    {
      header: "Campaign",
      cell: (r) => (
        <a
          href={`/crm/campaigns/${r.id}`}
          className="font-medium text-ink hover:text-brand-700"
        >
          {r.name}
        </a>
      ),
    },
    {
      header: "Slug",
      cell: (r) =>
        r.archiveSlug ? (
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs text-ink-soft bg-surface-sunken px-1.5 py-0.5 rounded">
              /{r.archiveSlug}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyUrl(r)}
              title="Copy public URL"
            >
              Copy URL
            </Button>
          </div>
        ) : (
          <span className="text-ink-muted text-xs">—</span>
        ),
    },
    {
      header: "Views",
      align: "right",
      cell: (r) => (
        <span
          className="tabular-nums text-ink-soft"
          title="Approximation based on Open TrackingEvent count for this campaign"
        >
          {(views[r.id] ?? 0).toLocaleString()}
        </span>
      ),
    },
    {
      header: "Published",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.sentAt ? dateShort(r.sentAt) : "—"}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-2 justify-end">
          {r.archiveSlug && (
            <a
              href={publicUrl(r.archiveSlug)}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Button variant="secondary" size="sm">
                Open
              </Button>
            </a>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => unpublish(r)}
            className="text-red-600 hover:text-red-700"
          >
            Unpublish
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Public archives"
        subtitle={`${rows.length.toLocaleString()} campaign${rows.length === 1 ? "" : "s"} published to a public URL.`}
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing", href: "/admin/marketing" },
          { label: "Archives" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            <Button variant="secondary" onClick={() => load()}>
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast
            kind="error"
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search name / slug…",
          }}
          actions={<SavedViewsControls listKey="shell:admin-marketing-archives" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.megaphone,
            title: "No published archives",
            description:
              "Open a Sent campaign and use the Publish archive action to give it a public URL.",
          }}
        />
      </div>
    </AppShell>
  );
}
