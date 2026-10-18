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

interface Shortcut {
  keys: string;
  description: string;
  group?: string;
  handler: (e: KeyboardEvent) => void;
}

interface Ctx {
  register: (s: Shortcut) => () => void;
  shortcuts: () => Shortcut[];
  cheatsheetOpen: boolean;
  setCheatsheet: (v: boolean) => void;
}

const KbdCtx = createContext<Ctx | null>(null);

function matches(e: KeyboardEvent, spec: string): boolean {
  // spec examples: "mod+k", "shift+?", "n", "g i", "escape"
  // Sequence shortcuts (space-separated) are handled by consumer; here we match single-chord.
  const parts = spec.toLowerCase().split("+").map((s) => s.trim());
  const key = parts.pop() ?? "";
  const wantMod = parts.includes("mod") || parts.includes("meta") || parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const mod = e.metaKey || e.ctrlKey;
  if (wantMod !== mod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === key || e.code.toLowerCase() === key;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const shortcutsRef = useRef<Shortcut[]>([]);
  const [cheatsheetOpen, setCheatsheet] = useState(false);

  const register = useCallback((s: Shortcut) => {
    shortcutsRef.current.push(s);
    return () => {
      shortcutsRef.current = shortcutsRef.current.filter((x) => x !== s);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Always allow ? even when typing is a bit much — require not-typing for everything.
      if (isTyping(e.target) && !((e.metaKey || e.ctrlKey) && !e.shiftKey)) return;
      // '?' cheatsheet
      if (!isTyping(e.target) && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        setCheatsheet(true);
        return;
      }
      for (const s of shortcutsRef.current) {
        if (matches(e, s.keys)) {
          e.preventDefault();
          s.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      register,
      shortcuts: () => shortcutsRef.current,
      cheatsheetOpen,
      setCheatsheet,
    }),
    [register, cheatsheetOpen],
  );
  return <KbdCtx.Provider value={value}>{children}</KbdCtx.Provider>;
}

export function useKeyboardShortcut(
  keys: string,
  handler: (e: KeyboardEvent) => void,
  description: string,
  group = "General",
): void {
  const ctx = useContext(KbdCtx);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!ctx) return;
    return ctx.register({
      keys,
      description,
      group,
      handler: (e) => handlerRef.current(e),
    });
  }, [ctx, keys, description, group]);
}

export function useOpenCheatsheet(): () => void {
  const ctx = useContext(KbdCtx);
  return useCallback(() => ctx?.setCheatsheet(true), [ctx]);
}

export function KeyboardCheatsheet() {
  const ctx = useContext(KbdCtx);
  if (!ctx || !ctx.cheatsheetOpen) return null;
  const list = ctx.shortcuts();
  const groups = new Map<string, Shortcut[]>();
  for (const s of list) {
    const key = s.group ?? "General";
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => ctx.setCheatsheet(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        aria-modal="true"
        className="max-w-xl w-full mx-4 rounded-xl bg-canvas border border-ink/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink/8 flex items-center justify-between">
          <h2 className="font-semibold text-ink">Keyboard shortcuts</h2>
          <button className="text-ink-muted hover:text-ink" onClick={() => ctx.setCheatsheet(false)}>
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
          {[...groups.entries()].map(([g, items]) => (
            <section key={g}>
              <h3 className="text-[11px] uppercase tracking-widest text-ink-muted mb-2">{g}</h3>
              <dl className="divide-y divide-ink/5">
                {items.map((s) => (
                  <div key={s.keys + s.description} className="flex items-center justify-between py-1.5">
                    <dt className="text-sm text-ink">{s.description}</dt>
                    <dd>
                      <kbd className="font-mono text-xs px-1.5 py-0.5 border border-ink/15 rounded text-ink-muted">
                        {s.keys}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {list.length === 0 && (
            <p className="text-sm text-ink-muted">No shortcuts registered on this page.</p>
          )}
        </div>
      </div>
    </div>
  );
}
