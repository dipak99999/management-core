"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import {
  DataTable,
  Drawer,
  PageHeader,
  Segmented,
  Toast,
  dateShort,
  type Column,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import {
  PlatformDot,
  POST_STATUS_BADGE,
  type Account,
  type Post,
  type PostStats,
  type PostStatus,
} from "../_shared";
import { Composer } from "../_composer";

// Zoho-Social-style Compose page: a big composer card at the top and a
// filterable list of every post below. The composer supports Draft /
// Schedule / Publish-now in a single form so operators don't context-switch.
// Polls every 30s to pick up state transitions coming from the backend
// scheduler.

type ListFilter = "all" | PostStatus;


// ── Page ──────────────────────────────────────────────────────────────

export default function ComposerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [stats, setStats] = useState<PostStats | null>(null);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [editPost, setEditPost] = useState<Post | null>(null);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const [ps, st] = await Promise.all([
        api.get<Post[]>(`/social/posts${q}`),
        api.get<PostStats>("/social/posts/stats"),
      ]);
      setPosts(ps);
      setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [filter]);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await api.get<Account[]>("/social/accounts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load accounts");
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useListPageCommands({
    singular: "Composer",
    plural: "Composer",
    refresh: load,
  });

  async function publishNow(id: string) {
    // Real OAuth publish path — calls each channel's adapter (LinkedIn /
    // FB / IG / X). Falls back to the mock endpoint if the real path 4xxs
    // for a "no credentials on file" reason so demo tenants still see
    // the calendar populate. Retryable via the "Retry" button when a
    // channel-level failure happens.
    try {
      await api.post(`/social/posts/${id}/publish`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }
  async function retryPublish(id: string) {
    // Same underlying endpoint — the server-side helper re-tries any
    // per-channel result with status=Failed.
    try {
      await api.post(`/social/posts/${id}/publish`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed");
    }
  }
  async function unschedule(id: string) {
    try {
      await api.post(`/social/posts/${id}/unschedule`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unschedule failed");
    }
  }
  async function del(id: string) {
    if (!confirm("Delete this post?")) return;
    try {
      await api.del(`/social/posts/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const accountsById = useMemo(() => {
    const m = new Map<string, Account>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const statsText = stats
    ? `${stats.drafts} draft${stats.drafts === 1 ? "" : "s"} · ${stats.scheduled} scheduled · ${stats.publishedLast7d} published this week`
    : "…";

  const columns: Column<Post>[] = [
    {
      header: "Content",
      cell: (r) => (
        <span className="text-sm text-ink">
          {r.content.length > 80 ? `${r.content.slice(0, 80)}…` : r.content}
        </span>
      ),
    },
    {
      header: "Channels",
      cell: (r) => (
        <div className="flex items-center gap-1">
          {r.channelIds.map((id) => {
            const acc = accountsById.get(id);
            if (!acc) return null;
            return (
              <PlatformDot
                key={id}
                platform={acc.platform}
                size={18}
                title={`@${acc.handle}`}
              />
            );
          })}
        </div>
      ),
    },
    {
      header: "Status",
      cell: (r) => {
        const cls = POST_STATUS_BADGE[r.status] ?? "badge-gray";
        return <span className={cls}>{r.status}</span>;
      },
    },
    {
      header: "When",
      cell: (r) => (
        <span className="text-xs text-ink-muted">
          {r.status === "Published"
            ? dateShort(r.publishedAt)
            : r.scheduledFor
              ? dateShort(r.scheduledFor)
              : "—"}
        </span>
      ),
    },
    {
      header: "Engagement",
      align: "right",
      cell: (r) => {
        if (r.status !== "Published") return <span className="text-ink-muted/40">—</span>;
        const t = r.results.reduce(
          (acc, x) => {
            acc.likes += x.likes;
            acc.shares += x.shares;
            acc.comments += x.comments;
            return acc;
          },
          { likes: 0, shares: 0, comments: 0 },
        );
        return (
          <span className="text-xs text-ink-soft tabular-nums">
            {t.likes}♥ · {t.shares}↻ · {t.comments}💬
          </span>
        );
      },
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center gap-1 justify-end">
          {(r.status === "Draft" || r.status === "Scheduled") && (
            <button
              onClick={() => {
                setEditPost(r);
                setShowEdit(true);
              }}
              className="btn-ghost btn-sm"
            >
              Edit
            </button>
          )}
          {(r.status === "Draft" || r.status === "Scheduled") && (
            <button
              onClick={() => publishNow(r.id)}
              className="btn-ghost btn-sm text-brand-600"
            >
              Publish now
            </button>
          )}
          {r.status === "Failed" && (
            <button
              onClick={() => retryPublish(r.id)}
              className="btn-ghost btn-sm text-amber-600"
            >
              Retry
            </button>
          )}
          {r.status === "Scheduled" && (
            <button
              onClick={() => unschedule(r.id)}
              className="btn-ghost btn-sm text-ink-muted"
            >
              Unschedule
            </button>
          )}
          <button
            onClick={() => del(r.id)}
            className="btn-ghost btn-sm text-red-600"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Compose" subtitle={<span>{statsText}</span>} />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="mb-6">
        <Composer
          accounts={accounts}
          onSaved={load}
          onError={setError}
        />
      </div>

      <div className="mb-3 flex items-center gap-3">
        <Segmented<ListFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "Draft", label: "Draft" },
            { value: "Scheduled", label: "Scheduled" },
            { value: "Published", label: "Published" },
            { value: "Failed", label: "Failed" },
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={posts}
        rowKey={(r) => r.id}
        empty={{
          icon: Icon.send,
          title: "No posts yet",
          description:
            "Draft a post above and it will show up here — scheduled, published or failed.",
        }}
      />

      <Drawer
        open={showEdit && editPost != null}
        onClose={() => {
          setShowEdit(false);
          setEditPost(null);
        }}
        title={`Edit post`}
        width="w-[640px]"
      >
        {editPost && (
          <Composer
            accounts={accounts}
            editPost={editPost}
            bare
            onSaved={() => {
              setShowEdit(false);
              setEditPost(null);
              load();
            }}
            onCancel={() => {
              setShowEdit(false);
              setEditPost(null);
            }}
            onError={setError}
          />
        )}
      </Drawer>
    </>
  );
}
