"use client";

// Route-level error boundary. Catches render errors in any page under this
// microfrontend and shows a branded fallback with a retry button instead of
// Next.js's default red overlay. The error itself is logged to the browser
// console so devs can grab the stack during dev; in prod we deliberately
// don't surface stack traces to the user.
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
     
    console.error("[crm-web] render error:", error);
  }, [error]);

  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <div className="text-center space-y-3 max-w-md">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
          <span className="text-white text-2xl font-bold">L</span>
        </div>
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-ink-muted text-sm">
          We hit an error loading this page. The team has been notified.
        </p>
        {error.digest && (
          <p className="text-ink-muted text-xs font-mono">ref: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center pt-2">
          <button type="button" onClick={reset} className="btn-brand">
            Try again
          </button>
          <a href="/" className="btn-secondary">
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}
