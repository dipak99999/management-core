import { describe, expect, it } from "vitest";
import {
  buildAllocationRow,
  buildConsumptionReversalRow,
  buildConsumptionRow,
  buildEncashmentReversalRow,
  buildEncashmentRow,
  computeBalanceAfter,
  finalizeLedgerRow,
} from "./leave-ledger";

describe("computeBalanceAfter", () => {
  it("empty prior → returns incoming", () => {
    expect(computeBalanceAfter([], 12)).toBe(12);
  });
  it("mixes signed entries", () => {
    expect(
      computeBalanceAfter(
        [{ leaves: 20 }, { leaves: -5 }, { leaves: -2.5 }],
        3,
      ),
    ).toBe(15.5); // 20 - 5 - 2.5 + 3
  });
  it("string / Decimal-like inputs coerce", () => {
    const decimal = { toString: () => "10.5" };
    expect(computeBalanceAfter([{ leaves: "5" }, { leaves: decimal }], -2)).toBe(
      13.5,
    );
  });
  it("rounds to 2dp for tidy arithmetic", () => {
    expect(
      computeBalanceAfter([{ leaves: 0.1 }, { leaves: 0.2 }], 0),
    ).toBe(0.3); // classic 0.30000...4 case
  });
});

describe("finalizeLedgerRow", () => {
  it("stamps balanceAfter + derives isEncashment for Encashment", () => {
    const r = finalizeLedgerRow(
      {
        employeeId: "e1",
        leaveTypeId: "casual",
        postingDate: new Date("2026-06-01"),
        entryType: "Encashment",
        leaves: -3,
      },
      12,
    );
    expect(r.isEncashment).toBe(true);
    expect(r.isExpired).toBe(false);
    expect(r.isCarryForward).toBe(false);
    expect(r.balanceAfter).toBe(12);
  });

  it("Expiry → isExpired only", () => {
    const r = finalizeLedgerRow(
      {
        employeeId: "e1",
        leaveTypeId: "casual",
        postingDate: new Date("2026-06-01"),
        entryType: "Expiry",
        leaves: -5,
      },
      7,
    );
    expect(r.isExpired).toBe(true);
    expect(r.isEncashment).toBe(false);
  });

  it("CarryForward → isCarryForward only", () => {
    const r = finalizeLedgerRow(
      {
        employeeId: "e1",
        leaveTypeId: "annual",
        postingDate: new Date("2026-01-01"),
        entryType: "CarryForward",
        leaves: 4,
      },
      4,
    );
    expect(r.isCarryForward).toBe(true);
  });
});

describe("buildAllocationRow", () => {
  it("returns +leaves with LeaveAllocation source stamped", () => {
    const r = buildAllocationRow({
      employeeId: "e1",
      leaveTypeId: "annual",
      postingDate: new Date("2026-01-01"),
      fromDate: new Date("2026-01-01"),
      toDate: new Date("2026-12-31"),
      totalLeaves: 21,
      allocationId: "alloc-1",
      workGroupId: "wg1",
      employeeCategoryId: "cat1",
    });
    expect(r.entryType).toBe("Allocation");
    expect(r.leaves).toBe(21);
    expect(r.sourceDoctype).toBe("LeaveAllocation");
    expect(r.sourceDocId).toBe("alloc-1");
    expect(r.workGroupId).toBe("wg1");
    expect(r.employeeCategoryId).toBe("cat1");
    expect(r.fromDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("buildConsumptionRow", () => {
  it("NEGATES the incoming positive days", () => {
    const r = buildConsumptionRow({
      employeeId: "e1",
      leaveTypeId: "casual",
      postingDate: new Date("2026-06-05"),
      fromDate: new Date("2026-06-05"),
      toDate: new Date("2026-06-06"),
      days: 2,
      applicationId: "app-1",
    });
    expect(r.entryType).toBe("Consumption");
    expect(r.leaves).toBe(-2);
    expect(r.sourceDoctype).toBe("LeaveApplication");
    expect(r.sourceDocId).toBe("app-1");
  });

  it("handles half-day 0.5 negation", () => {
    const r = buildConsumptionRow({
      employeeId: "e1",
      leaveTypeId: "casual",
      postingDate: new Date("2026-06-05"),
      fromDate: new Date("2026-06-05"),
      toDate: new Date("2026-06-05"),
      days: 0.5,
      applicationId: "app-1",
    });
    expect(r.leaves).toBe(-0.5);
  });

  it("caller-supplied negative days still ends up negative (safety)", () => {
    const r = buildConsumptionRow({
      employeeId: "e1",
      leaveTypeId: "casual",
      postingDate: new Date("2026-06-05"),
      fromDate: new Date("2026-06-05"),
      toDate: new Date("2026-06-06"),
      days: -2, // helper takes abs
      applicationId: "app-1",
    });
    expect(r.leaves).toBe(-2);
  });
});

describe("buildConsumptionReversalRow", () => {
  it("emits POSITIVE Adjustment with cancellation reason", () => {
    const r = buildConsumptionReversalRow({
      employeeId: "e1",
      leaveTypeId: "casual",
      postingDate: new Date("2026-06-10"),
      days: 2,
      applicationId: "app-1",
    });
    expect(r.entryType).toBe("Adjustment");
    expect(r.leaves).toBe(2); // positive — restores balance
    expect(r.sourceDoctype).toBe("LeaveApplication");
    expect(r.reason).toContain("Cancellation");
  });
});

describe("buildEncashmentRow", () => {
  it("NEGATIVE-signs days + stamps LeaveEncashment source", () => {
    const r = buildEncashmentRow({
      employeeId: "e1",
      leaveTypeId: "annual",
      postingDate: new Date("2026-12-31"),
      days: 5,
      encashmentId: "enc-1",
      encashmentName: "LEC-0001",
    });
    expect(r.entryType).toBe("Encashment");
    expect(r.leaves).toBe(-5);
    expect(r.sourceDoctype).toBe("LeaveEncashment");
    expect(r.sourceDocId).toBe("enc-1");
    expect(r.reason).toContain("LEC-0001");
  });

  it("finalizeLedgerRow sets isEncashment=true", () => {
    const raw = buildEncashmentRow({
      employeeId: "e1",
      leaveTypeId: "annual",
      postingDate: new Date("2026-12-31"),
      days: 5,
      encashmentId: "enc-1",
    });
    const ready = finalizeLedgerRow(raw, 3);
    expect(ready.isEncashment).toBe(true);
    expect(ready.isExpired).toBe(false);
    expect(ready.isCarryForward).toBe(false);
  });

  it("negative input still ends negative (safety)", () => {
    const r = buildEncashmentRow({
      employeeId: "e1",
      leaveTypeId: "annual",
      postingDate: new Date("2026-12-31"),
      days: -5,
      encashmentId: "enc-1",
    });
    expect(r.leaves).toBe(-5);
  });
});

describe("buildEncashmentReversalRow", () => {
  it("POSITIVE Adjustment restoring balance", () => {
    const r = buildEncashmentReversalRow({
      employeeId: "e1",
      leaveTypeId: "annual",
      postingDate: new Date("2027-01-05"),
      days: 5,
      encashmentId: "enc-1",
      encashmentName: "LEC-0001",
    });
    expect(r.entryType).toBe("Adjustment");
    expect(r.leaves).toBe(5);
    expect(r.reason).toContain("Cancellation");
    expect(r.reason).toContain("LEC-0001");
  });
});
