import { describe, expect, it, vi } from "vitest";
import { renderTemplate } from "./comm-render";

describe("renderTemplate", () => {
  it("substitutes tokens with values", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Alice" })).toBe("Hi Alice");
  });

  it("tolerates whitespace inside {{ }}", () => {
    expect(renderTemplate("{{  name  }}", { name: "X" })).toBe("X");
  });

  it("renders missing tokens as empty string", () => {
    expect(renderTemplate("Hi {{name}}", {})).toBe("Hi ");
  });

  it("calls onMissing for each unknown key", () => {
    const missing: string[] = [];
    renderTemplate("{{a}} {{b}}", { a: 1 }, (k) => missing.push(k));
    expect(missing).toEqual(["b"]);
  });

  it("coerces numbers + booleans to strings", () => {
    expect(renderTemplate("{{n}}/{{b}}", { n: 42, b: true })).toBe("42/true");
  });

  it("renders null values as empty", () => {
    expect(renderTemplate("[{{v}}]", { v: null })).toBe("[]");
  });

  it("leaves non-token braces alone", () => {
    expect(renderTemplate("{ok} {{name}}", { name: "A" })).toBe("{ok} A");
  });

  it("does not recurse into substituted values", () => {
    // The substituted value contains a token literal — must NOT be re-scanned.
    expect(renderTemplate("{{a}}", { a: "{{b}}", b: "SHOULD-NOT-RENDER" })).toBe("{{b}}");
  });

  it("does not fire onMissing for successful lookups", () => {
    const spy = vi.fn();
    renderTemplate("{{a}}", { a: 1 }, spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
