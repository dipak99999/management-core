import { describe, expect, it } from "vitest";
import {
  missingSupplierError,
  partitionDropshipLines,
  type DropshipLineInput,
} from "./dropship";

interface Line {
  id: string;
  itemName?: string | null;
}

function line(
  id: string,
  isDropship: boolean,
  defaultSupplierId: string | null | undefined,
  itemName?: string | null,
): DropshipLineInput<Line> {
  return { row: { id, itemName }, isDropship, defaultSupplierId, itemName };
}

describe("partitionDropshipLines", () => {
  it("routes non-dropship lines to `normal` and dropship lines to their supplier group", () => {
    const out = partitionDropshipLines([
      line("a", false, "sup-1"),
      line("b", true, "sup-1"),
      line("c", true, "sup-2"),
      line("d", true, "sup-1"),
    ]);
    expect(out.normal.map((r) => r.id)).toEqual(["a"]);
    expect(out.groups).toHaveLength(2);
    const sup1 = out.groups.find((g) => g.supplierId === "sup-1")!;
    expect(sup1.lines.map((r) => r.id).sort()).toEqual(["b", "d"]);
    const sup2 = out.groups.find((g) => g.supplierId === "sup-2")!;
    expect(sup2.lines.map((r) => r.id)).toEqual(["c"]);
  });

  it("collects dropship lines with a null supplier into missingSupplier (not silently dropped)", () => {
    const out = partitionDropshipLines([
      line("a", true, null),
      line("b", true, undefined),
      line("c", true, "sup-1"),
    ]);
    expect(out.missingSupplier.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].supplierId).toBe("sup-1");
  });

  it("ignores non-dropship lines even when their supplier is null (that's fine)", () => {
    const out = partitionDropshipLines([
      line("a", false, null),
      line("b", false, undefined),
    ]);
    expect(out.normal.map((r) => r.id)).toEqual(["a", "b"]);
    expect(out.missingSupplier).toEqual([]);
    expect(out.groups).toEqual([]);
  });

  it("preserves supplier insertion order so generated PO names match SO line order", () => {
    // supplier B appears before A in the input — the resulting groups
    // should list B first so the auto-created POs get sequential names
    // that visually match the SO's line order.
    const out = partitionDropshipLines([
      line("a1", true, "sup-B"),
      line("a2", true, "sup-A"),
      line("a3", true, "sup-B"),
    ]);
    expect(out.groups.map((g) => g.supplierId)).toEqual(["sup-B", "sup-A"]);
  });

  it("returns empty groups + normal + missing for an empty input", () => {
    const out = partitionDropshipLines([]);
    expect(out).toEqual({ groups: [], normal: [], missingSupplier: [] });
  });
});

describe("missingSupplierError", () => {
  it("names up to 5 items in the message so the operator can jump to them", () => {
    const msg = missingSupplierError([
      line("a", true, null, "Widget A"),
      line("b", true, null, "Widget B"),
    ]);
    expect(msg).toContain("Widget A");
    expect(msg).toContain("Widget B");
    expect(msg).toContain("Set Item.defaultSupplier");
  });

  it("says (+N more) when the list overflows 5", () => {
    const missing = Array.from({ length: 8 }, (_, i) =>
      line(`x${i}`, true, null, `Item ${i}`),
    );
    const msg = missingSupplierError(missing);
    expect(msg).toContain("(+3 more)");
  });

  it("falls back to a count when no item names are available", () => {
    const msg = missingSupplierError([
      line("a", true, null),
      line("b", true, null),
      line("c", true, null),
    ]);
    expect(msg).toContain("3 item(s)");
  });
});
