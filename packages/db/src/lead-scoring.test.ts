import { describe, expect, it } from "vitest";
import { scoreLead, type LeadScoreRule } from "./lead-scoring";

const rules: LeadScoreRule[] = [
  { fieldPath: "email", operator: "present", value: null, points: 10, applyMode: "Add" },
  { fieldPath: "email", operator: "contains", value: "@gmail.com", points: 5, applyMode: "Subtract" },
  { fieldPath: "source", operator: "eq", value: "Referral", points: 20, applyMode: "Add" },
  { fieldPath: "customData.employees", operator: "gt", value: "100", points: 15, applyMode: "Add" },
  { fieldPath: "customData.disqualified", operator: "eq", value: "true", points: 999, applyMode: "Subtract" },
];

describe("scoreLead", () => {
  it("sums positive rule points that match", () => {
    const r = scoreLead(rules, { email: "cfo@enterprise.com", source: "Referral" });
    // present (+10) + Referral (+20)
    expect(r.score).toBe(30);
    expect(r.matched.length).toBe(2);
  });

  it("subtracts on Subtract-mode matches", () => {
    const r = scoreLead(rules, { email: "someone@gmail.com" });
    // present (+10) - contains-gmail (-5)
    expect(r.score).toBe(5);
  });

  it("handles gt on numeric customData", () => {
    const r = scoreLead(rules, { customData: { employees: 500 } });
    expect(r.score).toBe(15);
  });

  it("skips disabled rules", () => {
    const withDisabled: LeadScoreRule[] = [
      { ...rules[2], enabled: false },
    ];
    const r = scoreLead(withDisabled, { source: "Referral" });
    expect(r.score).toBe(0);
  });

  it("empty record → 0", () => {
    expect(scoreLead(rules, {}).score).toBe(0);
  });

  it("absent operator matches missing values", () => {
    const r = scoreLead(
      [{ fieldPath: "phone", operator: "absent", value: null, points: 3, applyMode: "Add" }],
      { name: "Alice" },
    );
    expect(r.score).toBe(3);
  });

  it("neq operator", () => {
    const r = scoreLead(
      [{ fieldPath: "status", operator: "neq", value: "Lost", points: 5, applyMode: "Add" }],
      { status: "Open" },
    );
    expect(r.score).toBe(5);
  });

  it("Subtract with negative points input still subtracts (uses abs)", () => {
    const r = scoreLead(
      [{ fieldPath: "x", operator: "present", value: null, points: -50, applyMode: "Subtract" }],
      { x: 1 },
    );
    expect(r.score).toBe(-50);
  });
});
