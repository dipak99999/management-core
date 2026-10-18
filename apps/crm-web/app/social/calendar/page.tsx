"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  PageHeader,
  Toast,
  dateShort,
  relativeTime,
} from "../../../components/ui";
import {
  PlatformDot,
  POST_STATUS_BADGE,
  POST_STATUS_PILL,
  type Account,
  type Post,
} from "../_shared";
import { Composer } from "../_composer";

// Content Calendar — a 7-column month view. Each cell shows up to 3 posts
// as colored pills (Zoho-style). Click a pill → drawer with full detail
// + Edit/Publish/Delete. Click the "+" on a day → composer prefilled to
// that day at 10:00 AM local.

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Build the 6×7 grid of days shown for a given month. Starts on Sunday.
// Any day outside the target month is still rendered but visually muted.
function monthCells(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const dow = first.getDay(); // 0 = Sun
  const start = new Date(first);
  start.setDate(first.getDate() - dow);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

// The pill's timestamp — for scheduled posts use scheduledFor, for
// published use publishedAt, otherwise fall back to createdAt.
function postDate(p: Post): Date {
  const iso = p.scheduledFor ?? p.publishedAt ?? p.createdAt;
  return new Date(iso);
}

export default function CalendarPage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const [posts, setPosts] = useState<Post[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [openPost, setOpenPost] = useState<Post | null>(null);
  const [composeFor, setComposeFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const from = startOfMonth(anchor).toISOString();
      const to = endOfMonth(anchor).toISOString();
      const res = await api.get<Post[]>(
        `/social/posts/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setPosts(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    }
  }, [anchor]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<Account[]>("/social/accounts")
      .then(setAccounts)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load accounts"),
      );
  }, []);

  const accountsById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  // Bucket posts by ISO date (YYYY-MM-DD) for fast lookup while rendering.
  const postsByDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) {
      const d = postDate(p);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    }
    return m;
  }, [posts]);

  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const today = new Date();
  const monthIdx = anchor.getMonth();

  const stats = useMemo(() => {
    const c = { scheduled: 0, published: 0, drafts: 0, failed: 0 };
    for (const p of posts) {
      if (p.status === "Scheduled") c.scheduled++;
      else if (p.status === "Published") c.published++;
      else if (p.status === "Draft") c.drafts++;
      else if (p.status === "Failed") c.failed++;
    }
    return c;
  }, [posts]);

  async function publishNow(id: string) {
    try {
      await api.post(`/social/posts/${id}/publish-now`, {});
      setOpenPost(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }
  async function del(id: string) {
    if (!confirm("Delete this post?")) return;
    try {
      await api.del(`/social/posts/${id}`);
      setOpenPost(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // Build ISO for the "+" button — target day at 10:00 local time.
  function tenAmOn(cell: Date): string {
    const d = new Date(
      cell.getFullYear(),
      cell.getMonth(),
      cell.getDate(),
      10,
      0,
      0,
      0,
    );
    return d.toISOString();
  }

  const weekdayHeader = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <PageHeader
        title="Content Calendar"
        subtitle={
          <span>
            {stats.scheduled} scheduled · {stats.published} published · {stats.drafts} draft
            {stats.drafts === 1 ? "" : "s"}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(addMonths(anchor, -1))}>
              ‹ Prev
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAnchor(addMonths(anchor, 1))}>
              Next ›
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card className="p-3">
        <div className="flex items-center justify-between mb-3 px-2">
          <div className="text-sm font-semibold text-ink">{monthLabel(anchor)}</div>
          <div className="flex items-center gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Scheduled
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-600" /> Published
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-600" /> Failed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-ink-muted/40" /> Draft
            </span>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-ink-muted/10 rounded-lg overflow-hidden border border-ink-muted/10">
          {weekdayHeader.map((w) => (
            <div
              key={w}
              className="bg-surface-sunken text-[11px] uppercase tracking-wide text-ink-muted font-semibold text-center py-1.5"
            >
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            const key = `${cell.getFullYear()}-${cell.getMonth()}-${cell.getDate()}`;
            const dayPosts = postsByDay.get(key) ?? [];
            const inMonth = cell.getMonth() === monthIdx;
            const isToday = sameDay(cell, today);
            const visible = dayPosts.slice(0, 3);
            const overflow = dayPosts.length - visible.length;
            return (
              <div
                key={i}
                className={`min-h-[110px] bg-white p-1.5 flex flex-col gap-1 relative group ${
                  inMonth ? "" : "opacity-45"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-medium ${
                      isToday
                        ? "h-5 w-5 grid place-items-center rounded-full bg-brand-500 text-white"
                        : "text-ink-soft"
                    }`}
                  >
                    {cell.getDate()}
                  </span>
                  <button
                    onClick={() => setComposeFor(tenAmOn(cell))}
                    className="opacity-0 group-hover:opacity-100 transition text-[11px] text-brand-600 hover:text-brand-700"
                    aria-label="Add post"
                    title="Compose for this day"
                  >
                    + Add
                  </button>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  {visible.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setOpenPost(p)}
                      className={`text-[11px] px-1.5 py-0.5 rounded truncate text-start ${POST_STATUS_PILL[p.status]} hover:opacity-90`}
                      title={p.content}
                    >
                      {p.content.length > 24 ? `${p.content.slice(0, 24)}…` : p.content}
                    </button>
                  ))}
                  {overflow > 0 && (
                    <span className="text-[10px] text-ink-muted px-1">
                      +{overflow} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Post-detail drawer */}
      <Drawer
        open={openPost != null}
        onClose={() => setOpenPost(null)}
        title="Post details"
        width="w-[560px]"
        footer={
          openPost && (
            <>
              <Button variant="danger" onClick={() => del(openPost.id)}>
                Delete
              </Button>
              {openPost.status !== "Published" && (
                <Button variant="brand" onClick={() => publishNow(openPost.id)}>
                  Publish now
                </Button>
              )}
            </>
          )
        }
      >
        {openPost && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className={POST_STATUS_BADGE[openPost.status]}>{openPost.status}</span>
              <span className="text-xs text-ink-muted">
                {openPost.status === "Published"
                  ? `Published ${relativeTime(openPost.publishedAt)}`
                  : openPost.scheduledFor
                    ? `Scheduled ${dateShort(openPost.scheduledFor)}`
                    : `Created ${dateShort(openPost.createdAt)}`}
              </span>
            </div>

            <div className="whitespace-pre-wrap text-sm text-ink">
              {openPost.content}
            </div>

            {openPost.linkUrl && (
              <a
                href={openPost.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-600 hover:underline break-all block"
              >
                {openPost.linkUrl}
              </a>
            )}

            {openPost.mediaUrls && openPost.mediaUrls.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {openPost.mediaUrls.map((u, i) => (
                  // user-supplied post media URL.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={u}
                    alt=""
                    className="rounded border border-ink-muted/10 object-cover w-full h-32"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.3";
                    }}
                  />
                ))}
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1.5">
                Channels
              </div>
              <div className="flex flex-wrap gap-1.5">
                {openPost.channelIds.map((id) => {
                  const acc = accountsById.get(id);
                  if (!acc) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1.5 ps-1 pe-2 py-0.5 rounded-full bg-surface-sunken border border-ink-muted/10 text-xs"
                    >
                      <PlatformDot platform={acc.platform} size={16} />
                      @{acc.handle}
                    </span>
                  );
                })}
              </div>
            </div>

            {openPost.results && openPost.results.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1.5">
                  Per-channel results
                </div>
                <div className="space-y-1.5">
                  {openPost.results.map((r) => (
                    <div
                      key={r.accountId}
                      className="flex items-center gap-2 text-xs border border-ink-muted/10 rounded-lg px-2 py-1.5"
                    >
                      <PlatformDot platform={r.account.platform} size={16} />
                      <span className="font-medium text-ink flex-1">@{r.account.handle}</span>
                      <span className="text-ink-muted">
                        {r.impressions} views · {r.likes}♥ · {r.shares}↻ · {r.comments}💬 · {r.clicks}↗
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Compose drawer (from "+" on a day cell) */}
      <Drawer
        open={composeFor != null}
        onClose={() => setComposeFor(null)}
        title="New scheduled post"
        width="w-[640px]"
      >
        {composeFor != null && (
          <Composer
            accounts={accounts}
            initialScheduledFor={composeFor}
            bare
            onSaved={() => {
              setComposeFor(null);
              load();
            }}
            onCancel={() => setComposeFor(null)}
            onError={setError}
          />
        )}
      </Drawer>
    </>
  );
}
