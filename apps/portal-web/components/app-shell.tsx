"use client";

import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost } from "./toast-host";

// Lumaara AppShell — Zoho-inspired chrome shared by every app.
//
// Layout:
//   ┌────────────────────────────────────────────────┐
//   │ TopBar (56px)  logo · app · search · profile   │
//   ├──────────┬─────────────────────────────────────┤
//   │ Sidebar  │  main content (page)                │
//   │ (240px)  │                                     │
//   │          │                                     │
//   └──────────┴─────────────────────────────────────┘
//
// Each app supplies its own module name + nav groups so the sidebar reflects
// where the user is. The top bar's app-switcher lets them jump between apps.

export interface NavLink {
  href: string;
  label: string;
  icon?: ReactNode;
  badge?: string | number;
}
export interface NavGroup {
  label?: string;
  links: NavLink[];
}

export interface AppShellProps {
  moduleName: string;      // "Accounting", "CRM", etc.
  moduleAccent?: string;   // Tailwind color class for the module dot
  nav: NavGroup[];
  children: ReactNode;
}

const APPS = [
  { key: "shell",      label: "Home",       href: "/",              accent: "bg-brand-500" },
  { key: "accounting", label: "Accounting", href: "/accounting",    accent: "bg-emerald-500" },
  { key: "buying",     label: "Buying",     href: "/buying",        accent: "bg-rose-500" },
  { key: "stock",      label: "Stock",      href: "/stock",         accent: "bg-amber-500" },
  { key: "crm",        label: "CRM",        href: "/crm",           accent: "bg-indigo-500" },
  { key: "hr",         label: "HR",         href: "/hr",            accent: "bg-teal-500" },
  { key: "projects",   label: "Projects",   href: "/projects",      accent: "bg-lime-500" },
];

// URLs bounce through the shell for cross-app navigation (localhost:3100 in
// dev, but "same origin" in prod). We just use relative hrefs.
function AppSwitcher({ moduleName }: { moduleName: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    if (open) {
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 ps-1 pe-2.5 py-1 rounded-lg hover:bg-brand-50 transition"
      >
        <span className="h-8 w-8 rounded-lg bg-brand-gradient shadow-brand-sm grid place-items-center text-white font-bold text-sm">
          L
        </span>
        <span className="font-semibold text-ink tracking-tight">Lumaara</span>
        <span className="text-ink-muted">·</span>
        <span className="text-sm text-ink-soft">{moduleName}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`text-ink-muted transition ${open ? "rotate-180" : ""}`}
        >
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute start-0 top-11 w-72 card shadow-brand-glow p-2 grid grid-cols-3 gap-1">
          {APPS.map((a) => (
            <a
              key={a.key}
              href={a.href}
              onClick={() => setOpen(false)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-lg hover:bg-brand-50 transition"
            >
              <span className={`h-9 w-9 rounded-lg ${a.accent} grid place-items-center text-white text-xs font-bold`}>
                {a.label.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-xs text-ink-soft">{a.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<{
    email?: string;
    tenant?: { name?: string };
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("lumaara.session");
    if (raw) {
      try { setSession(JSON.parse(raw)); } catch { /* silent */ }
    }
    const close = () => setOpen(false);
    if (open) {
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [open]);

  function signOut() {
    localStorage.removeItem("lumaara.session");
    window.location.href = "/";
  }

  const initials = (session?.email ?? "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pe-1 ps-2 py-1 rounded-lg hover:bg-brand-50 transition"
      >
        <div className="text-end leading-tight hidden sm:block">
          <div className="text-xs font-medium text-ink">{session?.tenant?.name ?? "—"}</div>
          <div className="text-[10px] text-ink-muted">{session?.email ?? ""}</div>
        </div>
        <span className="h-8 w-8 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold">
          {initials}
        </span>
      </button>
      {open && (
        <div className="absolute end-0 top-11 w-56 card shadow-brand-glow py-1 text-sm">
          <a href="/settings/api-tokens" className="block px-3 py-2 hover:bg-brand-50 text-ink-soft">API Tokens</a>
          <a href="/settings/two-factor" className="block px-3 py-2 hover:bg-brand-50 text-ink-soft">Two-Factor Auth</a>
          <a href="/settings/sessions"   className="block px-3 py-2 hover:bg-brand-50 text-ink-soft">Active Sessions</a>
          <a href="/settings/notifications" className="block px-3 py-2 hover:bg-brand-50 text-ink-soft">Notifications</a>
          <div className="border-t border-ink-muted/10 my-1" />
          <button onClick={signOut} className="w-full text-start px-3 py-2 hover:bg-red-50 text-red-600">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Cmd+K global search. Debounced POST to accounting-service `/global-search`
// which fans out parallel Prisma queries across 12 doctypes and returns a
// grouped response. Rendered as a floating dropdown positioned relative to
// the input. Auth = same JWT the rest of the shell uses (localStorage).
interface GsRow {
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}
interface GsGroup {
  doctype: string;
  label: string;
  url: string;
  results: GsRow[];
}
const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<GsGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Flatten groups → rows so arrow-key navigation is one-dimensional.
  const flatRows = useMemo(() => {
    const rows: GsRow[] = [];
    for (const g of groups) for (const r of g.results) rows.push(r);
    return rows;
  }, [groups]);

  // Cmd+K / Ctrl+K focus. Escape blurs + closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
      if (e.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-outside close.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("click", onClick);
      return () => document.removeEventListener("click", onClick);
    }
  }, [open]);

  // Debounced fetch. Cancels in-flight requests when the query changes.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const raw = typeof window !== "undefined"
          ? localStorage.getItem("lumaara.session")
          : null;
        const token = raw ? (JSON.parse(raw) as { token?: string }).token : null;
        const res = await fetch(`${ACCOUNTING_URL}/global-search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ q }),
          signal: ac.signal,
        });
        if (!res.ok) {
          setGroups([]);
          return;
        }
        const data = (await res.json()) as { groups: GsGroup[] };
        setGroups(data.groups ?? []);
        setActiveIdx(0);
      } catch {
        // Aborted or network error; keep last groups silently.
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  function go(url: string) {
    setOpen(false);
    setQuery("");
    window.location.href = url;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || flatRows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flatRows[activeIdx];
      if (row) go(row.url);
    }
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={wrapRef} className="relative hidden md:block">
      <div className="flex items-center gap-2 w-72 h-9 px-3 rounded-lg bg-surface-sunken border border-transparent hover:border-brand-200 focus-within:border-brand-300 transition">
        <svg width="14" height="14" viewBox="0 0 20 20" className="text-ink-muted">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.7" fill="none" />
          <path d="M14 14l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search customers, invoices, items…"
          className="bg-transparent outline-none text-sm flex-1 placeholder:text-ink-muted"
        />
        {loading ? (
          <span
            aria-label="Searching"
            className="w-3 h-3 rounded-full border-2 border-brand-300 border-t-transparent animate-spin"
          />
        ) : (
          <kbd className="text-[10px] text-ink-muted bg-white/60 border border-ink-muted/20 rounded px-1.5 py-0.5">
            ⌘K
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div className="absolute start-0 top-11 w-[420px] card shadow-brand-glow max-h-[70vh] overflow-y-auto z-50">
          {groups.length === 0 && !loading && (
            <div className="p-4 text-sm text-ink-muted text-center">
              No matches for &ldquo;{query.trim()}&rdquo;
            </div>
          )}
          {groups.length === 0 && loading && (
            <div className="p-4 text-sm text-ink-muted text-center">Searching…</div>
          )}
          {groups.map((g) => {
            // Rebuild running index for this group so we can highlight the
            // active row without threading indices through the render.
            let idx = 0;
            for (const gg of groups) {
              if (gg.doctype === g.doctype) break;
              idx += gg.results.length;
            }
            return (
              <div key={g.doctype} className="py-1">
                <div className="px-3 pt-2 pb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
                  <span>{g.label}</span>
                  <a
                    href={g.url}
                    onClick={() => setOpen(false)}
                    className="text-brand-600 hover:underline normal-case tracking-normal font-medium"
                  >
                    View all
                  </a>
                </div>
                {g.results.map((r, ri) => {
                  const gi = idx + ri;
                  const active = gi === activeIdx;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onMouseEnter={() => setActiveIdx(gi)}
                      onClick={() => go(r.url)}
                      className={`w-full text-start px-3 py-2 flex flex-col gap-0.5 transition ${
                        active ? "bg-brand-50" : "hover:bg-brand-50/60"
                      }`}
                    >
                      <span className="text-sm font-medium text-ink truncate">
                        {r.title}
                      </span>
                      {r.subtitle && (
                        <span className="text-xs text-ink-muted truncate">
                          {r.subtitle}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AppShell({ moduleName, nav, children }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  return (
    <div className="min-h-screen">
      <header className="app-topbar">
        <div className="h-full ps-3 pe-4 flex items-center justify-between gap-3">
          <AppSwitcher moduleName={moduleName} />
          <GlobalSearch />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (window.location.href = "/notifications")}
              className="p-2 rounded-lg hover:bg-brand-50 text-ink-muted hover:text-brand-700 transition"
              aria-label="Notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 3a6 6 0 0 0-6 6v4l-2 2v1h16v-1l-2-2V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <UserMenu />
          </div>
        </div>
        <div className="app-hairline" />
      </header>
      <aside className="app-sidebar">
        <nav className="p-3 pb-8">
          {nav.map((group, gi) => (
            <div key={gi}>
              {group.label && <div className="nav-group-label">{group.label}</div>}
              {group.links.map((l) => {
                const active =
                  pathname === l.href ||
                  (l.href !== "/" && pathname.startsWith(l.href + "/"));
                // Plain <a> so cross-app navigation always does a full page
                // load through the shell rewrites. Same-app clicks are still
                // fast because Next serves the RSC on arrival.
                return (
                  <a
                    key={l.href}
                    href={l.href}
                    className={active ? "nav-link-active" : "nav-link"}
                  >
                    {l.icon && <span className="w-4 h-4 grid place-items-center text-current">{l.icon}</span>}
                    <span className="flex-1 truncate">{l.label}</span>
                    {l.badge != null && (
                      <span className="badge-brand">{l.badge}</span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <main className="app-main">
        {/* Keying by pathname causes React to remount the wrapper on every
            navigation, retriggering the fade-in CSS animation. */}
        <div key={pathname} className="app-content animate-fade-in">
          {children}
        </div>
      </main>
      <ToastHost />
    </div>
  );
}

// Compact icon set — inline SVG, no external dep, ~20 icons cover 95% of nav
// use cases. Each is 14×14 and inherits currentColor.
export const Icon = {
  home: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M3 9l7-6 7 6v8a1 1 0 0 1-1 1h-4v-6H8v6H4a1 1 0 0 1-1-1V9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 15.5c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  invoice: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M4 3h9l3 3v11H4V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 3v3h3M7 9h6M7 12h6M7 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M2 3h2l2 10h10l2-7H5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="7" cy="16" r="1.3" fill="currentColor" />
      <circle cx="15" cy="16" r="1.3" fill="currentColor" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M10 2l7 4v8l-7 4-7-4V6l7-4zM3 6l7 4 7-4M10 10v8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  bar: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M4 15V9M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="0.5" fill="currentColor" />
    </svg>
  ),
  cash: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <rect x="2" y="5" width="16" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 5v10M15 5v10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  briefcase: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <rect x="3" y="6" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6V4h6v2M3 10h14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M4 3h6c1.5 0 2 1 2 2v11c0-1-.5-2-2-2H4V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 3h-6c-1.5 0-2 1-2 2v11c0-1 .5-2 2-2h6V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M4 10H2M18 10h-2M5 5l1.5 1.5M13.5 13.5L15 15M15 5l-1.5 1.5M6.5 13.5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <rect x="3" y="4" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M3 3h7l7 7-7 7-7-7V3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6.5" cy="6.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M2 8l8-5 8 5H2zM4 9v7h2V9M9 9v7h2V9M14 9v7h2V9M2 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M10 2l8 4-8 4-8-4 8-4zM2 10l8 4 8-4M2 14l8 4 8-4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  clipboard: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <rect x="4" y="4" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="2" width="6" height="3" rx="0.7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  megaphone: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M3 8v4h3l7 4V4L6 8H3zM16 6a5 5 0 0 1 0 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M18 2L2 9l7 2 2 7 7-16zM9 11L18 2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
};
