import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import shortcuts from "./shortcut-redirects.json";

// Fast-path: build a Map so a lookup is O(1). Same source as next.config.js's
// redirects() — we mirror the list here so client-side prefetches (RSC) and
// direct navigations both hit the same rewrite. next.config.js redirects()
// only catches full server round-trips; middleware also catches prefetch
// requests and any request the app-router thinks is a client-local route.
const shortcutMap = new Map<string, string>(
  (shortcuts as [string, string][]).flatMap(([src, dst]) => [
    [src, dst],
    // Also register `/leads/` etc. — Next.js sometimes appends a trailing
    // slash when it resolves parallel-route boundaries.
    [`${src}/`, `${dst}/`],
  ]),
);

// A few hand-picked aliases that don't come from pages.json.
const aliases: Record<string, string> = {
  "/invoices": "/accounting/sales-invoices",
  "/bills": "/buying/purchase-invoices",
  "/orders": "/crm/sales-orders",
};

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 1. Exact match against the shortcut map.
  const exact = shortcutMap.get(pathname) ?? aliases[pathname];
  if (exact) {
    const url = req.nextUrl.clone();
    url.pathname = exact;
    // 307 preserves the request method (GET → GET, POST → POST) and lets
    // the browser update the URL bar to the canonical path. RSC prefetches
    // follow this correctly.
    return NextResponse.redirect(url, 307);
  }

  // 2. Prefix match — /leads/new should redirect to /crm/leads/new, etc.
  //    Walk segments to find the longest prefix that matches.
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length >= 2) {
    const first = `/${segs[0]}`;
    const mapped = shortcutMap.get(first) ?? aliases[first];
    if (mapped) {
      const url = req.nextUrl.clone();
      url.pathname = `${mapped}/${segs.slice(1).join("/")}`;
      url.search = search;
      return NextResponse.redirect(url, 307);
    }
  }

  return NextResponse.next();
}

// Match every request the browser makes EXCEPT static assets, RSC internals,
// and the shell's own known routes. The matcher runs BEFORE the app router
// so it's safe to use broad matching + fine-grained early returns above.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|api|admin|settings|dashboards|todos|login|signup|verify-email|forgot-password|reset-password|oauth|accounting|buying|stock|crm|hr|projects).*)",
  ],
};
