"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface Command {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string[];
  icon?: ReactNode;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export interface CommandGroup {
  name: string;
  commands: Command[];
}

export interface SearchHit {
  doctype: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  register: (cmd: Command) => () => void;
  commands: Map<string, Command>;
  searchFn: ((q: string) => Promise<SearchHit[]>) | null;
}

const CommandCtx = createContext<Ctx | null>(null);

export function CommandPaletteProvider({
  children,
  search,
}: {
  children: ReactNode;
  /** Optional async search function that returns doc hits matching the query.
   * When wired, typed queries fetch cross-doctype matches from the server
   * (debounced 150 ms). Without it the palette only matches registered commands. */
  search?: (q: string) => Promise<SearchHit[]>;
}) {
  const [open, setOpen] = useState(false);
  const commandsRef = useRef<Map<string, Command>>(new Map());
  const [, setTick] = useState(0);

  const register = useCallback((cmd: Command) => {
    commandsRef.current.set(cmd.id, cmd);
    setTick((t) => t + 1);
    return () => {
      commandsRef.current.delete(cmd.id);
      setTick((t) => t + 1);
    };
  }, []);

  // Global hotkeys:
  //   ⌘K / Ctrl-K — toggle open
  //   /           — open focused on search (Vercel/GitHub convention)
  // Both are suppressed while the user is typing in an input or textarea
  // so the shortcut doesn't eat regular keystrokes.
  useEffect(() => {
    const typing = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
      return t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ open, setOpen, register, commands: commandsRef.current, searchFn: search ?? null }),
    [open, search],
  );
  return <CommandCtx.Provider value={value}>{children}</CommandCtx.Provider>;
}

export function useCommandPalette(): { open: boolean; setOpen: (v: boolean) => void } {
  const ctx = useContext(CommandCtx);
  if (!ctx) throw new Error("useCommandPalette: wrap in <CommandPaletteProvider>");
  return { open: ctx.open, setOpen: ctx.setOpen };
}

/** Register a command for the lifetime of the component. */
export function useRegisterCommand(cmd: Command | null | undefined): void {
  const ctx = useContext(CommandCtx);
  useEffect(() => {
    if (!ctx || !cmd) return;
    return ctx.register(cmd);
    // Re-register if any field changes
  }, [ctx, cmd?.id, cmd?.label, cmd?.group, cmd?.hint, cmd?.shortcut]); // eslint-disable-line react-hooks/exhaustive-deps
}

function score(cmd: Command, q: string): number {
  if (!q) return 1;
  const needle = q.toLowerCase();
  const hay = `${cmd.label} ${cmd.group ?? ""} ${(cmd.keywords ?? []).join(" ")}`.toLowerCase();
  if (hay.includes(needle)) {
    // Prefer prefix matches on label.
    if (cmd.label.toLowerCase().startsWith(needle)) return 100;
    if (cmd.label.toLowerCase().includes(needle)) return 50;
    return 10;
  }
  // Fuzzy subsequence match.
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return 1;
  }
  return 0;
}

export function CommandPalette() {
  const ctx = useContext(CommandCtx);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ctx?.open) {
      setQ("");
      setCursor(0);
      setHits([]);
      // Focus after mount.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [ctx?.open]);

  // Debounced server search.
  useEffect(() => {
    if (!ctx?.open || !ctx.searchFn || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearchBusy(true);
    const t = setTimeout(async () => {
      try {
        const data = await ctx.searchFn!(q.trim());
        if (!cancelled) setHits(data);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ctx?.open, ctx?.searchFn, q]);

  const commandResults = useMemo(() => {
    if (!ctx) return [] as Command[];
    const list = [...ctx.commands.values()]
      .map((c) => ({ c, s: score(c, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.label.localeCompare(b.c.label))
      .slice(0, 50)
      .map((x) => x.c);
    return list;
  }, [ctx, q, ctx?.commands.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Materialize search hits as synthetic commands so the keyboard model
  // (cursor + Enter) is uniform.
  const hitCommands = useMemo<Command[]>(
    () =>
      hits.map((h) => ({
        id: `doc:${h.doctype}:${h.id}`,
        label: h.title,
        hint: h.subtitle,
        group: h.doctype,
        run: () => {
          if (typeof window !== "undefined") window.location.href = h.href;
        },
      })),
    [hits],
  );

  // Jumbo results = commands + search hits. Commands first (local + fast).
  const results = useMemo(
    () => [...commandResults, ...hitCommands],
    [commandResults, hitCommands],
  );

  useEffect(() => {
    setCursor(0);
  }, [q]);

  if (!ctx || !ctx.open) return null;

  const close = () => ctx.setOpen(false);
  const run = async (cmd: Command) => {
    close();
    await cmd.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[cursor];
      if (picked) void run(picked);
    }
  };

  const grouped = new Map<string, Command[]>();
  for (const c of results) {
    const g = c.group ?? "Actions";
    const arr = grouped.get(g) ?? [];
    arr.push(c);
    grouped.set(g, arr);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-[640px] mx-4 rounded-xl bg-canvas shadow-2xl overflow-hidden border border-ink/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ink/8">
          <span aria-hidden className="text-ink-muted">⌘K</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search commands, docs, actions…"
            className="flex-1 bg-transparent outline-none text-ink placeholder:text-ink-muted"
            aria-label="Command input"
          />
          {searchBusy && (
            <span className="text-xs text-ink-muted" aria-live="polite">Searching…</span>
          )}
          {q && !searchBusy && (
            <button
              className="text-xs text-ink-muted hover:text-ink"
              onClick={() => setQ("")}
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto" role="listbox">
          {results.length === 0 && (
            <div className="p-8 text-center text-sm text-ink-muted">
              No commands match <span className="font-mono">{q}</span>
            </div>
          )}
          {[...grouped.entries()].map(([groupName, cmds]) => (
            <div key={groupName} className="py-1">
              <div className="px-4 py-1 text-[11px] uppercase tracking-widest text-ink-muted">
                {groupName}
              </div>
              {cmds.map((c) => {
                const idx = results.indexOf(c);
                const active = idx === cursor;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => void run(c)}
                    role="option"
                    aria-selected={active}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-start ${
                      active ? "bg-ink/5" : ""
                    }`}
                  >
                    {c.icon && <span className="text-ink-muted">{c.icon}</span>}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate">{c.label}</span>
                      {c.hint && (
                        <span className="block text-xs text-ink-muted truncate">
                          {c.hint}
                        </span>
                      )}
                    </span>
                    {c.shortcut && (
                      <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-ink/15 text-ink-muted">
                        {c.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-ink/8 text-[11px] text-ink-muted">
          <span>
            <kbd className="font-mono">↑↓</kbd> move · <kbd className="font-mono">↵</kbd> run
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
