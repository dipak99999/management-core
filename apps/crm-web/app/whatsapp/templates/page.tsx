"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  FilterBar,
  PageHeader,
  Segmented,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

interface WhatsappTemplate {
  id: string;
  name: string;
  category: string; // MARKETING | UTILITY | AUTHENTICATION
  status: string; // PENDING | APPROVED | REJECTED | PAUSED
  language: string;
  headerType: string | null;
  headerText: string | null;
  bodyText: string;
  footerText: string | null;
  variables: string[] | null;
  wabaTemplateId: string | null;
  updatedAt: string;
  createdAt: string;
}

type StatusFilter = "all" | "PENDING" | "APPROVED" | "REJECTED" | "PAUSED";

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    APPROVED: "badge-green",
    PENDING: "badge-amber",
    REJECTED: "badge-red",
    PAUSED: "badge-gray",
  };
  return <span className={map[status] ?? "badge-gray"}>{status}</span>;
}

function CategoryPill({ category }: { category: string }) {
  const map: Record<string, string> = {
    MARKETING: "badge-violet",
    UTILITY: "badge-blue",
    AUTHENTICATION: "badge-brand",
  };
  return <span className={map[category] ?? "badge-gray"}>{category}</span>;
}

export default function WhatsappTemplatesPage() {
  const [rows, setRows] = useState<WhatsappTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<WhatsappTemplate[]>("/whatsapp/templates");
      setRows(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      if (/404|500|Request failed/.test(msg)) {
        setNotice(
          "WhatsApp template service is not wired yet. Showing an empty list.",
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
    singular: "Template",
    plural: "Templates",
    newHref: "/crm/whatsapp/templates/new",
    refresh: load,
  });
  async function syncFromMeta() {
    setSyncing(true);
    setError(null);
    try {
      await api.post("/whatsapp/templates/sync", {});
      setNotice("Sync from Meta complete.");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed";
      if (/404/.test(msg))
        setError("Sync endpoint not implemented yet.");
      else setError(msg);
    } finally {
      setSyncing(false);
    }
  }

  async function remove(t: WhatsappTemplate, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.del(`/whatsapp/templates/${t.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const counts = useMemo(
    () => ({
      all: rows.length,
      PENDING: rows.filter((r) => r.status === "PENDING").length,
      APPROVED: rows.filter((r) => r.status === "APPROVED").length,
      REJECTED: rows.filter((r) => r.status === "REJECTED").length,
      PAUSED: rows.filter((r) => r.status === "PAUSED").length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.name} ${r.bodyText}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const columns: Column<WhatsappTemplate>[] = [
    {
      header: "Name",
      cell: (t) => (
        <div className="flex flex-col">
          <span className="font-mono font-medium text-ink">{t.name}</span>
          {t.bodyText && (
            <span
              className="text-[11px] text-ink-muted truncate max-w-[320px]"
              title={t.bodyText}
            >
              {t.bodyText}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Category",
      cell: (t) => <CategoryPill category={t.category} />,
    },
    {
      header: "Status",
      cell: (t) => <StatusPill status={t.status} />,
    },
    {
      header: "Language",
      cell: (t) => <span className="text-xs text-ink-soft">{t.language}</span>,
    },
    {
      header: "Updated",
      cell: (t) => (
        <span className="text-xs text-ink-muted tabular-nums">
          {dateShort(t.updatedAt)}
        </span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (t) => (
        <button
          onClick={(e) => remove(t, e)}
          className="btn-ghost btn-sm text-red-600 hover:text-red-700"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "WhatsApp", href: "/crm/whatsapp" },
          { label: "Templates" },
        ]}
        title="WhatsApp Templates"
        subtitle="Meta-approved message templates. All marketing/utility messages must use one of these."
        actions={
          <>
            <Button
              variant="secondary"
              type="button"
              onClick={() => history.back()}
            >
              ← Back
            </Button>
            <Button
              variant="secondary"
              type="button"
              disabled={syncing}
              onClick={syncFromMeta}
            >
              {syncing ? "Syncing…" : "Sync from Meta"}
            </Button>
            <a href="/crm/whatsapp/templates/new">
              <Button variant="brand" type="button">
                + New template
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
            placeholder: "Search template name or body…",
          }}
          filters={
            <Segmented
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                {
                  value: "APPROVED",
                  label: "Approved",
                  count: counts.APPROVED,
                },
                { value: "PENDING", label: "Pending", count: counts.PENDING },
                {
                  value: "REJECTED",
                  label: "Rejected",
                  count: counts.REJECTED,
                },
                { value: "PAUSED", label: "Paused", count: counts.PAUSED },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:whatsapp-templates" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(t) => t.id}
          loading={loading}
          empty={{
            icon: Icon.book,
            title:
              search || statusFilter !== "all"
                ? "No matching templates"
                : "No WhatsApp templates yet",
            description:
              search || statusFilter !== "all"
                ? "Try a different filter."
                : "Create a template — Meta will review it and set the status to APPROVED before it can be used.",
            action:
              !search && statusFilter === "all" ? (
                <a href="/crm/whatsapp/templates/new">
                  <Button variant="brand" type="button">
                    + New template
                  </Button>
                </a>
              ) : undefined,
          }}
        />
      </div>
    </>
  );
}
