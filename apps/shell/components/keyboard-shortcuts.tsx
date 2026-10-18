"use client";

// Global keyboard shortcuts mounted once at the AppShell level.
//
//   /         focus the global search input (already a Cmd+K target)
//   n         go to the "new" action for the current section (Invoice,
//             Customer, Lead etc.) — picked from pathname
//   g h       go home (press g, then h within 1s)
//   ?         show the shortcut cheatsheet overlay
//   Esc       close the cheatsheet / unfocus active element
//
// Shortcuts are suppressed when the user is typing in an input/textarea
// so they can't accidentally fire while filling a form.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface Shortcut {
  keys: string;
  label: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: "/",      label: "Focus search" },
  { keys: "⌘ K",    label: "Open command palette" },
  { keys: "n",      label: "New record in current section" },
  { keys: "g then h", label: "Go to dashboard" },
  { keys: "?",      label: "Show this cheatsheet" },
  { keys: "Esc",    label: "Close drawer / dismiss" },
];

// Map URL prefix → the "new" route for that section.
const NEW_ROUTES: Array<[string, string]> = [
  ["/accounting/sales-invoices", "/accounting/sales-invoices/new"],
  ["/accounting/customers",      "/accounting/customers?new=1"],
  ["/accounting/items",          "/accounting/items?new=1"],
  ["/accounting/payments",       "/accounting/payments/new"],
  ["/crm/leads",                 "/crm/leads?new=1"],
  ["/crm/opportunities",         "/crm/opportunities?new=1"],
  ["/crm/quotations",            "/crm/quotations/new"],
  ["/hr/employees",              "/hr/employees?new=1"],
  ["/projects/projects",         "/projects/projects?new=1"],
  ["/projects/tasks",            "/projects/tasks?new=1"],
  ["/stock/items",               "/stock/items?new=1"],
];

function isTypingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [cheatOpen, setCheatOpen] = useState(false);
  const [pendingG, setPendingG] = useState(false);

  useEffect(() => {
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      // Never fight the user in input fields.
      if (isTypingInField(e.target)) return;
      // Modifier keys other than Shift are handled by their owning
      // widget (⌘K opens the search palette inside GlobalSearch).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Second-stroke after `g`?
      if (pendingG) {
        if (gTimer) { clearTimeout(gTimer); gTimer = null; }
        setPendingG(false);
        if (e.key === "h") {
          e.preventDefault();
          router.push("/");
        }
        return;
      }

      switch (e.key) {
        case "/": {
          e.preventDefault();
          // GlobalSearch registers for ⌘K; dispatch a synthetic event so
          // it can focus itself without us reaching into its state.
          const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search customers"]');
          input?.focus();
          input?.select();
          break;
        }
        case "n": {
          const match = NEW_ROUTES.find(([prefix]) => pathname.startsWith(prefix));
          if (match) { e.preventDefault(); router.push(match[1]); }
          break;
        }
        case "g": {
          e.preventDefault();
          setPendingG(true);
          gTimer = setTimeout(() => setPendingG(false), 1000);
          break;
        }
        case "?": {
          e.preventDefault();
          setCheatOpen((v) => !v);
          break;
        }
        case "Escape": {
          if (cheatOpen) { e.preventDefault(); setCheatOpen(false); }
          break;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [pathname, cheatOpen, pendingG, router]);

  if (!cheatOpen) {
    // Small floating hint when the user is in the g-chord window
    return pendingG ? (
      <div className="fixed bottom-6 start-6 z-30 bg-ink text-white text-xs rounded-pill px-3 py-1.5 shadow-raised">
        g… press <kbd className="font-mono bg-white/15 rounded px-1 ms-1">h</kbd> for home
      </div>
    ) : null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 grid place-items-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation shortcuts"
      onClick={() => setCheatOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-raised max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setCheatOpen(false)}
            className="text-ink-muted hover:text-ink text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>
        <ul className="divide-y divide-ink/5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="py-2 flex items-center justify-between gap-3">
              <span className="text-sm text-ink">{s.label}</span>
              <kbd className="font-mono text-xs bg-canvas-warm border border-ink/10 rounded px-2 py-0.5">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
