"use client";

import { useCallback, useEffect, useState } from "react";
import { collabApi, downloadAttachment, fileToBase64 } from "./collab-api";

export interface AttachmentRow {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

interface Props {
  doctype: string;
  docId: string;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Drop-in attachments panel for any detail page. Lists metadata, supports
// upload (base64) + download (blob) + delete. No pagination — the row count
// per doc should be small; if not we'll page later.
export function AttachmentsPanel({ doctype, docId }: Props) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rs = await collabApi.get<AttachmentRow[]>(
        `/attachments?doctype=${encodeURIComponent(doctype)}&docId=${encodeURIComponent(docId)}`,
      );
      setRows(rs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, [doctype, docId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 20MB safety cap on the client; the server accepts up to 25MB JSON.
    if (file.size > 20 * 1024 * 1024) {
      setError("File too large (max 20MB)");
      e.target.value = "";
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await collabApi.post("/attachments", {
        doctype,
        docId,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this attachment?")) return;
    try {
      await collabApi.del(`/attachments/${id}`);
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Attachments</h3>
        <label className="cursor-pointer rounded bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700">
          {uploading ? "Uploading…" : "Upload"}
          <input
            type="file"
            className="hidden"
            onChange={onPick}
            disabled={uploading}
          />
        </label>
      </div>

      {error && (
        <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-gray-400">No attachments yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="truncate text-blue-700 hover:underline"
                  onClick={() => downloadAttachment(r.id, r.filename)}
                >
                  {r.filename}
                </button>
                <div className="text-xs text-gray-500">
                  {fmtSize(r.size)} · {new Date(r.uploadedAt).toLocaleString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                className="ms-3 text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
