import { describe, expect, it } from "vitest";
import { generateVariantCombos, variantCodeFor, variantNameFor } from "./variant-matrix";

describe("generateVariantCombos", () => {
  it("returns [] for empty matrix", () => {
    expect(generateVariantCombos({})).toEqual([]);
  });
  it("returns [] when any attribute has empty values", () => {
    expect(generateVariantCombos({ Color: [], Size: ["S"] })).toEqual([]);
  });
  it("single attribute → one combo per value", () => {
    expect(generateVariantCombos({ Color: ["Red", "Blue"] })).toEqual([
      { Color: "Red" },
      { Color: "Blue" },
    ]);
  });
  it("cartesian product for two attributes", () => {
    const r = generateVariantCombos({ Color: ["Red", "Blue"], Size: ["S", "M", "L"] });
    expect(r).toHaveLength(6);
    expect(r[0]).toEqual({ Color: "Red", Size: "S" });
    expect(r[5]).toEqual({ Color: "Blue", Size: "L" });
  });
  it("preserves attribute order across combos", () => {
    const r = generateVariantCombos({ A: ["1"], B: ["2"], C: ["3"] });
    expect(Object.keys(r[0])).toEqual(["A", "B", "C"]);
  });
});

describe("variantCodeFor", () => {
  it("appends uppercased values", () => {
    expect(variantCodeFor("TSHIRT", { Color: "Red", Size: "L" })).toBe("TSHIRT-RED-L");
  });
  it("strips non-alphanumerics", () => {
    expect(variantCodeFor("SKU-1", { Color: "Off-White", Size: "3XL" })).toBe("SKU-1-OFFWHITE-3XL");
  });
});

describe("variantNameFor", () => {
  it("formats display name with combo values", () => {
    expect(variantNameFor("T-Shirt", { Color: "Red", Size: "L" })).toBe("T-Shirt (Red, L)");
  });
});
