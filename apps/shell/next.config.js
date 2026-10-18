/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@lumaara/shared-types"],
  // Default Next.js proxy timeout is 30s. Microfrontend `/accounting/*`,
  // `/projects/*` etc routes rewrite to independent Next.js dev servers
  // that need up to ~90s on first-compile for a cold route (417+ modules
  // transpiled on-demand). Bumping to 120s so dev-mode first-click doesn't
  // 500 at the shell layer. Prod ignores this (standalone server serves
  // compiled bundles).
  experimental: {
    proxyTimeout: 120_000,
  },
  // Proxy microfrontend routes to their independent Next.js remotes.
  // In prod this becomes a load-balancer/router config; here it's rewrites.
  async rewrites() {
    const accounting = process.env.ACCOUNTING_WEB_URL ?? "http://localhost:3001";
    const buying = process.env.BUYING_WEB_URL ?? "http://localhost:3002";
    const stock = process.env.STOCK_WEB_URL ?? "http://localhost:3003";
    const crm = process.env.CRM_WEB_URL ?? "http://localhost:3004";
    const hr = process.env.HR_WEB_URL ?? "http://localhost:3005";
    const projects = process.env.PROJECTS_WEB_URL ?? "http://localhost:3006";
    // Same-origin API proxies. The browser talks to shell (4556), which
    // rewrites to the backend service ports. Keeps auth/data calls same-origin
    // so port-isolated environments (VS Code webviews, tunnels, mobile
    // Safari, restrictive CSPs) don't hit CORS / "Failed to fetch" walls.
    const authSvc = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
    const accountingSvc = process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:4002";
    const stockSvc = process.env.STOCK_SERVICE_URL ?? "http://localhost:4003";
    const crmSvc = process.env.CRM_SERVICE_URL ?? "http://localhost:4004";
    const hrSvc = process.env.HR_SERVICE_URL ?? "http://localhost:4005";
    const projectsSvc = process.env.PROJECTS_SERVICE_URL ?? "http://localhost:4006";
    return [
      // API service proxies — same-origin from the browser's POV.
      { source: "/api/auth/:path*", destination: `${authSvc}/auth/:path*` },
      { source: "/api/auth-svc/:path*", destination: `${authSvc}/:path*` },
      { source: "/api/accounting/:path*", destination: `${accountingSvc}/:path*` },
      { source: "/api/stock/:path*", destination: `${stockSvc}/:path*` },
      { source: "/api/crm/:path*", destination: `${crmSvc}/:path*` },
      { source: "/api/hr/:path*", destination: `${hrSvc}/:path*` },
      { source: "/api/projects/:path*", destination: `${projectsSvc}/:path*` },
      // Microfrontend rewrites (unchanged).
      { source: "/accounting", destination: `${accounting}/accounting` },
      { source: "/accounting/:path*", destination: `${accounting}/accounting/:path*` },
      { source: "/buying", destination: `${buying}/buying` },
      { source: "/buying/:path*", destination: `${buying}/buying/:path*` },
      { source: "/stock", destination: `${stock}/stock` },
      { source: "/stock/:path*", destination: `${stock}/stock/:path*` },
      { source: "/crm", destination: `${crm}/crm` },
      { source: "/crm/:path*", destination: `${crm}/crm/:path*` },
      { source: "/hr", destination: `${hr}/hr` },
      { source: "/hr/:path*", destination: `${hr}/hr/:path*` },
      { source: "/projects", destination: `${projects}/projects` },
      { source: "/projects/:path*", destination: `${projects}/projects/:path*` },
    ];
  },
  // Convenience redirects — bare doctype URLs (e.g. /leads, /invoices,
  // /customers) bounce to the canonical module-prefixed path so bookmarks +
  // typed URLs "just work" instead of 404'ing. The full list is generated
  // from e2e/pages.json (see shortcut-redirects.json) — every module page
  // that doesn't clash with a shell-owned path gets a bare-URL alias plus
  // an /:path* wildcard so nested paths like /leads/new redirect too.
  //
  // Also includes a couple of hand-picked aliases (e.g. /invoices →
  // /accounting/sales-invoices) that don't appear in pages.json but are
  // intuitive user shortcuts.
  async redirects() {
    const pairs = require("./shortcut-redirects.json");
    const aliases = [
      ["/invoices", "/accounting/sales-invoices"],
      ["/bills", "/buying/purchase-invoices"],
      ["/orders", "/crm/sales-orders"],
    ];
    // 5-module URL aliases. Users bookmarking /hrms/employees get the
    // existing /hr/employees page; same for /payroll (→/hr), /finance
    // (→/accounting), /sales (→/crm), /manufacturing (→/stock). Keeps
    // marketing-visible module names in URLs while reusing current pages.
    const moduleAliases = [
      ["/hrms", "/hr"],
      ["/payroll", "/hr"],
      ["/finance", "/accounting"],
      ["/sales", "/crm"],
      ["/manufacturing", "/stock"],
    ];
    return [...pairs, ...aliases, ...moduleAliases].flatMap(([src, dst]) => [
      { source: src, destination: dst, permanent: false },
      { source: `${src}/:path*`, destination: `${dst}/:path*`, permanent: false },
    ]);
  },
};
module.exports = nextConfig;
