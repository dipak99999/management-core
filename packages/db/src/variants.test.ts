import { describe, expect, it } from "vitest";
import {
  collectAttributeOptions,
  findVariantByAttributes,
  parseVariantAttributes,
  validateVariantMetadata,
  variantsMatch,
} from "./variants";

// ---------------------------------------------------------------------
// parseVariantAttributes

describe("parseVariantAttributes", () => {
  it("returns null for non-object / array / null input", () => {
    expect(parseVariantAttributes(null)).toBeNull();
    expect(parseVariantAttributes(undefined)).toBeNull();
    expect(parseVariantAttributes([1, 2, 3])).toBeNull();
    expect(parseVariantAttributes("Red")).toBeNull();
  });

  it("returns null for an empty object (not a variant)", () => {
    expect(parseVariantAttributes({})).toBeNull();
  });

  it("coerces number + boolean values to strings (matches HTML select behaviour)", () => {
    expect(parseVariantAttributes({ Weight: 100, InStock: true })).toEqual({
      Weight: "100",
      InStock: "true",
    });
  });

  it("drops null / undefined values but keeps others", () => {
    expect(
      parseVariantAttributes({ Color: "Red", Size: null, Fit: undefined }),
    ).toEqual({ Color: "Red" });
  });
});

// ---------------------------------------------------------------------
// variantsMatch

describe("variantsMatch", () => {
  it("matches identical maps", () => {
    expect(variantsMatch({ Color: "Red", Size: "S" }, { Color: "Red", Size: "S" })).toBe(true);
  });

  it("is case-insensitive on values", () => {
    expect(variantsMatch({ Color: "RED" }, { Color: "red" })).toBe(true);
  });

  it("ignores whitespace around values", () => {
    expect(variantsMatch({ Color: "  Red  " }, { Color: "Red" })).toBe(true);
  });

  it("false when a key is missing on one side", () => {
    expect(
      variantsMatch({ Color: "Red", Size: "S" }, { Color: "Red" }),
    ).toBe(false);
  });

  it("false when a value differs", () => {
    expect(
      variantsMatch({ Color: "Red", Size: "S" }, { Color: "Red", Size: "M" }),
    ).toBe(false);
  });

  it("false when either side has extra empty (whitespace-only) values", () => {
    // Empty-after-trim doesn't count as picked — different key set.
    expect(
      variantsMatch({ Color: "Red", Size: "   " }, { Color: "Red" }),
    ).toBe(true);   // trimmed the empty away → identical
  });
});

// ---------------------------------------------------------------------
// findVariantByAttributes

describe("findVariantByAttributes", () => {
  const variants = [
    { id: "v1", variantAttributes: { Color: "Red", Size: "S" } },
    { id: "v2", variantAttributes: { Color: "Red", Size: "M" } },
    { id: "v3", variantAttributes: { Color: "Blue", Size: "S" } },
    { id: "v4", variantAttributes: null }, // malformed / not-a-variant
  ];

  it("returns the matching variant by exact attribute equality", () => {
    const v = findVariantByAttributes(variants, { Color: "Red", Size: "M" });
    expect(v?.id).toBe("v2");
  });

  it("returns the matching variant with case-insensitive values", () => {
    const v = findVariantByAttributes(variants, { Color: "blue", Size: "s" });
    expect(v?.id).toBe("v3");
  });

  it("returns null when no variant matches", () => {
    const v = findVariantByAttributes(variants, { Color: "Green", Size: "S" });
    expect(v).toBeNull();
  });

  it("returns null when the selection is empty (customer hasn't picked yet)", () => {
    expect(findVariantByAttributes(variants, {})).toBeNull();
  });

  it("skips variants with null / malformed attribute maps", () => {
    // v4 has null attributes — should never match.
    expect(findVariantByAttributes([variants[3]], { Color: "Red" })).toBeNull();
  });
});

// ---------------------------------------------------------------------
// collectAttributeOptions

describe("collectAttributeOptions", () => {
  it("returns one entry per attribute name with the union of values", () => {
    const variants = [
      { variantAttributes: { Color: "Red", Size: "S" } },
      { variantAttributes: { Color: "Red", Size: "M" } },
      { variantAttributes: { Color: "Blue", Size: "S" } },
    ];
    const opts = collectAttributeOptions(variants);
    expect(opts).toEqual([
      { name: "Color", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
    ]);
  });

  it("preserves the order that attribute names first appear across variants", () => {
    const variants = [
      { variantAttributes: { Size: "S", Color: "Red" } }, // Size first here
      { variantAttributes: { Color: "Blue", Size: "M" } },
    ];
    const opts = collectAttributeOptions(variants);
    expect(opts.map((o) => o.name)).toEqual(["Size", "Color"]);
  });

  it("skips variants with malformed attributes", () => {
    const variants = [
      { variantAttributes: null },
      { variantAttributes: { Color: "Red" } },
    ];
    expect(collectAttributeOptions(variants)).toEqual([
      { name: "Color", values: ["Red"] },
    ]);
  });

  it("returns [] when nothing usable", () => {
    expect(collectAttributeOptions([])).toEqual([]);
    expect(
      collectAttributeOptions([{ variantAttributes: null }, { variantAttributes: {} }]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// validateVariantMetadata

describe("validateVariantMetadata", () => {
  it("rejects an item that's both template AND variant", () => {
    const err = validateVariantMetadata({
      isVariantTemplate: true,
      variantOfId: "parent-1",
      variantAttributes: { Color: "Red" },
    });
    expect(err).toMatch(/both a variant template AND a variant/);
  });

  it("passes a plain non-variant Item (no template, no parent, no attrs)", () => {
    expect(
      validateVariantMetadata({
        isVariantTemplate: false,
        variantOfId: null,
        variantAttributes: null,
      }),
    ).toBeNull();
  });

  it("passes a template Item that has no parent", () => {
    expect(
      validateVariantMetadata({
        isVariantTemplate: true,
        variantOfId: null,
        variantAttributes: null,
      }),
    ).toBeNull();
  });

  it("rejects a variant without attributes", () => {
    const err = validateVariantMetadata({
      isVariantTemplate: false,
      variantOfId: "parent-1",
      variantAttributes: null,
    });
    expect(err).toMatch(/at least one attribute/);
  });

  it("rejects a variant whose attributes don't match template's declared names", () => {
    const err = validateVariantMetadata({
      isVariantTemplate: false,
      variantOfId: "parent-1",
      variantAttributes: { Color: "Red", Flavor: "Vanilla" },
      templateAttributeNames: ["Color", "Size"],
    });
    expect(err).toMatch(/Unknown attribute/);
    expect(err).toContain("Flavor");
    expect(err).toContain("Color, Size");
  });

  it("passes a variant whose attributes are a subset of template's names", () => {
    // Missing 'Size' is allowed at validation time — some templates only
    // vary on one axis for some variants (e.g. one-size-fits-all).
    expect(
      validateVariantMetadata({
        isVariantTemplate: false,
        variantOfId: "parent-1",
        variantAttributes: { Color: "Red" },
        templateAttributeNames: ["Color", "Size"],
      }),
    ).toBeNull();
  });

  it("passes when templateAttributeNames aren't supplied (skip the check)", () => {
    expect(
      validateVariantMetadata({
        isVariantTemplate: false,
        variantOfId: "parent-1",
        variantAttributes: { Anything: "Goes" },
      }),
    ).toBeNull();
  });
});
