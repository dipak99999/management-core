// Portal loading fallback — simpler shape than the staff apps since the
// portal pages are usually single-form or product-detail, not list-heavy.
// Uses plain divs with animate-pulse so there's no dependency on the
// Skeleton primitive (portal's ui.tsx is a leaner subset of the staff ui).

const bar = "bg-canvas-sunken rounded animate-pulse";

export default function PortalLoading() {
  return (
    <main className="p-6 space-y-4 max-w-2xl mx-auto">
      <div className={`h-8 w-48 ${bar}`} aria-hidden />
      <div className={`h-4 w-72 ${bar}`} aria-hidden />
      <div className={`h-40 w-full rounded-xl ${bar}`} aria-hidden />
      <div className={`h-10 w-32 rounded-full ${bar}`} aria-hidden />
      <span className="sr-only">Loading…</span>
    </main>
  );
}
