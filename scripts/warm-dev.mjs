// Pre-compile every dev-mode Next.js route so the first click after
// `pnpm dev` is fast. Next.js dev-mode compiles routes lazily — a cold
// `/stock/warehouses` route can take 15-90s on first navigation because
// the module tree (400+ modules per page) is transpiled on-demand.
//
// This script hits every page URL via the shell proxy (:4556) in
// parallel across module hosts (3001-3006), forcing dev-mode to compile
// them in the background. Run once after `pnpm dev` boots, before you
// start clicking.
//
// Usage:
//   node scripts/warm-dev.mjs           # all modules
//   WARM_ONLY=accounting node ...       # just one app
//
// Reads routes from the Next.js types.d.ts file each app emits — gives
// a complete list without maintaining a separate manifest.

import { readFileSync, existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { parse } from "node:url";

const SHELL = process.env.SHELL_URL ?? "http://127.0.0.1:4556";
const AUTH = process.env.AUTH_URL ?? "http://127.0.0.1:4001";
const DEMO = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

const APPS = {
  accounting: { basePath: "/accounting", typesFile: "apps/accounting-web/.next/types/routes.d.ts" },
  buying: { basePath: "/buying", typesFile: "apps/buying-web/.next/types/routes.d.ts" },
  crm: { basePath: "/crm", typesFile: "apps/crm-web/.next/types/routes.d.ts" },
  hr: { basePath: "/hr", typesFile: "apps/hr-web/.next/types/routes.d.ts" },
  projects: { basePath: "/projects", typesFile: "apps/projects-web/.next/types/routes.d.ts" },
  stock: { basePath: "/stock", typesFile: "apps/stock-web/.next/types/routes.d.ts" },
  shell: { basePath: "", typesFile: "apps/shell/.next/types/routes.d.ts" },
};

function extractRoutes(typesFile, basePath) {
  if (!existsSync(typesFile)) return [];
  const content = readFileSync(typesFile, "utf8");
  // Pull every "/path" | from the AppRoutes union type and skip [param]
  // dynamic routes (can't warm without an id).
  const m = content.match(/type AppRoutes\s*=\s*([^;]+);/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/"([^"]+)"/g))
    .map((x) => x[1])
    .filter((r) => !r.includes("[") && !r.includes("]"))
    .map((r) => (r === "/" ? basePath || "/" : basePath + r));
}

function doReq(url, { method = "GET", body = null, token = null, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = parse(url);
    const req = httpRequest({
      hostname: u.hostname, port: u.port, path: u.pathname + (u.search ?? ""),
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      // Discard body — we only care that compilation completed.
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const onlyApp = process.env.WARM_ONLY;
  const apps = onlyApp ? { [onlyApp]: APPS[onlyApp] } : APPS;
  if (onlyApp && !APPS[onlyApp]) {
    console.error(`Unknown app: ${onlyApp}. Options: ${Object.keys(APPS).join(", ")}`);
    process.exit(2);
  }

  // Login once — the warm-up requests go through the shell which some
  // routes require auth for (and we want to hit the authed codepath).
  const login = await doReq(`${AUTH}/auth/login`, { method: "POST", body: DEMO });
  if (login.status !== 200) {
    console.error("Login failed — demo creds must work. Status:", login.status);
    process.exit(1);
  }
  // Second shot to pull the token (first call discarded body)
  const r2 = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: 4001, path: "/auth/login", method: "POST",
      headers: { "content-type": "application/json" } },
      (res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", () => resolve(JSON.parse(d))); });
    req.on("error", reject);
    req.write(JSON.stringify(DEMO));
    req.end();
  });
  const token = r2.token;

  for (const [name, cfg] of Object.entries(apps)) {
    const routes = extractRoutes(cfg.typesFile, cfg.basePath);
    if (routes.length === 0) {
      console.log(`[${name}] no routes.d.ts found — skipping (run \`pnpm --filter @lumaara/${name}-web dev\` once to generate)`);
      continue;
    }
    console.log(`[${name}] warming ${routes.length} routes...`);
    const results = { ok: 0, slow: 0, fail: 0 };
    const times = [];
    // Parallelize per app, limit concurrency to 4 so dev-server isn't swamped
    const workers = 4;
    let idx = 0;
    await Promise.all(Array.from({ length: workers }, async () => {
      while (true) {
        const i = idx++;
        if (i >= routes.length) return;
        const route = routes[i];
        const t = Date.now();
        try {
          const res = await doReq(SHELL + route, { token, timeoutMs: 120_000 });
          const ms = Date.now() - t;
          times.push(ms);
          if (res.status >= 200 && res.status < 400) {
            if (ms > 5000) results.slow++;
            else results.ok++;
          } else {
            results.fail++;
          }
        } catch {
          results.fail++;
        }
      }
    }));
    const total = times.reduce((s, x) => s + x, 0);
    console.log(`[${name}] done. ok=${results.ok} slow=${results.slow} fail=${results.fail}  avg=${Math.round(total / Math.max(times.length, 1))}ms`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
