import { describe, expect, it } from "vitest";
import {
  deriveOverallStatus,
  mergeReadingsFromTemplate,
  type QIReadingLike,
  type QITemplateParamLike,
} from "./quality-inspection";

describe("deriveOverallStatus", () => {
  it("empty readings → Accepted (visual-only sign-off)", () => {
    expect(deriveOverallStatus([])).toBe("Accepted");
  });
  it("all Accepted → Accepted", () => {
    expect(
      deriveOverallStatus([
        { parameter: "a", status: "Accepted" },
        { parameter: "b", status: "Accepted" },
      ]),
    ).toBe("Accepted");
  });
  it("any Rejected → Rejected", () => {
    expect(
      deriveOverallStatus([
        { parameter: "a", status: "Accepted" },
        { parameter: "b", status: "Rejected" },
        { parameter: "c", status: "Accepted" },
      ]),
    ).toBe("Rejected");
  });
  it("case-insensitive on legacy strings", () => {
    expect(
      deriveOverallStatus([
        { parameter: "a", status: "REJECTED" },
      ]),
    ).toBe("Rejected");
    expect(
      deriveOverallStatus([
        { parameter: "a", status: " rejected " },
      ]),
    ).toBe("Rejected");
  });
});

describe("mergeReadingsFromTemplate", () => {
  const tplA: QITemplateParamLike[] = [
    { parameter: "colour", acceptanceCriteria: "Pantone 186 C", sortOrder: 0 },
    { parameter: "weight (g)", acceptanceCriteria: "between 480-520", sortOrder: 1 },
    { parameter: "moisture %", acceptanceCriteria: "≤ 5%", sortOrder: 2 },
  ];

  it("empty supplied → one Accepted row per template parameter, in sortOrder", () => {
    const r = mergeReadingsFromTemplate(tplA, []);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.parameter)).toEqual(["colour", "weight (g)", "moisture %"]);
    expect(r.every((x) => x.status === "Accepted")).toBe(true);
    expect(r[0]?.acceptanceCriteria).toBe("Pantone 186 C");
  });

  it("preserves caller-supplied reading + status for matching parameter names", () => {
    const supplied: QIReadingLike[] = [
      { parameter: "weight (g)", reading: "492", status: "Accepted" },
      { parameter: "moisture %", reading: "7.1", status: "Rejected" },
    ];
    const r = mergeReadingsFromTemplate(tplA, supplied);
    expect(r).toHaveLength(3);
    expect(r[1]?.reading).toBe("492");
    expect(r[2]?.reading).toBe("7.1");
    expect(r[2]?.status).toBe("Rejected");
  });

  it("template acceptanceCriteria always wins (template is source of truth)", () => {
    const supplied: QIReadingLike[] = [
      {
        parameter: "colour",
        acceptanceCriteria: "any red-ish", // caller tried to override
        reading: "close enough",
        status: "Accepted",
      },
    ];
    const r = mergeReadingsFromTemplate(tplA, supplied);
    expect(r[0]?.acceptanceCriteria).toBe("Pantone 186 C");
  });

  it("caller-only parameters (not in template) appended after template rows", () => {
    const supplied: QIReadingLike[] = [
      { parameter: "batch check", reading: "OK", status: "Accepted" },
    ];
    const r = mergeReadingsFromTemplate(tplA, supplied);
    expect(r).toHaveLength(4);
    expect(r[3]?.parameter).toBe("batch check");
  });

  it("respects template sortOrder even if input is out of order", () => {
    const jumbled: QITemplateParamLike[] = [
      { parameter: "c", sortOrder: 2 },
      { parameter: "a", sortOrder: 0 },
      { parameter: "b", sortOrder: 1 },
    ];
    const r = mergeReadingsFromTemplate(jumbled, []);
    expect(r.map((x) => x.parameter)).toEqual(["a", "b", "c"]);
  });

  it("empty template + caller readings → passes readings through with normalized status", () => {
    const r = mergeReadingsFromTemplate([], [
      { parameter: "a", reading: "1", status: "REJECTED" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.status).toBe("Rejected");
  });
});
