import Link from "next/link";
import { allCategories, articlesByCategory } from "../../lib/help-articles";

// Help center index — static, server-rendered. Lists categories + the
// articles in each. Searchable client-side (future: wire into Brew).

export const metadata = { title: "Help · Lumaara" };

export default function HelpIndex() {
  const categories = allCategories();
  return (
    <main className="min-h-screen bg-canvas p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <nav className="text-xs text-ink-muted mb-2">
            <Link href="/" className="hover:text-ink">← Back to app</Link>
          </nav>
          <h1 className="font-wordmark text-3xl mb-2">Help</h1>
          <p className="text-ink-muted">
            Guides for getting started, billing, security, AI, and troubleshooting.
            Can't find what you need?{" "}
            <Link href="/admin/tickets" className="text-ink underline">File a ticket</Link>.
          </p>
        </header>

        {categories.map((cat) => (
          <section key={cat} className="mb-8">
            <h2 className="section-title mb-3">{cat}</h2>
            <div className="card p-0 overflow-hidden">
              <ul className="divide-y divide-ink/10">
                {articlesByCategory(cat).map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/help/${a.slug}`}
                      className="flex items-start justify-between px-5 py-3 hover:bg-canvas-warm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{a.title}</div>
                        <div className="text-sm text-ink-muted mt-0.5">{a.summary}</div>
                      </div>
                      <span className="text-ink-muted ms-4 flex-shrink-0" aria-hidden>→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
