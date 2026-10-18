/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  basePath: "/portal",
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
};
module.exports = nextConfig;
