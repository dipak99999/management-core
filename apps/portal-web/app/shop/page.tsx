"use client";

// Public storefront grid. Anonymous — no session required.

import { useEffect, useState } from "react";
import Link from "next/link";
import { shopApi, type ShopSummary } from "../../lib/api";
import { CartLink } from "../../components/cart-link";

export default function ShopIndex() {
  const [items, setItems] = useState<ShopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shopApi
      .list()
      .then((rs) => setItems(rs ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    document.title = "Shop";
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link href="/shop" className="text-2xl font-bold text-ink no-underline">
            Shop
          </Link>
          <CartLink />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10">
        {error && <div className="text-red-600 mb-4">{error}</div>}
        {loading && <div className="text-ink-muted">Loading…</div>}
        {!loading && items.length === 0 && (
          <div className="text-ink-muted text-center py-16">
            Nothing published to the storefront yet.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {items.map((it) => (
            <Link
              key={it.slug}
              href={`/shop/${it.slug}`}
              className="group no-underline"
            >
              <div className="aspect-square bg-surface-2 rounded-lg overflow-hidden">
                {it.imageUrl ? (
                  // user-supplied shop image URL; multi-tenant CDNs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.imageUrl}
                    alt={it.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-ink-muted text-xs">
                    No image
                  </div>
                )}
              </div>
              <div className="mt-3">
                <div className="text-xs text-ink-muted">{it.itemCode}</div>
                <div className="mt-0.5 font-medium text-ink group-hover:text-brand-700 truncate">
                  {it.name}
                </div>
                {it.shortDescription && (
                  <div className="mt-0.5 text-xs text-ink-muted line-clamp-2">
                    {it.shortDescription}
                  </div>
                )}
                <div className="mt-1.5 text-sm font-semibold text-ink tabular-nums">
                  ₹{it.price.toFixed(2)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
