import { describe, expect, it } from "vitest";
import {
  latestScheduleDueDate,
  materializeSchedule,
  scheduleItemStatus,
  type PaymentTermsItemLike,
} from "./payment-schedule";

function item(over: Partial<PaymentTermsItemLike>): PaymentTermsItemLike {
  return {
    description: "term",
    invoicePortion: 50,
    dueDays: 30,
    sortOrder: 0,
    ...over,
  };
}

const postingDate = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

describe("materializeSchedule", () => {
  it("empty items → empty rows", () => {
    expect(materializeSchedule([], postingDate, 1000)).toEqual([]);
  });

  it("50/50 net-30/net-60 splits exactly", () => {
    const rows = materializeSchedule(
      [
        item({ description: "First half", invoicePortion: 50, dueDays: 30, sortOrder: 0 }),
        item({ description: "Second half", invoicePortion: 50, dueDays: 60, sortOrder: 1 }),
      ],
      postingDate,
      1000,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amount).toBe(500);
    expect(rows[1]?.amount).toBe(500);
    expect(rows[0]?.dueDate.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(rows[1]?.dueDate.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("sums to invoiceTotal exactly (rounding remainder in last row)", () => {
    // 3-way 33.33/33.33/33.34 of ₹100 → 33.33 + 33.33 + 33.34
    const rows = materializeSchedule(
      [
        item({ invoicePortion: 33.33, dueDays: 30, sortOrder: 0 }),
        item({ invoicePortion: 33.33, dueDays: 60, sortOrder: 1 }),
        item({ invoicePortion: 33.34, dueDays: 90, sortOrder: 2 }),
      ],
      postingDate,
      100,
    );
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it("sums to invoiceTotal exactly for pathological rounds (1/3 of 100)", () => {
    // Portions summing to 99.99 (with 33.33 × 3) exposed old bugs — last row
    // absorbs so caller doesn't need to pre-adjust the template.
    const rows = materializeSchedule(
      [
        item({ invoicePortion: 33.33, dueDays: 30, sortOrder: 0 }),
        item({ invoicePortion: 33.33, dueDays: 60, sortOrder: 1 }),
        item({ invoicePortion: 33.33, dueDays: 90, sortOrder: 2 }),
      ],
      postingDate,
      100,
    );
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    // Portions sum to 99.99 — last row absorbs the difference to make total = 100.
    expect(Math.round(sum * 100) / 100).toBe(100);
    expect(rows[2]?.amount).toBeGreaterThan(33.33);
  });

  it("respects sortOrder (unsorted input still comes out sorted)", () => {
    const rows = materializeSchedule(
      [
        item({ description: "last", invoicePortion: 30, dueDays: 90, sortOrder: 2 }),
        item({ description: "first", invoicePortion: 30, dueDays: 30, sortOrder: 0 }),
        item({ description: "middle", invoicePortion: 40, dueDays: 60, sortOrder: 1 }),
      ],
      postingDate,
      1000,
    );
    expect(rows[0]?.description).toBe("first");
    expect(rows[1]?.description).toBe("middle");
    expect(rows[2]?.description).toBe("last");
  });

  it("dueDate = postingDate + dueDays (UTC-anchored, DST-safe)", () => {
    const rows = materializeSchedule(
      [item({ invoicePortion: 100, dueDays: 45, sortOrder: 0 })],
      new Date(Date.UTC(2026, 2, 1)), // 2026-03-01, just before US DST
      500,
    );
    expect(rows[0]?.dueDate.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });

  it("dueDays = 0 → same day as postingDate", () => {
    const rows = materializeSchedule(
      [item({ invoicePortion: 100, dueDays: 0, sortOrder: 0 })],
      postingDate,
      500,
    );
    expect(rows[0]?.dueDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("100% single row → whole invoice on one dueDate", () => {
    const rows = materializeSchedule(
      [item({ description: "Net-30", invoicePortion: 100, dueDays: 30, sortOrder: 0 })],
      postingDate,
      1234.56,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(1234.56);
  });
});

describe("scheduleItemStatus", () => {
  const midJun = new Date(Date.UTC(2026, 5, 15));

  it("parent Paid → Paid regardless of paidAmount", () => {
    expect(
      scheduleItemStatus(
        {
          dueDate: new Date(Date.UTC(2027, 0, 1)),
          amount: 500,
          paidAmount: 0,
          parentInvoiceStatus: "Paid",
        },
        midJun,
      ),
    ).toBe("Paid");
  });

  it("paidAmount ≥ amount → Paid", () => {
    expect(
      scheduleItemStatus({ dueDate: new Date(Date.UTC(2027, 0, 1)), amount: 500, paidAmount: 500 }, midJun),
    ).toBe("Paid");
  });

  it("paidAmount > 0 but < amount → Partial", () => {
    expect(
      scheduleItemStatus({ dueDate: new Date(Date.UTC(2027, 0, 1)), amount: 500, paidAmount: 200 }, midJun),
    ).toBe("Partial");
  });

  it("today > dueDate + no payment → Overdue", () => {
    expect(
      scheduleItemStatus({ dueDate: new Date(Date.UTC(2026, 5, 1)), amount: 500, paidAmount: 0 }, midJun),
    ).toBe("Overdue");
  });

  it("today = dueDate → Upcoming (not overdue on due-day itself)", () => {
    expect(
      scheduleItemStatus({ dueDate: midJun, amount: 500, paidAmount: 0 }, midJun),
    ).toBe("Upcoming");
  });

  it("today < dueDate → Upcoming", () => {
    expect(
      scheduleItemStatus({ dueDate: new Date(Date.UTC(2026, 6, 1)), amount: 500, paidAmount: 0 }, midJun),
    ).toBe("Upcoming");
  });

  it("Partial trumps Overdue when both would apply", () => {
    // Past dueDate but partially paid → Partial (partial reflects the
    // customer engagement; overdue amount is reduced but not zero)
    expect(
      scheduleItemStatus({ dueDate: new Date(Date.UTC(2026, 5, 1)), amount: 500, paidAmount: 100 }, midJun),
    ).toBe("Partial");
  });
});

describe("latestScheduleDueDate", () => {
  it("empty → null", () => {
    expect(latestScheduleDueDate([])).toBeNull();
  });

  it("returns the max dueDate", () => {
    const rows = materializeSchedule(
      [
        item({ invoicePortion: 25, dueDays: 30, sortOrder: 0 }),
        item({ invoicePortion: 25, dueDays: 90, sortOrder: 1 }),
        item({ invoicePortion: 50, dueDays: 60, sortOrder: 2 }),
      ],
      postingDate,
      1000,
    );
    expect(latestScheduleDueDate(rows)?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });
});
