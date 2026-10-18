"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { AppShell } from "../../../../components/app-shell";
import { SHELL_NAV } from "../../../../components/shell-nav";
import {
  Button,
  Card,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  relativeTime,
  type Column,
} from "../../../../components/ui";

// Marketing media library — per-tenant image/file store served by the CRM
// service (routes/media.ts). We can't use the shell-wide `lib/api.ts` here
// because that client is bolted to AUTH_SERVICE_URL. A small typed CRM
// helper lives inline (same 401-auto-clear behaviour as apps/crm-web/lib/api).

const CRM_BASE =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CRM_SERVICE_URL) ??
  "/api/crm";

interface MediaRow {
  id: string;
  folder: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: string;
  presignedUrl: string | null;
  deduped?: boolean;
}

function sessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("lumaara.session");
    return raw ? (JSON.parse(raw).token as string) : "";
  } catch {
    return "";
  }
}
function clearSessionRedirect() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("lumaara.session");
  } catch {
    /* ignore */
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

async function crmFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = sessionToken();
  const res = await fetch(`${CRM_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && token) {
    clearSessionRedirect();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  // Guard against HTML/text responses from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status + body.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { throw new Error(`Expected JSON but got: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
  }
  if (!res.ok) {
    const err =
      data && typeof data === "object" && "error" in data
        ? typeof data.error === "string"
          ? data.error
          : JSON.stringify(data.error)
        : `${res.status} ${res.statusText}`;
    throw new Error(err);
  }
  return data as T;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isImageType(ct: string): boolean {
  return ct.toLowerCase().startsWith("image/");
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:*/*;base64," prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export default function MediaLibraryPage() {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [folders, setFolders] = useState<string[]>(["root"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "info" | "error"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renaming, setRenaming] = useState<MediaRow | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (folderFilter) qs.set("folder", folderFilter);
      if (search.trim()) qs.set("search", search.trim());
      qs.set("limit", "200");
      const [list, fs] = await Promise.all([
        crmFetch<MediaRow[]>(`/media?${qs.toString()}`),
        crmFetch<string[]>(`/media/folders`),
      ]);
      setRows(list);
      setFolders(fs.length > 0 ? fs : ["root"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }

  // Reload when folder filter changes; debounce search.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderFilter]);

  useListPageCommands({
    singular: "Media Library",
    plural: "Media Library",
    refresh: load,
  });
  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function doDelete(row: MediaRow) {
    if (!confirm(`Delete "${row.filename}"? This removes the file from S3 too.`)) return;
    try {
      await crmFetch<void>(`/media/${row.id}`, { method: "DELETE" });
      setToast({ kind: "success", msg: `Deleted ${row.filename}` });
      await load();
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Delete failed" });
    }
  }

  async function saveRename() {
    if (!renaming || !renameValue.trim()) return;
    try {
      await crmFetch<MediaRow>(`/media/${renaming.id}`, {
        method: "PATCH",
        body: JSON.stringify({ filename: renameValue.trim() }),
      });
      setToast({ kind: "success", msg: "Renamed" });
      setRenaming(null);
      setRenameValue("");
      await load();
    } catch (e) {
      setToast({ kind: "error", msg: e instanceof Error ? e.message : "Rename failed" });
    }
  }

  async function copyUrl(row: MediaRow) {
    if (!row.presignedUrl) {
      setToast({ kind: "error", msg: "No presigned URL — is the S3 integration configured?" });
      return;
    }
    try {
      await navigator.clipboard.writeText(row.presignedUrl);
      setToast({ kind: "info", msg: "Link copied — expires in 15 minutes." });
    } catch {
      setToast({ kind: "error", msg: "Clipboard blocked — copy manually from the URL bar." });
    }
  }

  const columns: Column<MediaRow>[] = useMemo(
    () => [
      {
        header: "",
        width: "56px",
        cell: (r) =>
          isImageType(r.contentType) && r.presignedUrl ? (
            // Presigned URLs are short-lived; if the browser caches the img
            // across page loads it'll refetch when the presigned URL rotates.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.presignedUrl}
              alt={r.filename}
              width={40}
              height={40}
              className="h-10 w-10 rounded object-cover border border-ink-muted/10 bg-surface-sunken"
            />
          ) : (
            <div className="h-10 w-10 rounded bg-surface-sunken border border-ink-muted/10 grid place-items-center text-ink-muted text-[10px] font-medium uppercase">
              {(extFromCt(r.contentType) || "file").slice(0, 4)}
            </div>
          ),
      },
      {
        header: "Filename",
        cell: (r) => (
          <div className="flex flex-col">
            <span className="text-ink font-medium truncate max-w-[280px]" title={r.filename}>
              {r.filename}
            </span>
            {r.width && r.height && (
              <span className="text-[11px] text-ink-muted tabular-nums">
                {r.width} × {r.height}
              </span>
            )}
          </div>
        ),
      },
      { header: "Folder", cell: (r) => <span className="text-ink-soft">{r.folder}</span> },
      {
        header: "Type",
        cell: (r) => <span className="text-ink-muted text-xs font-mono">{r.contentType}</span>,
      },
      {
        header: "Size",
        align: "right",
        cell: (r) => <span className="tabular-nums text-ink-soft">{formatSize(r.sizeBytes)}</span>,
      },
      {
        header: "Uploaded",
        cell: (r) => (
          <span className="text-ink-muted text-xs" title={dateShort(r.createdAt)}>
            {relativeTime(r.createdAt)}
          </span>
        ),
      },
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(r);
                setRenameValue(r.filename);
              }}
            >
              Rename
            </Button>
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                copyUrl(r);
              }}
              title="Copy short-lived (15 min) download URL"
            >
              Copy URL
            </Button>
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                doDelete(r);
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows],
  );

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Media library"
        subtitle="Images and files for email templates and campaigns"
        breadcrumb={[
          { label: "Admin", href: "/admin" },
          { label: "Marketing" },
          { label: "Media library" },
        ]}
        actions={
          <Button variant="brand" onClick={() => setUploadOpen(true)}>
            + Upload
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {toast && (
        <div className="mb-4">
          <Toast kind={toast.kind} message={toast.msg} onDismiss={() => setToast(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Search filenames…" }}
          filters={
            <select
              className="input"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              aria-label="Filter by folder"
            >
              <option value="">All folders</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          }
          actions={
            <>
              <Button variant="brand" onClick={() => setUploadOpen(true)}>
                + Upload
              </Button>
              <SavedViewsControls
                listKey="shell:admin-marketing-media-library"
                current={{ search, folderFilter }}
                onApply={(fv) => { setSearch(fv.search); setFolderFilter(fv.folderFilter); }}
              />
            </>
          }
        />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          empty={{
            icon: (
              <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="9" cy="9" r="1.5" fill="currentColor" />
              </svg>
            ),
            title: search || folderFilter ? "No matches" : "No media yet",
            description:
              search || folderFilter
                ? "Try a different search or folder."
                : "Upload logos, hero images, product shots — they'll be available in the email editor.",
            action:
              !search && !folderFilter ? (
                <Button variant="brand" onClick={() => setUploadOpen(true)}>+ Upload</Button>
              ) : undefined,
          }}
        />
      </div>

      <UploadDrawer
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        folders={folders}
        onUploaded={(row) => {
          setUploadOpen(false);
          setToast({
            kind: "success",
            msg: row.deduped ? `"${row.filename}" already existed — reused` : `Uploaded ${row.filename}`,
          });
          load();
        }}
        onError={(msg) => setToast({ kind: "error", msg })}
      />

      <Drawer
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename file"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button variant="brand" onClick={saveRename} disabled={!renameValue.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormField label="New filename" required>
            <input
              className="input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </FormField>
          {renaming && (
            <Card className="p-3 text-sm text-ink-muted">
              This only renames the DB label — the underlying S3 object keeps its content-hash key,
              so any existing embed URLs continue to resolve.
            </Card>
          )}
        </div>
      </Drawer>
    </AppShell>
  );
}

function extFromCt(ct: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/html": "html",
  };
  return map[ct.toLowerCase()] ?? ct.split("/")[1] ?? "";
}

// ── Upload drawer ────────────────────────────────────────────────────
function UploadDrawer({
  open,
  onClose,
  folders,
  onUploaded,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  folders: string[];
  onUploaded: (row: MediaRow) => void;
  onError: (msg: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState<string>("root");
  const [customFolder, setCustomFolder] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setFolder("root");
      setCustomFolder("");
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await readFileAsBase64(file);
      const chosenFolder =
        folder === "__new__" ? (customFolder.trim() || "root") : folder;
      const row = await crmFetch<MediaRow>("/media/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          folder: chosenFolder,
          base64,
        }),
      });
      onUploaded(row);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Upload media"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={submit} disabled={!file || busy}>
            {busy ? "Uploading…" : "Upload"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField label="File" required>
          <div
            className="border-2 border-dashed border-ink-muted/20 rounded-lg p-6 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/40 transition"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <div className="text-ink font-medium">{file.name}</div>
                <div className="text-ink-muted text-xs mt-1">
                  {file.type || "unknown type"} — {formatSize(file.size)}
                </div>
              </div>
            ) : (
              <div className="text-ink-muted">
                <div className="text-sm">Drop a file here, or click to browse</div>
                <div className="text-xs mt-1">Images, PDFs — up to ~10 MB works well</div>
              </div>
            )}
          </div>
        </FormField>

        <FormField label="Folder">
          <select
            className="input"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value="__new__">+ New folder…</option>
          </select>
        </FormField>
        {folder === "__new__" && (
          <FormField label="New folder name" required>
            <input
              className="input"
              placeholder="e.g. product-images"
              value={customFolder}
              onChange={(e) => setCustomFolder(e.target.value)}
            />
          </FormField>
        )}

        <Card className="p-3 text-xs text-ink-muted">
          Files are deduped by content hash — uploading the same image twice
          stores it once and returns the existing entry.
        </Card>
      </div>
    </Drawer>
  );
}
