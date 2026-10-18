"use client";

import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost } from "./toast-host";
import { submoduleForPath } from "@lumaara/shared-types";

// Lumaara AppShell — matched to the reference screenshots.
//
// Layout:
//   ┌──────────┬──────────────────────────────────────────────┐
//   │          │ TopBar (64px) search · credits · region · … │
//   │ LUMAARA  ├──────────────────────────────────────────────┤
//   │ sidebar  │                                              │
//   │ (240px)  │  page content                                │
//   │  groups  │                                              │
//   │  + LIVE  │                                              │
//   │ ▁▁▁▁▁▁▁▁ ├──────────────────────────────────────────────┤
//   │          │ BrewBar (56px)  Brew · Ask …   Online·Synced │
//   └──────────┴──────────────────────────────────────────────┘

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
  moduleName: string;
  moduleAccent?: string;
  nav: NavGroup[];
  children: ReactNode;
}

// ── Brand mark ─────────────────────────────────────────────────────────

function Wordmark() {
  return (
    <a href="/" className="flex items-center gap-2.5 ps-2 pe-3 py-4">
      {/* Six-petal gold flower */}
      <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
        <g fill="#C09040">
          <circle cx="16" cy="6" r="3" />
          <circle cx="24.66" cy="11" r="3" />
          <circle cx="24.66" cy="21" r="3" />
          <circle cx="16" cy="26" r="3" />
          <circle cx="7.34" cy="21" r="3" />
          <circle cx="7.34" cy="11" r="3" />
          <circle cx="16" cy="16" r="3.5" fill="#DDBB77" />
        </g>
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-wordmark text-[22px] text-ink">LUMAARA</span>
        <span className="text-[9px] tracking-[0.14em] text-ink-muted uppercase mt-0.5">
          powered by <span className="text-brew font-semibold">Brew AI</span>
        </span>
      </span>
    </a>
  );
}

// ── Top-bar controls ───────────────────────────────────────────────────

// Secondary chips in the topbar — "Unlimited credits", "ALL" scope.
// Hidden below `lg` (1024px) so the primary actions (search, mode toggle,
// notifications, user menu) stay on one row on 13" laptops.
function TopChip({ children, gold }: { children: ReactNode; gold?: boolean }) {
  return (
    <button className={`hidden lg:inline-flex ${gold ? "topbar-chip-gold" : "topbar-chip"}`}>
      {children}
    </button>
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
      try {
        setSession(JSON.parse(raw));
      } catch {
        /* silent */
      }
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

  // Pre-session (first paint before localStorage read), show a user glyph
  // instead of "?" which looks like a broken state.
  const initials = session?.email
    ? session.email.split("@")[0].slice(0, 2).toUpperCase()
    : null;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pe-1 ps-2 py-1 rounded-xl hover:bg-canvas-warm transition"
      >
        <div className="text-end leading-tight hidden sm:block">
          <div className="text-xs font-semibold text-ink">
            {session?.tenant?.name ?? "—"}
          </div>
          <div className="text-[10px] text-ink-muted">{session?.email ?? ""}</div>
        </div>
        <span className="h-9 w-9 rounded-full bg-ink text-gold-300 grid place-items-center text-xs font-bold">
          {initials ?? (
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="7" r="3.2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M4 17c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </span>
      </button>
      {open && (
        <div className="absolute end-0 top-12 w-56 card py-1 text-sm z-50">
          <a
            href="/settings/api-tokens"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            API Tokens
          </a>
          <a
            href="/settings/two-factor"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            Two-Factor Auth
          </a>
          <a
            href="/settings/sessions"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            Active Sessions
          </a>
          <a
            href="/settings/notifications"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            Notifications
          </a>
          <div className="border-t border-ink/8 my-1" />
          <button
            onClick={signOut}
            className="w-full text-start px-3 py-2 hover:bg-red-50 text-red-600"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Cmd+K global search — matches the reference top-bar search field.
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flatRows = useMemo(() => {
    const rows: GsRow[] = [];
    for (const g of groups) for (const r of g.results) rows.push(r);
    return rows;
  }, [groups]);

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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      setSearchError(null);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    setLoading(true);
    setSearchError(null);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const raw =
          typeof window !== "undefined"
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
          setSearchError(`Search failed (${res.status})`);
          return;
        }
        const data = (await res.json()) as { groups: GsGroup[] };
        setGroups(data.groups ?? []);
        setActiveIdx(0);
      } catch (err) {
        const aborted =
          (err instanceof DOMException && err.name === "AbortError") ||
          ac.signal.aborted;
        if (!aborted) {
          setGroups([]);
          setSearchError("Search unreachable — check your connection");
        }
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
      <div className="topbar-search">
        <svg width="16" height="16" viewBox="0 0 20 20" className="text-ink-muted">
          <circle
            cx="9"
            cy="9"
            r="6"
            stroke="currentColor"
            strokeWidth="1.7"
            fill="none"
          />
          <path
            d="M14 14l4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
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
          className="bg-transparent outline-none text-sm flex-1 placeholder:text-ink-faint"
        />
        {loading ? (
          <span
            aria-label="Searching"
            className="w-3.5 h-3.5 rounded-full border-2 border-gold-300 border-t-transparent animate-spin"
          />
        ) : (
          <kbd className="text-[10px] text-ink-muted bg-canvas-warm border border-ink/10 rounded px-1.5 py-0.5 font-medium">
            ⌘K
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div className="absolute start-0 top-12 w-[440px] card max-h-[70vh] overflow-y-auto z-50">
          {searchError && (
            <div className="p-3 text-sm text-red-700 border-b border-red-200 bg-red-50">
              {searchError}
            </div>
          )}
          {!searchError && groups.length === 0 && !loading && (
            <div className="p-4 text-sm text-ink-muted text-center">
              No matches for &ldquo;{query.trim()}&rdquo;
            </div>
          )}
          {groups.length === 0 && loading && (
            <div className="p-4 text-sm text-ink-muted text-center">
              Searching…
            </div>
          )}
          {groups.map((g) => {
            let idx = 0;
            for (const gg of groups) {
              if (gg.doctype === g.doctype) break;
              idx += gg.results.length;
            }
            return (
              <div key={g.doctype} className="py-1">
                <div className="px-3 pt-2 pb-1 flex items-center justify-between text-[11px] uppercase tracking-widest text-gold-700 font-semibold">
                  <span>{g.label}</span>
                  <a
                    href={g.url}
                    onClick={() => setOpen(false)}
                    className="text-ink hover:underline normal-case tracking-normal font-medium"
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
                        active ? "bg-canvas-warm" : "hover:bg-canvas-warm/60"
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

// ── Sidebar ────────────────────────────────────────────────────────────

function SidebarNav({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname() ?? "/";
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});

  function toggle(idx: number) {
    setOpenGroups((s) => ({ ...s, [idx]: !s[idx] }));
  }

  return (
    <nav className="space-y-1 pb-4">
      {nav.map((group, gi) => {
        const isOpen = openGroups[gi] !== false; // default open
        return (
          <div key={gi} className="nav-group">
            {group.label && (
              <button
                onClick={() => toggle(gi)}
                className="nav-group-label w-full text-start hover:text-gold-800 transition"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  className={`nav-group-caret transition-transform ${isOpen ? "" : "-rotate-90"}`}
                >
                  <path
                    d="M2 3.5l3 3 3-3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {group.label}
              </button>
            )}
            {isOpen &&
              group.links.map((l) => {
                const active =
                  pathname === l.href ||
                  (l.href !== "/" && pathname.startsWith(l.href + "/"));
                return (
                  <a
                    key={l.href}
                    href={l.href}
                    className={active ? "nav-link-active" : "nav-link"}
                  >
                    {l.icon && (
                      <span className="w-4 h-4 grid place-items-center text-current">
                        {l.icon}
                      </span>
                    )}
                    <span className="flex-1 truncate">{l.label}</span>
                    {l.badge != null && (
                      <span className="badge-gold ms-auto">{l.badge}</span>
                    )}
                    {active && <span className="nav-dot" />}
                  </a>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

// ── Brew Panel: right-side AI coworker workspace ───────────────────────
//
// A persistent right-side panel (max 25% of viewport width) with full
// chat transcript + live agent progress + prompt input. Replaces the
// previous "small floating card above the bottom bar" UX when the user
// wants more room to see outcomes. Toggle lives in the topbar.
//
// Layout contract:
//   - Fixed to right edge, below the topbar (top: 64px, right: 0, bottom: 0)
//   - Width: min(380px, 25vw) — never covers more than a quarter of the
//     page + never gets wider than 380px on huge monitors.
//   - Main content area gets padding-right so content doesn't hide under
//     the panel.
//   - Sidebar is UNAFFECTED (menu area stays visible on the left).
//
// Open-state persistence: lumaara.brewPanelOpen in localStorage so the
// user's choice sticks across reloads.

interface BrewTurn {
  id: string;
  // Prompt the user typed.
  question: string;
  // Current page's module/submodule when they asked, for the "re:" chip.
  scope: { module: string; submodule?: string } | null;
  // Live agent transcript — steps roll in via SSE, summary at the end.
  steps: AgentStep[];
  summary: string | null;
  error: string | null;
  // True until the SSE closes.
  busy: boolean;
}

interface BrewPanelProps {
  open: boolean;
  onClose: () => void;
  turns: BrewTurn[];
  busy: boolean;
  prompt: string;
  setPrompt: (s: string) => void;
  onSubmit: () => void;
  onClearHistory: () => void;
}

function BrewPanel({
  open,
  onClose,
  turns,
  busy,
  prompt,
  setPrompt,
  onSubmit,
  onClearHistory,
}: BrewPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll to the newest turn when it arrives. Only scroll if the
  // user hasn't scrolled up — otherwise we'd fight their reading.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  if (!open) return null;
  return (
    <aside
      className="brew-panel fixed top-16 end-0 bottom-0 z-30 w-[min(380px,25vw)] bg-white border-s border-ink/10 shadow-raised flex flex-col"
      aria-label="Brew AI coworker"
    >
      <header className="px-4 py-3 border-b border-ink/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="brew-mark text-sm">Brew</span>
          <span className="text-xs text-ink-muted">AI coworker</span>
        </div>
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="text-xs text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-canvas-warm"
              title="Clear conversation"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 grid place-items-center rounded hover:bg-canvas-warm text-ink-muted hover:text-ink"
            aria-label="Close Brew panel"
          >
            ×
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
        {turns.length === 0 && (
          <div className="text-sm text-ink-muted leading-relaxed">
            <p className="mb-2">
              Tell me what you want done — &quot;list overdue invoices&quot;,
              &quot;create a lead for Priya at Acme&quot;, &quot;count this week&apos;s customers&quot;.
            </p>
            <p className="text-xs">
              I use the tools your plan includes. If something isn&apos;t in your plan I&apos;ll say so.
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            {/* User prompt */}
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-ink text-white text-[10px] font-semibold grid place-items-center flex-shrink-0">
                YOU
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink whitespace-pre-wrap">{turn.question}</div>
                {turn.scope && (
                  <div className="text-[10px] text-ink-muted mt-0.5">
                    re: {turn.scope.submodule ?? turn.scope.module}
                  </div>
                )}
              </div>
            </div>

            {/* Agent response */}
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-brand-gradient text-white text-[10px] font-semibold grid place-items-center flex-shrink-0">
                AI
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                {turn.error ? (
                  <div className="text-sm text-red-600 whitespace-pre-wrap">{turn.error}</div>
                ) : (
                  <>
                    {turn.steps.length === 0 && !turn.summary && (
                      <span className="text-xs text-ink-muted italic">Planning…</span>
                    )}
                    {turn.steps.map((s) => (
                      <div key={s.id} className="flex items-start gap-2 text-xs">
                        <span
                          className={
                            s.status === "running"
                              ? "text-amber-600 w-4 flex-shrink-0"
                              : s.status === "done"
                              ? "text-green-700 w-4 flex-shrink-0"
                              : "text-red-600 w-4 flex-shrink-0"
                          }
                          aria-hidden
                        >
                          {s.status === "running" ? "▸" : s.status === "done" ? "✓" : "⚠"}
                        </span>
                        <span className="font-mono text-ink">{s.tool}</span>
                        {s.output && (
                          <span className="text-ink-muted truncate flex-1" title={s.output}>
                            — {s.output}
                          </span>
                        )}
                      </div>
                    ))}
                    {turn.summary && (
                      <div className="pt-2 mt-2 border-t border-ink/10 text-sm text-ink whitespace-pre-wrap">
                        {turn.summary}
                      </div>
                    )}
                    {turn.busy && (
                      <span
                        className="inline-block w-2 h-3 ms-0.5 bg-ink animate-pulse align-middle"
                        aria-hidden
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer className="border-t border-ink/10 px-3 py-3 flex-shrink-0 bg-white">
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy) onSubmit();
              }
            }}
            placeholder="Ask or tell me to do anything…"
            rows={2}
            className="flex-1 resize-none bg-canvas-warm border border-ink/10 rounded-lg px-3 py-2 text-sm placeholder:text-ink-muted outline-none focus:border-ink/30"
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !prompt.trim()}
            className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed self-end"
            aria-label="Send"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
        <p className="text-[10px] text-ink-muted mt-1.5">
          Enter to send · Shift+Enter for a new line
        </p>
      </footer>
    </aside>
  );
}

// ── Brew: AI coworker bar ──────────────────────────────────────────────
//
// Was: a thin wrapper around the Q&A /ai/chat endpoint (text in, text out).
// Now: a full agent surface — the same backend the AI-mode landing uses.
// Users type what they want ("create a sales invoice for Acme for ₹5000";
// "list this week's leads") and the planner picks MCP tools + executes.
//
// Flow:
//   1. POST /api/accounting/agents/tasks   { goal, agentKind: "freeform", contextJson }
//   2. Open EventSource SSE on /tasks/<id>/events (token via ?access_token=)
//   3. POST /api/accounting/agents/tasks/<id>/run (fires the planner loop)
//   4. Render step.new / step.finished / task.status / done events as they
//      stream, updating the floating card above the input.
//
// Plan gating: the server rejects at step 1 with a 403 "MODULE_NOT_IN_PLAN"
// if the current page's scope isn't in the tenant's SubscriptionPlan,
// returning a friendly upgrade message that we surface verbatim.

interface AgentStep {
  id: string;
  tool: string;
  status: "running" | "done" | "error";
  output?: string;
}

// BrewController hoists all the Brew state up so BOTH the bottom input
// bar AND the right-side panel share one transcript + one in-flight
// submit. Returns the state + a submit() handler the caller wires into
// whichever surface they're rendering. Callers that need multi-turn
// history (BrewPanel) read `turns`; callers that just need a single
// quick-launch input (BrewBar) read `prompt + onSubmit`.
function useBrewController(
  onFirstSubmit: () => void,
): {
  turns: BrewTurn[];
  busy: boolean;
  prompt: string;
  setPrompt: (s: string) => void;
  submit: () => void;
  clearHistory: () => void;
} {
  const [turns, setTurns] = useState<BrewTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const brewPath = usePathname() ?? "/";
  const scope = submoduleForPath(brewPath);

  const clearHistory = () => setTurns([]);

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    const question = prompt;
    const turnId = `t-${Date.now()}`;
    setPrompt("");
    setBusy(true);
    // Add the user prompt immediately so the panel updates on click,
    // even before the server responds.
    const turn: BrewTurn = {
      id: turnId,
      question,
      scope: scope ? { module: scope.module, submodule: scope.submodule } : null,
      steps: [],
      summary: null,
      error: null,
      busy: true,
    };
    setTurns((xs) => [...xs, turn]);
    // Promote caller to open the panel if this is the first submit.
    onFirstSubmit();

    const token = (() => { try { return JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""; } catch { return ""; } })();
    const authHdr: Record<string, string> = token ? { authorization: "Bearer " + token } : {};

    // Helpers to update this specific turn in-place without recomputing
    // the whole transcript each event.
    const updateTurn = (patch: Partial<BrewTurn>): void => {
      setTurns((xs) => xs.map((t) => (t.id === turnId ? { ...t, ...patch } : t)));
    };
    const finish = (patch: Partial<BrewTurn>): void => {
      setTurns((xs) => xs.map((t) => (t.id === turnId ? { ...t, ...patch, busy: false } : t)));
      setBusy(false);
    };

    try {
      // 1. Create the task. Server validates plan (403 "MODULE_NOT_IN_PLAN"
      //    if the current page's scope isn't in the tenant's plan).
      // Compose the goal with the current page's module/submodule scope so
      // the agent planner biases its tool choice. Pattern mirrors AssistShell.
      const goal = scope
        ? `[Module: ${scope.module}${scope.submodule ? ` — Submodule: ${scope.submodule}` : ""}]\n\n${question}`
        : question;
      let eventSource: EventSource | null = null;
      const createResp = await fetch("/api/accounting/agents/tasks", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHdr },
        body: JSON.stringify({
          goal,
          agentKind: "freeform",
          contextJson: scope ? { module: scope.module, submodule: scope.submodule } : {},
        }),
      });
      if (!createResp.ok) {
        const text = await createResp.text().catch(() => "");
        let errMsg = `Brew failed (${createResp.status})`;
        try {
          const parsed = JSON.parse(text) as { error?: string; detail?: string; hint?: string; code?: string };
          if (parsed.code === "MODULE_NOT_IN_PLAN") {
            errMsg = [parsed.error, parsed.detail, parsed.hint].filter(Boolean).join(" ");
          } else if (parsed.error) {
            errMsg = parsed.error;
          }
        } catch { /* ignore */ }
        finish({ error: errMsg });
        return;
      }
      const task = (await createResp.json()) as { id: string };

      // Open SSE BEFORE firing the run so we don't miss early events.
      // EventSource can't send Authorization headers, so the service
      // accepts `?access_token=` as a fallback.
      const sseUrl = `/api/accounting/agents/tasks/${task.id}/events${
        token ? `?access_token=${encodeURIComponent(token)}` : ""
      }`;
      eventSource = new EventSource(sseUrl);
      const stepMap = new Map<string, AgentStep>();
      const upsert = (step: AgentStep) => {
        stepMap.set(step.id, step);
        updateTurn({ steps: Array.from(stepMap.values()) });
      };
      eventSource.addEventListener("step.new", (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as { id?: string; toolName?: string; kind?: string };
        upsert({
          id: d.id ?? `${Date.now()}-${Math.random()}`,
          tool: d.toolName ?? d.kind ?? "step",
          status: "running",
        });
      });
      eventSource.addEventListener("step.finished", (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as { id?: string; toolName?: string; kind?: string; status?: string; output?: unknown };
        const key = d.id ?? "";
        const existing = stepMap.get(key);
        const short =
          typeof d.output === "object" && d.output !== null
            ? JSON.stringify(d.output).slice(0, 240)
            : String(d.output ?? "");
        upsert({
          id: key || `${Date.now()}-${Math.random()}`,
          tool: d.toolName ?? d.kind ?? existing?.tool ?? "step",
          status: d.status === "Succeeded" ? "done" : "error",
          output: short,
        });
      });
      eventSource.addEventListener("task.status", (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as { task?: { summary?: string } };
        if (d.task?.summary) updateTurn({ summary: d.task.summary });
      });
      eventSource.addEventListener("done", (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as { task?: { summary?: string; errorMessage?: string } };
        const patch: Partial<BrewTurn> = {};
        if (d.task?.summary) patch.summary = d.task.summary;
        if (d.task?.errorMessage) patch.error = d.task.errorMessage;
        finish(patch);
        eventSource?.close();
      });
      eventSource.onerror = () => {
        // Close on transport error so we don't retry forever.
        eventSource?.close();
      };

      // Fire the run. SSE carries the rest.
      const runResp = await fetch(`/api/accounting/agents/tasks/${task.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHdr },
        body: "{}",
      });
      if (!runResp.ok) {
        const text = await runResp.text().catch(() => "");
        finish({ error: `Run failed: ${text.slice(0, 200)}` });
        eventSource?.close();
      }
    } catch (e) {
      finish({ error: e instanceof Error ? e.message : "Brew request failed" });
    }
  };

  return { turns, busy, prompt, setPrompt, submit, clearHistory };
}

// ── AppShell ───────────────────────────────────────────────────────────

export function AppShell({ nav, children }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const [collapsed, setCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  // Brew panel open/closed. Persisted so the user's choice sticks across
  // route changes + reloads. First submit from BrewBar auto-opens.
  const [brewPanelOpen, setBrewPanelOpen] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("appshell.collapsed") === "1");
    const storedDark = localStorage.getItem("appshell.darkMode") === "1";
    setDarkMode(storedDark);
    document.documentElement.classList.toggle("dark", storedDark);
    setBrewPanelOpen(localStorage.getItem("appshell.brewPanel") === "1");
  }, []);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("appshell.collapsed", next ? "1" : "0");
    document.documentElement.classList.toggle("sidebar-collapsed", next);
  };
  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("appshell.darkMode", next ? "1" : "0");
  };
  const setBrewPanel = (next: boolean) => {
    setBrewPanelOpen(next);
    localStorage.setItem("appshell.brewPanel", next ? "1" : "0");
  };
  const brew = useBrewController(() => setBrewPanel(true));

  return (
    <div className="min-h-screen">
      <aside className="app-sidebar">
        <Wordmark />
        <div className="app-sidebar-scroll">
          <SidebarNav nav={nav} />
        </div>
        <div className="app-sidebar-footer">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            V0.1.0
          </span>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="ms-auto p-1.5 rounded-lg hover:bg-canvas-warm text-ink-muted"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path
                d={collapsed ? "M8 4l6 6-6 6M14 4v12" : "M12 4l-6 6 6 6M6 4v12"}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </aside>
      <div
        className="app-sidebar-backdrop"
        onClick={() => document.documentElement.classList.remove("sidebar-open")}
        aria-hidden
      />

      <header className="app-topbar">
        <div className="h-full ps-3 md:ps-6 pe-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => document.documentElement.classList.toggle("sidebar-open")}
            className="md:hidden p-2 -ms-1 rounded-lg hover:bg-canvas-warm text-ink"
            aria-label="Open navigation"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <GlobalSearch />
          <div className="flex items-center gap-2">
            <TopChip gold>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 2l2.5 5 5.5.8-4 4 1 5.5L10 14.8 4.9 17.3l1-5.5-4-4 5.5-.8L10 2z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill="currentColor"
                  fillOpacity="0.15"
                />
              </svg>
              <span className="text-xs font-semibold">Unlimited credits</span>
            </TopChip>
            <TopChip>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M3 10h14M10 3c2.5 3 2.5 11 0 14M10 3c-2.5 3-2.5 11 0 14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-widest">ALL</span>
              <svg width="10" height="10" viewBox="0 0 10 10" className="text-ink-muted">
                <path
                  d="M2 3.5l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </TopChip>
            <button
              type="button"
              onClick={() => (window.location.href = "/help")}
              className="p-2.5 rounded-xl bg-white border border-ink/8 hover:border-ink/20 hover:bg-canvas-warm text-ink-muted hover:text-ink transition"
              aria-label="Help & docs"
              title="Help & docs (opens the help center)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7v.5M12 17.2h.01"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => (window.location.href = "/notifications")}
              className="relative p-2.5 rounded-xl bg-white border border-ink/8 hover:border-ink/20 text-ink-muted hover:text-ink transition"
              aria-label="Notifications"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3a6 6 0 0 0-6 6v4l-2 2v1h16v-1l-2-2V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="absolute -top-1 -end-1 h-4 min-w-4 px-1 rounded-full bg-ink text-white text-[10px] font-bold grid place-items-center">
                1
              </span>
            </button>
            <button
              type="button"
              onClick={toggleDarkMode}
              className="p-2.5 rounded-xl bg-white border border-ink/8 hover:border-ink/20 text-ink-muted hover:text-ink transition"
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="4" width="16" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7 17h6M10 14v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <UserMenu />
          </div>
        </div>
      </header>

      <main
        className="app-main"
        // Push main content left when the Brew panel is open so the panel
        // doesn't cover the page. The sidebar on the left is unaffected.
        style={brewPanelOpen ? { paddingRight: "min(380px, 25vw)" } : undefined}
      >
        <div key={pathname} className="app-content animate-fade-in">
          {children}
        </div>
      </main>

      <BrewPanel
        open={brewPanelOpen}
        onClose={() => setBrewPanel(false)}
        turns={brew.turns}
        busy={brew.busy}
        prompt={brew.prompt}
        setPrompt={brew.setPrompt}
        onSubmit={brew.submit}
        onClearHistory={brew.clearHistory}
      />
      <BrewFab open={brewPanelOpen} onOpen={() => setBrewPanel(true)} />
      <ToastHost />
    </div>
  );
}

// ── Floating AI coworker FAB (bottom-right) ─────────────────────────
// Chat-widget pattern: a circular button sits at the bottom-right.
// Click opens the right-side BrewPanel (which already exists).
// FAB hides itself while the panel is open to avoid overlap.

function BrewFab({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  if (open) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open Brew AI coworker"
      title="Brew — your AI coworker"
      className="fixed bottom-6 end-6 z-30 grid place-items-center h-14 w-14 rounded-full bg-ink text-white shadow-xl hover:scale-105 active:scale-95 transition border border-white/10"
    >
      <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2z" fill="currentColor" />
      </svg>
      <span className="absolute -top-1 -end-1 h-3 w-3 rounded-full bg-emerald-400 border-2 border-white" aria-hidden />
    </button>
  );
}



// ── Page header helper (icon-square + title + subtitle + actions) ──────

export function PageHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-lead">
        {icon && <span className="icon-square">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <div className="page-eyebrow mb-1">{eyebrow}</div>}
          <h1 className="page-title truncate">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}


// ── Icon set — inline SVG monoline glyphs used in nav + page headers ──

export const Icon = {
  home: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M3 9l7-6 7 6v8a1 1 0 0 1-1 1h-4v-6H8v6H4a1 1 0 0 1-1-1V9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  dashboard: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
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
      <path
        d="M4 3h9l3 3v11H4V3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13 3v3h3M7 9h6M7 12h6M7 15h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M3 4h14v9H3zM3 13l3 3h8l3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M2 3h2l2 10h10l2-7H5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="7" cy="16" r="1.3" fill="currentColor" />
      <circle cx="15" cy="16" r="1.3" fill="currentColor" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M10 2l7 4v8l-7 4-7-4V6l7-4zM3 6l7 4 7-4M10 10v8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  bar: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path d="M4 15V9M10 15V4M16 15v-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3 17h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  factory: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M3 17V9l4 2V9l4 2V9l6 3v5H3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M6 14h1M10 14h1M14 14h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M2 5h9v9H2zM11 8h4l3 3v3h-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M13.5 3.5a3.5 3.5 0 0 0-4.5 4.4L3 14l3 3 6.1-6a3.5 3.5 0 0 0 4.4-4.5L14 9l-3-3 2.5-2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
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
      <path
        d="M10 2v2M10 16v2M4 10H2M18 10h-2M5 5l1.5 1.5M13.5 13.5L15 15M15 5l-1.5 1.5M6.5 13.5L5 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
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
  sparkles: (
    <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
      <path
        d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2zM15.5 12l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  ),
};
