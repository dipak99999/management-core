// Branded 404 for the accounting microfrontend. Without this file, Next.js
// serves its default unstyled 404 when a bad path like /accounting/foo falls
// through — looks like a broken deploy. The shell has its own not-found that
// catches shortcut redirects; this one just needs to look consistent so a
// stray link doesn't break the brand.
export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center bg-canvas">
      <div className="text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-gradient shadow-brand-glow grid place-items-center">
          <span className="text-white text-2xl font-bold">L</span>
        </div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-ink-muted text-sm max-w-sm">
          The URL you followed doesn&apos;t match any Lumaara page.
        </p>
        <a href="/" className="btn-brand inline-flex">
          Back to dashboard
        </a>
      </div>
    </main>
  );
}
