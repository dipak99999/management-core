/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: emits .next/standalone/ with a self-contained server
  // (only needs node runtime — no node_modules in the runner image).
  output: "standalone",
  // basePath ensures assets/routes are namespaced under /accounting so the shell
  // can proxy this app cleanly.
  basePath: "/hr",
  transpilePackages: ["@lumaara/shared-types"],

  async rewrites() {
    // Same /api/* proxies as the shell (apps/shell/next.config.js). Keeps
    // the module app functional when visited directly instead of via shell:
    // a form POST to /api/accounting/suppliers works on either origin.
    const authSvc = process.env.AUTH_SERVICE_URL ?? "http://localhost:4001";
    const accountingSvc = process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:4002";
    const stockSvc = process.env.STOCK_SERVICE_URL ?? "http://localhost:4003";
    const crmSvc = process.env.CRM_SERVICE_URL ?? "http://localhost:4004";
    const hrSvc = process.env.HR_SERVICE_URL ?? "http://localhost:4005";
    const projectsSvc = process.env.PROJECTS_SERVICE_URL ?? "http://localhost:4006";
    return [
      { source: "/api/auth/:path*", destination: `${authSvc}/auth/:path*`, basePath: false },
      { source: "/api/auth-svc/:path*", destination: `${authSvc}/:path*`, basePath: false },
      { source: "/api/accounting/:path*", destination: `${accountingSvc}/:path*`, basePath: false },
      { source: "/api/stock/:path*", destination: `${stockSvc}/:path*`, basePath: false },
      { source: "/api/crm/:path*", destination: `${crmSvc}/:path*`, basePath: false },
      { source: "/api/hr/:path*", destination: `${hrSvc}/:path*`, basePath: false },
      { source: "/api/projects/:path*", destination: `${projectsSvc}/:path*`, basePath: false },
    ];
  },
  // Some pages transitively import @lumaara/db (via shared-types re-exports).
  // packages/db/src/backup.ts uses node:child_process — safe on the server,
  // unbundleable in the browser. Stub Node built-ins to `false` so webpack
  // drops them from client chunks; server chunks resolve them normally.
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        "child_process": false,
        "fs": false,
        "net": false,
        "tls": false,
        "dns": false,
      };
      // Also strip `node:` scheme so `import "node:child_process"` resolves.
      config.plugins ||= [];
      const webpack = require("next/dist/compiled/webpack/webpack.js").webpack;
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
    }
    return config;
  },
};
module.exports = nextConfig;
