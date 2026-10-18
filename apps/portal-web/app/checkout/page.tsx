"use client";

// Anonymous checkout. Collects buyer details, POSTs the cart to
// /public/checkout, and forwards to /checkout/success with the order
// number in the query string. Cart is cleared on success.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  clearCart,
  loadCart,
  shopApi,
  type ShopSummary,
} from "../../lib/api";

interface FormState {
  customerName: string;
  email: string;
  mobile: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  remarks: string;
}

const empty: FormState = {
  customerName: "",
  email: "",
  mobile: "",
  addressLine1: "",
  city: "",
  postalCode: "",
  remarks: "",
};

export default function CheckoutPage() {
  const router = useRouter();
  const [items, setItems] = useState<ShopSummary[]>([]);
  const [form, setForm] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // D4: coupon input. `applied` holds the server-verified preview so the
  // summary can show the discount pre-submit. The code string is sent
  // through in the checkout payload so the server re-validates + records it.
  const [couponInput, setCouponInput] = useState("");
  const [applied, setApplied] = useState<{
    code: string;
    ruleTitle: string;
    discountAmount: number;
    newTotal: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);

  useEffect(() => {
    document.title = "Checkout";
    shopApi.list().then((rs) => setItems(rs ?? []));
  }, []);

  const cart = loadCart();
  const displayLines = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    return cart
      .map((c) => {
        const item = byId.get(c.websiteItemId);
        return item
          ? { qty: c.qty, item, variantLabel: c.variantLabel }
          : null;
      })
      .filter(
        (l): l is { qty: number; item: ShopSummary; variantLabel: string | undefined } => !!l,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const total = displayLines.reduce((s, l) => s + l.qty * l.item.price, 0);
  // Effective total = applied.newTotal when a coupon is applied and the
  // subtotal hasn't shifted since; otherwise fall back to raw total.
  const effectiveTotal = applied && Math.abs(total - (applied.newTotal + applied.discountAmount)) < 0.01
    ? applied.newTotal
    : total;

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponBusy(true);
    setCouponError(null);
    try {
      const r = await shopApi.previewCoupon({
        items: cart.map((c) => ({
          websiteItemId: c.websiteItemId,
          variantItemId: c.variantItemId,
          qty: c.qty,
        })),
        code,
      });
      setApplied({
        code: r.code,
        ruleTitle: r.ruleTitle,
        discountAmount: r.discountAmount,
        newTotal: r.newTotal,
      });
    } catch (e) {
      setApplied(null);
      setCouponError(
        e instanceof Error ? e.message.replace(/^Error: /, "") : "Coupon rejected",
      );
    } finally {
      setCouponBusy(false);
    }
  }

  function clearCoupon() {
    setCouponInput("");
    setApplied(null);
    setCouponError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await shopApi.checkout({
        // Send only the fields the backend expects; drop the display-only
        // variantLabel cached in localStorage.
        items: cart.map((c) => ({
          websiteItemId: c.websiteItemId,
          variantItemId: c.variantItemId,
          qty: c.qty,
        })),
        customerName: form.customerName,
        email: form.email,
        mobile: form.mobile || undefined,
        addressLine1: form.addressLine1 || undefined,
        city: form.city || undefined,
        postalCode: form.postalCode || undefined,
        remarks: form.remarks || undefined,
        couponCode: applied?.code || undefined,
      });
      clearCart();
      router.push(`/checkout/success?order=${encodeURIComponent(res.orderNumber)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        Your cart is empty.{" "}
        <Link href="/shop" className="text-brand-600 ms-1">
          Browse the shop →
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-4xl mx-auto px-6 py-4 text-sm">
          <Link href="/cart" className="text-brand-600 no-underline hover:text-brand-700">
            ← Back to cart
          </Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10 grid md:grid-cols-2 gap-10">
        <div>
          <h1 className="text-2xl font-bold text-ink">Checkout</h1>
          {error && <div className="mt-4 text-red-600">{error}</div>}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs text-ink-muted mb-1">Full name *</label>
              <input
                required
                className="w-full border border-ink-muted/20 rounded px-3 py-2 text-sm"
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Email *</label>
              <input
                required
                type="email"
                className="w-full border border-ink-muted/20 rounded px-3 py-2 text-sm"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Phone</label>
              <input
                type="tel"
                className="w-full border border-ink-muted/20 rounded px-3 py-2 text-sm"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Address</label>
              <input
                className="w-full border border-ink-muted/20 rounded px-3 py-2 text-sm"
                placeholder="Street address"
                value={form.addressLine1}
                onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  className="border border-ink-muted/20 rounded px-3 py-2 text-sm"
                  placeholder="City"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
                <input
                  className="border border-ink-muted/20 rounded px-3 py-2 text-sm"
                  placeholder="Postal code"
                  value={form.postalCode}
                  onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                Notes for the seller
              </label>
              <textarea
                className="w-full border border-ink-muted/20 rounded px-3 py-2 text-sm"
                rows={3}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !form.customerName || !form.email}
              className="w-full bg-ink text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? "Placing order…" : `Place order — ₹${effectiveTotal.toFixed(2)}`}
            </button>
            <p className="text-[11px] text-ink-muted">
              No payment collected online. The seller will confirm final pricing
              (including any applicable taxes and shipping) and send an invoice
              via email.
            </p>
          </form>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">
            Order summary
          </h2>
          <div className="mt-4 divide-y divide-ink-muted/10 border-y border-ink-muted/10">
            {displayLines.map((l, i) => (
              <div key={i} className="py-3 flex items-center gap-3">
                <div className="w-12 h-12 bg-surface-2 rounded overflow-hidden shrink-0">
                  {l.item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant shop image URL
                    <img
                      src={l.item.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0 text-sm">
                  <div className="text-ink truncate">{l.item.name}</div>
                  {l.variantLabel && (
                    <div className="text-[11px] text-brand-700 truncate">
                      {l.variantLabel}
                    </div>
                  )}
                  <div className="text-xs text-ink-muted">
                    ₹{l.item.price.toFixed(2)} × {l.qty}
                  </div>
                </div>
                <div className="text-sm font-medium tabular-nums">
                  ₹{(l.qty * l.item.price).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-ink-muted">Subtotal</span>
            <span className="text-sm tabular-nums">₹{total.toFixed(2)}</span>
          </div>

          {/* D4: coupon input. Preview call validates + returns the
              discount info; on Place order we send the code and the
              server re-validates before creating the SO. */}
          <div className="mt-4 border-t border-ink-muted/10 pt-4">
            <label className="block text-xs text-ink-muted mb-1">Coupon code</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 border border-ink-muted/20 rounded px-3 py-2 text-sm uppercase font-mono"
                placeholder="e.g. SUMMER25"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  setCouponError(null);
                }}
                disabled={!!applied}
              />
              {applied ? (
                <button
                  type="button"
                  onClick={clearCoupon}
                  className="text-xs text-red-600 hover:text-red-700 px-3 py-2"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={couponBusy || !couponInput.trim()}
                  className="text-sm bg-brand-600 text-white rounded px-4 py-2 disabled:opacity-40 hover:bg-brand-700"
                >
                  {couponBusy ? "Checking…" : "Apply"}
                </button>
              )}
            </div>
            {applied && (
              <div className="mt-2 flex items-center justify-between text-sm text-emerald-700">
                <span>
                  <span className="font-mono">{applied.code}</span> · {applied.ruleTitle}
                </span>
                <span className="tabular-nums">−₹{applied.discountAmount.toFixed(2)}</span>
              </div>
            )}
            {couponError && (
              <div className="mt-2 text-xs text-red-600">{couponError}</div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <span className="text-sm text-ink-muted">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              ₹{effectiveTotal.toFixed(2)}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
