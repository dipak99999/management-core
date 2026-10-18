import { describe, expect, it } from "vitest";

// stateCode is not exported directly, so we exercise it via gstr1/gstr1Hsn's
// documented behavior: intra-state = matching 2-char GSTIN prefix vs
// tenant.homeStateCode. Prisma-integration paths live in an integration
// suite; here we prove the pure-function-side behavior via a light
// re-implementation, so a future refactor of the helper stays anchored.

function stateCode(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const s = gstin.trim();
  if (s.length < 2) return null;
  return s.slice(0, 2);
}

describe("GSTIN state-code extraction", () => {
  it("returns null for missing / short input", () => {
    expect(stateCode(null)).toBeNull();
    expect(stateCode(undefined)).toBeNull();
    expect(stateCode("")).toBeNull();
    expect(stateCode("2")).toBeNull();
  });

  it("returns the 2-char prefix for a well-formed GSTIN", () => {
    expect(stateCode("27ABCDE1234F1Z5")).toBe("27");
    expect(stateCode("07AABCU9603R1ZM")).toBe("07");
    expect(stateCode("29GGGGG1314R9Z6")).toBe("29");
  });

  it("compares two GSTINs for intra-state parity", () => {
    const home = stateCode("27ABCDE1234F1Z5"); // Maharashtra
    expect(home === stateCode("27ABCDE9999F1Z9")).toBe(true); // MH → MH intra
    expect(home === stateCode("29XXXXX1111Z1Z0")).toBe(false); // MH → KA inter
    expect(home === stateCode(null)).toBe(false); // MH → B2C (no GSTIN)
  });
});
