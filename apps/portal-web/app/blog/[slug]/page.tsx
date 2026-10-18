// Server component — exports generateMetadata so social-preview bots
// and search crawlers get real per-post title + description + OG image
// without executing JS. The interactive rendering stays in the client
// component below.
//
// generateMetadata fetches the post server-side on every request. Add
// Next.js `revalidate` or ISR here when scaling matters.

import type { Metadata } from "next";
import BlogPostClient from "./BlogPostClient";

const CRM_BASE =
  process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "http://localhost:4004";

interface PostSEO {
  title: string;
  excerpt: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  try {
    const r = await fetch(`${CRM_BASE}/public/blog-posts/${slug}`, {
      next: { revalidate: 300 }, // 5 min
    });
    if (!r.ok) return {};
    const post = (await r.json()) as PostSEO;
    const description =
      post.excerpt ??
      "Read the latest from our blog on Lumaara's self-service portal.";
    return {
      title: post.title,
      description,
      openGraph: {
        title: post.title,
        description,
        type: "article",
        publishedTime: post.publishedAt ?? undefined,
        modifiedTime: post.updatedAt,
        images: post.featuredImage ? [{ url: post.featuredImage }] : undefined,
      },
      twitter: {
        card: post.featuredImage ? "summary_large_image" : "summary",
        title: post.title,
        description,
        images: post.featuredImage ? [post.featuredImage] : undefined,
      },
    };
  } catch {
    return {};
  }
}

export default function Page() {
  return <BlogPostClient />;
}
