"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  Toast,
  relativeTime,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import {
  PLATFORMS,
  PLATFORM_LABEL,
  PlatformDot,
  SENTIMENT_PILL,
  type Mention,
  type Platform,
  type Sentiment,
} from "../_shared";

// Zoho Social-style Engagement Inbox — a chat-like vertical feed of
// mentions surfaced by the operator's monitors. Polls every 30s. Filters
// don't refetch the list from a stale timer — the timer just re-invokes
// `load` with the current filters closure.

type SentFilter = "all" | "unreplied" | Sentiment;
type PlatformFilter = "all" | Platform;

export default function InboxPage() {
  const [rows, setRows] = useState<Mention[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SentFilter>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [reply, setReply] = useState<Mention | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (filter === "unreplied") p.set("unreplied", "1");
      else if (filter !== "all") p.set("sentiment", filter);
      if (platform !== "all") p.set("platform", platform);
      if (keyword.trim()) p.set("keyword", keyword.trim());
      const qs = p.toString();
      setRows(
        await api.get<Mention[]>(`/social/mentions${qs ? `?${qs}` : ""}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mentions");
    }
  }, [filter, platform, keyword]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useListPageCommands({
    singular: "Inbox",
    plural: "Inbox",
    refresh: load,
  });

  const counts = useMemo(() => {
    let unreplied = 0;
    for (const r of rows) if (!r.isReplied) unreplied++;
    return { total: rows.length, unreplied };
  }, [rows]);

  async function markReplied() {
    if (!reply) return;
    setBusy(true);
    try {
      await api.post(`/social/mentions/${reply.id}/mark-replied`, {
        replyText: replyText.trim() || undefined,
      });
      setReply(null);
      setReplyText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark replied");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Engagement Inbox"
        subtitle={
          <span>
            {counts.total} mention{counts.total === 1 ? "" : "s"} ·{" "}
            <span className={counts.unreplied > 0 ? "text-amber-700 font-medium" : ""}>
              {counts.unreplied} unreplied
            </span>
          </span>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="mb-4">
        <FilterBar
          search={{
            value: keyword,
            onChange: setKeyword,
            placeholder: "Search by keyword…",
          }}
          filters={
            <>
              <Segmented<SentFilter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "unreplied", label: "Unreplied" },
                  { value: "Positive", label: "Positive" },
                  { value: "Neutral", label: "Neutral" },
                  { value: "Negative", label: "Negative" },
                ]}
              />
              <select
                className="input input-sm w-auto"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as PlatformFilter)}
              >
                <option value="all">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </>
          }
          actions={<SavedViewsControls listKey="crm-web:social-inbox" current={{ keyword, filter, platform }} onApply={(fv) => { setKeyword(fv.keyword); setFilter(fv.filter); setPlatform(fv.platform); }} />}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Icon.megaphone}
          title="Nothing to engage with yet"
          description="Set up monitors under Monitors and use the mock generator to populate this inbox for a demo."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <Card
              key={m.id}
              className={`p-3 flex items-start gap-3 ${
                m.isReplied ? "opacity-70" : ""
              }`}
            >
              <div className="flex flex-col items-center gap-1 shrink-0">
                <PlatformDot platform={m.platform} size={28} />
                <span
                  className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-sm font-bold grid place-items-center uppercase"
                  title={m.authorName}
                >
                  {(m.authorName || m.authorHandle || "?").charAt(0)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-semibold text-ink">{m.authorName}</span>
                  <span className="text-ink-muted">@{m.authorHandle}</span>
                  <span className="text-ink-muted">·</span>
                  <span className="text-ink-muted">{relativeTime(m.postedAt)}</span>
                  <span className={SENTIMENT_PILL[m.sentiment]}>{m.sentiment}</span>
                  {m.keyword && (
                    <span className="badge-brand">#{m.keyword}</span>
                  )}
                  {m.isReplied && (
                    <span className="badge-green">Replied</span>
                  )}
                </div>
                <div className="text-sm text-ink mt-1 whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
              <div className="shrink-0">
                {!m.isReplied ? (
                  <Button
                    variant="brand"
                    size="sm"
                    onClick={() => {
                      setReply(m);
                      setReplyText("");
                    }}
                  >
                    Reply
                  </Button>
                ) : (
                  <span className="text-[11px] text-ink-muted">Done</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={reply != null}
        onClose={() => {
          setReply(null);
          setReplyText("");
        }}
        title={reply ? `Reply to @${reply.authorHandle}` : "Reply"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setReply(null);
                setReplyText("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={markReplied}
              disabled={busy}
            >
              {busy ? "Saving…" : "Send & mark replied"}
            </Button>
          </>
        }
      >
        {reply && (
          <div className="space-y-4">
            <Card className="p-3 bg-surface-sunken">
              <div className="text-xs text-ink-muted mb-1">
                @{reply.authorHandle} · {relativeTime(reply.postedAt)}
              </div>
              <div className="text-sm text-ink whitespace-pre-wrap">
                {reply.content}
              </div>
            </Card>
            <FormField
              label="Your reply"
              hint="MVP: this text is saved on the mention record; real cross-platform reply APIs come later."
            >
              <textarea
                className="input min-h-[120px]"
                placeholder="Thanks for the shout-out! We appreciate…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
            </FormField>
          </div>
        )}
      </Drawer>
    </>
  );
}
