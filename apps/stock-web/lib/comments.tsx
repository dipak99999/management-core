"use client";

import { useCallback, useEffect, useState } from "react";
import { collabApi } from "./collab-api";

export interface CommentRow {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  doctype: string;
  docId: string;
  currentUserId?: string;
}

// Doc comments panel. Flat (not threaded) — matches ERPNext's Comment behavior
// and keeps the UI simple. Edit/delete gated by author on the server side; the
// client just hides the buttons when there's no match.
export function CommentsPanel({ doctype, docId, currentUserId }: Props) {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const refresh = useCallback(async () => {
    try {
      const rs = await collabApi.get<CommentRow[]>(
        `/comments?doctype=${encodeURIComponent(doctype)}&docId=${encodeURIComponent(docId)}`,
      );
      setRows(rs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [doctype, docId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  async function onPost() {
    if (!draft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const row = await collabApi.post<CommentRow>("/comments", {
        doctype,
        docId,
        body: draft.trim(),
      });
      setRows((rs) => [...rs, row]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  }

  async function onSaveEdit(id: string) {
    try {
      const row = await collabApi.put<CommentRow>(`/comments/${id}`, {
        body: editBody.trim(),
      });
      setRows((rs) => rs.map((r) => (r.id === id ? row : r)));
      setEditingId(null);
      setEditBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this comment?")) return;
    try {
      await collabApi.del(`/comments/${id}`);
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-800">Comments</h3>

      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="mb-3 text-xs text-gray-400">No comments yet.</div>
      ) : (
        <ul className="mb-3 space-y-3">
          {rows.map((r) => {
            const isMine = currentUserId && r.authorUserId === currentUserId;
            const isEditing = editingId === r.id;
            return (
              <li key={r.id} className="rounded bg-gray-50 p-2 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                  <span>
                    {r.authorUserId} · {new Date(r.createdAt).toLocaleString()}
                    {r.updatedAt !== r.createdAt && " (edited)"}
                  </span>
                  {isMine && !isEditing && (
                    <div className="space-x-2">
                      <button
                        type="button"
                        className="text-blue-600 hover:underline"
                        onClick={() => {
                          setEditingId(r.id);
                          setEditBody(r.body);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => onDelete(r.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full rounded border border-gray-300 p-2 text-sm"
                      rows={3}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded bg-gray-900 px-3 py-1 text-xs text-white"
                        onClick={() => onSaveEdit(r.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="text-xs text-gray-600 hover:underline"
                        onClick={() => {
                          setEditingId(null);
                          setEditBody("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-gray-800">{r.body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2">
        <textarea
          className="w-full rounded border border-gray-300 p-2 text-sm"
          rows={2}
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          onClick={onPost}
          disabled={posting || !draft.trim()}
          className="rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </div>
  );
}
