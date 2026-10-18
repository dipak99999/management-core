"use client";

// Public blog post renderer. bodyHtml is authored-by-staff content, safe to
// render verbatim (same reasoning as WebPage). No comments/likes/related-
// posts yet — those are future work.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cmsApi, type PublicBlogPost } from "../../../lib/api";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function BlogPostClient() {
  const params = useParams<{ slug: string }>();
  const [post, setPost] = useState<PublicBlogPost | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.slug) return;
    cmsApi
      .getPost(params.slug)
      .then((p) => {
        if (!p) setNotFound(true);
        else {
          setPost(p);
          document.title = p.title;
          if (p.excerpt) {
            let el = document.querySelector<HTMLMetaElement>('meta[name="description"]');
            if (!el) {
              el = document.createElement("meta");
              el.setAttribute("name", "description");
              document.head.appendChild(el);
            }
            el.setAttribute("content", p.excerpt);
          }
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [params?.slug]);

  if (error)
    return (
      <div className="min-h-screen grid place-items-center text-red-600">
        {error}
      </div>
    );
  if (notFound)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-ink">404</h1>
          <p className="mt-2">
            This post hasn't been published.{" "}
            <Link href="/blog" className="text-brand-600">
              Back to Blog →
            </Link>
          </p>
        </div>
      </div>
    );
  if (!post)
    return (
      <div className="min-h-screen grid place-items-center text-ink-muted">
        Loading…
      </div>
    );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-muted/10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between text-sm">
          <Link href="/blog" className="text-brand-600 no-underline hover:text-brand-700">
            ← Blog
          </Link>
        </div>
      </header>
      <article className="max-w-3xl mx-auto px-6 py-10">
        {post.category && (
          <Link
            href={`/blog?category=${encodeURIComponent(post.category)}`}
            className="text-xs uppercase tracking-wider text-brand-600 font-semibold no-underline"
          >
            {post.category}
          </Link>
        )}
        <h1 className="mt-2 text-4xl font-bold text-ink leading-tight">
          {post.title}
        </h1>
        <div className="mt-3 text-sm text-ink-muted">
          {post.authorName && <span>{post.authorName}</span>}
          {post.authorName && post.publishedAt && <span> · </span>}
          {post.publishedAt && <span>{fmtDate(post.publishedAt)}</span>}
        </div>
        {post.featuredImage && (
          // tenant-authored blog image URL; CDN varies per tenant.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.featuredImage}
            alt=""
            className="mt-6 w-full h-auto rounded-lg"
          />
        )}
        <div
          className="mt-8 prose"
          dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
        />
      </article>
    </div>
  );
}
