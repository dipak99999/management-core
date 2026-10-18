"use client";

import { useCallback, useEffect, useState } from "react";

// Companies live in accounting-service — not hr-service. Cross-fetch via
// the shell proxy's /api/accounting/* rewrite so the picker works in HR
// regardless of which service owns the tenant Company table.
const COMPANIES_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL
    ? `${process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL}/companies`
    : "/api/accounting/companies";

function sessionToken(): string {
  if (typeof window === "undefined") return "";
  const raw = window.localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { token?: string }).token ?? "";
  } catch {
    return "";
  }
}

// Multi-company Phase 5 (shell): a shared company selector for reports.
// One `useCompanyScope()` hook + one `<CompanyScopePicker />` component,
// each report page opts in by dropping the picker into its toolbar and
// reading the selected id from the hook.
//
// Persistence: localStorage under a single key. Cross-tab consistency is
// handy — if you scope Trial Balance to Company AC, then click through
// to the General Ledger, it stays scoped to AC without re-picking.
//
// URL takes precedence: `?companyId=<id>` in the query string overrides
// the persisted choice, so shareable links work as expected. When the
// URL param clears, we fall back to the persisted choice again.

// Phase 8: shared across every app in the shell (buying-web, hr-web,
// stock-web) — same key, same origin, so localStorage lookup returns
// the same choice everywhere. Renamed from
// `lumaara.accounting.companyScope` — the accounting namespace was
// too narrow.
const STORAGE_KEY = "lumaara.companyScope";

export interface CompanyOption {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage disabled — silent */
  }
}

function readUrlParam(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search).get("companyId");
  return p && p.length > 0 ? p : null;
}

export function useCompanyScope(): {
  companyId: string | null;
  companies: CompanyOption[];
  loading: boolean;
  setCompanyId: (id: string | null) => void;
  // Returns a URL query fragment for scoped API calls, e.g. "?companyId=abc" or "".
  qs: string;
} {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  // Start at null so SSR and client first-paint match. Hydrate from URL /
  // localStorage inside useEffect (client-only phase) to avoid a mismatch.
  const [companyId, setCompanyIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hydrated = readUrlParam() ?? readStored();
    if (hydrated) setCompanyIdState(hydrated);
    const token = sessionToken();
    fetch(COMPANIES_URL, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? (r.json() as Promise<CompanyOption[]>) : []))
      .then((rows) => {
        setCompanies(rows);
        // If our persisted id no longer belongs to this tenant, drop it.
        if (hydrated && !rows.some((r) => r.id === hydrated)) {
          setCompanyIdState(null);
          writeStored(null);
        }
      })
      .catch(() => {
        // Shell proxy down or network blocked — degrade gracefully.
        setCompanies([]);
      })
      .finally(() => setLoading(false));
    // Intentionally run once on mount; changing companyId shouldn't
    // re-fetch the whole list.
     
  }, []);

  const setCompanyId = useCallback((id: string | null) => {
    setCompanyIdState(id);
    writeStored(id);
  }, []);

  return {
    companyId,
    companies,
    loading,
    setCompanyId,
    qs: companyId ? `?companyId=${encodeURIComponent(companyId)}` : "",
  };
}

// Compact selector — meant to sit in a report page's toolbar. When only
// one Company exists (single-tenant setup) we render nothing so the
// picker doesn't clutter reports for users who don't need it.
export function CompanyScopePicker() {
  const { companyId, companies, setCompanyId, loading } = useCompanyScope();
  if (loading) return null;
  if (companies.length <= 1) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
      <span className="text-xs uppercase tracking-wide text-ink-muted">Company</span>
      <select
        className="input h-8 py-0"
        value={companyId ?? ""}
        onChange={(e) => setCompanyId(e.target.value || null)}
      >
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.code}){c.isDefault ? " · default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
