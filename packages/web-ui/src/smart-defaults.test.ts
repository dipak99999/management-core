// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSmartDefaults } from "./smart-defaults";

const KEY = "lumaara.defaults.test-key";

afterEach(() => {
  window.localStorage.removeItem(KEY);
});

describe("useSmartDefaults", () => {
  it("exposes last-remembered value", () => {
    const { result } = renderHook(() =>
      useSmartDefaults<{ a: number }>("test-key"),
    );
    expect(result.current.last).toBeNull();
    act(() => result.current.remember({ a: 1 }));
    expect(result.current.last).toEqual({ a: 1 });
  });

  it("caps history at 10", () => {
    const { result } = renderHook(() =>
      useSmartDefaults<number>("test-key"),
    );
    act(() => {
      for (let i = 0; i < 15; i++) result.current.remember(i);
    });
    expect(result.current.history.length).toBe(10);
    expect(result.current.history[0]).toBe(14);
  });

  it("persists through localStorage", () => {
    const { result, unmount } = renderHook(() =>
      useSmartDefaults<string>("test-key"),
    );
    act(() => result.current.remember("hello"));
    unmount();
    const { result: next } = renderHook(() =>
      useSmartDefaults<string>("test-key"),
    );
    expect(next.current.last).toBe("hello");
  });

  it("clears all history", () => {
    const { result } = renderHook(() =>
      useSmartDefaults<string>("test-key"),
    );
    act(() => {
      result.current.remember("a");
      result.current.remember("b");
    });
    expect(result.current.history.length).toBe(2);
    act(() => result.current.clear());
    expect(result.current.history.length).toBe(0);
    expect(result.current.last).toBeNull();
  });
});
