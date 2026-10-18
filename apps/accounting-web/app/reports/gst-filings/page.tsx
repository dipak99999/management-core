"use client";

// GST filings dashboard — the single page from which India-compliance
// operators download the four government-schema payloads:
//   • GSTR-1  (outward supplies) — monthly
//   • GSTR-3B (summary + liability) — monthly
//   • GSTR-1 HSN summary — monthly
//   • GSTR-9  (annual return) — yearly
//
// Each report is fetched from /gst/<slug> and downloaded as JSON in the
// GSTN portal upload format. Date pickers default to the current fiscal
// month; the GSTR-9 button snaps the window to the current fiscal year.

import { useMemo, useState } from "react";
import { PageHeader, Card, Button, Toast } from "../../../components/ui";

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function token(): string {
  if (typeof window === "undefined") return "";
  try {
    return JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? "";
  } catch {
    return "";
  }
}

// Default period — first day of the current month → today. Matches how
// operators file at the end of each month.
function todayIso(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
function monthStart(d: Date = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}
// India FY runs Apr 1 → Mar 31 of the following year. Given today,
// return the (from, to) of the current fiscal year.
function currentFyRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const fyStartYear = m >= 4 ? y : y - 1;
  const from = new Date(Date.UTC(fyStartYear, 3, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(fyStartYear + 1, 2, 31))
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

async function fetchAndDownload(slug: string, from: string, to: string) {
  const r = await fetch(
    `${ACC}/gst/${slug}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { authorization: `Bearer ${token()}` } },
  );
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to fetch ${slug} (${r.status})`);
  }
  const data = await r.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}-${from}-to-${to}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return data;
}

interface PreviewShape {
  slug: string;
  data: unknown;
}

export default function GstFilingsPage() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIso());
  const [preview, setPreview] = useState<PreviewShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fyRange = useMemo(currentFyRange, []);

  async function run(slug: string, overrideRange?: { from: string; to: string }) {
    setError(null);
    setBusy(slug);
    try {
      const range = overrideRange ?? { from, to };
      const data = await fetchAndDownload(slug, range.from, range.to);
      setPreview({ slug, data });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="GST filings"
        subtitle="Download the four government-schema payloads for portal upload"
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Reports", href: "/accounting" },
          { label: "GST filings" },
        ]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card className="p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-ink-muted mb-1">From</label>
            <input
              type="date"
              className="input w-full"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">To</label>
            <input
              type="date"
              className="input w-full"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="col-span-2 flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom(monthStart());
                setTo(todayIso());
              }}
            >
              This month
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFrom(fyRange.from);
                setTo(fyRange.to);
              }}
            >
              Current FY
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FilingCard
          slug="gstr1"
          title="GSTR-1"
          subtitle="Outward supplies, per rate + B2B/B2C bucketed"
          cadence="Monthly"
          onDownload={() => run("gstr1")}
          busy={busy === "gstr1"}
        />
        <FilingCard
          slug="gstr3b"
          title="GSTR-3B"
          subtitle="Summary + net liability (outward tax − ITC)"
          cadence="Monthly"
          onDownload={() => run("gstr3b")}
          busy={busy === "gstr3b"}
        />
        <FilingCard
          slug="gstr1-hsn"
          title="GSTR-1 HSN summary"
          subtitle="One row per (HSN, UoM) with qty + taxable value"
          cadence="Monthly"
          onDownload={() => run("gstr1-hsn")}
          busy={busy === "gstr1-hsn"}
        />
        <FilingCard
          slug="gstr9"
          title="GSTR-9 (annual return)"
          subtitle={`Consolidates the FY (${fyRange.from} → ${fyRange.to})`}
          cadence="Yearly"
          onDownload={() => run("gstr9", fyRange)}
          busy={busy === "gstr9"}
        />
      </div>

      {preview && (
        <Card className="mt-6 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">
              {preview.slug} — preview
            </h3>
            <button
              onClick={() => setPreview(null)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <pre className="text-xs bg-surface-2 p-3 rounded overflow-x-auto max-h-96">
            {JSON.stringify(preview.data, null, 2)}
          </pre>
        </Card>
      )}
    </>
  );
}

function FilingCard({
  slug,
  title,
  subtitle,
  cadence,
  busy,
  onDownload,
}: {
  slug: string;
  title: string;
  subtitle: string;
  cadence: "Monthly" | "Yearly";
  busy: boolean;
  onDownload: () => void;
}) {
  void slug;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-ink-muted font-semibold">
            {cadence}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>
        </div>
        <Button onClick={onDownload} disabled={busy}>
          {busy ? "…" : "Download JSON"}
        </Button>
      </div>
    </Card>
  );
}
