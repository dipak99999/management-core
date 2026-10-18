"use client";

// Cart page. Fetches the shop index once (small payload — 200 items max)
// and hydrates the localStorage cart against it by WebsiteItem id. Items
// that disappeared from the storefront since being added are silently
// dropped when rendering; the checkout server-side re-verifies too.
//
// Cart state lives in localStorage only — no server call to load/save.
// Qty changes and removals write through immediately.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  clearCart,
  loadCart,
  saveCart,
  shopApi,
  type ShopSummary,
} from "../../lib/api";
import { CartLink } from "../../components/cart-link";

export default function CartPage() {
  const [items, setItems] = useState<ShopSummary[]>([]);
  const [cartRaw, setCartRaw] = useState(loadCart());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shopApi
      .list()
      .then((rs) => setItems(rs ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    document.title = "Cart";
  }, []);

  useEffect(() => {
    function recompute() {
      setCartRaw(loadCart());
    }
    window.addEventListener("lumaara.cart.updated", recompute);
    window.addEventListener("storage", recompute);
    return () => {
      window.removeEventListener("lumaara.cart.updated", recompute);
      window.removeEventListener("storage", recompute);
    };
  }, []);

  const displayLines = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return cartRaw
      .map((c) => {
        const item = byId.get(c.websiteItemId);
        return item
          ? {
              websiteItemId: c.websiteItemId,
              variantItemId: c.variantItemId,
              variantLabel: c.variantLabel,
              qty: c.qty,
              item,
            }
          : null;
      })
      .filter(
        (l): l is {
          websiteItemId: string;
          variantItemId: string | undefined;
          variantLabel: string | undefined;
          qty: number;
          item: ShopSummary;
        } => !!l,
      );
  }, [cartRaw, items]);

  const total = displayLines.reduce((s, l) => s + l.qty * l.item.price, 0);

  // Cart-line identity is (websiteItemId, variantItemId?). Two variants
  // of the same template share websiteItemId, so keying only on that
  // would silently merge/clobber them.
  function lineKey(c: { websiteItemId: string; variantItemId?: string }): string {
    return `${c.websiteItemId}::${c.variantItemId ?? ""}`;
  }
  function updateQty(key: string, qty: number) {
    if (qty <= 0) {
      saveCart(cartRaw.filter((c) => lineKey(c) !== key));
    } else {
      saveCart(
        cartRaw.map((c) => (lineKey(c) === key ? { ...c, qty } : c)),
      );
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
          <Link href="/shop" className="text-brand-600 no-underline hover:text-brand-700">
            ← Continue shopping
          </Link>
          <CartLink />
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-ink">Cart</h1>
        {error && <div className="mt-4 text-red-600">{error}</div>}
        {loading && <div className="mt-4 text-ink-muted">Loading…</div>}
        {!loading && cartRaw.length === 0 && (
          <div className="mt-10 text-ink-muted text-center">
            Your cart is empty.{" "}
            <Link href="/shop" className="text-brand-600">
              Browse the shop →
            </Link>
          </div>
        )}
        {displayLines.length > 0 && (
          <>
            <div className="mt-6 divide-y divide-ink-muted/10 border-y border-ink-muted/10">
              {displayLines.map((l) => {
                const key = lineKey(l);
                return (
                  <div key={key} className="py-4 flex items-center gap-4">
                    <div className="w-16 h-16 bg-surface-2 rounded overflow-hidden shrink-0">
                      {l.item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- tenant shop image URL
                        <img
                          src={l.item.imageUrl}
                          alt={l.item.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center text-ink-muted text-xs">
                          —
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/shop/${l.item.slug}`}
                        className="font-medium text-ink truncate no-underline hover:text-brand-700"
                      >
                        {l.item.name}
                      </Link>
                      {l.variantLabel && (
                        <div className="text-xs text-brand-700">{l.variantLabel}</div>
                      )}
                      <div className="text-xs text-ink-muted">{l.item.itemCode}</div>
                      <div className="text-sm text-ink-soft tabular-nums">
                        ₹{l.item.price.toFixed(2)} each
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={l.qty}
                      onChange={(e) =>
                        updateQty(key, Number(e.target.value) || 0)
                      }
                      className="w-16 border border-ink-muted/20 rounded px-2 py-1 text-sm text-end"
                    />
                    <div className="w-24 text-end font-medium text-ink tabular-nums">
                      ₹{(l.qty * l.item.price).toFixed(2)}
                    </div>
                    <button
                      onClick={() => updateQty(key, 0)}
                      className="text-ink-muted hover:text-red-600 text-xs"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => {
                  if (confirm("Clear the entire cart?")) clearCart();
                }}
                className="text-sm text-ink-muted hover:text-red-600"
              >
                Clear cart
              </button>
              <div className="text-end">
                <div className="text-xs text-ink-muted">
                  Subtotal — taxes calculated at review
                </div>
                <div className="text-2xl font-bold text-ink tabular-nums">
                  ₹{total.toFixed(2)}
                </div>
                <Link
                  href="/checkout"
                  className="mt-3 inline-block bg-ink text-white px-6 py-2 rounded-lg font-medium hover:bg-brand-700 no-underline"
                >
                  Checkout →
                </Link>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
