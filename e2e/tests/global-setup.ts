import { test as setup, expect } from "@playwright/test";

// Global setup: log in via the staff auth API, then hand-write the
// localStorage session into a browser context and save its storageState.
// Every subsequent test starts from this authed state.
const ADMIN = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

// Playwright config sets E2E_AUTH_URL based on which port-set is up
// (harness 4101 vs. laptop 4001). Fallback keeps the file runnable
// standalone (e.g. via `playwright test -c custom.config.ts`).
const AUTH_URL = process.env.E2E_AUTH_URL ?? "http://localhost:4101";

// Setup logs in, then seeds localStorage on up to 14 origins. Dev-mode
// cold-compile is 15-45s per origin — allow ~60s/origin × 7 open origins
// × a safety margin → 10 min.
setup.setTimeout(600_000);
setup("authenticate as demo admin", async ({ page }) => {
  const res = await page.request.post(`${AUTH_URL}/auth/login`, {
    data: ADMIN,
  });
  expect(res.ok(), `login failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  expect(body.token, "no token in login response").toBeTruthy();

  // The web apps read the session from localStorage keyed by "lumaara.session".
  // We seed it on the shell origin (3100) then persist storageState. All the
  // module apps live under the same shell origin via rewrites, so the same
  // localStorage entry is visible to them.
  await page.goto("/login");
  await page.evaluate((session) => {
    localStorage.setItem("lumaara.session", JSON.stringify(session));
    // Shell defaults UiMode to "ai" (AssistShell takes over the viewport),
    // but every pre-AI-mode spec was written against the classic Manual
    // layout — sidebar, module cards, forms. Seed Manual here so each
    // suite doesn't need its own seedAuth helper.
    localStorage.setItem("lumaara.uiMode", "manual");
    // Tours (packages/web-ui/src/tour.tsx) auto-open on first visit and
    // intercept pointer events on list pages (Sales invoices, Customers,
    // …), making row clicks flaky. Disable globally in e2e.
    localStorage.setItem("lumaara.tours.disabled", "1");
  }, body);

  // Seed the module-app origins. In dev mode the first visit cold-compiles
  // (15-45s per app), so we can't rely on 20s timeouts. Strategy:
  //   1. Save storageState NOW (just shell origin) so a worker crash still
  //      leaves a usable file.
  //   2. For each origin, do a quick TCP probe before trying page.goto —
  //      skips closed ports in <100ms instead of waiting the full timeout.
  //   3. Allow 60s per cold-compile goto.
  //   4. Re-save storageState after every successful origin so partial
  //      seeding still improves on nothing.
  await page.context().storageState({ path: "storageState.json" });

  const PORT_BASEPATH: Record<number, string> = {
    // HARNESS layout
    3101: "/accounting", 3102: "/buying", 3103: "/stock",
    3104: "/crm", 3105: "/hr", 3106: "/projects", 3107: "/portal",
    // DEV layout
    3001: "/accounting", 3002: "/buying", 3003: "/stock",
    3004: "/crm", 3005: "/hr", 3006: "/projects", 3007: "/portal",
  };
  const envPorts = process.env.E2E_MODULE_PORTS?.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  const origins = envPorts && envPorts.length > 0
    ? envPorts
    : Object.keys(PORT_BASEPATH).map(Number);

  async function portOpen(port: number): Promise<boolean> {
    try {
      const r = await page.request.get(`http://localhost:${port}/`, { timeout: 1_500 });
      return r.status() > 0;
    } catch {
      return false;
    }
  }

  for (const port of origins) {
    if (!(await portOpen(port))) continue; // closed → skip fast
    try {
      const basePath = PORT_BASEPATH[port] ?? "/accounting";
      const url = `http://localhost:${port}${basePath}`;
      const resp = await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });
      if (!resp) throw new Error("no response");
      await page.evaluate((session) => {
        localStorage.setItem("lumaara.session", JSON.stringify(session));
        localStorage.setItem("lumaara.uiMode", "manual");
        localStorage.setItem("lumaara.tours.disabled", "1");
      }, body);
      // Checkpoint: persist storageState after each successful seed so
      // partial progress survives even if a later origin hangs.
      await page.context().storageState({ path: "storageState.json" });
    } catch (e) {
      console.warn(`setup: skip :${port} — ${e instanceof Error ? e.message.slice(0, 80) : "err"}`);
    }
  }

  await page.context().storageState({ path: "storageState.json" });
});
