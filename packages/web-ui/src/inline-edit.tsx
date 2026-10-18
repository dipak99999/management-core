"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type InlineEditType = "text" | "number" | "date";

/**
 * Click a value → edit in place → Enter to save, Escape to cancel.
 * The `save` callback receives the raw string; wrap/parse in the caller.
 */
export function InlineEditCell({
  value,
  type = "text",
  save,
  display,
  placeholder,
  disabled,
}: {
  value: string;
  type?: InlineEditType;
  save: (next: string) => Promise<void> | void;
  display?: (v: string) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await save(draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }, [draft, value, save]);

  const cancel = useCallback(() => {
    setDraft(value);
    setErr(null);
    setEditing(false);
  }, [value]);

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1 group text-start ${
          disabled ? "cursor-default" : "cursor-text hover:bg-ink/5 rounded px-1 -mx-1"
        }`}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === "F2")) {
            e.preventDefault();
            setEditing(true);
          }
        }}
        disabled={disabled}
        aria-label="Edit value"
      >
        <span>{display ? display(value) : (value || <span className="text-ink-muted">{placeholder ?? "—"}</span>)}</span>
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        disabled={busy}
        className="input input-sm w-32"
      />
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
