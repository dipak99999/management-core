// E-commerce cart pure helpers — the non-DB pieces of the checkout flow.
// Kept here so vitest can exercise them without a live database.
// Used by services/crm-service/src/routes/shop-checkout.ts.

export interface CartLineInput {
  websiteItemId: string;
  qty: number;
}

export interface WebsiteItemLike {
  id: string;
  tenantId: string;
  webPrice: number | string | { toString(): string } | null | undefined;
  item: { id: string; standardRate: number | string | { toString(): string } };
}

/**
 * Verify all items in a cart belong to the same tenant. Returns the tenantId
 * on success, or an error string. Every storefront checkout is scoped to
 * one seller — a cart spanning two tenants would need to split into N Sales
 * Orders, which we deliberately don't do.
 */
export function assertSingleTenant<T extends { tenantId: string }>(
  websiteItems: T[],
): { tenantId: string } | { error: string } {
  const tenantIds = [...new Set(websiteItems.map((wi) => wi.tenantId))];
  if (tenantIds.length === 0) {
    return { error: "Cart is empty after resolution" };
  }
  if (tenantIds.length > 1) {
    return {
      error: "Cart contains items from multiple stores; check out separately",
    };
  }
  return { tenantId: tenantIds[0]! };
}

/**
 * Verify every cart line resolved to a live WebsiteItem. Returns null on
 * success or a helpful error string listing the missing IDs.
 */
export function assertAllResolved(
  cart: CartLineInput[],
  resolved: { id: string }[],
): string | null {
  const resolvedIds = new Set(resolved.map((r) => r.id));
  const missing = cart
    .map((c) => c.websiteItemId)
    .filter((id) => !resolvedIds.has(id));
  if (missing.length === 0) return null;
  return `One or more items in your cart are no longer available`;
}

/**
 * Effective per-unit price for a WebsiteItem: `webPrice` if set (a positive
 * override), else fall back to the parent Item's `standardRate`. Handles
 * both raw numbers and Prisma Decimal (which stringifies via .toString()).
 */
export function effectivePrice(wi: WebsiteItemLike): number {
  const override = wi.webPrice;
  const raw = override != null ? override : wi.item.standardRate;
  return typeof raw === "number" ? raw : Number(raw.toString());
}

/**
 * Compute per-line amounts + the cart total. Uses `effectivePrice` per item.
 * Returns numeric values (routes convert to Prisma.Decimal on write).
 */
export function computeCartTotals(
  cart: CartLineInput[],
  wiById: Map<string, WebsiteItemLike>,
): {
  lines: { websiteItemId: string; qty: number; rate: number; amount: number }[];
  netTotal: number;
} {
  const lines = cart.map((c) => {
    const wi = wiById.get(c.websiteItemId);
    const rate = wi ? effectivePrice(wi) : 0;
    return {
      websiteItemId: c.websiteItemId,
      qty: c.qty,
      rate,
      amount: rate * c.qty,
    };
  });
  const netTotal = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, netTotal };
}
