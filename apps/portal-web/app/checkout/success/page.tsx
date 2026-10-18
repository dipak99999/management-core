"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect } from "react";

function InnerCheckoutSuccess() {
  const q = useSearchParams();
  const order = q?.get("order") ?? "";

  useEffect(() => {
    document.title = "Order placed";
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-white">
      <div className="max-w-md text-center px-6">
        <div className="w-16 h-16 rounded-full bg-brand-50 grid place-items-center mx-auto">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-brand-600">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl font-bold text-ink">Order placed</h1>
        {order && (
          <p className="mt-2 text-ink-soft">
            Your reference is{" "}
            <span className="font-mono font-semibold text-ink">{order}</span>.
          </p>
        )}
        <p className="mt-4 text-sm text-ink-muted">
          We've emailed the buyer a receipt. The seller will confirm the final
          invoice (with any applicable taxes and shipping) shortly.
        </p>
        <div className="mt-8">
          <Link
            href="/shop"
            className="inline-block bg-ink text-white px-6 py-2 rounded-lg font-medium hover:bg-brand-700 no-underline"
          >
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutSuccess() {
  return (
    <Suspense fallback={null}>
      <InnerCheckoutSuccess />
    </Suspense>
  );
}
