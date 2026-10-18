import { describe, expect, it } from "vitest";
import {
  assertAllResolved,
  assertSingleTenant,
  computeCartTotals,
  effectivePrice,
  type WebsiteItemLike,
} from "./cart";

function wi(overrides: Partial<WebsiteItemLike> & { id: string }): WebsiteItemLike {
  return {
    tenantId: "t1",
    webPrice: null,
    item: { id: `item-${overrides.id}`, standardRate: 100 },
    ...overrides,
  };
}

describe("assertSingleTenant", () => {
  it("returns the tenantId when every item shares a tenant", () => {
    const r = assertSingleTenant([wi({ id: "a" }), wi({ id: "b" })]);
    expect(r).toEqual({ tenantId: "t1" });
  });

  it("returns an error when items span two tenants", () => {
    const r = assertSingleTenant([
      wi({ id: "a", tenantId: "t1" }),
      wi({ id: "b", tenantId: "t2" }),
    ]);
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toMatch(/multiple stores/);
  });

  it("returns an error when the cart resolved to zero items", () => {
    const r = assertSingleTenant([]);
    expect(r).toHaveProperty("error");
  });
});

describe("assertAllResolved", () => {
  it("returns null when every cart line matched a resolved item", () => {
    const err = assertAllResolved(
      [
        { websiteItemId: "a", qty: 1 },
        { websiteItemId: "b", qty: 2 },
      ],
      [{ id: "a" }, { id: "b" }],
    );
    expect(err).toBeNull();
  });

  it("returns an error when a cart id is missing from the resolved set", () => {
    const err = assertAllResolved(
      [
        { websiteItemId: "a", qty: 1 },
        { websiteItemId: "MISSING", qty: 2 },
      ],
      [{ id: "a" }],
    );
    expect(err).toMatch(/no longer available/);
  });
});

describe("effectivePrice", () => {
  it("uses webPrice when set (number)", () => {
    expect(effectivePrice(wi({ id: "a", webPrice: 79.5 }))).toBe(79.5);
  });

  it("falls back to Item.standardRate when webPrice is null", () => {
    expect(effectivePrice(wi({ id: "a", webPrice: null }))).toBe(100);
  });

  it("handles Prisma Decimal-shaped values (toString) on webPrice", () => {
    const decimalish = { toString: () => "49.99" };
    expect(effectivePrice(wi({ id: "a", webPrice: decimalish }))).toBe(49.99);
  });

  it("handles Prisma Decimal-shaped values on standardRate too", () => {
    const decimalish = { toString: () => "250" };
    expect(
      effectivePrice(
        wi({ id: "a", webPrice: null, item: { id: "i1", standardRate: decimalish } }),
      ),
    ).toBe(250);
  });

  it("treats webPrice = 0 as a valid free-item override, not a fallback", () => {
    // "Give it away" pricing — 0 is a legitimate value, not the same as null.
    expect(effectivePrice(wi({ id: "a", webPrice: 0 }))).toBe(0);
  });
});

describe("computeCartTotals", () => {
  it("multiplies rate by qty per line and sums", () => {
    const map = new Map<string, WebsiteItemLike>([
      ["a", wi({ id: "a", webPrice: 10 })],
      ["b", wi({ id: "b", webPrice: 25 })],
    ]);
    const { lines, netTotal } = computeCartTotals(
      [
        { websiteItemId: "a", qty: 3 }, // 30
        { websiteItemId: "b", qty: 2 }, // 50
      ],
      map,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ rate: 10, amount: 30 });
    expect(lines[1]).toMatchObject({ rate: 25, amount: 50 });
    expect(netTotal).toBe(80);
  });

  it("emits rate=0 for missing items (upstream resolver should have caught this)", () => {
    // Defensive: computeCartTotals doesn't throw on missing items so the
    // route can return a clean 400 via assertAllResolved instead of a crash.
    const map = new Map<string, WebsiteItemLike>();
    const { lines, netTotal } = computeCartTotals([{ websiteItemId: "x", qty: 5 }], map);
    expect(lines[0]).toMatchObject({ rate: 0, amount: 0 });
    expect(netTotal).toBe(0);
  });

  it("uses standardRate when webPrice is null", () => {
    const map = new Map<string, WebsiteItemLike>([
      [
        "a",
        wi({ id: "a", webPrice: null, item: { id: "i1", standardRate: 42 } }),
      ],
    ]);
    const { netTotal } = computeCartTotals([{ websiteItemId: "a", qty: 2 }], map);
    expect(netTotal).toBe(84);
  });
});
