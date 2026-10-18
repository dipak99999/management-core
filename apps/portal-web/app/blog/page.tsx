"use client";

// Public blog index. Renders published posts as cards (title, excerpt,
// author, category, featured image). Optional `?category=` narrows the
// list. Anonymous — no session required.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cmsApi, type PublicBlogPostSummary } from "../../lib/api";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function InnerBlogIndex() {
  const search = useSearchParams();
  const category = search?.get("category") ?? "";
  const [posts, setPosts] = useState<PublicBlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    cmsApi
      .listPosts(category || undefined)
      .then((rows) => setPosts(rows ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    document.title = category ? `Blog · ${category}` : "Blog";
  }, [category]);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-baseline justify-between">
          <Link href="/blog" className="text-3xl font-bold text-ink no-underline">
            Blog
          </Link>
          {category && (
            <div className="text-sm text-ink-muted">
              Category: <span className="text-ink font-medium">{category}</span>{" "}
              · <Link href="/blog" className="text-brand-600">show all</Link>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10">
        {error && <div className="text-red-600 mb-4">{error}</div>}
        {loading && <div className="text-ink-muted">Loading…</div>}
        {!loading && posts.length === 0 && (
          <div className="text-ink-muted text-center py-16">
            {category ? "No posts in this category yet." : "No posts published yet."}
          </div>
        )}
        <div className="space-y-8">
          {posts.map((p) => (
            <article
              key={p.id}
              className="flex gap-6 pb-8 border-b border-ink-muted/10 last:border-0"
            >
              {p.featuredImage && (
                <Link href={`/blog/${p.publicSlug}`} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- tenant blog image URL */}
                  <img
                    src={p.featuredImage}
                    alt=""
                    className="w-40 h-28 object-cover rounded-lg"
                  />
                </Link>
              )}
              <div className="flex-1 min-w-0">
                {p.category && (
                  <Link
                    href={`/blog?category=${encodeURIComponent(p.category)}`}
                    className="text-xs uppercase tracking-wider text-brand-600 font-semibold no-underline"
                  >
                    {p.category}
                  </Link>
                )}
                <h2 className="mt-1 text-xl font-bold text-ink">
                  <Link
                    href={`/blog/${p.publicSlug}`}
                    className="hover:text-brand-700 no-underline"
                  >
                    {p.title}
                  </Link>
                </h2>
                {p.excerpt && (
                  <p className="mt-2 text-ink-soft leading-relaxed">{p.excerpt}</p>
                )}
                <div className="mt-3 text-xs text-ink-muted">
                  {p.authorName && <span>{p.authorName}</span>}
                  {p.authorName && p.publishedAt && <span> · </span>}
                  {p.publishedAt && <span>{fmtDate(p.publishedAt)}</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

export default function BlogIndex() {
  return (
    <Suspense fallback={null}>
      <InnerBlogIndex />
    </Suspense>
  );
}
