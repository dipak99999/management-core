// Accessibility sweep. Hits a sampling of pages, runs axe-core, writes
// the violation list to the Playwright report. INTENTIONALLY lenient:
// we assert "no critical violations" rather than "zero violations",
// since perfect axe compliance is rare and the goal is to catch
// regressions (missing labels, broken headings, insufficient contrast),
// not block every PR.
//
// If a page lands with new critical violations the test fails and the
// report lists exactly which rules + which elements. Fix the elements,
// not the test.

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SHELL = "http://localhost:4556";
const AUTH = "http://localhost:4001";
const CREDS = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

async function seedAuth(page: Page): Promise<void> {
  const res = await page.request.post(`${AUTH}/auth/login`, { data: CREDS });
  if (!res.ok()) throw new Error(`login failed ${res.status()}`);
  const body = await res.json();
  await page.goto(`${SHELL}/`);
  await page.evaluate((b) => {
    localStorage.setItem("lumaara.session", JSON.stringify(b));
    localStorage.setItem("lumaara.uiMode", "manual");
  }, body);
}

interface Violation {
  id: string;
  impact?: string | null;
  description: string;
  helpUrl: string;
  nodes: { html: string; target: string[] }[];
}

async function runAxe(page: Page, label: string): Promise<Violation[]> {
  const res = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // Disable the rule that flags Next.js dev-mode <nextjs-portal> element
    // — not a real page concern.
    .disableRules(["landmark-one-main"])
    .analyze();
  const vs = res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({ html: n.html.slice(0, 200), target: n.target as string[] })),
  }));
  console.log(`[a11y] ${label}: ${vs.length} violation(s)`);
  for (const v of vs) {
    console.log(`  [${v.impact ?? "?"}] ${v.id} — ${v.description} (${v.nodes.length} nodes)`);
  }
  return vs;
}

const PAGES: Array<{ path: string; label: string; auth?: boolean }> = [
  // Public (unauth) — highest a11y stakes: new users land here cold.
  { path: "/login", label: "login", auth: false },
  { path: "/signup", label: "signup", auth: false },
  { path: "/forgot-password", label: "forgot password", auth: false },
  { path: "/status", label: "status", auth: false },
  { path: "/help", label: "help index", auth: false },
  { path: "/help/first-login", label: "help article", auth: false },
  { path: "/legal/privacy", label: "privacy policy", auth: false },
  // Authed shell — the pages a user hits every day.
  { path: "/dashboards", label: "dashboards (manual mode)", auth: true },
  { path: "/settings/billing", label: "billing", auth: true },
  { path: "/settings/two-factor", label: "2FA settings (QR + form)", auth: true },
  { path: "/notifications", label: "notifications inbox", auth: true },
  { path: "/todos", label: "todos list", auth: true },
  { path: "/ai-inbox", label: "AI inbox", auth: true },
  // Admin surfaces — tables, forms, modals.
  { path: "/admin/super/ai-providers", label: "super-admin AI providers", auth: true },
  { path: "/admin/super/billing-gateways", label: "super-admin billing gateways", auth: true },
  { path: "/admin/feature-flags", label: "admin feature flags", auth: true },
  { path: "/admin/audit-logs", label: "admin audit logs", auth: true },
];

test.describe("a11y: axe-core sweep", () => {
  test.setTimeout(180_000);

  for (const spec of PAGES) {
    test(`${spec.label} (${spec.path})`, async ({ page }) => {
      if (spec.auth) await seedAuth(page);
      // SSE connections keep the network warm, so "networkidle" never
      // fires. Use "domcontentloaded" and a hydration beat instead.
      await page.goto(`${SHELL}${spec.path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(2000); // let hydration + any lazy modules settle
      const violations = await runAxe(page, spec.label);
      const criticals = violations.filter((v) => v.impact === "critical");
      // Only fail on criticals. Serious/moderate/minor get logged to the
      // report so the a11y backlog is visible without blocking shipping.
      if (criticals.length > 0) {
        const summary = criticals
          .map((c) => `  - ${c.id}: ${c.description} (${c.nodes.length} node(s), e.g. ${c.nodes[0]?.target.join(">")})`)
          .join("\n");
        throw new Error(`${criticals.length} critical a11y violation(s) on ${spec.label}:\n${summary}`);
      }
      expect(criticals.length, `critical a11y violations on ${spec.label}`).toBe(0);
    });
  }
});
