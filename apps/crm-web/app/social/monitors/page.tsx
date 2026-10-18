"use client";

import { useCallback, useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FormField,
  PageHeader,
  Segmented,
  Toast,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import {
  PLATFORMS,
  PLATFORM_LABEL,
  PlatformDot,
  type Monitor,
  type MonitorType,
  type Platform,
} from "../_shared";

// Monitors — saved keyword/hashtag/mention searches that back the inbox.
// The "generate mock mention" row action is a demo affordance; it hits a
// backend seeder so the inbox has content to show during walkthroughs.

interface Draft {
  id?: string;
  name: string;
  type: MonitorType;
  query: string;
  platforms: Platform[];
  isActive: boolean;
}

const emptyDraft: Draft = {
  name: "",
  type: "Keyword",
  query: "",
  platforms: [],
  isActive: true,
};

const TYPE_BADGE: Record<MonitorType, string> = {
  Keyword: "badge-brand",
  Hashtag: "badge-blue",
  Mention: "badge-violet",
};

export default function MonitorsPage() {
  const [rows, setRows] = useState<Monitor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft });
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Monitor[]>("/social/monitors"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load monitors");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useListPageCommands({
    singular: "Monitor",
    plural: "Monitors",
    refresh: load,
  });

  function openNew() {
    setDraft({ ...emptyDraft });
    setShowEdit(true);
  }
  function openEdit(m: Monitor) {
    setDraft({
      id: m.id,
      name: m.name,
      type: m.type,
      query: m.query,
      platforms: m.platforms ?? [],
      isActive: m.isActive,
    });
    setShowEdit(true);
  }
  function close() {
    setShowEdit(false);
    setDraft({ ...emptyDraft });
  }

  async function save() {
    if (!draft.name.trim() || !draft.query.trim() || draft.platforms.length === 0) {
      setError("Name, query and at least one platform are required");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: draft.name.trim(),
        type: draft.type,
        query: draft.query.trim(),
        platforms: draft.platforms,
        isActive: draft.isActive,
      };
      if (draft.id) {
        await api.put(`/social/monitors/${draft.id}`, body);
      } else {
        await api.post("/social/monitors", body);
      }
      close();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save monitor");
    } finally {
      setBusy(false);
    }
  }

  async function del(m: Monitor) {
    if (!confirm(`Delete monitor "${m.name}"?`)) return;
    try {
      await api.del(`/social/monitors/${m.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function toggleActive(m: Monitor) {
    try {
      await api.put(`/social/monitors/${m.id}`, {
        name: m.name,
        type: m.type,
        query: m.query,
        platforms: m.platforms,
        isActive: !m.isActive,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  async function generateMock(m: Monitor) {
    try {
      await api.post(`/social/monitors/${m.id}/generate-mock-mention`, {});
      setToast(`Generated a mock mention for "${m.name}" — check the inbox`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate mention");
    }
  }

  function togglePlatform(p: Platform) {
    setDraft((d) => ({
      ...d,
      platforms: d.platforms.includes(p)
        ? d.platforms.filter((x) => x !== p)
        : [...d.platforms, p],
    }));
  }

  const columns: Column<Monitor>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: "Type",
      cell: (r) => <span className={TYPE_BADGE[r.type]}>{r.type}</span>,
    },
    {
      header: "Query",
      cell: (r) => (
        <code className="font-mono text-xs text-ink-soft bg-surface-sunken px-1.5 py-0.5 rounded">
          {r.query}
        </code>
      ),
    },
    {
      header: "Platforms",
      cell: (r) => (
        <div className="flex items-center gap-1">
          {(r.platforms ?? []).map((p) => (
            <PlatformDot key={p} platform={p} size={16} />
          ))}
        </div>
      ),
    },
    {
      header: "Active",
      align: "center",
      cell: (r) => (
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={r.isActive}
            onChange={() => toggleActive(r)}
          />
        </label>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button onClick={() => openEdit(r)} className="btn-ghost btn-sm">
            Edit
          </button>
          <button
            onClick={() => generateMock(r)}
            className="btn-ghost btn-sm text-brand-600"
            title="Create a random mock mention (for demos)"
          >
            + Mock mention
          </button>
          <button
            onClick={() => del(r)}
            className="btn-ghost btn-sm text-red-600"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Monitors"
        subtitle={
          <span>
            {rows.length} monitor{rows.length === 1 ? "" : "s"} ·{" "}
            {rows.filter((r) => r.isActive).length} active
          </span>
        }
        actions={
          <Button variant="brand" onClick={openNew}>
            + New Monitor
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast kind="success" message={toast} onDismiss={() => setToast(null)} />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={{
          icon: Icon.target,
          title: "No monitors yet",
          description:
            "Create a monitor to track keywords, hashtags or brand mentions across your connected channels.",
          action: (
            <Button variant="brand" onClick={openNew}>
              + New Monitor
            </Button>
          ),
        }}
      />

      <Drawer
        open={showEdit}
        onClose={close}
        title={draft.id ? "Edit monitor" : "New monitor"}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="brand" onClick={save} disabled={busy}>
              {busy ? "Saving…" : draft.id ? "Save" : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Name" required>
            <input
              className="input"
              placeholder="Brand mentions"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </FormField>

          <FormField label="Type" required>
            <Segmented<MonitorType>
              value={draft.type}
              onChange={(v) => setDraft({ ...draft, type: v })}
              options={[
                { value: "Keyword", label: "Keyword" },
                { value: "Hashtag", label: "Hashtag" },
                { value: "Mention", label: "Mention" },
              ]}
            />
          </FormField>

          <FormField
            label="Query"
            required
            hint={
              draft.type === "Hashtag"
                ? "e.g. #lumaara — leading # optional"
                : draft.type === "Mention"
                  ? "e.g. @lumaara or a display name"
                  : "e.g. lumaara CRM"
            }
          >
            <input
              className="input font-mono text-sm"
              value={draft.query}
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            />
          </FormField>

          <FormField label="Platforms" required>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const active = draft.platforms.includes(p);
                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-2 ps-1 pe-3 py-1 rounded-full border text-xs transition ${
                      active
                        ? "border-brand-500 bg-brand-50 text-brand-800"
                        : "border-ink-muted/20 bg-white text-ink-soft hover:border-brand-300"
                    }`}
                  >
                    <PlatformDot platform={p} size={18} />
                    {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
            </div>
          </FormField>

          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft({ ...draft, isActive: e.target.checked })
              }
            />
            Active — poll for matches
          </label>
        </div>
      </Drawer>
    </>
  );
}
