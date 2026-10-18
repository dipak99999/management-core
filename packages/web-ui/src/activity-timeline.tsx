"use client";

import { useState, type ReactNode } from "react";

export interface ActivityEntry {
  id: string;
  at: string;
  actor: { name: string; initials?: string; avatarUrl?: string | null };
  verb: string;
  summary?: string;
  kind: "system" | "comment" | "status" | "ai";
  diff?: Array<{ field: string; from?: string | null; to?: string | null }>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ActivityTimeline({
  entries,
  composer,
  empty,
}: {
  entries: ActivityEntry[];
  composer?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {composer}
      {entries.length === 0 && (
        <div className="text-sm text-ink-muted py-6 text-center">
          {empty ?? "No activity yet."}
        </div>
      )}
      <ol className="relative space-y-4">
        {entries.map((e, idx) => {
          const kindCls =
            e.kind === "comment"
              ? "bg-brew/10 text-brew"
              : e.kind === "ai"
                ? "bg-violet-100 text-violet-700"
                : e.kind === "status"
                  ? "bg-success-soft text-success"
                  : "bg-ink/5 text-ink-muted";
          return (
            <li key={e.id} className="relative ps-8">
              {idx < entries.length - 1 && (
                <span
                  aria-hidden
                  className="absolute start-[11px] top-6 bottom-[-16px] w-px bg-ink/8"
                />
              )}
              <div
                className={`absolute start-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${kindCls}`}
                aria-hidden
              >
                {e.actor.initials ?? initials(e.actor.name)}
              </div>
              <div className="text-sm">
                <span className="font-medium text-ink">{e.actor.name}</span>
                <span className="text-ink-muted"> {e.verb}</span>
                {e.summary && (
                  <>
                    <span className="text-ink-muted"> — </span>
                    <span className="text-ink">{e.summary}</span>
                  </>
                )}
                <span className="ms-2 text-xs text-ink-muted">
                  {new Date(e.at).toLocaleString()}
                </span>
              </div>
              {e.diff && e.diff.length > 0 && (
                <dl className="mt-1 text-xs space-y-0.5">
                  {e.diff.map((d) => (
                    <div key={d.field} className="flex gap-2">
                      <dt className="text-ink-muted">{d.field}:</dt>
                      <dd className="text-ink">
                        {d.from != null && (
                          <>
                            <s className="text-red-600">{d.from}</s>
                            {" → "}
                          </>
                        )}
                        <span className="text-success">{d.to ?? "—"}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function CommentComposer({
  placeholder,
  onSubmit,
  busy,
}: {
  placeholder?: string;
  onSubmit: (text: string) => Promise<void> | void;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    await onSubmit(trimmed);
    setText("");
  }
  return (
    <div className="rounded-lg border border-ink/10 bg-canvas p-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder ?? "Leave a comment… (⌘↵ to post)"}
        className="w-full resize-none bg-transparent outline-none text-sm min-h-[64px]"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="text-[11px] text-ink-muted me-auto">
          Markdown supported
        </span>
        <button
          className="btn-brand btn-sm"
          onClick={() => void submit()}
          disabled={busy || !text.trim()}
        >
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
