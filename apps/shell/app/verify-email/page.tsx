"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

function InnerVerifyEmailPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setStatus("error");
      setError("Missing token");
      return;
    }
    fetch(`${AUTH}/verify-email/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (r.ok) setStatus("ok");
        else {
          const b = await r.json().catch(() => ({}));
          setError(b.error ?? "Verification failed");
          setStatus("error");
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Verification failed");
        setStatus("error");
      });
  }, [params]);

  return (
    <main className="min-h-screen bg-brand-soft grid place-items-center px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
            <span className="text-white text-2xl font-bold tracking-tight">L</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-brand-gradient bg-clip-text text-transparent">
            Verify your email
          </h1>
        </div>

        <div className="card shadow-brand-sm p-7 text-center">
          {status === "pending" && (
            <>
              <div className="mx-auto h-12 w-12 rounded-full bg-brand-100 text-brand-600 grid place-items-center mb-3 animate-pulse">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" strokeDasharray="30 15" />
                </svg>
              </div>
              <p className="text-sm text-ink-muted">Verifying your email address…</p>
            </>
          )}
          {status === "ok" && (
            <>
              <div className="mx-auto h-12 w-12 rounded-full bg-green-100 text-green-600 grid place-items-center mb-3">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10l4 4 8-8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-ink">Email verified</h2>
              <p className="text-sm text-ink-muted mt-2 mb-4">You&apos;re all set. Sign in to continue.</p>
              <a href="/login" className="btn-brand inline-flex">Sign in →</a>
            </>
          )}
          {status === "error" && (
            <>
              <div className="mx-auto h-12 w-12 rounded-full bg-red-100 text-red-600 grid place-items-center mb-3">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-ink">Verification failed</h2>
              <p className="text-sm text-red-600 mt-2 mb-4">{error}</p>
              <a href="/login" className="btn-secondary inline-flex">Back to sign in</a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <InnerVerifyEmailPage />
    </Suspense>
  );
}
