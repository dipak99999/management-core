import { describe, expect, it } from "vitest";
import {
  allocateToSchedule,
  derivePaidStatus,
  reverseFromSchedule,
  type AllocatableRow,
} from "./schedule-allocation";

function row(over: Partial<AllocatableRow> & { id: string }): AllocatableRow {
  return {
    dueDate: new Date("2026-07-01"),
    sortOrder: 0,
    amount: 500,
    paidAmount: 0,
    ...over,
  };
}

const jul1 = new Date("2026-07-01");
const aug1 = new Date("2026-08-01");
const sep1 = new Date("2026-09-01");

describe("allocateToSchedule (FIFO)", () => {
  it("empty rows → remainder=incoming", () => {
    const r = allocateToSchedule([], 500);
    expect(r.changes).toEqual([]);
    expect(r.remainder).toBe(500);
  });

  it("zero/negative incoming → no-op", () => {
    expect(allocateToSchedule([row({ id: "a" })], 0)).toEqual({ changes: [], remainder: 0 });
    expect(allocateToSchedule([row({ id: "a" })], -50).changes).toEqual([]);
  });

  it("single row, partial payment → one Partial change", () => {
    const r = allocateToSchedule([row({ id: "a", amount: 500, paidAmount: 0 })], 200);
    expect(r.changes).toEqual([{ id: "a", paidDelta: 200, newPaidAmount: 200 }]);
    expect(r.remainder).toBe(0);
  });

  it("single row, full payment → one Paid change", () => {
    const r = allocateToSchedule([row({ id: "a", amount: 500 })], 500);
    expect(r.changes[0]?.newPaidAmount).toBe(500);
    expect(r.remainder).toBe(0);
  });

  it("multi row, fills oldest first", () => {
    const r = allocateToSchedule(
      [
        row({ id: "aug", dueDate: aug1, amount: 400 }),
        row({ id: "jul", dueDate: jul1, amount: 300 }),
        row({ id: "sep", dueDate: sep1, amount: 500 }),
      ],
      500,
    );
    // Fills jul (300) → aug (200 partial) → sep skipped
    expect(r.changes.map((c) => c.id)).toEqual(["jul", "aug"]);
    expect(r.changes[0]?.newPaidAmount).toBe(300);
    expect(r.changes[1]?.newPaidAmount).toBe(200);
    expect(r.remainder).toBe(0);
  });

  it("skips fully-paid rows", () => {
    const r = allocateToSchedule(
      [
        row({ id: "jul", dueDate: jul1, amount: 300, paidAmount: 300 }),
        row({ id: "aug", dueDate: aug1, amount: 200, paidAmount: 0 }),
      ],
      150,
    );
    expect(r.changes).toEqual([{ id: "aug", paidDelta: 150, newPaidAmount: 150 }]);
  });

  it("over-payment → remainder = leftover", () => {
    const r = allocateToSchedule([row({ id: "a", amount: 100 })], 500);
    expect(r.changes[0]?.newPaidAmount).toBe(100);
    expect(r.remainder).toBe(400);
  });

  it("dueDate tie broken by sortOrder", () => {
    const r = allocateToSchedule(
      [
        row({ id: "later", dueDate: jul1, sortOrder: 1, amount: 100 }),
        row({ id: "earlier", dueDate: jul1, sortOrder: 0, amount: 100 }),
      ],
      100,
    );
    expect(r.changes[0]?.id).toBe("earlier");
  });
});

describe("reverseFromSchedule (LIFO)", () => {
  it("empty rows → remainder=decrement", () => {
    const r = reverseFromSchedule([], 500);
    expect(r.remainder).toBe(500);
  });

  it("zero decrement → no-op", () => {
    expect(reverseFromSchedule([row({ id: "a", paidAmount: 100 })], 0).changes).toEqual([]);
  });

  it("pulls from most-recent paid row first", () => {
    const r = reverseFromSchedule(
      [
        row({ id: "jul", dueDate: jul1, amount: 300, paidAmount: 300 }),
        row({ id: "aug", dueDate: aug1, amount: 400, paidAmount: 400 }),
        row({ id: "sep", dueDate: sep1, amount: 500, paidAmount: 200 }),
      ],
      500,
    );
    // Order: sep first (pulls 200 out of 200), aug next (300 of 400)
    expect(r.changes.map((c) => c.id)).toEqual(["sep", "aug"]);
    expect(r.changes[0]?.paidDelta).toBe(-200);
    expect(r.changes[0]?.newPaidAmount).toBe(0);
    expect(r.changes[1]?.paidDelta).toBe(-300);
    expect(r.changes[1]?.newPaidAmount).toBe(100);
    expect(r.remainder).toBe(0);
  });

  it("skips rows with paidAmount = 0", () => {
    const r = reverseFromSchedule(
      [
        row({ id: "jul", dueDate: jul1, amount: 300, paidAmount: 300 }),
        row({ id: "aug", dueDate: aug1, amount: 400, paidAmount: 0 }),
      ],
      200,
    );
    // aug has no paid → pull from jul
    expect(r.changes[0]?.id).toBe("jul");
    expect(r.changes[0]?.paidDelta).toBe(-200);
  });

  it("never drives paidAmount negative", () => {
    const r = reverseFromSchedule([row({ id: "a", amount: 500, paidAmount: 100 })], 999);
    expect(r.changes[0]?.newPaidAmount).toBe(0);
    expect(r.remainder).toBe(899);
  });

  it("FIFO + LIFO invariant — apply 400 then reverse 400 → all rows back to zero paid", () => {
    const initial: AllocatableRow[] = [
      row({ id: "jul", dueDate: jul1, amount: 300 }),
      row({ id: "aug", dueDate: aug1, amount: 500 }),
    ];
    const fwd = allocateToSchedule(initial, 400);
    // Apply changes
    const afterFwd = initial.map((r) => {
      const c = fwd.changes.find((x) => x.id === r.id);
      return c ? { ...r, paidAmount: c.newPaidAmount } : r;
    });
    const rev = reverseFromSchedule(afterFwd, 400);
    const afterRev = afterFwd.map((r) => {
      const c = rev.changes.find((x) => x.id === r.id);
      return c ? { ...r, paidAmount: c.newPaidAmount } : r;
    });
    expect(afterRev.every((r) => r.paidAmount === 0)).toBe(true);
  });
});

describe("derivePaidStatus", () => {
  const midJun = new Date("2026-06-15");
  it("parent Paid → Paid", () => {
    expect(
      derivePaidStatus({ dueDate: sep1, amount: 500, paidAmount: 0 }, midJun, "Paid"),
    ).toBe("Paid");
  });
  it("fully paid → Paid", () => {
    expect(derivePaidStatus({ dueDate: sep1, amount: 500, paidAmount: 500 }, midJun)).toBe("Paid");
  });
  it("partial → Partial", () => {
    expect(derivePaidStatus({ dueDate: sep1, amount: 500, paidAmount: 100 }, midJun)).toBe("Partial");
  });
  it("past due, no payment → Overdue", () => {
    expect(derivePaidStatus({ dueDate: jul1, amount: 500, paidAmount: 0 }, aug1)).toBe("Overdue");
  });
  it("upcoming → Upcoming", () => {
    expect(derivePaidStatus({ dueDate: sep1, amount: 500, paidAmount: 0 }, midJun)).toBe("Upcoming");
  });
});
