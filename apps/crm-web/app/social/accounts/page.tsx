"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  FormField,
  PageHeader,
  Toast,
  dateShort,
} from "../../../components/ui";
import { Icon } from "../../../components/app-shell";
import {
  PLATFORMS,
  PLATFORM_GRADIENT,
  PLATFORM_LABEL,
  platformInitial,
  type Account,
  type Platform,
} from "../_shared";

// Connected Channels — one card per social account. Real OAuth flows will
// come later; for now operators enter their handle manually so they can
// still plan/schedule content against a placeholder.

const emptyDraft: {
  platform: Platform;
  handle: string;
  displayName: string;
  avatarUrl: string;
  externalId: string;
  isActive: boolean;
} = {
  platform: "Twitter",
  handle: "",
  displayName: "",
  avatarUrl: "",
  externalId: "",
  isActive: true,
};

export default function AccountsPage() {
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<Account[]>("/social/accounts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft.handle.trim() || !draft.displayName.trim()) {
      setError("Handle and display name are required");
      return;
    }
    setBusy(true);
    try {
      await api.post("/social/accounts", {
        platform: draft.platform,
        handle: draft.handle.replace(/^@/, "").trim(),
        displayName: draft.displayName.trim(),
        avatarUrl: draft.avatarUrl.trim() || undefined,
        externalId: draft.externalId.trim() || undefined,
        isActive: draft.isActive,
      });
      setShowAdd(false);
      setDraft({ ...emptyDraft });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save channel");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(a: Account) {
    try {
      await api.put(`/social/accounts/${a.id}`, {
        platform: a.platform,
        handle: a.handle,
        displayName: a.displayName,
        avatarUrl: a.avatarUrl ?? undefined,
        externalId: a.externalId ?? undefined,
        isActive: !a.isActive,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    }
  }

  // OAuth popup flow: hit /social/oauth/:platform/start to get the auth
  // URL, open it as a popup, then poll our own accounts list once the
  // popup closes (the platform redirects to our /callback which finishes
  // the exchange — see services/crm-service/src/routes/social-oauth.ts).
  async function connectOAuth(platform: "LinkedIn" | "Facebook" | "Instagram" | "Twitter") {
    try {
      const redirectUri = `${window.location.origin}/social/accounts/oauth-callback`;
      const { authUrl } = await api.get<{ authUrl: string; state: string }>(
        `/social/oauth/${platform}/start?redirectUri=${encodeURIComponent(redirectUri)}`,
      );
      const popup = window.open(
        authUrl,
        `oauth_${platform}`,
        "width=600,height=700,noopener=no",
      );
      if (!popup) {
        setError("Popup blocked — allow popups for this site to connect an account");
        return;
      }
      // Poll for the popup to close; then reload accounts.
      const timer = setInterval(async () => {
        if (popup.closed) {
          clearInterval(timer);
          await load();
        }
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OAuth start failed");
    }
  }

  async function disconnect(a: Account) {
    if (!confirm(`Disconnect ${PLATFORM_LABEL[a.platform]} @${a.handle}?`)) return;
    try {
      await api.del(`/social/accounts/${a.id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    }
  }

  return (
    <>
      <PageHeader
        title="Connected Channels"
        subtitle={
          <span>
            {rows.length} channel{rows.length === 1 ? "" : "s"} connected
          </span>
        }
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {(["LinkedIn", "Facebook", "Instagram", "Twitter"] as const).map((p) => (
              <Button
                key={p}
                variant="secondary"
                onClick={() => connectOAuth(p)}
              >
                Connect {p}
              </Button>
            ))}
            <Button variant="brand" onClick={() => setShowAdd(true)}>
              + Add Manually
            </Button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-xl bg-white shadow animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Icon.users}
          title="No channels connected"
          description="Add a social account to start composing and scheduling posts."
          action={
            <Button variant="brand" onClick={() => setShowAdd(true)}>
              + Add Channel
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((a) => (
            <Card key={a.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`h-12 w-12 rounded-xl ${PLATFORM_GRADIENT[a.platform]} grid place-items-center text-white text-lg font-bold shadow-brand-sm`}
                >
                  {platformInitial(a.platform)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-ink truncate">
                    {a.displayName}
                  </div>
                  <div className="text-xs text-ink-muted truncate">
                    @{a.handle} · {PLATFORM_LABEL[a.platform]}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-ink-muted">
                Added {dateShort(a.addedAt)}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-ink-muted/10">
                <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
                  <input
                    type="checkbox"
                    checked={a.isActive}
                    onChange={() => toggleActive(a)}
                  />
                  {a.isActive ? "Active" : "Paused"}
                </label>
                <button
                  onClick={() => disconnect(a)}
                  className="btn-ghost btn-sm text-red-600 hover:text-red-700"
                >
                  Disconnect
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Drawer
        open={showAdd}
        onClose={() => {
          setShowAdd(false);
          setDraft({ ...emptyDraft });
        }}
        title="Add channel"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowAdd(false);
                setDraft({ ...emptyDraft });
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={save}
              disabled={busy || !draft.handle.trim() || !draft.displayName.trim()}
            >
              {busy ? "Saving…" : "Connect"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Card className="p-3 bg-brand-50 border-brand-200 text-xs text-brand-800">
            Real OAuth to platforms is coming soon — for now, add manually so
            you can plan and schedule posts.
          </Card>

          <FormField label="Platform" required>
            <select
              className="input"
              value={draft.platform}
              onChange={(e) =>
                setDraft({ ...draft, platform: e.target.value as Platform })
              }
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Handle" required hint="Without the @ prefix">
            <div className="flex items-center gap-1.5">
              <span className="text-ink-muted text-sm">@</span>
              <input
                className="input flex-1"
                placeholder="lumaara"
                value={draft.handle}
                onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
              />
            </div>
          </FormField>

          <FormField label="Display name" required>
            <input
              className="input"
              placeholder="Lumaara Official"
              value={draft.displayName}
              onChange={(e) =>
                setDraft({ ...draft, displayName: e.target.value })
              }
            />
          </FormField>

          <FormField label="Avatar URL">
            <input
              className="input"
              placeholder="https://…/avatar.png"
              value={draft.avatarUrl}
              onChange={(e) => setDraft({ ...draft, avatarUrl: e.target.value })}
            />
          </FormField>

          <FormField label="External ID" hint="Optional — platform user ID for future OAuth pairing">
            <input
              className="input"
              value={draft.externalId}
              onChange={(e) =>
                setDraft({ ...draft, externalId: e.target.value })
              }
            />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) =>
                setDraft({ ...draft, isActive: e.target.checked })
              }
            />
            Active — enable this channel for composing
          </label>
        </div>
      </Drawer>
    </>
  );
}
