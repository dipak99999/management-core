"use client";

import { useEffect, useState } from "react";
import {
  Card,
  EmptyState,
  FormField,
  PageHeader,
  Toast,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface Hit {
  partyType: "Customer" | "Supplier" | "Lead";
  id: string;
  label: string;
  email: string | null;
  mobile: string | null;
  href: string;
  status?: string;
}

function token(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return JSON.parse(raw).token as string;
  } catch {
    return "";
  }
}

function badgeClass(t: string) {
  return t === "Customer"
    ? "badge-blue"
    : t === "Supplier"
      ? "badge-violet"
      : "badge-amber";
}

export default function PartySearchPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(
          `${ACC}/party-search?q=${encodeURIComponent(q.trim())}`,
          {
            headers: { authorization: `Bearer ${token()}` },
            signal: ctrl.signal,
          },
        );
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        setHits(await r.json());
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed");
      } finally {
        setBusy(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "CRM", href: "/crm" },
          { label: "Party Search" },
        ]}
        title="Party Search"
        subtitle={
          busy
            ? "Searching…"
            : q.trim().length >= 2
              ? `${hits.length} match${hits.length === 1 ? "" : "es"} for "${q.trim()}"`
              : "Search Customers, Suppliers and Leads by name, email, mobile or GSTIN"
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="space-y-4">
        <Card className="p-4">
          <FormField label="Query">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type at least 2 characters…"
              className="input"
            />
          </FormField>
        </Card>

        <Card className="overflow-hidden">
          {hits.length > 0 && (
            <ul className="divide-y divide-ink-muted/10">
              {hits.map((h) => (
                <li key={`${h.partyType}-${h.id}`}>
                  <a
                    href={h.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-brand-50/50 transition"
                  >
                    <div className="w-24 shrink-0">
                      <span className={badgeClass(h.partyType)}>{h.partyType}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate">{h.label}</div>
                      <div className="text-xs text-ink-muted truncate">
                        {[h.email, h.mobile].filter(Boolean).join(" · ") || "—"}
                        {h.status ? ` · ${h.status}` : ""}
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {hits.length === 0 && !busy && q.trim().length >= 2 && (
            <EmptyState
              icon={Icon.users}
              title="No matches"
              description={`No customers, suppliers or leads matched "${q.trim()}".`}
            />
          )}
          {hits.length === 0 && q.trim().length < 2 && (
            <EmptyState
              icon={Icon.users}
              title="Start typing to search"
              description="Enter at least 2 characters to find parties across Customers, Suppliers and Leads."
            />
          )}
        </Card>
      </div>
    </>
  );
}
