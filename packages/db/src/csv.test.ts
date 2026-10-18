import { describe, expect, it } from "vitest";
import { coerceCell, csvIterator, parseCsv, toCsvRow } from "./csv";

describe("parseCsv", () => {
  it("parses a plain grid", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles quoted cells with commas", () => {
    expect(parseCsv('name,note\n"Doe, Jane","hi, there"')).toEqual([
      ["name", "note"],
      ["Doe, Jane", "hi, there"],
    ]);
  });

  it("handles escaped double quotes inside quoted cells", () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([["a"], ['say "hi"']]);
  });

  it("normalizes CRLF to LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves embedded newlines inside quoted cells", () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([["a"], ["line1\nline2"]]);
  });

  it("returns empty grid for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("toCsvRow", () => {
  it("joins simple cells with commas", () => {
    expect(toCsvRow(["a", "b", 1])).toBe("a,b,1");
  });

  it("quotes cells containing commas or quotes", () => {
    expect(toCsvRow(["Doe, Jane", 'say "hi"'])).toBe('"Doe, Jane","say ""hi"""');
  });

  it("renders null/undefined as empty", () => {
    expect(toCsvRow([null, undefined, "x"])).toBe(",,x");
  });
});

describe("coerceCell", () => {
  it("coerces string type", () => {
    expect(coerceCell({ key: "name", type: "string" }, " hi ")).toBe("hi");
  });

  it("coerces number type", () => {
    expect(coerceCell({ key: "n", type: "number" }, "3.14")).toBe(3.14);
  });

  it("throws on invalid number", () => {
    expect(() =>
      coerceCell({ key: "n", type: "number", required: true }, "abc"),
    ).toThrow(/must be a number/);
  });

  it("coerces date type", () => {
    const d = coerceCell({ key: "d", type: "date" }, "2024-01-15") as Date;
    expect(d.getUTCFullYear()).toBe(2024);
  });

  it("accepts multiple boolean surface forms", () => {
    expect(coerceCell({ key: "b", type: "boolean" }, "yes")).toBe(true);
    expect(coerceCell({ key: "b", type: "boolean" }, "0")).toBe(false);
  });

  it("returns null for empty when not required", () => {
    expect(coerceCell({ key: "x", type: "string" }, "")).toBe(null);
    expect(coerceCell({ key: "x", type: "string" }, "  ")).toBe(null);
  });

  it("throws for empty when required", () => {
    expect(() => coerceCell({ key: "x", required: true }, "")).toThrow(/required/);
  });
});

describe("csvIterator", () => {
  it("exposes cell lookup by header name + 1-based rowNumber", () => {
    const parsed = parseCsv("name,age\nA,30\nB,40");
    const { header, iter, rowCount } = csvIterator(parsed);
    expect(header).toEqual(["name", "age"]);
    expect(rowCount).toBe(2);
    expect(iter[0].rowNumber).toBe(1);
    expect(iter[0].cell("name")).toBe("A");
    expect(iter[1].cell("age")).toBe("40");
    expect(iter[0].cell("missing")).toBe("");
  });
});
