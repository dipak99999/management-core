"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button, Card, FormField } from "../../components/ui";
import {
  PLATFORM_BG,
  isoToLocalInput,
  localInputToIso,
  platformInitial,
  type Account,
  type Post,
} from "./_shared";

// Extracted so the composer form can be imported by both /social/composer/page.tsx
// (as the top-of-page card) and /social/calendar/page.tsx (embedded in a drawer).
// A page file can't have named exports without tripping Next's page-type guard,
// so this lives in a `_`-prefixed sibling that Next treats as private.

export interface ComposerProps {
  accounts: Account[];
  editPost?: Post | null;
  initialScheduledFor?: string | null;
  onSaved: () => void;
  onError: (msg: string) => void;
  bare?: boolean;
  onCancel?: () => void;
}

export function Composer({
  accounts,
  editPost = null,
  initialScheduledFor = null,
  onSaved,
  onError,
  bare = false,
  onCancel,
}: ComposerProps) {
  const [content, setContent] = useState(editPost?.content ?? "");
  const [mediaUrls, setMediaUrls] = useState<string[]>(editPost?.mediaUrls ?? []);
  const [linkUrl, setLinkUrl] = useState(editPost?.linkUrl ?? "");
  const [channelIds, setChannelIds] = useState<string[]>(editPost?.channelIds ?? []);
  const [scheduleMode, setScheduleMode] = useState(
    Boolean(editPost?.scheduledFor || initialScheduledFor),
  );
  const [scheduledFor, setScheduledFor] = useState<string>(
    isoToLocalInput(editPost?.scheduledFor ?? initialScheduledFor ?? null),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setContent(editPost?.content ?? "");
    setMediaUrls(editPost?.mediaUrls ?? []);
    setLinkUrl(editPost?.linkUrl ?? "");
    setChannelIds(editPost?.channelIds ?? []);
    setScheduleMode(Boolean(editPost?.scheduledFor || initialScheduledFor));
    setScheduledFor(
      isoToLocalInput(editPost?.scheduledFor ?? initialScheduledFor ?? null),
    );
  }, [editPost, initialScheduledFor]);

  const charCount = content.length;
  const charColor =
    charCount > 280 ? "text-red-600"
    : charCount > 250 ? "text-amber-600"
    : "text-green-600";

  function toggleChannel(id: string) {
    setChannelIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }
  function addMediaRow() {
    if (mediaUrls.length >= 4) return;
    setMediaUrls((cur) => [...cur, ""]);
  }
  function updateMedia(i: number, v: string) {
    setMediaUrls((cur) => cur.map((u, ix) => (ix === i ? v : u)));
  }
  function removeMedia(i: number) {
    setMediaUrls((cur) => cur.filter((_, ix) => ix !== i));
  }
  function resetForm() {
    setContent("");
    setMediaUrls([]);
    setLinkUrl("");
    setChannelIds([]);
    setScheduleMode(false);
    setScheduledFor("");
  }

  const canSubmit =
    content.trim().length > 0 &&
    content.length <= 280 &&
    channelIds.length > 0 &&
    !busy;

  function body(overrideScheduledFor?: string | null) {
    const cleanMedia = mediaUrls.map((u) => u.trim()).filter(Boolean);
    return {
      content: content.trim(),
      mediaUrls: cleanMedia.length > 0 ? cleanMedia : undefined,
      linkUrl: linkUrl.trim() || undefined,
      channelIds,
      scheduledFor:
        overrideScheduledFor !== undefined
          ? overrideScheduledFor
          : scheduleMode
            ? localInputToIso(scheduledFor)
            : null,
    };
  }

  async function submit(action: "draft" | "schedule" | "publish") {
    if (!canSubmit) return;
    if (action === "schedule" && !scheduledFor) {
      onError("Pick a schedule time first.");
      return;
    }
    setBusy(true);
    try {
      const payload = body(action === "draft" ? null : undefined);
      if (editPost) {
        await api.put(`/social/posts/${editPost.id}`, payload);
        if (action === "publish") {
          await api.post(`/social/posts/${editPost.id}/publish-now`, {});
        } else if (action === "schedule") {
          await api.post(`/social/posts/${editPost.id}/schedule`, {
            scheduledFor: localInputToIso(scheduledFor),
          });
        }
      } else {
        const created = await api.post<Post>("/social/posts", payload);
        if (action === "publish") {
          await api.post(`/social/posts/${created.id}/publish-now`, {});
        }
      }
      if (!editPost) resetForm();
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save post");
    } finally {
      setBusy(false);
    }
  }

  const inner = (
    <>
      <div className="relative">
        <textarea
          className="input min-h-[140px] resize-y"
          placeholder="What's happening?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className={`absolute end-3 bottom-3 text-xs tabular-nums ${charColor}`}>
          {charCount}/280
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1.5">
          Media URLs
        </div>
        {mediaUrls.length === 0 && (
          <div className="text-xs text-ink-muted mb-1">
            No images attached. Up to 4 supported.
          </div>
        )}
        <div className="space-y-1.5">
          {mediaUrls.map((u, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input flex-1"
                placeholder="https://…/image.jpg"
                value={u}
                onChange={(e) => updateMedia(i, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeMedia(i)}
                className="btn-ghost btn-sm text-red-600"
                aria-label="Remove media"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {mediaUrls.length < 4 && (
          <button
            type="button"
            onClick={addMediaRow}
            className="btn-ghost btn-sm text-brand-600 mt-1.5"
          >
            + Add image URL
          </button>
        )}
      </div>

      <div className="mt-4">
        <FormField label="Link URL">
          <input
            className="input"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
          />
        </FormField>
      </div>

      <div className="mt-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-muted font-medium mb-1.5">
          Channels
        </div>
        {accounts.length === 0 ? (
          <div className="text-xs text-ink-muted">
            No connected channels yet.{" "}
            <a href="/crm/social/accounts" className="text-brand-600 hover:underline">
              Connect one
            </a>{" "}
            first.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => {
              const active = channelIds.includes(a.id);
              return (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => toggleChannel(a.id)}
                  className={`flex items-center gap-2 ps-1 pe-3 py-1 rounded-full border text-xs transition ${
                    active
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-ink-muted/20 bg-white text-ink-soft hover:border-brand-300"
                  }`}
                >
                  <span
                    className={`h-6 w-6 rounded-full grid place-items-center text-white text-[11px] font-bold ${PLATFORM_BG[a.platform]}`}
                  >
                    {platformInitial(a.platform)}
                  </span>
                  <span className="font-medium">@{a.handle}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => submit("draft")} disabled={!canSubmit}>
          Save draft
        </Button>
        <Button
          variant={scheduleMode ? "brand" : "secondary"}
          onClick={() => {
            if (!scheduleMode) setScheduleMode(true);
            else submit("schedule");
          }}
          disabled={busy || content.trim().length === 0 || channelIds.length === 0}
        >
          {scheduleMode ? "Schedule post" : "Schedule…"}
        </Button>
        {scheduleMode && (
          <>
            <input
              type="datetime-local"
              className="input w-auto"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                setScheduleMode(false);
                setScheduledFor("");
              }}
              className="btn-ghost btn-sm text-ink-muted"
            >
              Cancel schedule
            </button>
          </>
        )}
        <div className="flex-1" />
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={() => submit("publish")} disabled={!canSubmit}>
          Publish now
        </Button>
      </div>
    </>
  );

  if (bare) return inner;
  return <Card className="p-5">{inner}</Card>;
}
