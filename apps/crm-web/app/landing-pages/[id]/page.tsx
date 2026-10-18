"use client";

import { useEffect, useState } from "react";
import { DocActivityPanel } from "@lumaara/web-ui";
import { useParams } from "next/navigation";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  CardHeader,
  Field,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";

// Simple detail page for a Landing Page: stats + live iframe preview if
// published, plus edit/delete actions.

const CRM_SERVICE_URL =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

interface LandingPage {
  id: string;
  name: string;
  publicSlug: string;
  title: string;
  description: string | null;
  bodyHtml: string;
  headHtml: string | null;
  isPublished: boolean;
  linkedWebFormId: string | null;
  viewCount: number;
  conversionCount: number;
  updatedAt: string;
}
interface WebFormRef {
  id: string;
  name: string;
}

function publicUrl(slug: string): string {
  return `${CRM_SERVICE_URL}/public/pages/${slug}`;
}

export default function LandingPageDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [page, setPage] = useState<LandingPage | null>(null);
  const [webForms, setWebForms] = useState<WebFormRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      setPage(await api.get<LandingPage>(`/landing-pages/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    api.get<WebFormRef[]>("/web-forms").then(setWebForms).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function togglePublished() {
    if (!page) return;
    try {
      await api.put(`/landing-pages/${id}`, {
        name: page.name,
        publicSlug: page.publicSlug,
        title: page.title,
        description: page.description ?? undefined,
        bodyHtml: page.bodyHtml,
        headHtml: page.headHtml ?? undefined,
        linkedWebFormId: page.linkedWebFormId ?? undefined,
        isPublished: !page.isPublished,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function removePage() {
    if (!confirm("Delete this landing page?")) return;
    try {
      await api.del(`/landing-pages/${id}`);
      window.location.href = "/crm/landing-pages";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "success", message: `Copied ${label}` });
    } catch {
      setToast({ kind: "error", message: "Copy failed" });
    }
  }

  if (!page && !loading) {
    return (
      <>
        {error && (
          <div className="mb-4">
            <Toast kind="error" message={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <a
          href="/crm/landing-pages"
          className="text-sm text-brand-600 hover:underline"
        >
          ← Back to pages
        </a>
      </>
    );
  }

  const conversionRate =
    page && page.viewCount > 0
      ? ((page.conversionCount / page.viewCount) * 100).toFixed(1) + "%"
      : "—";

  const linkedFormName = page?.linkedWebFormId
    ? webForms.find((w) => w.id === page.linkedWebFormId)?.name ?? page.linkedWebFormId
    : null;

  return (
    <>
      <PageHeader
        title={page?.name ?? "Loading…"}
        subtitle={
          page ? (
            <span>
              <code className="font-mono text-xs">{page.publicSlug}</code>
              {page.title && <> · {page.title}</>}
            </span>
          ) : undefined
        }
        breadcrumb={[
          { label: "Landing Pages", href: "/crm/landing-pages" },
          { label: page?.name ?? "…" },
        ]}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => history.back()}
              type="button"
            >
              ← Back
            </Button>
            {page && (
            <>
              <span className="me-1">
                <StatusBadge status={page.isPublished ? "Active" : "Draft"} />
              </span>
              <a
                href={publicUrl(page.publicSlug)}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary btn-sm"
              >
                Preview
              </a>
              <Button variant="secondary" size="sm" onClick={togglePublished}>
                {page.isPublished ? "Unpublish" : "Publish"}
              </Button>
              <a
                href="/crm/landing-pages"
                onClick={(e) => {
                  // Reopen the edit drawer on the list page via query param
                  // would need extra plumbing — for MVP just send them back.
                  e.preventDefault();
                  window.location.href = `/crm/landing-pages?edit=${page.id}`;
                }}
                className="btn-secondary btn-sm"
              >
                Edit
              </a>
              <Button variant="danger" size="sm" onClick={removePage}>
                Delete
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
      {toast && (
        <div className="mb-4">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      {page && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Stats + info ─────────────────────────────────────── */}
          <div className="space-y-4">
            <Card className="p-4">
              <CardHeader title="Performance" />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                    Views
                  </div>
                  <div className="text-2xl font-semibold text-ink tabular-nums mt-1">
                    {(page.viewCount ?? 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                    Conversions
                  </div>
                  <div className="text-2xl font-semibold text-ink tabular-nums mt-1">
                    {(page.conversionCount ?? 0).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                    Rate
                  </div>
                  <div className="text-2xl font-semibold text-brand-700 tabular-nums mt-1">
                    {conversionRate}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <CardHeader title="Details" />
              <div className="space-y-3">
                <Field label="Title" value={page.title} />
                <Field label="Description" value={page.description} />
                <Field
                  label="Linked web form"
                  value={
                    linkedFormName ? (
                      <a
                        href={`/crm/web-forms/${page.linkedWebFormId}`}
                        className="text-brand-600 hover:underline"
                      >
                        {linkedFormName}
                      </a>
                    ) : (
                      "—"
                    )
                  }
                />
                <Field label="Updated" value={dateShort(page.updatedAt)} />
              </div>
              <div className="mt-4 pt-4 border-t border-ink-muted/10 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                  Public URL
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate font-mono text-xs bg-surface-sunken border border-ink-muted/10 rounded px-2 py-1">
                    {publicUrl(page.publicSlug)}
                  </code>
                  <button
                    onClick={() => copy(publicUrl(page.publicSlug), "URL")}
                    className="btn-secondary btn-sm shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* ── Preview ──────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <Card className="p-4">
              <CardHeader
                title="Live preview"
                subtitle={
                  page.isPublished
                    ? "Rendered from the public URL"
                    : "Publish to view the live rendering"
                }
              />
              {page.isPublished ? (
                <div className="rounded-lg border border-ink-muted/10 overflow-hidden bg-white">
                  <iframe
                    src={publicUrl(page.publicSlug)}
                    className="w-full"
                    style={{ height: "70vh", border: 0 }}
                    title={page.title || page.name}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-ink-muted/20 bg-surface-sunken p-10 text-center">
                  <div className="text-sm text-ink-soft mb-3">
                    Not published yet.
                  </div>
                  <div className="text-xs text-ink-muted mb-4">
                    Publish to make the page public and render it here.
                  </div>
                  <Button variant="brand" size="sm" onClick={togglePublished}>
                    Publish page
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-ink/10 bg-canvas p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <DocActivityPanel doctype="LandingPage" docId={params.id} />
      </div>
    </>
  );
}
