"use client";

// Route-level error boundary for the shell itself. Catches render crashes
// in shell-owned routes (/, /settings/*, /admin/*, /notifications, etc.) and
// shows the branded fallback instead of Next.js's red overlay.
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
     
    console.error("[shell] render error:", error);
  }, [error]);

  return (
    <main className="min-h-screen grid place-items-center bg-brand-soft">
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
