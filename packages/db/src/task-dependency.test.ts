import { describe, expect, it } from "vitest";
import {
  canTransitionTask,
  summarizeDependencyReadiness,
  type DependencyLike,
  type FromTaskStatusMap,
} from "./task-dependency";

const dep = (
  fromTaskId: string,
  type: DependencyLike["type"] = "FS",
): DependencyLike => ({ fromTaskId, type });

describe("canTransitionTask — always-allowed transitions", () => {
  it("→ Open is always allowed (reopen)", () => {
    expect(
      canTransitionTask("Open", [dep("a", "FS")], { a: "Open" }).allowed,
    ).toBe(true);
  });
  it("→ Cancelled is always allowed", () => {
    expect(
      canTransitionTask("Cancelled", [dep("a", "FS")], { a: "Open" }).allowed,
    ).toBe(true);
  });
});

describe("canTransitionTask — FS gate", () => {
  it("start blocked when FS-from is not Completed", () => {
    const r = canTransitionTask(
      "InProgress",
      [dep("a", "FS")],
      { a: "InProgress" },
    );
    expect(r.allowed).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]?.reason).toMatch(/FS dependency/);
  });
  it("start allowed when FS-from is Completed", () => {
    const r = canTransitionTask(
      "InProgress",
      [dep("a", "FS")],
      { a: "Completed" },
    );
    expect(r.allowed).toBe(true);
  });
  it("complete gated on FS too", () => {
    const r = canTransitionTask(
      "Completed",
      [dep("a", "FS")],
      { a: "InProgress" },
    );
    expect(r.allowed).toBe(false);
  });
});

describe("canTransitionTask — SS gate", () => {
  it("start blocked when SS-from is still Open", () => {
    const r = canTransitionTask(
      "InProgress",
      [dep("a", "SS")],
      { a: "Open" },
    );
    expect(r.allowed).toBe(false);
    expect(r.blockers[0]?.reason).toMatch(/SS dependency/);
  });
  it("start allowed when SS-from is InProgress", () => {
    expect(
      canTransitionTask("InProgress", [dep("a", "SS")], { a: "InProgress" }).allowed,
    ).toBe(true);
  });
  it("start allowed when SS-from is Completed", () => {
    expect(
      canTransitionTask("InProgress", [dep("a", "SS")], { a: "Completed" }).allowed,
    ).toBe(true);
  });
});

describe("canTransitionTask — FF gate (fires only on Complete)", () => {
  it("start unaffected by FF (FF only gates completion)", () => {
    expect(
      canTransitionTask("InProgress", [dep("a", "FF")], { a: "Open" }).allowed,
    ).toBe(true);
  });
  it("complete blocked when FF-from not Completed", () => {
    expect(
      canTransitionTask("Completed", [dep("a", "FF")], { a: "InProgress" }).allowed,
    ).toBe(false);
  });
  it("complete allowed when FF-from Completed", () => {
    expect(
      canTransitionTask("Completed", [dep("a", "FF")], { a: "Completed" }).allowed,
    ).toBe(true);
  });
});

describe("canTransitionTask — SF gate", () => {
  it("start unaffected by SF", () => {
    expect(
      canTransitionTask("InProgress", [dep("a", "SF")], { a: "Open" }).allowed,
    ).toBe(true);
  });
  it("complete blocked when SF-from is Open", () => {
    expect(
      canTransitionTask("Completed", [dep("a", "SF")], { a: "Open" }).allowed,
    ).toBe(false);
  });
  it("complete allowed when SF-from is InProgress", () => {
    expect(
      canTransitionTask("Completed", [dep("a", "SF")], { a: "InProgress" }).allowed,
    ).toBe(true);
  });
});

describe("canTransitionTask — Cancelled fromTask is never a blocker", () => {
  it("FS-from Cancelled → start allowed", () => {
    expect(
      canTransitionTask("InProgress", [dep("a", "FS")], { a: "Cancelled" }).allowed,
    ).toBe(true);
  });
});

describe("canTransitionTask — collects ALL blockers", () => {
  it("returns every failed dep, not just the first", () => {
    const deps: DependencyLike[] = [
      dep("a", "FS"),
      dep("b", "FS"),
      dep("c", "SS"),
    ];
    const statuses: FromTaskStatusMap = {
      a: "Open",
      b: "InProgress",
      c: "Open",
    };
    const r = canTransitionTask("InProgress", deps, statuses);
    expect(r.allowed).toBe(false);
    expect(r.blockers).toHaveLength(3);
  });
});

describe("canTransitionTask — missing fromTaskId defaults to Open (worst-case)", () => {
  it("unknown from → treated as Open, blocks", () => {
    const r = canTransitionTask("InProgress", [dep("ghost", "FS")], {});
    expect(r.allowed).toBe(false);
    expect(r.blockers[0]?.fromTaskStatus).toBe("Open");
  });
});

describe("summarizeDependencyReadiness", () => {
  it("returns both flags + blocker lists", () => {
    const r = summarizeDependencyReadiness(
      [dep("a", "FS"), dep("b", "FF")],
      { a: "Completed", b: "InProgress" },
    );
    expect(r.readyToStart).toBe(true);
    expect(r.readyToComplete).toBe(false);
    expect(r.startBlockers).toEqual([]);
    expect(r.completeBlockers).toHaveLength(1);
    expect(r.completeBlockers[0]?.fromTaskId).toBe("b");
  });

  it("no deps → ready for both", () => {
    const r = summarizeDependencyReadiness([], {});
    expect(r.readyToStart).toBe(true);
    expect(r.readyToComplete).toBe(true);
  });
});
