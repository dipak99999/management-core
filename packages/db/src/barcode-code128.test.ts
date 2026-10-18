import { describe, expect, it } from "vitest";
import { encodeCode128B, renderCode128Svg, renderLabelGridHtml } from "./barcode-code128";

describe("encodeCode128B", () => {
  it("prepends start (104) + appends stop (106)", () => {
    const s = encodeCode128B("A");
    expect(s[0]).toBe(104);
    expect(s[s.length - 1]).toBe(106);
  });

  it("checksum for 'PJJ123C' matches the ISO 15417 worked example", () => {
    //   Start B (104), P=48, J=42, J=42, 1=17, 2=18, 3=19, C=35
    //   check = (104 + 48*1 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7) mod 103
    //         = (104 + 48 + 84 + 126 + 68 + 90 + 114 + 245) mod 103
    //         = 879 mod 103 = 55
    const s = encodeCode128B("PJJ123C");
    expect(s[8]).toBe(55);
  });

  it("throws for characters outside 32..127", () => {
    expect(() => encodeCode128B("\t")).toThrow(/outside/);
    expect(() => encodeCode128B("€")).toThrow(/outside/);
  });

  it("encodes an empty-ish minimum", () => {
    const s = encodeCode128B("A");
    // start(104) + 'A'(33) + checksum + stop(106) = 4 symbols
    expect(s.length).toBe(4);
  });
});

describe("renderCode128Svg", () => {
  it("produces valid-looking SVG with bars + optional text", () => {
    const svg = renderCode128Svg("HELLO", { showText: true });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<rect");
    expect(svg).toContain(">HELLO</text>");
  });

  it("omits text when showText=false", () => {
    const svg = renderCode128Svg("HELLO", { showText: false });
    expect(svg).not.toContain("<text");
  });

  it("scales with moduleWidth", () => {
    const narrow = renderCode128Svg("X", { moduleWidth: 1 });
    const wide = renderCode128Svg("X", { moduleWidth: 4 });
    const wNarrow = Number(narrow.match(/width="(\d+)"/)![1]);
    const wWide = Number(wide.match(/width="(\d+)"/)![1]);
    expect(wWide).toBe(wNarrow * 4);
  });

  it("escapes < and & in human-readable text", () => {
    const svg = renderCode128Svg("A&B", { showText: true });
    expect(svg).toContain("A&amp;B");
    expect(svg).not.toContain(">A&B<");
  });
});

describe("renderLabelGridHtml", () => {
  it("emits one .label per row + honours column count", () => {
    const html = renderLabelGridHtml(
      [
        { barcode: "SKU-1", title: "Widget", subtitle: "$9.99" },
        { barcode: "SKU-2", title: "Gizmo" },
      ],
      { columns: 2 },
    );
    expect(html).toContain("grid-template-columns: repeat(2");
    expect((html.match(/class="label"/g) ?? []).length).toBe(2);
    expect(html).toContain("Widget");
    expect(html).toContain("$9.99");
  });
});
