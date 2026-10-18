"use client";

// Zoho-Notebook-style notes UI. Left sidebar: notebooks + views (pinned,
// archived, trash) + tag cloud. Right pane: card grid of notes. Editor
// drawer for compose + edit. Checklist blocks tick inline (single API call).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, PageHeader, Toast } from "../../../components/ui";

interface Notebook {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  isShared: boolean;
  archivedAt: string | null;
  _count?: { notes: number };
}

type Block =
  | { type: "text"; text: string }
  | { type: "checklist"; text: string; done: boolean }
  | { type: "divider" };

interface Note {
  id: string;
  notebookId: string;
  ownerUserId: string;
  title: string;
  body: Block[];
  type: "Text" | "Checklist" | "Mixed";
  tags: string[];
  color: string;
  pinned: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  notebook?: { id: string; name: string; color: string };
}

interface TagCount {
  tag: string;
  count: number;
}

type View = "active" | "pinned" | "reminders" | "archived" | "trash";

const NOTE_COLORS = ["default", "yellow", "pink", "mint", "sky", "lilac"] as const;

const nbSwatch: Record<string, string> = {
  violet: "bg-brand-500",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  slate: "bg-slate-500",
};

const noteBg: Record<string, string> = {
  default: "bg-white",
  yellow: "bg-yellow-50 border-yellow-200",
  pink: "bg-pink-50 border-pink-200",
  mint: "bg-emerald-50 border-emerald-200",
  sky: "bg-sky-50 border-sky-200",
  lilac: "bg-violet-50 border-violet-200",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function NotebookPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [selectedNbId, setSelectedNbId] = useState<string | null>(null);
  const [view, setView] = useState<View>("active");
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Note | "new" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSidebars = useCallback(async () => {
    const [nbs, tg] = await Promise.all([
      api.get<Notebook[]>("/notebook/notebooks"),
      api.get<TagCount[]>("/notebook/tags"),
    ]);
    setNotebooks(nbs);
    setTags(tg);
  }, []);

  const loadNotes = useCallback(async () => {
    const qs = new URLSearchParams();
    qs.set("view", view);
    if (selectedNbId) qs.set("notebookId", selectedNbId);
    if (tag) qs.set("tag", tag);
    if (search) qs.set("search", search);
    const rows = await api.get<Note[]>(`/notebook/notes?${qs.toString()}`);
    setNotes(rows);
  }, [view, selectedNbId, tag, search]);

  useEffect(() => {
    (async () => {
      try {
        await loadSidebars();
        await loadNotes();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed");
      }
    })();
  }, [loadSidebars, loadNotes]);

  const toggleItem = async (n: Note, index: number) => {
    const updated = await api.post<Note>(`/notebook/notes/${n.id}/toggle-item`, { index });
    setNotes((rows) => rows.map((r) => (r.id === n.id ? { ...r, body: updated.body } : r)));
  };

  const togglePin = async (n: Note) => {
    await api.put(`/notebook/notes/${n.id}`, { pinned: !n.pinned });
    await loadNotes();
  };

  const archive = async (n: Note) => {
    await api.post(`/notebook/notes/${n.id}/archive`, {});
    await loadNotes();
  };

  const trash = async (n: Note) => {
    if (!confirm("Move to trash?")) return;
    await api.delete(`/notebook/notes/${n.id}`);
    await loadNotes();
  };

  const restore = async (n: Note) => {
    await api.post(`/notebook/notes/${n.id}/restore`, {});
    await loadNotes();
  };

  const purge = async (n: Note) => {
    if (!confirm("Permanently delete this note?")) return;
    await api.post(`/notebook/notes/${n.id}/purge`, {});
    await loadNotes();
  };

  const createNotebook = async () => {
    const name = prompt("Notebook name");
    if (!name) return;
    await api.post("/notebook/notebooks", { name });
    await loadSidebars();
  };

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Notebook" }]}
        title="Notes"
        subtitle="Personal notes with notebooks, tags, checklists, and reminders."
        actions={
          <Button variant="brand" onClick={() => setEditor("new")} type="button">
            + New note
          </Button>
        }
      />

      {err && (
        <div className="mb-3">
          <Toast kind="error" message={err} onDismiss={() => setErr(null)} />
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-3 bg-white rounded shadow p-3 text-sm space-y-4">
          <div className="space-y-0.5">
            {(
              [
                ["active", "📝 All notes"],
                ["pinned", "📌 Pinned"],
                ["reminders", "⏰ Reminders"],
                ["archived", "📦 Archived"],
                ["trash", "🗑 Trash"],
              ] as [View, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                  setSelectedNbId(null);
                  setTag(null);
                }}
                className={`w-full text-start px-2 py-1 rounded ${
                  view === v && !selectedNbId && !tag
                    ? "bg-brand-50 text-brand-700 font-semibold"
                    : "hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between text-xs uppercase text-gray-500 tracking-wide mb-1">
              <span>Notebooks</span>
              <button
                onClick={createNotebook}
                className="text-brand-600 hover:underline normal-case text-xs"
              >
                + New
              </button>
            </div>
            {notebooks.length === 0 && (
              <div className="text-xs text-gray-400">No notebooks yet.</div>
            )}
            {notebooks.map((nb) => (
              <button
                key={nb.id}
                onClick={() => {
                  setSelectedNbId(nb.id);
                  setView("active");
                  setTag(null);
                }}
                className={`w-full text-start px-2 py-1 rounded flex items-center gap-2 ${
                  selectedNbId === nb.id
                    ? "bg-brand-50 text-brand-700 font-semibold"
                    : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full ${nbSwatch[nb.color] ?? "bg-gray-400"}`}
                />
                <span>{nb.icon ?? "📓"}</span>
                <span className="truncate">{nb.name}</span>
                <span className="ms-auto text-[10px] text-gray-400">
                  {nb._count?.notes ?? 0}
                </span>
              </button>
            ))}
          </div>

          {tags.length > 0 && (
            <div>
              <div className="text-xs uppercase text-gray-500 tracking-wide mb-1">Tags</div>
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <button
                    key={t.tag}
                    onClick={() => {
                      setTag(tag === t.tag ? null : t.tag);
                      setView("active");
                      setSelectedNbId(null);
                    }}
                    className={`px-2 py-0.5 rounded text-xs border ${
                      tag === t.tag
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-gray-600 border-gray-200 hover:border-brand-300"
                    }`}
                  >
                    #{t.tag}
                    <span className="ms-1 opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="col-span-9">
          <div className="flex items-center gap-2 mb-3">
            <input
              placeholder="Search titles…"
              className="border rounded px-3 py-1.5 text-sm flex-1"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {tag && (
              <span className="text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">
                #{tag}{" "}
                <button onClick={() => setTag(null)} className="ms-1">
                  ×
                </button>
              </span>
            )}
          </div>

          {notes.length === 0 ? (
            <div className="bg-white rounded shadow p-10 text-center text-sm text-gray-500">
              No notes here. Click <b>New note</b> to create one.
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {notes.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  onOpen={() => setEditor(n)}
                  onTogglePin={() => togglePin(n)}
                  onArchive={() => archive(n)}
                  onTrash={() => trash(n)}
                  onRestore={() => restore(n)}
                  onPurge={() => purge(n)}
                  onToggleItem={(i) => toggleItem(n, i)}
                  isTrash={view === "trash"}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {editor && (
        <NoteEditor
          note={editor}
          notebooks={notebooks}
          defaultNotebookId={selectedNbId}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await Promise.all([loadSidebars(), loadNotes()]);
          }}
        />
      )}
    </AppShell>
  );
}

function NoteCard({
  note,
  onOpen,
  onTogglePin,
  onArchive,
  onTrash,
  onRestore,
  onPurge,
  onToggleItem,
  isTrash,
}: {
  note: Note;
  onOpen: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onToggleItem: (i: number) => void;
  isTrash: boolean;
}) {
  return (
    <div
      className={`rounded shadow border p-3 text-sm flex flex-col gap-2 ${
        noteBg[note.color] ?? "bg-white"
      }`}
    >
      <div className="flex items-start gap-1">
        <button
          onClick={onOpen}
          className="text-start font-semibold flex-1 truncate hover:underline"
        >
          {note.title || <span className="text-gray-400 italic">Untitled</span>}
        </button>
        <button
          onClick={onTogglePin}
          title={note.pinned ? "Unpin" : "Pin"}
          className={note.pinned ? "text-amber-500" : "text-gray-300 hover:text-amber-500"}
        >
          📌
        </button>
      </div>

      <div className="space-y-0.5 text-xs">
        {note.body.slice(0, 6).map((b, i) => {
          if (b.type === "text")
            return (
              <div key={i} className="whitespace-pre-wrap text-gray-700 line-clamp-2">
                {b.text}
              </div>
            );
          if (b.type === "checklist")
            return (
              <label key={i} className="flex items-start gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={b.done}
                  onChange={() => onToggleItem(i)}
                  className="mt-0.5"
                />
                <span className={b.done ? "line-through text-gray-400" : ""}>{b.text}</span>
              </label>
            );
          return <hr key={i} className="border-gray-200" />;
        })}
        {note.body.length > 6 && (
          <div className="text-[10px] text-gray-400">+ {note.body.length - 6} more…</div>
        )}
      </div>

      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <span
              key={t}
              className="text-[10px] bg-white/70 border border-gray-200 px-1.5 py-0.5 rounded"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 text-[11px] text-gray-500 border-t border-gray-200/50">
        <span>{fmtDate(note.updatedAt)}</span>
        <span className="ms-auto flex gap-2 opacity-70">
          {isTrash ? (
            <>
              <button onClick={onRestore} className="text-brand-600 hover:underline">
                Restore
              </button>
              <button onClick={onPurge} className="text-red-600 hover:underline">
                Purge
              </button>
            </>
          ) : (
            <>
              <button onClick={onArchive} className="hover:underline">
                Archive
              </button>
              <button onClick={onTrash} className="text-red-600 hover:underline">
                Trash
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  notebooks,
  defaultNotebookId,
  onClose,
  onSaved,
}: {
  note: Note | "new";
  notebooks: Notebook[];
  defaultNotebookId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = note === "new";
  const initial: Note = useMemo(
    () =>
      isNew
        ? {
            id: "",
            notebookId: defaultNotebookId ?? notebooks[0]?.id ?? "",
            ownerUserId: "",
            title: "",
            body: [{ type: "text", text: "" }],
            type: "Text",
            tags: [],
            color: "default",
            pinned: false,
            archivedAt: null,
            deletedAt: null,
            reminderAt: null,
            createdAt: "",
            updatedAt: "",
          }
        : note,
    [note, isNew, defaultNotebookId, notebooks],
  );
  const [draft, setDraft] = useState<Note>(initial);
  const [tagInput, setTagInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(initial), [initial]);

  const save = async () => {
    if (!draft.notebookId) {
      setErr("Pick a notebook");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        notebookId: draft.notebookId,
        title: draft.title,
        body: draft.body,
        tags: draft.tags,
        color: draft.color,
        pinned: draft.pinned,
        reminderAt: draft.reminderAt,
      };
      if (isNew) await api.post("/notebook/notes", payload);
      else await api.put(`/notebook/notes/${draft.id}`, payload);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const setBlock = (i: number, next: Block) =>
    setDraft({ ...draft, body: draft.body.map((b, idx) => (idx === i ? next : b)) });
  const insertBlock = (kind: "text" | "checklist" | "divider") => {
    const nb: Block =
      kind === "text"
        ? { type: "text", text: "" }
        : kind === "checklist"
          ? { type: "checklist", text: "", done: false }
          : { type: "divider" };
    setDraft({ ...draft, body: [...draft.body, nb] });
  };
  const deleteBlock = (i: number) =>
    setDraft({ ...draft, body: draft.body.filter((_, idx) => idx !== i) });

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "").toLowerCase();
    if (!t || draft.tags.includes(t)) return;
    setDraft({ ...draft, tags: [...draft.tags, t] });
    setTagInput("");
  };
  const removeTag = (t: string) =>
    setDraft({ ...draft, tags: draft.tags.filter((x) => x !== t) });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">{isNew ? "New note" : "Edit note"}</div>
          <button onClick={onClose} className="text-xl text-gray-500 hover:text-gray-700">
            ×
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-sm">
          <div className="flex gap-2">
            <select
              value={draft.notebookId}
              onChange={(e) => setDraft({ ...draft, notebookId: e.target.value })}
              className="border rounded px-2 py-1.5 text-sm"
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.icon ?? "📓"} {nb.name}
                </option>
              ))}
            </select>
            <select
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              className="border rounded px-2 py-1.5 text-sm"
            >
              {NOTE_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              Pinned
            </label>
          </div>

          <input
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full border rounded px-3 py-2 text-base font-semibold"
          />

          <div className="space-y-2">
            {draft.body.map((b, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  {b.type === "text" && (
                    <textarea
                      value={b.text}
                      onChange={(e) => setBlock(i, { type: "text", text: e.target.value })}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                      rows={3}
                    />
                  )}
                  {b.type === "checklist" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={b.done}
                        onChange={(e) =>
                          setBlock(i, { type: "checklist", text: b.text, done: e.target.checked })
                        }
                      />
                      <input
                        value={b.text}
                        onChange={(e) =>
                          setBlock(i, { type: "checklist", text: e.target.value, done: b.done })
                        }
                        className={`flex-1 border rounded px-2 py-1 text-sm ${
                          b.done ? "line-through text-gray-400" : ""
                        }`}
                        placeholder="Checklist item"
                      />
                    </div>
                  )}
                  {b.type === "divider" && <hr className="border-gray-300" />}
                </div>
                <button
                  onClick={() => deleteBlock(i)}
                  className="text-red-500 text-xs hover:underline"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => insertBlock("text")}
                className="border rounded px-2 py-0.5 hover:bg-gray-50"
              >
                + Text
              </button>
              <button
                onClick={() => insertBlock("checklist")}
                className="border rounded px-2 py-0.5 hover:bg-gray-50"
              >
                + Checklist
              </button>
              <button
                onClick={() => insertBlock("divider")}
                className="border rounded px-2 py-0.5 hover:bg-gray-50"
              >
                + Divider
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1">Tags</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {draft.tags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] bg-brand-50 text-brand-700 border border-brand-200 px-1.5 py-0.5 rounded"
                >
                  #{t}
                  <button onClick={() => removeTag(t)} className="ms-1">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                placeholder="Add tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="flex-1 border rounded px-2 py-1 text-xs"
              />
              <button onClick={addTag} className="border rounded px-2 py-1 text-xs">
                Add
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500">Reminder</label>
            <input
              type="datetime-local"
              value={draft.reminderAt ? draft.reminderAt.slice(0, 16) : ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  reminderAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                })
              }
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="p-4 border-t flex items-center justify-end gap-2">
          {err && <span className="text-red-600 text-xs me-auto">{err}</span>}
          <button
            onClick={onClose}
            className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="bg-brand-600 text-white px-4 py-1.5 rounded text-sm disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
