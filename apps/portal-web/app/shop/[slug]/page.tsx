"use client";

// Product detail. Add-to-cart mutates localStorage synchronously; toast
// feedback rather than a modal so the customer stays on the page and can
// keep browsing. bodyHtml is authored by staff — safe to inject verbatim
// (same reasoning as WebPage / BlogPost renderer).
//
// Variant products (item.isVariantTemplate = true) render one <select>
// per attribute (Color / Size / etc.) populated from the variants[]
// array. On every selection change we resolve the customer's picks to
// exactly one variant Item — if unmatched, "Add to cart" is disabled.
// Displayed price + itemCode swap to the resolved variant so the
// customer sees exactly what they're buying.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { loadCart, saveCart, shopApi, type ShopItem, type ShopVariant } from "../../../lib/api";
import { CartLink } from "../../../components/cart-link";

// The distinct attribute name → options mapping shown as pickers. Kept
// as a local helper (not @lumaara/db's collectAttributeOptions) so
// portal-web doesn't need to import from db.
function collectAttributeOptions(
  variants: ShopVariant[],
): { name: string; values: string[] }[] {
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes)) {
      if (!byName.has(k)) {
        byName.set(k, []);
        order.push(k);
      }
      const vals = byName.get(k)!;
      if (!vals.includes(val)) vals.push(val);
    }
  }
  return order.map((name) => ({ name, values: byName.get(name)! }));
}

// Resolve the current pick object to exactly one variant. Case-insensitive
// on both sides so "Red" matches "red". Returns null when unmatched — the
// UI disables "Add to cart" in that case.
function findVariant(
  variants: ShopVariant[],
  selection: Record<string, string>,
): ShopVariant | null {
  const keys = Object.keys(selection);
  if (keys.length === 0) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  for (const v of variants) {
    const attrs = v.attributes;
    const attrKeys = Object.keys(attrs);
    if (attrKeys.length !== keys.length) continue;
    let ok = true;
    for (const k of keys) {
      if (norm(attrs[k] ?? "") !== norm(selection[k])) {
        ok = false;
        break;
      }
    }
    if (ok) return v;
  }
  return null;
}

export default function ShopItemRoute() {
  const params = useParams<{ slug: string }>();
  const [item, setItem] = useState<ShopItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  // Selected attribute values. Empty string = unpicked. Only meaningful
  // when the item is a variant template.
  const [selection, setSelection] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!params?.slug) return;
    shopApi
      .get(params.slug)
      .then((it) => {
        if (!it) setNotFound(true);
        else {
          setItem(it);
          document.title = it.name;
          // Pre-seed the selection map with empty strings for every
          // attribute the template exposes.
          if (it.isVariantTemplate) {
            const seed: Record<string, string> = {};
            for (const opt of collectAttributeOptions(it.variants)) {
              seed[opt.name] = "";
            }
            setSelection(seed);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [params?.slug]);

  const attrOptions = useMemo(
    () => (item?.isVariantTemplate ? collectAttributeOptions(item.variants) : []),
    [item],
  );
  const resolvedVariant = useMemo(
    () =>
      item?.isVariantTemplate ? findVariant(item.variants, selection) : null,
    [item, selection],
  );

  // Effective display: variant's own price + itemCode when resolved; else
  // fall through to the template's WebsiteItem-level price.
  const displayPrice = resolvedVariant?.price ?? item?.price ?? 0;
  const displayCode = resolvedVariant?.itemCode ?? item?.itemCode ?? "";

  function addToCart() {
    if (!item) return;
    // Variant template WITHOUT a resolved pick — button should have been
    // disabled but guard defensively.
    if (item.isVariantTemplate && !resolvedVariant) return;
    const cart = loadCart();
    // De-dup key: for variants we key on (websiteItemId, variantItemId)
    // so Red-S and Red-M are separate lines. For non-variant products
    // the variantItemId is undefined so the key collapses to websiteItemId.
    const variantItemId = resolvedVariant?.itemId;
    const existing = cart.find(
      (c) => c.websiteItemId === item.id && c.variantItemId === variantItemId,
    );
    if (existing) existing.qty += qty;
    else
      cart.push({
        websiteItemId: item.id,
        variantItemId,
        qty,
        variantLabel: resolvedVariant
          ? Object.entries(resolvedVariant.attributes)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")
          : undefined,
      });
    saveCart(cart);
    setAdded(true);
    setTimeout(() => setAdded(false), 2500);
  }

  if (error)
    return (
      <div className="min-h-screen grid place-items-center text-red-600">
        {error}
      </div>
    );
  if (notFound)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-ink">404</h1>
          <p className="mt-2">
            This product isn't available.{" "}
            <Link href="/shop" className="text-brand-600">
              Back to Shop →
            </Link>
          </p>
        </div>
      </div>
    );
  if (!item)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        Loading…
      </div>
    );

  const needsVariantPick =
    item.isVariantTemplate &&
    (attrOptions.length === 0 || !resolvedVariant);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
          <Link href="/shop" className="text-brand-600 no-underline hover:text-brand-700">
            ← Shop
          </Link>
          <CartLink />
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-10 grid md:grid-cols-2 gap-10">
        <div>
          <div className="aspect-square bg-surface-2 rounded-lg overflow-hidden">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- tenant shop image URL
              <img
                src={item.imageUrl}
                alt={item.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full grid place-items-center text-ink-muted">
                No image
              </div>
            )}
          </div>
          {item.galleryUrls.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {item.galleryUrls.map((url) => (
                <div key={url} className="aspect-square bg-surface-2 rounded overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- tenant shop image URL */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-ink-muted">{displayCode}</div>
          <h1 className="mt-1 text-3xl font-bold text-ink">{item.name}</h1>
          {item.shortDescription && (
            <p className="mt-3 text-ink-soft">{item.shortDescription}</p>
          )}
          <div className="mt-5 text-3xl font-semibold text-ink tabular-nums">
            ₹{displayPrice.toFixed(2)}
          </div>

          {item.isVariantTemplate && (
            <div className="mt-6 space-y-3">
              {attrOptions.map((opt) => (
                <div key={opt.name}>
                  <label className="block text-xs uppercase tracking-wider text-ink-muted font-semibold mb-1">
                    {opt.name}
                  </label>
                  <select
                    value={selection[opt.name] ?? ""}
                    onChange={(e) =>
                      setSelection({ ...selection, [opt.name]: e.target.value })
                    }
                    className="w-full sm:w-56 border border-ink-muted/20 rounded px-3 py-2 text-sm"
                  >
                    <option value="">Choose {opt.name.toLowerCase()}…</option>
                    {opt.values.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {attrOptions.length === 0 && (
                <div className="text-sm text-ink-muted italic">
                  This product is marked as having variants, but none are
                  configured yet.
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <label className="text-sm text-ink-muted">Qty</label>
            <input
              type="number"
              min={1}
              max={999}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 border border-ink-muted/20 rounded px-2 py-1.5 text-sm"
            />
            <button
              onClick={addToCart}
              disabled={needsVariantPick}
              className="bg-ink text-white px-6 py-2 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {needsVariantPick ? "Pick options" : "Add to cart"}
            </button>
          </div>
          {added && (
            <div className="mt-3 text-sm text-brand-600">
              Added to cart —{" "}
              <Link href="/cart" className="underline">
                view cart →
              </Link>
            </div>
          )}
          {item.descriptionHtml && (
            <div
              className="mt-8 prose text-ink-soft"
              dangerouslySetInnerHTML={{ __html: item.descriptionHtml }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
