// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSavedViews } from "./saved-views";

const KEY = "lumaara.views.test-list";

afterEach(() => {
  window.localStorage.removeItem(KEY);
});

interface Filters {
  status?: string;
  q?: string;
}

describe("useSavedViews (localStorage mode)", () => {
  it("saves, lists, and activates views", async () => {
    const { result } = renderHook(() => useSavedViews<Filters>("test-list"));
    expect(result.current.views).toEqual([]);
    let savedId = "";
    await act(async () => {
      const v = await result.current.save("Overdue", { status: "overdue" });
      savedId = v.id;
    });
    expect(result.current.views.length).toBe(1);
    expect(result.current.views[0].name).toBe("Overdue");
    expect(result.current.activeId).toBe(savedId);
  });

  it("removes views and clears active id if removed", async () => {
    const { result } = renderHook(() => useSavedViews<Filters>("test-list"));
    let id = "";
    await act(async () => {
      id = (await result.current.save("x", {})).id;
    });
    await act(async () => {
      await result.current.remove(id);
    });
    expect(result.current.views.length).toBe(0);
    expect(result.current.activeId).toBeNull();
  });

  it("renames views", async () => {
    const { result } = renderHook(() => useSavedViews<Filters>("test-list"));
    let id = "";
    await act(async () => {
      id = (await result.current.save("Old", {})).id;
    });
    await act(async () => {
      await result.current.rename(id, "New");
    });
    expect(result.current.views[0].name).toBe("New");
  });

  it("sets exactly one default at a time", async () => {
    const { result } = renderHook(() => useSavedViews<Filters>("test-list"));
    let a = "";
    let b = "";
    await act(async () => {
      a = (await result.current.save("A", {})).id;
      b = (await result.current.save("B", {})).id;
    });
    await act(async () => {
      await result.current.setDefault(a);
    });
    expect(result.current.views.find((v) => v.id === a)?.isDefault).toBe(true);
    expect(result.current.views.find((v) => v.id === b)?.isDefault).toBe(false);
    await act(async () => {
      await result.current.setDefault(b);
    });
    expect(result.current.views.find((v) => v.id === a)?.isDefault).toBe(false);
    expect(result.current.views.find((v) => v.id === b)?.isDefault).toBe(true);
    await act(async () => {
      await result.current.setDefault(null);
    });
    expect(result.current.views.every((v) => !v.isDefault)).toBe(true);
  });
});
