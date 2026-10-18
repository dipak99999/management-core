// Dynamic sitemap. Lists static public routes + the tenant-authored
// blog posts and shop items that have been published. Each entry gets a
// `lastModified` so crawlers only revisit changed pages.
//
// The sitemap is tenant-scoped at the URL layer only (one portal host =
// one tenant, resolved by subdomain). If you're serving multiple tenants
// from one portal host, you'd need per-tenant sub-sitemaps keyed by
// `?tenant=slug`; the pattern below is the single-tenant default.
//
// Next.js caches `sitemap.ts` output at the ISR layer; this file is a
// server-only module that fetches at build time + revalidates per
// `revalidate` export. Set NEXT_PUBLIC_PORTAL_PUBLIC_URL to generate
// absolute URLs — crawlers reject relative sitemap entries.

import type { MetadataRoute } from "next";

export const revalidate = 3600; // 1h

interface MinimalBlogPost {
  publicSlug: string;
  publishedAt: string | null;
  updatedAt: string;
}

interface MinimalShopItem {
  slug: string;
  updatedAt: string;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { next: { revalidate } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base =
    process.env.NEXT_PUBLIC_PORTAL_PUBLIC_URL ??
    process.env.PORTAL_PUBLIC_URL ??
    "https://portal.example.com";

  // Public API bases — fall back to CI defaults.
  const crmBase =
    process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "http://localhost:4004";

  const [blogPosts, shopItems] = await Promise.all([
    fetchJson<MinimalBlogPost[]>(`${crmBase}/public/blog-posts?limit=1000`),
    fetchJson<MinimalShopItem[]>(`${crmBase}/public/shop?limit=1000`),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/blog`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];

  const blogEntries: MetadataRoute.Sitemap = (blogPosts ?? []).map((p) => ({
    url: `${base}/blog/${p.publicSlug}`,
    lastModified: new Date(p.publishedAt ?? p.updatedAt),
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const shopEntries: MetadataRoute.Sitemap = (shopItems ?? []).map((s) => ({
    url: `${base}/shop/${s.slug}`,
    lastModified: new Date(s.updatedAt),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...blogEntries, ...shopEntries];
}
