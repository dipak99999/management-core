"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { smsApi } from "../../../lib/sms-api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";

interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const empty = { name: "", body: "", enabled: true };

export default function SmsTemplatesPage() {
  const [rows, setRows] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await smsApi.get<SmsTemplate[]>("/sms-templates"));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load SMS templates",
      );
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
    refresh: load,
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await smsApi.post("/sms-templates", form);
      setForm(empty);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function remove(row: SmsTemplate, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (!confirm(`Delete template "${row.name}"?`)) return;
    try {
      await smsApi.del(`/sms-templates/${row.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.name} ${r.body}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: Column<SmsTemplate>[] = [
    {
      header: "Name",
      cell: (r) => <span className="font-medium text-ink">{r.name}</span>,
    },
    {
      header: "Body",
      cell: (r) => (
        <span
          className="text-ink-soft truncate inline-block max-w-[480px] align-middle"
          title={r.body}
        >
          {r.body}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) =>
        r.enabled ? (
          <span className="badge-green">Enabled</span>
        ) : (
          <span className="badge-gray">Disabled</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <button
          onClick={(e) => remove(r, e)}
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
          { label: "SMS", href: "/crm/sms" },
          { label: "Templates" },
        ]}
        title="SMS Templates"
        subtitle="Reusable message bodies with {{var}} placeholders."
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
              variant="brand"
              type="button"
              onClick={() => setShowForm(true)}
            >
              + New template
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

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search name or body…",
          }}
          actions={<SavedViewsControls listKey="crm-web:sms-templates" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: Icon.book,
            title: search ? "No matching templates" : "No SMS templates yet",
            description: search
              ? "Try a different search term."
              : "Create a template to reuse merge-tagged bodies across sends.",
            action: !search ? (
              <Button
                variant="brand"
                type="button"
                onClick={() => setShowForm(true)}
              >
                + New template
              </Button>
            ) : undefined,
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => {
          setForm(empty);
          setShowForm(false);
        }}
        title="New SMS template"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setForm(empty);
                setShowForm(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
            >
              Create template
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField
            label="Name"
            required
            hint="Short identifier — use letters, digits and underscores."
          >
            <input
              required
              className="input"
              placeholder="otp_login"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </FormField>
          <FormField
            label="Body"
            required
            hint="Supports {{var}} placeholders. Keep under 160 chars per segment."
          >
            <textarea
              required
              className="input"
              rows={6}
              placeholder="Hi {{name}}, your OTP is {{otp}}. It expires in 5 minutes."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={form.enabled}
              onChange={(e) =>
                setForm({ ...form, enabled: e.target.checked })
              }
            />
            <span>Enabled (available in composer + sequences)</span>
          </label>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
