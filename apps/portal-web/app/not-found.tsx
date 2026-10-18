// Branded 404 for the customer portal. Portal pages are public-facing so
// the fallback links to "/" (portal home) rather than a staff "dashboard".
export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <div className="text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
          <span className="text-white text-2xl font-bold">L</span>
        </div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-ink-muted text-sm max-w-sm">
          The URL you followed doesn&apos;t match any page on this portal.
        </p>
        <a href="/" className="btn-brand inline-flex">
          Back to home
        </a>
      </div>
    </main>
  );
}
