"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "./api";

interface Notification {
  id: string;
  subject: string;
  body: string | null;
  doctype: string | null;
  docId: string | null;
  isRead: boolean;
  createdAt: string;
}

// Header dropdown that polls unread count every 30s and lazy-loads the list on
// open. Kept dead simple — no websocket / push channel yet.
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function refreshCount() {
    try {
      const r = await api.get<{ count: number }>("/notifications/unread-count");
      setCount(r.count);
    } catch {
      // Silent — a failing badge shouldn't spam the console.
    }
  }

  useEffect(() => {
    refreshCount();
    const h = setInterval(refreshCount, 30_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function openDropdown() {
    setOpen((v) => !v);
    if (open) return;
    setLoading(true);
    try {
      const rs = await api.get<Notification[]>("/notifications");
      setRows(rs);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    await api.post("/notifications/read-all", {});
    setRows((rs) => rs.map((r) => ({ ...r, isRead: true })));
    setCount(0);
  }

  async function markOneRead(id: string) {
    await api.post(`/notifications/${id}/read`, {});
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, isRead: true } : r)));
    setCount((c) => Math.max(0, c - 1));
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={openDropdown}
        className="relative rounded p-2 hover:bg-gray-100"
        aria-label="Notifications"
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && (
          <span className="absolute -end-1 -top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 z-20 mt-2 w-96 rounded border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-semibold">Notifications</div>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-auto">
            {loading ? (
              <div className="p-3 text-xs text-gray-400">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="p-3 text-xs text-gray-400">Nothing here.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className={`px-3 py-2 text-sm ${r.isRead ? "" : "bg-blue-50"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{r.subject}</div>
                        {r.body && (
                          <div className="mt-0.5 text-xs text-gray-600">{r.body}</div>
                        )}
                        <div className="mt-1 text-[10px] text-gray-400">
                          {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                      {!r.isRead && (
                        <button
                          type="button"
                          onClick={() => markOneRead(r.id)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Read
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
