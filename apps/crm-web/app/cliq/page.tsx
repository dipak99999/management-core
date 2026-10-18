"use client";

// Cliq — internal team chat workspace (Zoho-Cliq / Slack-style).
//
// This page fills the AppShell content slot with a fixed, three-column
// layout (channels sidebar · chat pane · [thread drawer]). Because
// `.app-content` has padding + a max-width cap, we anchor with
// `position: fixed` to the viewport slot left of the AppShell sidebar
// (60 = w-60) and below the topbar (14 = h-14).
//
// Polling model:
//   • /cliq/channels every 15s → unread badges + last message preview
//   • /cliq/channels/:id/messages?after=<lastMsgId> every 3s → deltas
//   • mark-read fires on channel switch + when the composer is focused.

import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../lib/api";
import {
  Button,
  Drawer,
  FormField,
  Segmented,
  Toast,
  dateShort,
  relativeTime,
} from "../../components/ui";

// ─── Types (mirror crm-service /cliq contracts) ─────────────────────────

type ChannelType = "Direct" | "Public" | "Private";

interface ChannelListEntry {
  id: string;
  type: ChannelType;
  name: string;
  description: string | null;
  otherUserId: string | null;
  otherUserEmail: string | null;
  joinedAt: string;
  lastReadAt: string | null;
  isPinned: boolean;
  isMuted: boolean;
  unread: number;
  lastMessage: {
    id: string;
    body: string;
    senderName: string;
    createdAt: string;
  } | null;
}

interface ChannelBrowseEntry {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
}

interface ChannelMember {
  id: string;
  email: string;
  fullName: string;
}

interface ChannelDetail {
  id: string;
  type: ChannelType;
  name: string;
  description: string | null;
  members: ChannelMember[];
}

interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: string[];
}

interface CliqMessage {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  threadParentId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactionSummary: ReactionSummary[];
  threadReplyCount: number;
}

interface ThreadPayload {
  parent: CliqMessage;
  replies: CliqMessage[];
}

interface DirectoryUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

interface SessionPayload {
  userId?: string;
  token?: string;
}

// ─── Local helpers ──────────────────────────────────────────────────────

const COMMON_REACTIONS = ["👍", "❤️", "😄", "🎉", "🙏", "🚀", "👀", "✅"];

const AVATAR_PALETTE = [
  "bg-brand-100 text-brand-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-lime-100 text-lime-700",
];

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function avatarClass(seed: string | null | undefined): string {
  const s = (seed || "?").toLowerCase();
  return AVATAR_PALETTE[hashString(s) % AVATAR_PALETTE.length];
}

function firstLetter(name: string | null | undefined): string {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function sessionUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionPayload;
    return parsed.userId ?? null;
  } catch {
    return null;
  }
}

function channelDisplayName(c: {
  type: ChannelType;
  name: string;
}): string {
  return c.name;
}

// ─── Sub-components (kept in-file per constraints) ──────────────────────

function ChannelRowIcon({
  channel,
}: {
  channel: Pick<ChannelListEntry, "type" | "name" | "otherUserEmail">;
}) {
  if (channel.type === "Direct") {
    const seed = channel.otherUserEmail ?? channel.name;
    return (
      <span
        className={`h-6 w-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0 ${avatarClass(seed)}`}
      >
        {firstLetter(channel.name)}
      </span>
    );
  }
  return (
    <span className="h-6 w-6 rounded-md grid place-items-center text-ink-muted shrink-0 text-sm font-semibold">
      {channel.type === "Private" ? "🔒" : "#"}
    </span>
  );
}

function ChannelBadge({ type }: { type: ChannelType }) {
  const label =
    type === "Direct" ? "Direct" : type === "Private" ? "Private" : "Public";
  const cls =
    type === "Private"
      ? "badge-amber"
      : type === "Direct"
        ? "badge-gray"
        : "badge-blue";
  return <span className={cls}>{label}</span>;
}

function ReactionChip({
  reaction,
  mine,
  onToggle,
}: {
  reaction: ReactionSummary;
  mine: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition ${
        mine
          ? "bg-brand-50 border-brand-200 text-brand-700"
          : "bg-white border-ink-muted/15 text-ink-soft hover:bg-brand-50/60"
      }`}
    >
      <span>{reaction.emoji}</span>
      <span className="tabular-nums">{reaction.count}</span>
    </button>
  );
}

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="absolute bottom-full end-0 mb-2 z-10 flex gap-0.5 p-1 rounded-lg bg-white border border-ink-muted/15 shadow-brand-glow">
      {COMMON_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="w-7 h-7 grid place-items-center rounded hover:bg-brand-50 text-base"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// One rendered message. Merges consecutive same-author messages inside 3min.
function MessageItem({
  message,
  showHeader,
  meUserId,
  onReact,
  onOpenThread,
  onStartEdit,
  onDelete,
}: {
  message: CliqMessage;
  showHeader: boolean;
  meUserId: string | null;
  onReact: (emoji: string) => void;
  onOpenThread: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [hover, setHover] = useState(false);
  const mine = meUserId === message.senderUserId;
  const deleted = !!message.deletedAt;
  const hasReactions = message.reactionSummary.length > 0;

  return (
    <div
      className="group relative px-4 py-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setShowPicker(false);
      }}
    >
      <div className="flex gap-3">
        <div className="w-9 shrink-0">
          {showHeader ? (
            <span
              className={`h-9 w-9 rounded-md grid place-items-center text-sm font-bold ${avatarClass(message.senderName)}`}
            >
              {firstLetter(message.senderName)}
            </span>
          ) : (
            <span className="block w-9 h-4 text-[10px] text-ink-muted opacity-0 group-hover:opacity-100 text-end pe-1 leading-4">
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {showHeader && (
            <div className="flex items-baseline gap-2">
              <span className="font-semibold text-ink text-sm">
                {message.senderName}
              </span>
              <span
                className="text-[11px] text-ink-muted"
                title={new Date(message.createdAt).toLocaleString()}
              >
                {relativeTime(message.createdAt)}
              </span>
              {message.editedAt && (
                <span className="text-[10px] text-ink-muted bg-surface-sunken rounded px-1.5 py-px">
                  edited
                </span>
              )}
            </div>
          )}
          {deleted ? (
            <div className="italic text-ink-muted text-sm">
              Message deleted
            </div>
          ) : (
            <div
              className={`text-sm text-ink whitespace-pre-wrap break-words ${
                hasReactions
                  ? "bg-brand-50/40 border border-brand-100/60 rounded-lg px-2.5 py-1.5 inline-block"
                  : ""
              }`}
            >
              {message.body}
            </div>
          )}
          {(hasReactions || message.threadReplyCount > 0) && !deleted && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {message.reactionSummary.map((r) => (
                <ReactionChip
                  key={r.emoji}
                  reaction={r}
                  mine={!!meUserId && r.userIds.includes(meUserId)}
                  onToggle={() => onReact(r.emoji)}
                />
              ))}
              {message.threadReplyCount > 0 && (
                <button
                  type="button"
                  onClick={onOpenThread}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {message.threadReplyCount}{" "}
                  {message.threadReplyCount === 1 ? "reply" : "replies"} →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {hover && !deleted && (
        <div className="absolute -top-3 end-4 flex items-center gap-1 bg-white border border-ink-muted/15 rounded-lg shadow-brand-sm px-1 py-0.5 z-10">
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            title="React"
            className="w-7 h-7 grid place-items-center rounded hover:bg-brand-50 text-base"
          >
            🙂
          </button>
          <button
            type="button"
            onClick={onOpenThread}
            title="Reply in thread"
            className="w-7 h-7 grid place-items-center rounded hover:bg-brand-50 text-ink-muted"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 5v4a3 3 0 0 0 3 3h9M13 9l3 3-3 3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {mine && (
            <>
              <button
                type="button"
                onClick={onStartEdit}
                title="Edit"
                className="w-7 h-7 grid place-items-center rounded hover:bg-brand-50 text-ink-muted"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4 16l3-1 9-9-2-2-9 9-1 3zM12 4l4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                onClick={onDelete}
                title="Delete"
                className="w-7 h-7 grid place-items-center rounded hover:bg-red-50 text-ink-muted hover:text-red-600"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
          {showPicker && (
            <EmojiPicker
              onPick={(e) => {
                onReact(e);
                setShowPicker(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────

export default function CliqPage() {
  const [meUserId, setMeUserId] = useState<string | null>(null);
  useEffect(() => {
    setMeUserId(sessionUserId());
  }, []);

  const [channels, setChannels] = useState<ChannelListEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [messages, setMessages] = useState<CliqMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );

  const [toast, setToast] = useState<{
    kind: "info" | "success" | "error";
    message: string;
  } | null>(null);

  const [sidebarQuery, setSidebarQuery] = useState("");

  // Drawer states.
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseList, setBrowseList] = useState<ChannelBrowseEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<"Public" | "Private">("Public");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createMembers, setCreateMembers] = useState<Set<string>>(new Set());
  const [createBusy, setCreateBusy] = useState(false);

  const [dmOpen, setDmOpen] = useState(false);
  const [dmQuery, setDmQuery] = useState("");
  const [dmBusy, setDmBusy] = useState(false);

  const [users, setUsers] = useState<DirectoryUser[]>([]);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberBusy, setAddMemberBusy] = useState(false);

  const [threadOpen, setThreadOpen] = useState(false);
  const [thread, setThread] = useState<ThreadPayload | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const [threadBusy, setThreadBusy] = useState(false);
  const activeThreadParentIdRef = useRef<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const sidebarSearchRef = useRef<HTMLInputElement | null>(null);

  // Drag-to-resize channel sidebar. Starts at 280px, user can grab the
  // 4px handle on its right edge and resize between 200px and 480px.
  // Persisted so the choice sticks across visits.
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const resizingRef = useRef(false);
  useEffect(() => {
    const raw = localStorage.getItem("cliq.sidebarWidth");
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(n) && n >= 200 && n <= 480) setSidebarWidth(n);
  }, []);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current) return;
      // Clamp to [200, 480] — narrower makes nav labels truncate; wider
      // eats too much of the message area on a 13" laptop.
      const next = Math.max(200, Math.min(480, e.clientX - 240));
      setSidebarWidth(next);
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("cliq.sidebarWidth", String(sidebarWidth));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);
  const startResize = () => {
    resizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // ── Channel list ──────────────────────────────────────────────────────

  const loadChannels = useCallback(async () => {
    try {
      const list = await api.get<ChannelListEntry[]>("/cliq/channels");
      setChannels(list);
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load channels",
      });
    }
  }, []);

  useEffect(() => {
    loadChannels();
    const t = setInterval(loadChannels, 15000);
    return () => clearInterval(t);
  }, [loadChannels]);

  // Load directory once (used by DM picker + create-private + add-member).
  useEffect(() => {
    api
      .get<DirectoryUser[]>("/cliq/users")
      .then(setUsers)
      .catch(() => {
        /* non-fatal — drawers just show empty list */
      });
  }, []);

  // ── Active channel: detail + messages ────────────────────────────────

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api.get<ChannelDetail>(`/cliq/channels/${id}`);
      setDetail(d);
    } catch (e) {
      setToast({
        kind: "error",
        message:
          e instanceof Error ? e.message : "Failed to load channel detail",
      });
    }
  }, []);

  const loadMessagesInitial = useCallback(async (id: string) => {
    try {
      const msgs = await api.get<CliqMessage[]>(
        `/cliq/channels/${id}/messages?limit=100`,
      );
      // Ensure ascending order (bottom = newest).
      const sorted = [...msgs].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      );
      // Filter out thread replies from the main pane — they only render in
      // the thread drawer. Root messages still show their reply count.
      const roots = sorted.filter((m) => !m.threadParentId);
      setMessages(roots);
      lastMsgIdRef.current = sorted.length
        ? sorted[sorted.length - 1].id
        : null;
    } catch (e) {
      setToast({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load messages",
      });
    }
  }, []);

  const pollMessages = useCallback(async () => {
    if (!activeId) return;
    const after = lastMsgIdRef.current;
    if (!after) return;
    try {
      const next = await api.get<CliqMessage[]>(
        `/cliq/channels/${activeId}/messages?after=${encodeURIComponent(after)}&limit=100`,
      );
      if (next.length === 0) return;
      const sorted = [...next].sort(
        (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
      );
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of sorted) {
          if (m.threadParentId) continue; // replies handled by thread panel
          if (!seen.has(m.id)) merged.push(m);
        }
        return merged;
      });
      lastMsgIdRef.current = sorted[sorted.length - 1].id;

      // If the thread drawer is open, refresh it so live replies land.
      if (activeThreadParentIdRef.current) {
        loadThread(activeThreadParentIdRef.current, /* silent */ true);
      }
       
    } catch {
      // silent — retry next tick
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Auto-scroll on new message.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, activeId]);

  // Switch channel → load history, mark read, restart polling.
  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      setMessages([]);
      lastMsgIdRef.current = null;
      return;
    }
    setDetail(null);
    setMessages([]);
    lastMsgIdRef.current = null;
    loadDetail(activeId);
    loadMessagesInitial(activeId);
    api.post(`/cliq/channels/${activeId}/mark-read`, {}).catch(() => {});
    loadChannels();
    const t = setInterval(pollMessages, 3000);
    return () => clearInterval(t);
  }, [activeId, loadDetail, loadMessagesInitial, pollMessages, loadChannels]);

  // Cmd/Ctrl+K → focus sidebar search.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // The AppShell's global search also binds Cmd+K — but that input is
        // hidden on <md. We still respect ours here as a channel jumper.
        const target = e.target as HTMLElement | null;
        // Avoid stealing focus if user is inside the composer.
        if (target && target.tagName === "TEXTAREA") return;
        if (sidebarSearchRef.current) {
          e.preventDefault();
          sidebarSearchRef.current.focus();
          sidebarSearchRef.current.select();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Derived views ────────────────────────────────────────────────────

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeId) ?? null,
    [channels, activeId],
  );

  const filteredChannels = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, sidebarQuery]);

  const groupedChannels = useMemo(() => {
    const pinned = filteredChannels
      .filter((c) => c.isPinned)
      .sort((a, b) => a.name.localeCompare(b.name));
    const rooms = filteredChannels
      .filter((c) => !c.isPinned && c.type !== "Direct")
      .sort((a, b) => a.name.localeCompare(b.name));
    const dms = filteredChannels
      .filter((c) => !c.isPinned && c.type === "Direct")
      .sort((a, b) => a.name.localeCompare(b.name));
    return { pinned, rooms, dms };
  }, [filteredChannels]);

  // ── Actions ──────────────────────────────────────────────────────────

  async function sendMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!activeId) return;
    const body = composer.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (editing) {
        const updated = await api.patch<CliqMessage>(
          `/cliq/messages/${editing.id}`,
          { body },
        );
        setMessages((prev) =>
          prev.map((m) => (m.id === updated.id ? updated : m)),
        );
        setEditing(null);
      } else {
        const created = await api.post<CliqMessage>(
          `/cliq/channels/${activeId}/messages`,
          { body },
        );
        setMessages((prev) => {
          if (prev.some((m) => m.id === created.id)) return prev;
          return [...prev, created];
        });
        if (
          !lastMsgIdRef.current ||
          +new Date(created.createdAt) >=
            +new Date(
              messages.length
                ? messages[messages.length - 1].createdAt
                : created.createdAt,
            )
        ) {
          lastMsgIdRef.current = created.id;
        }
      }
      setComposer("");
      api.post(`/cliq/channels/${activeId}/mark-read`, {}).catch(() => {});
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to send",
      });
    } finally {
      setSending(false);
    }
  }

  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Enter=send, Shift+Enter=newline, Cmd/Ctrl+Enter=send.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function startEdit(m: CliqMessage) {
    setEditing({ id: m.id, body: m.body });
    setComposer(m.body);
  }

  function cancelEdit() {
    setEditing(null);
    setComposer("");
  }

  async function deleteMessage(m: CliqMessage) {
    if (!confirm("Delete this message?")) return;
    try {
      await api.del(`/cliq/messages/${m.id}`);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id
            ? { ...x, deletedAt: new Date().toISOString(), body: "" }
            : x,
        ),
      );
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to delete",
      });
    }
  }

  async function toggleReaction(m: CliqMessage, emoji: string) {
    const mine =
      !!meUserId &&
      m.reactionSummary.some(
        (r) => r.emoji === emoji && r.userIds.includes(meUserId),
      );
    try {
      if (mine) {
        await api.post(`/cliq/messages/${m.id}/unreact`, { emoji });
      } else {
        await api.post(`/cliq/messages/${m.id}/react`, { emoji });
      }
      // Optimistic local update; poll will reconcile.
      setMessages((prev) =>
        prev.map((x) => {
          if (x.id !== m.id) return x;
          const existing = x.reactionSummary.find((r) => r.emoji === emoji);
          let next: ReactionSummary[];
          if (existing) {
            const newUsers = mine
              ? existing.userIds.filter((u) => u !== meUserId)
              : [...existing.userIds, meUserId!];
            if (newUsers.length === 0) {
              next = x.reactionSummary.filter((r) => r.emoji !== emoji);
            } else {
              next = x.reactionSummary.map((r) =>
                r.emoji === emoji
                  ? { ...r, count: newUsers.length, userIds: newUsers }
                  : r,
              );
            }
          } else {
            next = [
              ...x.reactionSummary,
              { emoji, count: 1, userIds: [meUserId!] },
            ];
          }
          return { ...x, reactionSummary: next };
        }),
      );
      // Same for thread panel.
      if (thread) {
        const patch = (msg: CliqMessage): CliqMessage => {
          if (msg.id !== m.id) return msg;
          const existing = msg.reactionSummary.find((r) => r.emoji === emoji);
          let next: ReactionSummary[];
          if (existing) {
            const newUsers = mine
              ? existing.userIds.filter((u) => u !== meUserId)
              : [...existing.userIds, meUserId!];
            if (newUsers.length === 0) {
              next = msg.reactionSummary.filter((r) => r.emoji !== emoji);
            } else {
              next = msg.reactionSummary.map((r) =>
                r.emoji === emoji
                  ? { ...r, count: newUsers.length, userIds: newUsers }
                  : r,
              );
            }
          } else {
            next = [
              ...msg.reactionSummary,
              { emoji, count: 1, userIds: [meUserId!] },
            ];
          }
          return { ...msg, reactionSummary: next };
        };
        setThread({
          parent: patch(thread.parent),
          replies: thread.replies.map(patch),
        });
      }
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Reaction failed",
      });
    }
  }

  // ── Thread drawer ─────────────────────────────────────────────────────

  const loadThread = useCallback(
    async (parentId: string, silent = false) => {
      try {
        const t = await api.get<ThreadPayload>(
          `/cliq/messages/${parentId}/thread`,
        );
        setThread(t);
      } catch (err) {
        if (!silent) {
          setToast({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to load thread",
          });
        }
      }
    },
    [],
  );

  async function openThread(parent: CliqMessage) {
    activeThreadParentIdRef.current = parent.id;
    setThreadDraft("");
    setThread({ parent, replies: [] });
    setThreadOpen(true);
    await loadThread(parent.id);
  }

  function closeThread() {
    setThreadOpen(false);
    setThread(null);
    setThreadDraft("");
    activeThreadParentIdRef.current = null;
  }

  async function sendThreadReply(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!activeId || !thread) return;
    const body = threadDraft.trim();
    if (!body || threadBusy) return;
    setThreadBusy(true);
    try {
      const created = await api.post<CliqMessage>(
        `/cliq/channels/${activeId}/messages`,
        { body, threadParentId: thread.parent.id },
      );
      setThread((prev) =>
        prev
          ? {
              parent: {
                ...prev.parent,
                threadReplyCount: prev.parent.threadReplyCount + 1,
              },
              replies: [...prev.replies, created],
            }
          : prev,
      );
      // Bump reply count on the message in the main pane too.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thread.parent.id
            ? { ...m, threadReplyCount: m.threadReplyCount + 1 }
            : m,
        ),
      );
      setThreadDraft("");
    } catch (err) {
      setToast({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to reply in thread",
      });
    } finally {
      setThreadBusy(false);
    }
  }

  // ── Browse / Create / DM / Add-member ────────────────────────────────

  async function openBrowse() {
    setBrowseOpen(true);
    setBrowseLoading(true);
    try {
      const list = await api.get<ChannelBrowseEntry[]>(
        "/cliq/channels/browse",
      );
      setBrowseList(list);
    } catch (err) {
      setToast({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to load channels",
      });
    } finally {
      setBrowseLoading(false);
    }
  }

  async function joinFromBrowse(channelId: string) {
    try {
      await api.post(`/cliq/channels/${channelId}/join`, {});
      await loadChannels();
      setBrowseList((prev) =>
        prev.map((c) =>
          c.id === channelId
            ? { ...c, joined: true, memberCount: c.memberCount + 1 }
            : c,
        ),
      );
      setActiveId(channelId);
      setBrowseOpen(false);
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to join",
      });
    }
  }

  function openCreate() {
    setCreateType("Public");
    setCreateName("");
    setCreateDesc("");
    setCreateMembers(new Set());
    setCreateOpen(true);
  }

  const nameOk = /^[a-z0-9-]{1,60}$/.test(createName);
  const nameErr = createName && !nameOk
    ? "Lowercase letters, digits, and hyphens only"
    : "";

  async function submitCreate() {
    if (!nameOk || createBusy) return;
    setCreateBusy(true);
    try {
      const created = await api.post<{ id: string }>("/cliq/channels", {
        type: createType,
        name: createName,
        description: createDesc || undefined,
        memberUserIds:
          createType === "Private" ? Array.from(createMembers) : undefined,
      });
      await loadChannels();
      setActiveId(created.id);
      setCreateOpen(false);
    } catch (err) {
      setToast({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to create channel",
      });
    } finally {
      setCreateBusy(false);
    }
  }

  const dmCandidates = useMemo(() => {
    const q = dmQuery.trim().toLowerCase();
    return users
      .filter((u) => u.id !== meUserId)
      .filter(
        (u) =>
          !q ||
          u.fullName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [users, dmQuery, meUserId]);

  async function startDm(userId: string) {
    if (dmBusy) return;
    setDmBusy(true);
    try {
      const dm = await api.post<{ id: string }>("/cliq/channels/dm", {
        userId,
      });
      await loadChannels();
      setActiveId(dm.id);
      setDmOpen(false);
      setDmQuery("");
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to open DM",
      });
    } finally {
      setDmBusy(false);
    }
  }

  const nonMemberUsers = useMemo(() => {
    if (!detail) return [];
    const memberIds = new Set(detail.members.map((m) => m.id));
    return users.filter((u) => !memberIds.has(u.id) && u.id !== meUserId);
  }, [users, detail, meUserId]);

  async function addMemberToChannel(userId: string) {
    if (!activeId || addMemberBusy) return;
    setAddMemberBusy(true);
    try {
      await api.post(`/cliq/channels/${activeId}/add-member`, { userId });
      await loadDetail(activeId);
    } catch (err) {
      setToast({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to add member",
      });
    } finally {
      setAddMemberBusy(false);
    }
  }

  async function leaveChannel() {
    if (!activeId) return;
    if (!confirm("Leave this channel?")) return;
    try {
      await api.post(`/cliq/channels/${activeId}/leave`, {});
      setActiveId(null);
      await loadChannels();
    } catch (err) {
      setToast({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to leave",
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  const placeholder = !activeChannel
    ? "Message"
    : activeChannel.type === "Direct"
      ? `Message @${activeChannel.name}`
      : `Message #${activeChannel.name}`;

  // Fixed workspace shell that fills the AppShell content slot. `.app-topbar`
  // is h-16 (64px) and `.app-sidebar` is w-60 (240px) — anchor to viewport
  // minus those. The padded `.app-content` is already escaped by
  // position:fixed; no negative margin needed (and -m-6 would shift the
  // fixed box -24px on each side, clipping it under the sidebar/topbar).
  return (
    <div className="fixed top-16 start-60 end-0 bottom-0 flex bg-white">
      {/* ── Channels sidebar (resizable) ───────────────────────────── */}
      <aside
        className="shrink-0 border-e border-ink-muted/10 bg-surface-sunken flex flex-col relative"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="p-3 border-b border-ink-muted/10 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-ink">Chat</div>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={openCreate}
              className="flex-1"
            >
              + Channel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDmOpen(true)}
              className="flex-1"
            >
              + DM
            </Button>
          </div>
          <div className="relative">
            <input
              ref={sidebarSearchRef}
              className="input input-sm w-full pe-10"
              placeholder="Jump to…"
              value={sidebarQuery}
              onChange={(e) => setSidebarQuery(e.target.value)}
            />
            <kbd className="absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-muted bg-white/60 border border-ink-muted/20 rounded px-1 py-px">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {groupedChannels.pinned.length > 0 && (
            <ChannelGroup
              label="Pinned"
              rows={groupedChannels.pinned}
              activeId={activeId}
              onSelect={setActiveId}
            />
          )}
          <div className="flex items-center justify-between px-3 pt-4 pb-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              Channels
            </div>
            <button
              type="button"
              onClick={openBrowse}
              className="text-[11px] text-brand-600 hover:underline"
            >
              + browse
            </button>
          </div>
          {groupedChannels.rooms.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">
              No channels yet
            </div>
          ) : (
            groupedChannels.rooms.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                active={c.id === activeId}
                onSelect={() => setActiveId(c.id)}
              />
            ))
          )}

          <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Direct messages
          </div>
          {groupedChannels.dms.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">
              No conversations yet
            </div>
          ) : (
            groupedChannels.dms.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                active={c.id === activeId}
                onSelect={() => setActiveId(c.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* Drag handle — 4px grab zone that widens on hover; cursor hints it
          is resizable. Keeps the splitter visible without stealing layout
          room from the sidebar/pane on either side. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize channels sidebar"
        onMouseDown={startResize}
        className="w-1 shrink-0 cursor-col-resize bg-ink-muted/10 hover:bg-brand-400/60 transition-colors"
      />

      {/* ── Chat pane ───────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col min-w-0">
        {!activeChannel ? (
          <div className="flex-1 grid place-items-center p-8">
            <div className="max-w-md w-full text-center card p-8">
              <div className="empty-state-icon mx-auto">
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-3 3v-3H5a2 2 0 0 1-2-2V5z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="text-base font-semibold text-ink">
                Pick a channel or start a DM
              </div>
              <div className="text-sm text-ink-muted mt-1">
                Team Chat keeps your conversations right next to the work
                they belong to.
              </div>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="brand" onClick={openCreate}>
                  New channel
                </Button>
                <Button variant="secondary" onClick={() => setDmOpen(true)}>
                  New DM
                </Button>
                <Button variant="ghost" onClick={openBrowse}>
                  Browse
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-ink-muted/10 px-5 py-3 flex items-start gap-3 shrink-0 bg-white">
              <ChannelRowIcon channel={activeChannel} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-semibold text-ink truncate">
                    {activeChannel.type === "Direct" ? "" : "#"}
                    {channelDisplayName(activeChannel)}
                  </div>
                  <ChannelBadge type={activeChannel.type} />
                </div>
                {(activeChannel.description ||
                  detail?.description ||
                  detail?.members) && (
                  <div className="text-xs text-ink-muted truncate">
                    {activeChannel.description ||
                      detail?.description ||
                      (detail?.members
                        ? `${detail.members.length} member${detail.members.length === 1 ? "" : "s"}`
                        : "")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {detail && (
                  <span className="text-xs text-ink-muted">
                    {detail.members.length}{" "}
                    member{detail.members.length === 1 ? "" : "s"}
                  </span>
                )}
                {activeChannel.type !== "Direct" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAddMemberOpen(true)}
                  >
                    Add member
                  </Button>
                )}
                {activeChannel.type !== "Direct" && (
                  <Button size="sm" variant="ghost" onClick={leaveChannel}>
                    Leave
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto py-3"
              style={{ scrollBehavior: "smooth" }}
            >
              {messages.length === 0 ? (
                <div className="h-full grid place-items-center text-sm text-ink-muted">
                  No messages yet — say hello 👋
                </div>
              ) : (
                messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const merge =
                    prev &&
                    prev.senderUserId === m.senderUserId &&
                    !prev.deletedAt &&
                    !m.deletedAt &&
                    +new Date(m.createdAt) - +new Date(prev.createdAt) <
                      3 * 60 * 1000;
                  return (
                    <MessageItem
                      key={m.id}
                      message={m}
                      showHeader={!merge}
                      meUserId={meUserId}
                      onReact={(emoji) => toggleReaction(m, emoji)}
                      onOpenThread={() => openThread(m)}
                      onStartEdit={() => startEdit(m)}
                      onDelete={() => deleteMessage(m)}
                    />
                  );
                })
              )}
            </div>

            {/* Composer */}
            <form
              onSubmit={sendMessage}
              className="border-t border-ink-muted/10 p-3 bg-white shrink-0"
            >
              {editing && (
                <div className="mb-2 flex items-center justify-between text-xs bg-brand-50 border border-brand-100 rounded px-2 py-1">
                  <span className="text-brand-700">
                    Editing message — Esc to cancel
                  </span>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="text-brand-700 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="input flex-1 resize-none"
                  rows={2}
                  placeholder={placeholder}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (editing && e.key === "Escape") {
                      e.preventDefault();
                      cancelEdit();
                    } else {
                      onComposerKey(e);
                    }
                  }}
                  onFocus={() => {
                    if (activeId) {
                      api
                        .post(`/cliq/channels/${activeId}/mark-read`, {})
                        .catch(() => {});
                    }
                  }}
                  disabled={sending}
                />
                <Button
                  type="submit"
                  variant="brand"
                  disabled={sending || composer.trim().length === 0}
                >
                  {editing ? "Save" : "Send"}
                </Button>
              </div>
            </form>
          </>
        )}
      </section>

      {toast && (
        <div className="fixed bottom-4 end-4 z-40 w-80">
          <Toast
            kind={toast.kind}
            message={toast.message}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      {/* ── Browse drawer ─────────────────────────────────────────── */}
      <Drawer
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        title="Browse public channels"
        width="w-[460px]"
      >
        {browseLoading ? (
          <div className="text-sm text-ink-muted">Loading…</div>
        ) : browseList.length === 0 ? (
          <div className="text-sm text-ink-muted">
            No public channels yet.
          </div>
        ) : (
          <ul className="divide-y divide-ink-muted/10">
            {browseList.map((c) => (
              <li
                key={c.id}
                className="py-3 flex items-start gap-3 justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink text-sm">
                    # {c.name}
                  </div>
                  {c.description && (
                    <div className="text-xs text-ink-muted mt-0.5 truncate">
                      {c.description}
                    </div>
                  )}
                  <div className="text-[11px] text-ink-muted mt-1">
                    {c.memberCount}{" "}
                    member{c.memberCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="shrink-0">
                  {c.joined ? (
                    <span className="badge-green">Joined</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="brand"
                      onClick={() => joinFromBrowse(c.id)}
                    >
                      Join
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      {/* ── Create-channel drawer ─────────────────────────────────── */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New channel"
        width="w-[460px]"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="brand"
              onClick={submitCreate}
              disabled={!nameOk || createBusy}
            >
              {createBusy ? "Creating…" : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormField label="Type">
            <Segmented
              value={createType}
              options={[
                { value: "Public", label: "Public" },
                { value: "Private", label: "Private" },
              ]}
              onChange={(v) => setCreateType(v)}
            />
          </FormField>
          <FormField
            label="Name"
            required
            error={nameErr || undefined}
            hint="Lowercase letters, digits, hyphens. Auto-formatted."
          >
            <input
              className="input"
              value={createName}
              onChange={(e) =>
                setCreateName(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                )
              }
              placeholder="e.g. product-launch"
            />
          </FormField>
          <FormField label="Description">
            <input
              className="input"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              placeholder="What's this channel about?"
            />
          </FormField>
          {createType === "Private" && (
            <FormField
              label="Members"
              hint={`${createMembers.size} selected`}
            >
              <div className="max-h-64 overflow-y-auto border border-ink-muted/15 rounded-md divide-y divide-ink-muted/10">
                {users
                  .filter((u) => u.id !== meUserId)
                  .map((u) => {
                    const checked = createMembers.has(u.id);
                    return (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-brand-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setCreateMembers((prev) => {
                              const next = new Set(prev);
                              if (next.has(u.id)) next.delete(u.id);
                              else next.add(u.id);
                              return next;
                            });
                          }}
                        />
                        <span
                          className={`h-6 w-6 rounded-full grid place-items-center text-[11px] font-bold ${avatarClass(u.email)}`}
                        >
                          {firstLetter(u.fullName)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm text-ink truncate">
                            {u.fullName}
                          </div>
                          <div className="text-[11px] text-ink-muted truncate">
                            {u.email}
                          </div>
                        </div>
                      </label>
                    );
                  })}
              </div>
            </FormField>
          )}
        </div>
      </Drawer>

      {/* ── New DM drawer ─────────────────────────────────────────── */}
      <Drawer
        open={dmOpen}
        onClose={() => {
          setDmOpen(false);
          setDmQuery("");
        }}
        title="New direct message"
        width="w-[420px]"
      >
        <input
          autoFocus
          className="input mb-3"
          placeholder="Search people…"
          value={dmQuery}
          onChange={(e) => setDmQuery(e.target.value)}
        />
        {dmCandidates.length === 0 ? (
          <div className="text-sm text-ink-muted">No matches.</div>
        ) : (
          <ul className="divide-y divide-ink-muted/10">
            {dmCandidates.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={dmBusy}
                  onClick={() => startDm(u.id)}
                  className="w-full flex items-center gap-3 py-2.5 px-2 rounded hover:bg-brand-50 text-start"
                >
                  <span
                    className={`h-8 w-8 rounded-full grid place-items-center text-xs font-bold ${avatarClass(u.email)}`}
                  >
                    {firstLetter(u.fullName)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">
                      {u.fullName}
                    </div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {u.email}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      {/* ── Add member drawer ─────────────────────────────────────── */}
      <Drawer
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        title={
          activeChannel
            ? `Add members to #${activeChannel.name}`
            : "Add members"
        }
        width="w-[420px]"
      >
        {nonMemberUsers.length === 0 ? (
          <div className="text-sm text-ink-muted">
            Everyone is already in this channel.
          </div>
        ) : (
          <ul className="divide-y divide-ink-muted/10">
            {nonMemberUsers.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 py-2.5 px-1"
              >
                <span
                  className={`h-8 w-8 rounded-full grid place-items-center text-xs font-bold ${avatarClass(u.email)}`}
                >
                  {firstLetter(u.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">
                    {u.fullName}
                  </div>
                  <div className="text-[11px] text-ink-muted truncate">
                    {u.email}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="brand"
                  disabled={addMemberBusy}
                  onClick={() => addMemberToChannel(u.id)}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      {/* ── Thread drawer ─────────────────────────────────────────── */}
      <Drawer
        open={threadOpen}
        onClose={closeThread}
        title="Thread"
        width="w-[460px]"
      >
        {!thread ? (
          <div className="text-sm text-ink-muted">Loading…</div>
        ) : (
          <div className="flex flex-col h-full -m-5">
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              <MessageItem
                message={thread.parent}
                showHeader
                meUserId={meUserId}
                onReact={(e) => toggleReaction(thread.parent, e)}
                onOpenThread={() => {}}
                onStartEdit={() => startEdit(thread.parent)}
                onDelete={() => deleteMessage(thread.parent)}
              />
              <div className="border-t border-ink-muted/10 my-2 flex items-center gap-2 px-4">
                <span className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold py-2">
                  {thread.replies.length}{" "}
                  {thread.replies.length === 1 ? "reply" : "replies"}
                </span>
              </div>
              {thread.replies.map((r, i) => {
                const prev = thread.replies[i - 1];
                const merge =
                  prev &&
                  prev.senderUserId === r.senderUserId &&
                  +new Date(r.createdAt) - +new Date(prev.createdAt) <
                    3 * 60 * 1000;
                return (
                  <MessageItem
                    key={r.id}
                    message={r}
                    showHeader={!merge}
                    meUserId={meUserId}
                    onReact={(e) => toggleReaction(r, e)}
                    onOpenThread={() => {}}
                    onStartEdit={() => startEdit(r)}
                    onDelete={() => deleteMessage(r)}
                  />
                );
              })}
            </div>
            <form
              onSubmit={sendThreadReply}
              className="border-t border-ink-muted/10 p-3 bg-white shrink-0 flex items-end gap-2"
            >
              <textarea
                className="input flex-1 resize-none"
                rows={2}
                placeholder="Reply in thread…"
                value={threadDraft}
                onChange={(e) => setThreadDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendThreadReply();
                  }
                }}
                disabled={threadBusy}
              />
              <Button
                type="submit"
                variant="brand"
                disabled={threadBusy || threadDraft.trim().length === 0}
              >
                Reply
              </Button>
            </form>
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ─── Sidebar row + group primitives ─────────────────────────────────────

function ChannelGroup({
  label,
  rows,
  activeId,
  onSelect,
}: {
  label: string;
  rows: ChannelListEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="px-3 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      {rows.map((c) => (
        <ChannelRow
          key={c.id}
          channel={c}
          active={c.id === activeId}
          onSelect={() => onSelect(c.id)}
        />
      ))}
    </>
  );
}

function ChannelRow({
  channel,
  active,
  onSelect,
}: {
  channel: ChannelListEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const tooltip = channel.lastMessage
    ? `${channel.lastMessage.senderName}: ${channel.lastMessage.body} · ${dateShort(channel.lastMessage.createdAt)}`
    : "";
  return (
    <button
      type="button"
      onClick={onSelect}
      title={tooltip}
      className={`relative w-full text-start flex items-center gap-2 px-3 py-1.5 text-sm transition ${
        active
          ? "bg-brand-100 text-brand-700 font-semibold"
          : channel.unread > 0
            ? "text-ink font-medium hover:bg-brand-50"
            : "text-ink-soft hover:bg-brand-50"
      }`}
    >
      {active && (
        <span className="absolute start-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-e-full bg-brand-gradient" />
      )}
      <ChannelRowIcon channel={channel} />
      <span className="flex-1 truncate">{channel.name}</span>
      {channel.unread > 0 && (
        <span className="badge-brand tabular-nums">{channel.unread}</span>
      )}
    </button>
  );
}
