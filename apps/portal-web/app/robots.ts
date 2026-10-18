// Static robots.txt. Allow crawling of public surfaces (shop, blog,
// public booking pages) and deny the authed portal interior (invoices,
// settings, DSR, tickets) + login flows that don't help SEO + the API
// endpoints Next.js auto-proxies.
//
// If the deployment binds the portal to its own hostname (e.g.
// portal.example.com), tune this per-host. Default is "allow public,
// deny everything else."

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_PORTAL_PUBLIC_URL ??
    process.env.PORTAL_PUBLIC_URL ??
    "https://portal.example.com";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/shop", "/blog", "/book", "/site", "/privacy"],
        disallow: [
          "/login",
          "/forgot-password",
          "/accept-invite",
          "/cart",
          "/checkout",
          "/invoices",
          "/statement",
          "/tickets",
          "/quotations",
          "/purchase-orders",
          "/dsr",
          "/settings",
          "/api/",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
