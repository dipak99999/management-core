import { describe, expect, it } from "vitest";
import { validateStageTransition, type BlueprintStage } from "./pipeline-blueprints";

const stages: BlueprintStage[] = [
  { stageKey: "Open", requiredFields: ["expectedAmount"], allowedNext: ["Quotation", "Lost"] },
  { stageKey: "Quotation", requiredFields: ["expectedCloseDate", "customData.nextAction"], allowedNext: ["Converted", "Lost"] },
  { stageKey: "Converted", requiredFields: [], allowedNext: [] },
  { stageKey: "Lost", requiredFields: [], allowedNext: [] },
];

describe("validateStageTransition", () => {
  it("allows same-state edits without checks", () => {
    const r = validateStageTransition(stages, "Open", "Open", {});
    expect(r.ok).toBe(true);
  });

  it("rejects transitions not in allowedNext", () => {
    const r = validateStageTransition(stages, "Open", "Converted", { expectedAmount: 1000 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Allowed: Quotation, Lost");
  });

  it("rejects when a required field on the FROM stage is unset", () => {
    const r = validateStageTransition(stages, "Open", "Quotation", {});
    expect(r.ok).toBe(false);
    expect(r.missingFields).toEqual(["expectedAmount"]);
  });

  it("accepts when required field is present", () => {
    const r = validateStageTransition(stages, "Open", "Quotation", { expectedAmount: 5000 });
    expect(r.ok).toBe(true);
  });

  it("treats empty string as unset", () => {
    const r = validateStageTransition(stages, "Open", "Quotation", { expectedAmount: "" });
    expect(r.ok).toBe(false);
  });

  it("resolves dot-path into customData", () => {
    const bad = validateStageTransition(stages, "Quotation", "Converted", { expectedCloseDate: "2026-12-01" });
    expect(bad.ok).toBe(false);
    expect(bad.missingFields).toEqual(["customData.nextAction"]);

    const ok = validateStageTransition(stages, "Quotation", "Converted", {
      expectedCloseDate: "2026-12-01",
      customData: { nextAction: "call CFO" },
    });
    expect(ok.ok).toBe(true);
  });

  it("terminal stage cannot transition", () => {
    const r = validateStageTransition(stages, "Converted", "Open", {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Allowed: (none)");
  });

  it("legacy status not in blueprint = soft off-ramp", () => {
    const r = validateStageTransition(stages, "SomeOldStatus", "Open", {});
    expect(r.ok).toBe(true);
  });
});
