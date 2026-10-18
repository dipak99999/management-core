"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Card, PageHeader, Toast } from "../../../components/ui";
import { api } from "../../../lib/api";

// Marketing hub — links out to each marketing surface + a headline stat per
// tile fetched from the backing service. Missing endpoints degrade to "—" so
// the page always renders (backend agents A/B/C may still be building routes).

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

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

// Small unauthenticated-friendly fetch. On 4xx/5xx we swallow + return null;
// the tile just shows "—". We do NOT reuse the crm-web api client here because
// that one hard-redirects on 401 and this page needs to stay put even if a
// service is briefly unreachable.
async function crmFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${CRM_BASE}${path}`, {
      headers: { authorization: `Bearer ${crmToken()}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

interface Tile {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  stat?: string;
}

interface Campaign {
  id: string;
  archiveEnabled?: boolean;
}

export default function MarketingHomePage() {
  const [suppressionCount, setSuppressionCount] = useState<number | null>(null);
  const [trackingCount, setTrackingCount] = useState<number | null>(null);
  const [mediaCount, setMediaCount] = useState<number | null>(null);
  const [archiveCount, setArchiveCount] = useState<number | null>(null);
  // P3: pending-approval count for the reviewer tile. Falls back to "—" when
  // the crm-service endpoint isn't reachable.
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Suppressions — auth-service (per shell api client base URL).
    api
      .get<{ total: number } | unknown[]>("/suppressions?limit=1")
      .then((r) => {
        if (Array.isArray(r)) setSuppressionCount(r.length);
        else if (r && typeof r === "object" && "total" in r)
          setSuppressionCount(Number((r as { total: number }).total));
      })
      .catch(() => setSuppressionCount(null));

    // Tracking events — auth-service /email/track/events returns an array.
    api
      .get<unknown[]>("/email/track/events?limit=100")
      .then((rows) => setTrackingCount(Array.isArray(rows) ? rows.length : 0))
      .catch(() => setTrackingCount(null));

    // Media — crm-service /media returns { items: [...] } or array.
    crmFetch<{ items?: unknown[] } | unknown[]>("/media?limit=1").then((r) => {
      if (Array.isArray(r)) setMediaCount(r.length);
      else if (r && Array.isArray(r.items)) setMediaCount(r.items.length);
      else setMediaCount(null);
    });

    // Archives — crm-service /campaigns then filter archiveEnabled.
    crmFetch<Campaign[]>("/campaigns").then((rows) => {
      if (!rows) return setArchiveCount(null);
      setArchiveCount(rows.filter((c) => c.archiveEnabled === true).length);
    });

    // P3: pending approval count for the "Approvals" tile.
    crmFetch<{ pending: number; approved: number; rejected: number; withdrawn: number }>(
      "/approvals/stats/summary",
    ).then((s) => {
      if (!s) return setPendingApprovals(null);
      setPendingApprovals(s.pending ?? 0);
    });
  }, []);

  const stat = (n: number | null, suffix: string, missing: string) =>
    n == null ? missing : `${n.toLocaleString()} ${suffix}`;

  const tiles: Tile[] = [
    {
      href: "/admin/marketing/suppressions",
      title: "Suppression list",
      icon: Icon.shield,
      description:
        "Emails blocked from receiving campaigns — hard bounces, complaints, manual entries, GDPR erasures.",
      stat: stat(suppressionCount, "addresses blocked", "Loading…"),
    },
    {
      href: "/admin/marketing/tracking-events",
      title: "Tracking events",
      icon: Icon.bar,
      description:
        "Per-open / per-click / per-bounce activity across all campaigns. Filter by type, campaign, or recipient.",
      stat: stat(trackingCount, "recent events", "Loading…"),
    },
    {
      href: "/admin/marketing/media-library",
      title: "Media library",
      icon: Icon.box,
      description:
        "Reusable images and files for email templates. Deduplicated per tenant by content hash.",
      stat: stat(mediaCount, "assets", "Coming soon"),
    },
    {
      href: "/admin/marketing/archives",
      title: "Public archives",
      icon: Icon.megaphone,
      description:
        "Published campaign copies at a public URL. Useful for sharing on social + linking from a newsletter footer.",
      stat: stat(archiveCount, "published", "Loading…"),
    },
    {
      href: "/admin/marketing/approvals",
      title: "Approvals",
      icon: Icon.shield,
      description:
        "Pending Campaign / Social / Broadcast sign-offs. Reviewers approve or reject; requesters get notified.",
      stat: stat(pendingApprovals, "pending", "Loading…"),
    },
    {
      href: "/admin/marketing/roi",
      title: "ROI dashboard",
      icon: Icon.bar,
      description:
        "Revenue attributed to each campaign, journey, web form, webinar, or social post. Last-touch / first-touch / linear models.",
    },
    {
      href: "/crm/campaigns",
      title: "Campaigns",
      icon: Icon.send,
      description:
        "Compose, schedule, and monitor email campaigns. Send-loop, real-time stats, per-recipient breakdown.",
    },
    {
      href: "/crm/contact-lists",
      title: "Contact lists",
      icon: Icon.users,
      description:
        "Static + dynamic contact lists that back campaigns and journeys. Import from CSV or build with the segment DSL.",
    },
    {
      href: "/admin/marketing/brand-kit",
      title: "Brand kit",
      icon: Icon.box,
      description:
        "Colours, fonts, logo, favicon, and footer HTML injected into every email your team sends.",
    },
    {
      href: "/admin/marketing/calendar",
      title: "Content calendar",
      icon: Icon.bar,
      description:
        "Unified view of notes, campaigns, broadcasts, social posts, WhatsApp messages, and webinars.",
    },
  ];

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Marketing"
        subtitle="Suppression list, tracking events, media library, public archives, and everything else that keeps sends deliverable."
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing" },
        ]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <a
            key={t.href}
            href={t.href}
            className="card p-5 hover:shadow-brand-glow transition"
          >
            <div className="flex items-center gap-2 text-brand-600 mb-2">
              <span className="w-4 h-4 grid place-items-center">{t.icon}</span>
              <div className="text-base font-semibold text-ink">{t.title}</div>
            </div>
            <div className="text-sm text-ink-soft">{t.description}</div>
            {t.stat && (
              <div className="mt-3 text-xs text-ink-muted tabular-nums">
                {t.stat}
              </div>
            )}
          </a>
        ))}
      </div>

      <Card className="p-4 mt-6 text-sm text-ink-soft">
        <div className="font-medium text-ink mb-1">Quick links</div>
        <div className="flex flex-wrap gap-3">
          <a
            href="/admin/broadcasts"
            className="text-brand-600 hover:text-brand-700"
          >
            Broadcasts
          </a>
          <span className="text-ink-muted">·</span>
          <a
            href="/admin/email-templates"
            className="text-brand-600 hover:text-brand-700"
          >
            Email templates
          </a>
          <span className="text-ink-muted">·</span>
          <a
            href="/admin/webhooks"
            className="text-brand-600 hover:text-brand-700"
          >
            Inbound webhooks
          </a>
        </div>
      </Card>
    </AppShell>
  );
}
