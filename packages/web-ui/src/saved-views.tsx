"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SavedView<F = unknown> {
  id: string;
  name: string;
  filters: F;
  createdAt: string;
  isDefault?: boolean;
}

/**
 * Backend contract: GET/POST/PUT/DELETE on a REST-ish endpoint that
 * returns `SavedView<F>[]`. See services/auth-service /user-views.
 * Caller provides the base URL + bearer-token fetcher so this package
 * stays independent of the app's http client.
 */
export interface SavedViewsBackend {
  list(listKey: string): Promise<SavedView<unknown>[]>;
  create(input: {
    listKey: string;
    name: string;
    filters: unknown;
    isDefault?: boolean;
  }): Promise<SavedView<unknown>>;
  update(id: string, patch: Partial<Omit<SavedView<unknown>, "id" | "createdAt">>): Promise<SavedView<unknown>>;
  remove(id: string): Promise<void>;
}

const LS_PREFIX = "lumaara.views.";

function readLocal<F>(key: string): SavedView<F>[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    return raw ? (JSON.parse(raw) as SavedView<F>[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<F>(key: string, views: SavedView<F>[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(views));
}

/**
 * Per-user saved filter sets for a list.
 *
 * When `backend` is provided, state is persisted server-side (replaces
 * localStorage). Without `backend` falls back to localStorage so dev,
 * tests, and portal-web (no auth) still work.
 */
export function useSavedViews<F>(storageKey: string, backend?: SavedViewsBackend) {
  const [views, setViews] = useState<SavedView<F>[]>(() =>
    backend ? [] : readLocal<F>(storageKey),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!backend);

  // Hydrate from backend on first mount.
  useEffect(() => {
    if (!backend) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = (await backend.list(storageKey)) as SavedView<F>[];
        if (cancelled) return;
        setViews(rows);
        const def = rows.find((v) => v.isDefault);
        if (def) setActiveId(def.id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, storageKey]);

  // Keep localStorage mirror up-to-date only when there's no backend.
  useEffect(() => {
    if (backend) return;
    writeLocal(storageKey, views);
  }, [backend, storageKey, views]);

  // Apply default on first mount — localStorage fallback.
  const didInit = useRef(false);
  useEffect(() => {
    if (backend || didInit.current) return;
    didInit.current = true;
    const def = views.find((v) => v.isDefault);
    if (def) setActiveId(def.id);
  }, [backend, views]);

  const save = useCallback(
    async (name: string, filters: F) => {
      if (backend) {
        const created = (await backend.create({
          listKey: storageKey,
          name,
          filters,
        })) as SavedView<F>;
        setViews((cur) => [...cur, created]);
        setActiveId(created.id);
        return created;
      }
      const id = `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const next: SavedView<F> = {
        id,
        name,
        filters,
        createdAt: new Date().toISOString(),
      };
      setViews((cur) => [...cur, next]);
      setActiveId(id);
      return next;
    },
    [backend, storageKey],
  );

  const remove = useCallback(
    async (id: string) => {
      if (backend) await backend.remove(id).catch(() => {});
      setViews((cur) => cur.filter((v) => v.id !== id));
      setActiveId((cur) => (cur === id ? null : cur));
    },
    [backend],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      setViews((cur) => cur.map((v) => (v.id === id ? { ...v, name } : v)));
      if (backend) {
        await backend.update(id, { name }).catch(() => {});
      }
    },
    [backend],
  );

  const setDefault = useCallback(
    async (id: string | null) => {
      setViews((cur) => cur.map((v) => ({ ...v, isDefault: v.id === id })));
      if (backend && id) {
        await backend.update(id, { isDefault: true }).catch(() => {});
      }
    },
    [backend],
  );

  const activeView = useMemo(
    () => views.find((v) => v.id === activeId) ?? null,
    [views, activeId],
  );

  return {
    views,
    loading,
    activeId,
    activeView,
    setActive: setActiveId,
    save,
    remove,
    rename,
    setDefault,
  };
}

export function SavedViewsMenu<F>({
  controller,
  currentFilters,
  onApply,
}: {
  controller: ReturnType<typeof useSavedViews<F>>;
  currentFilters: F;
  onApply: (f: F) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [showSave, setShowSave] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {controller.activeView ? controller.activeView.name : "Views"}
        <span aria-hidden className="ms-1 text-ink-muted">▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-30 top-full mt-1 end-0 min-w-[220px] rounded-lg bg-canvas border border-ink/10 shadow-lg p-1"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            role="menuitem"
            className="w-full text-start px-3 py-1.5 text-sm rounded hover:bg-ink/5"
            onClick={() => {
              controller.setActive(null);
              setOpen(false);
            }}
          >
            All (clear view)
          </button>
          {controller.views.length > 0 && <div className="my-1 border-t border-ink/5" />}
          {controller.views.map((v) => (
            <div
              key={v.id}
              className={`group flex items-center gap-1 px-1 rounded ${
                v.id === controller.activeId ? "bg-ink/5" : ""
              }`}
            >
              <button
                role="menuitem"
                className="flex-1 text-start px-2 py-1.5 text-sm hover:bg-ink/5 rounded"
                onClick={() => {
                  controller.setActive(v.id);
                  onApply(v.filters);
                  setOpen(false);
                }}
              >
                <span className="block truncate">{v.name}</span>
                {v.isDefault && (
                  <span className="block text-[10px] text-ink-muted">default</span>
                )}
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 text-xs text-ink-muted hover:text-ink px-1"
                onClick={() => void controller.setDefault(v.isDefault ? null : v.id)}
                title={v.isDefault ? "Unset default" : "Set as default"}
              >
                ★
              </button>
              <button
                className="opacity-0 group-hover:opacity-100 text-xs text-red-600 px-1"
                onClick={() => void controller.remove(v.id)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="my-1 border-t border-ink/5" />
          {showSave ? (
            <div className="px-2 py-1.5 flex items-center gap-1">
              <input
                autoFocus
                className="input input-sm flex-1"
                placeholder="View name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    void controller.save(newName.trim(), currentFilters);
                    setNewName("");
                    setShowSave(false);
                    setOpen(false);
                  } else if (e.key === "Escape") {
                    setShowSave(false);
                  }
                }}
              />
            </div>
          ) : (
            <button
              role="menuitem"
              className="w-full text-start px-3 py-1.5 text-sm rounded hover:bg-ink/5 text-brew"
              onClick={() => setShowSave(true)}
            >
              + Save current filters as view
            </button>
          )}
        </div>
      )}
    </div>
  );
}
