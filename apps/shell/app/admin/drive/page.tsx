"use client";

// Zoho-WorkDrive-style file library. Left rail: folder tree from root.
// Right pane: file grid for the selected folder, with upload, rename, star,
// versions, comments, share links, and trash.

import { useCallback, useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  _count: { children: number; files: number };
}

interface FileVersion {
  id: string;
  version: number;
  size: number;
  mimeType: string;
  uploadedByUserId: string;
  note: string | null;
  createdAt: string;
}
interface FileComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}
interface DriveFile {
  id: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  size: number;
  starred: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { versions: number; comments: number; shareLinks: number };
}
interface FileDetail extends DriveFile {
  versions: FileVersion[];
  comments: FileComment[];
}
interface ShareLink {
  id: string;
  token: string;
  label: string | null;
  isActive: boolean;
  isPasswordProtected: boolean;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
  file?: { id: string; name: string };
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function uploadFile(
  folderId: string | null,
  file: File,
  note?: string,
): Promise<DriveFile & { version: number; versioned: boolean }> {
  const buffer = await file.arrayBuffer();
  const base64 = bytesToBase64(new Uint8Array(buffer));
  return api.post<DriveFile & { version: number; versioned: boolean }>("/drive/files", {
    folderId: folderId ?? null,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    base64,
    note,
  });
}

export default function DrivePage() {
  const [tree, setTree] = useState<Folder[]>([]);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const [subfolders, setSubfolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<"folder" | "starred" | "trash">("folder");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FileDetail | null>(null);
  const [shareOpen, setShareOpen] = useState<DriveFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadTree = useCallback(async () => {
    const rows = await api.get<Folder[]>("/drive/folders?parentId=root");
    setTree(rows);
  }, []);

  const loadPane = useCallback(async () => {
    if (view === "starred") {
      const rows = await api.get<DriveFile[]>("/drive/files?starred=true");
      setFiles(rows);
      setSubfolders([]);
      setBreadcrumb([]);
      return;
    }
    if (view === "trash") {
      const rows = await api.get<DriveFile[]>("/drive/files?trashed=true");
      setFiles(rows);
      setSubfolders([]);
      setBreadcrumb([]);
      return;
    }
    const [folderRows, fileRows] = await Promise.all([
      api.get<Folder[]>(
        `/drive/folders?parentId=${openFolderId ?? "root"}`,
      ),
      api.get<DriveFile[]>(
        `/drive/files?folderId=${openFolderId ?? "root"}${
          search ? `&search=${encodeURIComponent(search)}` : ""
        }`,
      ),
    ]);
    setSubfolders(folderRows);
    setFiles(fileRows);
    if (openFolderId) {
      const chain = await api.get<{ id: string; name: string }[]>(
        `/drive/folders/${openFolderId}/breadcrumb`,
      );
      setBreadcrumb(chain);
    } else {
      setBreadcrumb([]);
    }
  }, [openFolderId, view, search]);

  useEffect(() => {
    (async () => {
      try {
        await loadTree();
        await loadPane();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, [loadTree, loadPane]);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const createFolder = async () => {
    const name = prompt("New folder name");
    if (!name) return;
    try {
      await api.post("/drive/folders", { name, parentId: openFolderId });
      await Promise.all([loadTree(), loadPane()]);
      say(`Folder "${name}" created`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleUpload = async (input: HTMLInputElement) => {
    if (!input.files || !input.files.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(input.files)) {
        const r = await uploadFile(openFolderId, f);
        say(
          r.versioned
            ? `${f.name} uploaded as v${r.version}`
            : `${f.name} uploaded`,
        );
      }
      await loadPane();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      input.value = "";
    }
  };

  const openDetail = async (f: DriveFile) => {
    const detail = await api.get<FileDetail>(`/drive/files/${f.id}`);
    setSelected(detail);
  };

  const download = (f: DriveFile, version?: number) => {
    const session = localStorage.getItem("lumaara.session");
    const token = session ? (JSON.parse(session).token as string) : "";
    const base = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
    // Auth is via Bearer; we open a fetch → blob → save flow instead of
    // a bare href so the auth header can travel.
    (async () => {
      const r = await fetch(
        `${base}/drive/files/${f.id}/download${version ? `?version=${version}` : ""}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!r.ok) {
        setErr(`Download failed (${r.status})`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      URL.revokeObjectURL(url);
    })().catch((e) => setErr(e instanceof Error ? e.message : "Download failed"));
  };

  const toggleStar = async (f: DriveFile) => {
    await api.put(`/drive/files/${f.id}`, { starred: !f.starred });
    await loadPane();
  };

  const trashFile = async (f: DriveFile) => {
    if (!confirm(`Move "${f.name}" to trash?`)) return;
    await api.delete(`/drive/files/${f.id}`);
    setSelected(null);
    await loadPane();
    say("Moved to trash");
  };

  const restoreFile = async (f: DriveFile) => {
    await api.post(`/drive/files/${f.id}/restore`, {});
    await loadPane();
    say("Restored");
  };

  const purgeFile = async (f: DriveFile) => {
    if (!confirm(`Permanently delete "${f.name}"? This cannot be undone.`)) return;
    await api.post(`/drive/files/${f.id}/purge`, {});
    await loadPane();
    say("Purged");
  };

  const rename = async (f: DriveFile) => {
    const name = prompt("Rename to", f.name);
    if (!name || name === f.name) return;
    await api.put(`/drive/files/${f.id}`, { name });
    await loadPane();
  };

  const addComment = async (fileId: string) => {
    const body = prompt("Comment");
    if (!body) return;
    await api.post(`/drive/files/${fileId}/comments`, { body });
    const detail = await api.get<FileDetail>(`/drive/files/${fileId}`);
    setSelected(detail);
  };

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "WorkDrive" }]}
        title="Files"
        subtitle="File library with folders, versions, comments, share links, and trash."
        actions={
          <Button variant="secondary" onClick={() => history.back()} type="button">
            ← Back
          </Button>
        }
      />

      {err && (
        <div className="mb-3">
          <Toast kind="error" message={err} onDismiss={() => setErr(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-3">
          <Toast kind="success" message={toast} />
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="col-span-3 bg-white rounded shadow p-3 space-y-1 text-sm">
          <button
            onClick={() => {
              setView("folder");
              setOpenFolderId(null);
            }}
            className={`w-full text-start px-2 py-1 rounded ${
              view === "folder" && !openFolderId
                ? "bg-brand-50 text-brand-700 font-semibold"
                : "hover:bg-gray-50"
            }`}
          >
            📁 My Drive
          </button>
          <button
            onClick={() => setView("starred")}
            className={`w-full text-start px-2 py-1 rounded ${
              view === "starred"
                ? "bg-brand-50 text-brand-700 font-semibold"
                : "hover:bg-gray-50"
            }`}
          >
            ⭐ Starred
          </button>
          <button
            onClick={() => setView("trash")}
            className={`w-full text-start px-2 py-1 rounded ${
              view === "trash"
                ? "bg-brand-50 text-brand-700 font-semibold"
                : "hover:bg-gray-50"
            }`}
          >
            🗑 Trash
          </button>
          <div className="pt-3 border-t mt-3 text-xs uppercase text-gray-500 tracking-wide">
            Top-level folders
          </div>
          {tree.length === 0 && (
            <div className="text-xs text-gray-400 px-2 py-1">
              No folders yet — create one from the toolbar.
            </div>
          )}
          {tree.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setView("folder");
                setOpenFolderId(f.id);
              }}
              className={`w-full text-start px-2 py-1 rounded flex items-center gap-2 ${
                openFolderId === f.id
                  ? "bg-brand-50 text-brand-700 font-semibold"
                  : "hover:bg-gray-50"
              }`}
            >
              <span>📁</span>
              <span className="truncate">{f.name}</span>
              <span className="ms-auto text-[10px] text-gray-400">
                {f._count.files + f._count.children}
              </span>
            </button>
          ))}
        </aside>

        {/* Main */}
        <section className="col-span-9 bg-white rounded shadow flex flex-col min-h-[600px]">
          <div className="border-b px-4 py-3 flex items-center gap-2">
            <div className="flex-1 text-sm">
              {view === "folder" ? (
                <div className="flex items-center gap-1 text-gray-600">
                  <button
                    onClick={() => setOpenFolderId(null)}
                    className="text-brand-600 hover:underline"
                  >
                    My Drive
                  </button>
                  {breadcrumb.map((b, i) => (
                    <span key={b.id} className="flex items-center gap-1">
                      <span>›</span>
                      {i === breadcrumb.length - 1 ? (
                        <span className="font-semibold text-gray-900">{b.name}</span>
                      ) : (
                        <button
                          onClick={() => setOpenFolderId(b.id)}
                          className="text-brand-600 hover:underline"
                        >
                          {b.name}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : view === "starred" ? (
                <div className="font-semibold">Starred files</div>
              ) : (
                <div className="font-semibold">Trash</div>
              )}
            </div>
            <input
              placeholder="Search files…"
              className="border rounded px-2 py-1 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {view === "folder" && (
              <>
                <button
                  onClick={createFolder}
                  className="border border-brand-600 text-brand-600 px-3 py-1.5 rounded text-sm"
                >
                  New folder
                </button>
                <label
                  className={`px-3 py-1.5 rounded text-sm cursor-pointer bg-brand-600 text-white ${
                    busy ? "opacity-60" : ""
                  }`}
                >
                  {busy ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleUpload(e.currentTarget)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
          </div>

          <div className="p-4 space-y-3 flex-1 overflow-y-auto">
            {view === "folder" && subfolders.length > 0 && (
              <div>
                <div className="text-xs uppercase text-gray-500 mb-1">Folders</div>
                <div className="grid grid-cols-3 gap-2">
                  {subfolders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setOpenFolderId(f.id)}
                      className="border rounded p-3 text-start hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        <span>📁</span>
                        <span className="truncate">{f.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {f._count.files} file{f._count.files === 1 ? "" : "s"} ·{" "}
                        {f._count.children} sub-folder
                        {f._count.children === 1 ? "" : "s"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs uppercase text-gray-500 mb-1">
                Files ({files.length})
              </div>
              {files.length === 0 ? (
                <div className="text-sm text-gray-500 py-8 text-center">
                  No files here yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start border-b text-xs uppercase text-gray-500">
                      <th className="py-2 pe-2">Name</th>
                      <th className="py-2 pe-2">Size</th>
                      <th className="py-2 pe-2">Updated</th>
                      <th className="py-2 pe-2">Meta</th>
                      <th className="py-2 pe-2 text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 pe-2">
                          <button
                            onClick={() => openDetail(f)}
                            className="text-brand-700 hover:underline flex items-center gap-2"
                          >
                            {f.starred && <span>⭐</span>}
                            <span className="truncate max-w-md">{f.name}</span>
                          </button>
                          <div className="text-xs text-gray-400">{f.mimeType}</div>
                        </td>
                        <td className="py-2 pe-2 font-mono text-xs">
                          {fmtBytes(f.size)}
                        </td>
                        <td className="py-2 pe-2 text-xs text-gray-500">
                          {fmtDate(f.updatedAt)}
                        </td>
                        <td className="py-2 pe-2 text-xs text-gray-500">
                          {f._count && (
                            <>
                              v{f._count.versions} · {f._count.comments}💬 ·{" "}
                              {f._count.shareLinks}🔗
                            </>
                          )}
                        </td>
                        <td className="py-2 pe-2 text-end text-xs">
                          {view === "trash" ? (
                            <>
                              <button
                                onClick={() => restoreFile(f)}
                                className="text-brand-600 hover:underline me-2"
                              >
                                Restore
                              </button>
                              <button
                                onClick={() => purgeFile(f)}
                                className="text-red-600 hover:underline"
                              >
                                Purge
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => download(f)}
                                className="text-brand-600 hover:underline me-2"
                              >
                                Download
                              </button>
                              <button
                                onClick={() => setShareOpen(f)}
                                className="text-brand-600 hover:underline me-2"
                              >
                                Share
                              </button>
                              <button
                                onClick={() => toggleStar(f)}
                                className="hover:underline me-2"
                              >
                                {f.starred ? "Unstar" : "Star"}
                              </button>
                              <button
                                onClick={() => rename(f)}
                                className="hover:underline me-2"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => trashFile(f)}
                                className="text-red-600 hover:underline"
                              >
                                Trash
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>

      {selected && (
        <FileDetailDrawer
          file={selected}
          onClose={() => setSelected(null)}
          onDownloadVersion={(v) => download(selected, v)}
          onAddComment={() => addComment(selected.id)}
        />
      )}
      {shareOpen && (
        <FileShareDrawer file={shareOpen} onClose={() => setShareOpen(null)} />
      )}
    </AppShell>
  );
}

function FileDetailDrawer({
  file,
  onClose,
  onDownloadVersion,
  onAddComment,
}: {
  file: FileDetail;
  onClose: () => void;
  onDownloadVersion: (version: number) => void;
  onAddComment: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold truncate pe-2">{file.name}</div>
          <button onClick={onClose} className="text-xl text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-sm">
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            <dt className="text-gray-500">Size</dt>
            <dd className="text-end">{fmtBytes(file.size)}</dd>
            <dt className="text-gray-500">Type</dt>
            <dd className="text-end">{file.mimeType}</dd>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-end">{fmtDate(file.createdAt)}</dd>
            <dt className="text-gray-500">Updated</dt>
            <dd className="text-end">{fmtDate(file.updatedAt)}</dd>
          </dl>

          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">
              Version history ({file.versions.length})
            </div>
            <ul className="text-xs divide-y">
              {file.versions.map((v) => (
                <li key={v.id} className="py-1.5 flex items-center gap-2">
                  <span className="font-mono">v{v.version}</span>
                  <span className="text-gray-400">·</span>
                  <span>{fmtBytes(v.size)}</span>
                  <span className="text-gray-400 truncate flex-1">{v.note ?? ""}</span>
                  <span className="text-gray-500">{fmtDate(v.createdAt)}</span>
                  <button
                    onClick={() => onDownloadVersion(v.version)}
                    className="text-brand-600 hover:underline"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-700 mb-1">
                Comments ({file.comments.length})
              </div>
              <button
                onClick={onAddComment}
                className="text-xs text-brand-600 hover:underline"
              >
                + Add
              </button>
            </div>
            {file.comments.length === 0 ? (
              <div className="text-xs text-gray-400">No comments yet.</div>
            ) : (
              <ul className="space-y-2 text-xs">
                {file.comments.map((c) => (
                  <li key={c.id} className="border rounded p-2">
                    <div className="text-gray-500">
                      {c.userId} · {fmtDate(c.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap">{c.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FileShareDrawer({
  file,
  onClose,
}: {
  file: DriveFile;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [label, setLabel] = useState("");
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.get<ShareLink[]>(
      `/drive/share-links?fileId=${file.id}`,
    );
    setLinks(r);
  }, [file.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useListPageCommands({
    singular: "Drive",
    plural: "Drive",
    refresh: load,
  });

  const create = async () => {
    setErr(null);
    try {
      await api.post("/drive/share-links", {
        fileId: file.id,
        label: label || undefined,
        password: password || undefined,
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      });
      setLabel("");
      setPassword("");
      setExpires("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  };

  const revoke = async (id: string) => {
    if (!confirm("Revoke this share link? Anyone with the URL will lose access."))
      return;
    await api.delete(`/drive/share-links/${id}`);
    await load();
  };

  const toggle = async (id: string) => {
    await api.post(`/drive/share-links/${id}/toggle`, {});
    await load();
  };

  const shareBase =
    typeof window !== "undefined"
      ? `${window.location.origin}/share/file`
      : "/share/file";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold truncate">Share “{file.name}”</div>
          <button onClick={onClose} className="text-xl text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-sm">
          <div className="space-y-2 border border-dashed rounded p-3">
            <div className="text-xs font-semibold text-gray-700">New link</div>
            <input
              placeholder="Label (optional)"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              placeholder="Password (optional)"
              type="password"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="datetime-local"
              className="w-full border rounded px-2 py-1.5 text-sm"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
            <button
              onClick={create}
              className="bg-brand-600 text-white px-3 py-1.5 rounded text-sm"
            >
              Create link
            </button>
            {err && <div className="text-xs text-red-600">{err}</div>}
          </div>
          <div className="text-xs font-semibold text-gray-700 pt-2">
            Active ({links.filter((l) => l.isActive).length}/{links.length})
          </div>
          {links.length === 0 && (
            <div className="text-xs text-gray-500">No share links yet.</div>
          )}
          {links.map((l) => (
            <div key={l.id} className="border rounded p-3 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <div className="font-semibold">{l.label ?? "Untitled"}</div>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    l.isActive
                      ? "bg-green-100 text-green-800"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {l.isActive ? "Active" : "Disabled"}
                </span>
              </div>
              <div className="text-gray-500">
                Views {l.viewCount}
                {l.isPasswordProtected ? " · Password-protected" : ""}
                {l.expiresAt
                  ? ` · Expires ${new Date(l.expiresAt).toLocaleDateString()}`
                  : ""}
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={`${shareBase}/${l.token}`}
                  className="flex-1 border rounded px-1.5 py-1 font-mono text-[11px] bg-gray-50"
                />
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(`${shareBase}/${l.token}`)
                  }
                  className="text-brand-600 hover:underline"
                >
                  Copy
                </button>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => toggle(l.id)} className="text-gray-600 hover:underline">
                  {l.isActive ? "Disable" : "Enable"}
                </button>
                <button onClick={() => revoke(l.id)} className="text-red-600 hover:underline">
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
