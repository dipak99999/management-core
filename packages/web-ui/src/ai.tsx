"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ─── Suggestion chips ───────────────────────────────────────────────── */

export interface AISuggestion {
  id: string;
  label: string;
  description?: string;
  danger?: boolean;
  run: () => void | Promise<void>;
}

export function AISuggestionChips({
  suggestions,
  busy,
  heading,
}: {
  suggestions: AISuggestion[];
  busy?: boolean;
  heading?: ReactNode;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-violet-700">
          {heading ?? "Suggested next actions"}
        </h3>
        <span aria-hidden className="text-[10px] text-violet-500">AI</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.id}
            onClick={() => void s.run()}
            disabled={busy}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition ${
              s.danger
                ? "border-red-300 bg-white text-red-700 hover:bg-red-50"
                : "border-violet-300 bg-white text-violet-900 hover:bg-violet-100"
            } ${busy ? "opacity-50 cursor-not-allowed" : ""}`}
            title={s.description}
          >
            <span aria-hidden>✨</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Diff preview modal ─────────────────────────────────────────────── */

export interface AIDiff {
  summary: string;
  rows: Array<{
    field: string;
    before?: string | null;
    after?: string | null;
    editable?: boolean;
  }>;
}

export function AIDiffModal({
  open,
  onClose,
  diff,
  onApprove,
  onReject,
  onEdit,
  onSaveAsRule,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  diff: AIDiff | null;
  onApprove: (edited: AIDiff) => Promise<void> | void;
  onReject: () => void;
  onEdit?: (field: string, newAfter: string) => void;
  /** When supplied, offers a "Save as rule" affordance once the user has
   * tweaked at least one field — persists the corrected before/after so
   * similar prompts can replay later. */
  onSaveAsRule?: (name: string, before: AIDiff, after: AIDiff) => Promise<void> | void;
  busy?: boolean;
}) {
  const [local, setLocal] = useState<AIDiff | null>(diff);
  const [edited, setEdited] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocal(diff);
    setEdited(false);
    setShowSave(false);
    setSaveName("");
  }, [diff]);

  if (!open || !local) return null;

  const patchField = (field: string, after: string) => {
    setLocal((cur) =>
      cur
        ? {
            ...cur,
            rows: cur.rows.map((r) =>
              r.field === field ? { ...r, after } : r,
            ),
          }
        : cur,
    );
    setEdited(true);
    onEdit?.(field, after);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI change preview"
    >
      <div
        className="w-full max-w-xl mx-4 rounded-xl bg-canvas border border-ink/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-ink/8">
          <div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-violet-700">
              <span aria-hidden>✨</span>
              AI proposed change
            </div>
            <h2 className="mt-1 text-base font-semibold text-ink">{local.summary}</h2>
          </div>
          <button className="text-ink-muted hover:text-ink" onClick={onClose}>✕</button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-4 space-y-2">
          {local.rows.length === 0 ? (
            <p className="text-sm text-ink-muted">No changes to preview.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-ink-muted border-b border-ink/8">
                  <th className="text-start py-1">Field</th>
                  <th className="text-start py-1">Current</th>
                  <th className="text-start py-1">Proposed</th>
                </tr>
              </thead>
              <tbody>
                {local.rows.map((r) => (
                  <tr key={r.field} className="align-top border-b border-ink/5">
                    <td className="py-1.5 text-ink-muted whitespace-nowrap pe-3">
                      {r.field}
                    </td>
                    <td className="py-1.5 pe-3">
                      <span className="text-ink-muted">
                        {r.before ?? <em className="text-ink-muted">empty</em>}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {r.editable ? (
                        <input
                          data-testid={`ai-diff-field-${r.field}`}
                          aria-label={`${r.field} new value`}
                          className="input input-sm w-full"
                          value={r.after ?? ""}
                          onChange={(e) => patchField(r.field, e.target.value)}
                        />
                      ) : (
                        <span className="text-success font-medium">
                          {r.after ?? <em>empty</em>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {edited && onSaveAsRule && (
          <div className="px-4 py-2 border-t border-ink/8 bg-violet-50/50">
            {showSave ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="input input-sm flex-1"
                  placeholder="Name this rule (e.g. “Acme invoice preset”)"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && saveName.trim() && diff) {
                      setSaving(true);
                      try {
                        await onSaveAsRule(saveName.trim(), diff, local);
                        setShowSave(false);
                      } finally {
                        setSaving(false);
                      }
                    } else if (e.key === "Escape") setShowSave(false);
                  }}
                />
                <button
                  className="btn-brand btn-sm"
                  disabled={!saveName.trim() || saving}
                  onClick={async () => {
                    if (!diff) return;
                    setSaving(true);
                    try {
                      await onSaveAsRule(saveName.trim(), diff, local);
                      setShowSave(false);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setShowSave(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="text-xs text-violet-700 hover:underline"
                onClick={() => setShowSave(true)}
                type="button"
              >
                ✨ Save your edits as a rule — next time the AI suggests this, we apply it automatically
              </button>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-ink/8">
          <button
            className="btn-ghost btn-sm text-red-700"
            onClick={() => {
              onReject();
              onClose();
            }}
            disabled={busy}
          >
            Reject
          </button>
          <div className="flex items-center gap-2">
            <button className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn-brand btn-sm"
              onClick={() => void onApprove(local)}
              disabled={busy}
            >
              {busy ? "Applying…" : "Approve & apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline AI slash-command input ──────────────────────────────────── */

export interface SlashCommand {
  prefix: string; // e.g. "/ai", "/invoice"
  description: string;
  run: (args: string) => Promise<void> | void;
}

export function AISlashInput({
  commands,
  placeholder,
}: {
  commands: SlashCommand[];
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matched = useMemo(() => {
    if (!value.startsWith("/")) return null;
    const first = value.split(/\s+/)[0];
    return commands.find((c) => c.prefix.startsWith(first)) ?? null;
  }, [commands, value]);

  const submit = useCallback(async () => {
    if (!matched) return;
    const args = value.slice(matched.prefix.length).trim();
    setBusy(true);
    setError(null);
    try {
      await matched.run(args);
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }, [matched, value]);

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-violet-600">✨</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matched) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder ?? "Try “/ai 3× SKU-ABC for Acme, due in 15 days”"}
          className="flex-1 bg-transparent outline-none text-sm text-ink"
          aria-label="AI command"
        />
        <button
          className="btn-brand btn-sm"
          onClick={() => void submit()}
          disabled={!matched || busy}
        >
          {busy ? "…" : "Run"}
        </button>
      </div>
      <div className="mt-1 text-[11px] text-ink-muted min-h-[1.1em]">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : matched ? (
          <>
            <span className="font-mono">{matched.prefix}</span> — {matched.description}
          </>
        ) : value.startsWith("/") ? (
          <>No matching command. Try: {commands.map((c) => c.prefix).join(", ")}</>
        ) : (
          <>Type <span className="font-mono">/</span> for AI commands.</>
        )}
      </div>
    </div>
  );
}

/* ─── Live AI budget pill ────────────────────────────────────────────── */

export function AIBudgetPill({
  used,
  limit,
  currency = "USD",
  warnAt = 0.8,
}: {
  used: number;
  limit: number;
  currency?: string;
  warnAt?: number;
}) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0;
  const danger = pct >= 1;
  const warn = !danger && pct >= warnAt;
  const cls = danger
    ? "bg-red-100 text-red-800 border-red-200"
    : warn
      ? "bg-amber-50 text-amber-800 border-amber-200"
      : "bg-violet-50 text-violet-700 border-violet-200";
  const fmt = (n: number) =>
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}
      title={`AI spend today: ${fmt(used)} of ${fmt(limit)}`}
    >
      <span aria-hidden>✨</span>
      <span>
        {fmt(used)} / {fmt(limit)}
      </span>
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-black/5" aria-hidden>
        <span
          className="block h-full"
          style={{
            width: `${Math.round(pct * 100)}%`,
            background: danger
              ? "rgb(220 38 38)"
              : warn
                ? "rgb(217 119 6)"
                : "rgb(124 58 237)",
          }}
        />
      </span>
    </span>
  );
}

/**
 * Backend-powered variant that fetches the current spend snapshot from
 * `/ai-budget`. Pass a thin loader so the component stays independent
 * of the app's http client. Refetches on `refreshMs` interval (default
 * 60s) and after any mutation that bumped AI cost — callers can call
 * `onInvalidate()` to force a re-read.
 */
export function AIBudgetPillLive({
  load,
  refreshMs = 60_000,
}: {
  load: () => Promise<{ used: number; limit: number; currency?: string } | null>;
  refreshMs?: number;
}) {
  const [snap, setSnap] = useState<{ used: number; limit: number; currency?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fire = async () => {
      const s = await load().catch(() => null);
      if (!cancelled) setSnap(s);
    };
    void fire();
    const t = setInterval(() => void fire(), refreshMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [load, refreshMs]);
  if (!snap) return null;
  return <AIBudgetPill used={snap.used} limit={snap.limit} currency={snap.currency} />;
}

/* ─── Save-as-rule flow ──────────────────────────────────────────────── */

export interface SavedRule<T> {
  id: string;
  name: string;
  before: T;
  after: T;
  createdAt: string;
  usageCount: number;
}

export interface AiRulesBackend {
  list(scope: string): Promise<SavedRule<unknown>[]>;
  create(input: {
    scope: string;
    name: string;
    before: unknown;
    after: unknown;
  }): Promise<SavedRule<unknown>>;
  bump(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const RULES_KEY = (ns: string) => `lumaara.rules.${ns}`;

export function useSaveAsRule<T>(namespace: string, backend?: AiRulesBackend) {
  const [rules, setRules] = useState<SavedRule<T>[]>(() => {
    if (backend) return [];
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(RULES_KEY(namespace));
      return raw ? (JSON.parse(raw) as SavedRule<T>[]) : [];
    } catch {
      return [];
    }
  });

  // Hydrate from backend on first mount.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = (await backend.list(namespace)) as SavedRule<T>[];
        if (!cancelled) setRules(rows);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [backend, namespace]);

  // Mirror to localStorage only when backend is absent.
  useEffect(() => {
    if (backend) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(RULES_KEY(namespace), JSON.stringify(rules));
  }, [backend, namespace, rules]);

  const saveRule = useCallback(
    async (name: string, before: T, after: T): Promise<SavedRule<T>> => {
      if (backend) {
        const created = (await backend.create({
          scope: namespace,
          name,
          before,
          after,
        })) as SavedRule<T>;
        setRules((cur) => [created, ...cur].slice(0, 50));
        return created;
      }
      const rule: SavedRule<T> = {
        id: `r-${Date.now()}`,
        name,
        before,
        after,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      };
      setRules((cur) => [rule, ...cur].slice(0, 50));
      return rule;
    },
    [backend, namespace],
  );

  const bumpUsage = useCallback(
    async (id: string) => {
      setRules((cur) =>
        cur.map((r) => (r.id === id ? { ...r, usageCount: r.usageCount + 1 } : r)),
      );
      if (backend) await backend.bump(id).catch(() => {});
    },
    [backend],
  );

  const removeRule = useCallback(
    async (id: string) => {
      setRules((cur) => cur.filter((r) => r.id !== id));
      if (backend) await backend.remove(id).catch(() => {});
    },
    [backend],
  );

  return { rules, saveRule, bumpUsage, removeRule };
}
