// @vitest-environment jsdom
// Exercises the backend-mode path of useSavedViews: hydrate from
// `backend.list`, delegate save/update/remove to the backend, surface
// `loading` while hydrating.
import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSavedViews, type SavedView, type SavedViewsBackend } from "./saved-views";

interface Filters { q?: string }

function mkBackend(initial: SavedView<Filters>[] = []): SavedViewsBackend {
  const rows = [...initial];
  return {
    list: vi.fn(async () => rows as SavedView<unknown>[]),
    create: vi.fn(async (input) => {
      const row: SavedView<unknown> = {
        id: `b-${rows.length + 1}`,
        name: input.name,
        filters: input.filters,
        isDefault: input.isDefault,
        createdAt: new Date().toISOString(),
      };
      rows.push(row as SavedView<Filters>);
      return row;
    }),
    update: vi.fn(async (id, patch) => {
      const r = rows.find((x) => x.id === id);
      if (r && patch.name) r.name = patch.name;
      if (r && patch.isDefault !== undefined) r.isDefault = patch.isDefault;
      return r as SavedView<unknown>;
    }),
    remove: vi.fn(async (id) => {
      const i = rows.findIndex((x) => x.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
}

describe("useSavedViews (backend mode)", () => {
  it("hydrates from backend on mount", async () => {
    const b = mkBackend([
      { id: "b-1", name: "Preset", filters: { q: "foo" }, createdAt: new Date().toISOString() },
    ]);
    const { result } = renderHook(() => useSavedViews<Filters>("test", b));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.views.length).toBe(1);
    expect(result.current.views[0].name).toBe("Preset");
    expect(b.list).toHaveBeenCalledWith("test");
  });

  it("calls backend.create on save and reflects the returned id", async () => {
    const b: SavedViewsBackend = {
      list: vi.fn(async () => [] as SavedView<unknown>[]),
      create: vi.fn(async (input) => ({
        id: "b-created",
        name: input.name,
        filters: input.filters,
        isDefault: input.isDefault,
        createdAt: new Date().toISOString(),
      })),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const { result } = renderHook(() => useSavedViews<Filters>("test", b));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let newId = "";
    await act(async () => {
      newId = (await result.current.save("fresh", { q: "x" })).id;
    });
    expect(newId).toBe("b-created");
    expect(b.create).toHaveBeenCalledTimes(1);
    expect(result.current.views.some((v) => v.id === "b-created")).toBe(true);
    expect(result.current.activeId).toBe("b-created");
  });

  it("activates the backend-provided default on hydrate", async () => {
    const b = mkBackend([
      { id: "b-1", name: "A", filters: {}, isDefault: false, createdAt: new Date().toISOString() },
      { id: "b-2", name: "B", filters: {}, isDefault: true, createdAt: new Date().toISOString() },
    ]);
    const { result } = renderHook(() => useSavedViews<Filters>("test", b));
    await waitFor(() => expect(result.current.activeId).toBe("b-2"));
  });
});
