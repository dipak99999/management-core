"use client";

// Header cart badge. Reads localStorage on mount, then re-reads on the
// `lumaara.cart.updated` window event so mutations from any page keep the
// badge live. Zero server round-trips.

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadCart } from "../lib/api";

export function CartLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function recompute() {
      const items = loadCart();
      setCount(items.reduce((s, l) => s + l.qty, 0));
    }
    recompute();
    window.addEventListener("lumaara.cart.updated", recompute);
    window.addEventListener("storage", recompute); // cross-tab sync
    return () => {
      window.removeEventListener("lumaara.cart.updated", recompute);
      window.removeEventListener("storage", recompute);
    };
  }, []);

  return (
    <Link
      href="/cart"
      className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-brand-50 no-underline text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6h15l-2 12H8z" />
        <circle cx="9" cy="21" r="1" />
        <circle cx="18" cy="21" r="1" />
        <path d="M6 6L4 2H1" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-medium">Cart</span>
      {count > 0 && (
        <span className="absolute -top-1 -end-1 bg-brand-600 text-white text-[10px] rounded-full h-4 min-w-4 px-1 grid place-items-center font-bold">
          {count}
        </span>
      )}
    </Link>
  );
}
