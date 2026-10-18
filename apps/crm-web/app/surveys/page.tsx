"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  StatusBadge,
  Toast,
  dateShort,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

// Zoho-Survey style — the operator list for surveys. Detail-page /crm/surveys/[id]
// handles the actual question builder + analytics + responses. Public respondent
// URL is served by crm-service at /public/surveys/<slug>/render.

const CRM_SERVICE_URL =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

interface SurveyRow {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  description: string | null;
  thankYouMessage: string | null;
  isActive: boolean;
  closeAt: string | null;
  responseCap: number | null;
  responseCount: number;
  updatedAt: string;
  _count: { questions: number; responses: number };
}

type StatusFilter = "all" | "active" | "draft" | "closed";

interface FormState {
  name: string;
  publicSlug: string;
  title: string;
  description: string;
  isActive: boolean;
}

const emptyForm: FormState = {
  name: "",
  publicSlug: "",
  title: "",
  description: "",
  isActive: false,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/surveys/${slug}/render`;
}

// A survey is "closed" if it has an explicit closeAt in the past, or its
// response cap has been reached. Otherwise Active/Draft depend on isActive.
function surveyStatus(s: SurveyRow): "Active" | "Draft" | "Closed" {
  if (s.closeAt && new Date(s.closeAt).getTime() < Date.now()) return "Closed";
  if (s.responseCap != null && s.responseCount >= s.responseCap) return "Closed";
  return s.isActive ? "Active" : "Draft";
}

export default function SurveysPage() {
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<SurveyRow[]>("/surveys"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Survey",
    plural: "Surveys",
    refresh: load,
  });
  function close() {
    setForm(emptyForm);
    setSlugTouched(false);
    setShowForm(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        publicSlug: form.publicSlug || slugify(form.name),
        title: form.title || form.name,
        description: form.description || undefined,
        isActive: form.isActive,
      };
      const created = await api.post<{ id: string }>("/surveys", body);
      close();
      // Detail page is where questions get built, so bounce straight there.
      window.location.href = `/crm/surveys/${created.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function copySlug(slug: string, ev: React.MouseEvent) {
    ev.stopPropagation();
    try {
      await navigator.clipboard.writeText(publicUrl(slug));
      setToast({ kind: "success", message: "Copied public URL" });
    } catch {
      setToast({ kind: "error", message: "Copy failed" });
    }
  }

  // "Responses this month" — cheap client-side compute from the list. We use
  // updatedAt as a proxy for last activity; the responseCount is a lifetime
  // total. In production this would be a dedicated summary endpoint.
  const subtitleText = useMemo(() => {
    if (rows.length === 0) {
      return "Collect NPS, CSAT and structured feedback with hosted survey pages.";
    }
    const totalResponses = rows.reduce((n, r) => n + r.responseCount, 0);
    return `${rows.length} survey${rows.length === 1 ? "" : "s"} · ${totalResponses} total response${totalResponses === 1 ? "" : "s"}`;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = surveyStatus(r);
      if (statusFilter === "active" && st !== "Active") return false;
      if (statusFilter === "draft" && st !== "Draft") return false;
      if (statusFilter === "closed" && st !== "Closed") return false;
      if (
        q &&
        !`${r.name} ${r.title ?? ""} ${r.publicSlug}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, draft: 0, closed: 0 };
    for (const r of rows) {
      const st = surveyStatus(r);
      if (st === "Active") c.active++;
      else if (st === "Draft") c.draft++;
      else c.closed++;
    }
    return c;
  }, [rows]);

  const columns: Column<SurveyRow>[] = [
    {
      header: "Name",
      cell: (s) => (
        <div className="flex flex-col">
          <a
            href={`/crm/surveys/${s.id}`}
            className="font-medium text-ink hover:text-brand-700"
            onClick={(e) => e.stopPropagation()}
          >
            {s.name}
          </a>
          {s.title && s.title !== s.name && (
            <span className="text-[11px] text-ink-muted truncate max-w-[320px]">
              {s.title}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Slug",
      cell: (s) => (
        <div className="flex items-center gap-1">
          <code className="font-mono text-xs text-ink-soft">{s.publicSlug}</code>
          <button
            onClick={(e) => copySlug(s.publicSlug, e)}
            className="p-1 rounded hover:bg-brand-50 text-ink-muted hover:text-brand-700"
            title="Copy public URL"
            aria-label="Copy public URL"
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <rect x="6" y="6" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M4 14V4a1 1 0 0 1 1-1h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ),
    },
    {
      header: "Questions",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums text-ink-soft">{s._count?.questions ?? 0}</span>
      ),
    },
    {
      header: "Responses",
      align: "right",
      cell: (s) => (
        <span className="tabular-nums font-medium text-ink">
          {s.responseCount ?? s._count?.responses ?? 0}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (s) => <StatusBadge status={surveyStatus(s)} />,
    },
    {
      header: "Updated",
      cell: (s) => (
        <span className="text-xs text-ink-muted">{dateShort(s.updatedAt)}</span>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-2">
          <a
            href={publicUrl(s.publicSlug)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="btn-ghost btn-sm"
          >
            Preview
          </a>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Surveys"
        subtitle={subtitleText}
        actions={
          <Button variant="brand" onClick={() => setShowForm(true)}>
            + New Survey
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
            placeholder: "Search survey name, title or slug…",
          }}
          filters={
            <Segmented<StatusFilter>
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "active", label: "Active", count: counts.active },
                { value: "draft", label: "Draft", count: counts.draft },
                { value: "closed", label: "Closed", count: counts.closed },
              ]}
        />
          }
          actions={<SavedViewsControls listKey="crm-web:surveys" current={{ search, statusFilter }} onApply={(fv) => { setSearch(fv.search); setStatusFilter(fv.statusFilter); }} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(s) => s.id}
          onRowClick={(s) => (window.location.href = `/crm/surveys/${s.id}`)}
          loading={loading}
          empty={{
            icon: Icon.clipboard,
            title:
              search || statusFilter !== "all"
                ? "No matching surveys"
                : "No surveys yet",
            description:
              search || statusFilter !== "all"
                ? "Try changing your search or filter."
                : "Create your first survey to start collecting feedback.",
            action: !search && statusFilter === "all" && (
              <Button variant="brand" onClick={() => setShowForm(true)}>
                + New Survey
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={close}
        width="w-[560px]"
        title="New survey"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={(e) => save(e as unknown as React.FormEvent)}
              disabled={busy || !form.name.trim()}
            >
              {busy ? "Creating…" : "Create survey"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-5">
          <FormField label="Internal name" required>
            <input
              required
              className="input"
              placeholder="Customer satisfaction Q4"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  publicSlug: slugTouched ? f.publicSlug : slugify(name),
                  title: f.title || name,
                }));
              }}
              autoFocus
            />
          </FormField>
          <FormField
            label="Public slug"
            required
            hint={`Renders at ${publicUrl(form.publicSlug || "…")}`}
          >
            <input
              required
              className="input font-mono text-xs"
              placeholder="q4-csat"
              value={form.publicSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm({ ...form, publicSlug: slugify(e.target.value) });
              }}
            />
          </FormField>
          <FormField label="Public title" required>
            <input
              required
              className="input"
              placeholder="How was your experience?"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </FormField>
          <FormField label="Description" hint="Optional sub-heading shown above the questions.">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField label="Publish immediately">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span className="text-sm text-ink-soft">
                {form.isActive
                  ? "Live — public URL will accept responses"
                  : "Draft — you can add questions before going live"}
              </span>
            </label>
          </FormField>
          <p className="text-[11px] text-ink-muted">
            You&apos;ll be taken to the builder after creation to add questions.
          </p>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}
