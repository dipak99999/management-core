import { test, expect, request as pwRequest } from "@playwright/test";

// AI Mode smoke test. Verifies:
//   1. Signing in and defaulting to AI Mode renders the assist chat
//      ("What's next?" heading, prompt input, left rail).
//   2. Toggling to Manual Mode brings back the sidebar.
//   3. Typing "/" opens the slash-command palette populated from
//      /api/accounting/agents/tool-catalog.

const SHELL = process.env.SHELL_URL ?? "http://localhost:4556";
const ADMIN = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

let SESSION: { token: string } & Record<string, unknown>;

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${SHELL}/api/auth-svc/auth/login`, { data: ADMIN });
  if (!res.ok()) throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  SESSION = await res.json();
  await ctx.dispose();
});

test.beforeEach(async ({ page }) => {
  await page.goto(`${SHELL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((session) => {
    localStorage.setItem("lumaara.session", JSON.stringify(session));
    // Force AI Mode default; individual tests override.
    localStorage.setItem("lumaara.uiMode", "ai");
  }, SESSION);
});

test("AI Mode renders the assist chat by default", async ({ page }) => {
  await page.goto(SHELL);
  await expect(page.getByText(/What.?s next\?/)).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByPlaceholder(/Ask, create, or explore/i),
  ).toBeVisible();
  // Mode toggle is present so users can switch back to Manual.
  await expect(page.getByRole("button", { name: /Manual Mode/i })).toBeVisible();
});

test("Toggle switches to Manual Mode + brings back sidebar", async ({ page }) => {
  await page.goto(SHELL);
  await expect(page.getByText(/What.?s next\?/)).toBeVisible();

  await page.getByRole("button", { name: /Manual Mode/i }).click();
  // Manual Mode renders the classic sidebar → "Overview" section label
  await expect(page.getByText(/^Overview$/i).first()).toBeVisible({ timeout: 5000 });
});

test("Typing '/' opens the slash palette with tool matches", async ({ page }) => {
  await page.goto(SHELL);
  const input = page.getByPlaceholder(/Ask, create, or explore/i);
  await input.fill("/report");

  // The palette shows entries like "/report.trial_balance" etc.
  await expect(page.getByText("/report.trial_balance")).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText(/reports/i).first()).toBeVisible();
});

test("Submitting a prompt creates an AgentTask + streams step events", async ({ page }) => {
  await page.goto(SHELL);

  const input = page.getByPlaceholder(/Ask, create, or explore/i);
  await input.fill("List the first 3 customers");
  await input.press("Enter");

  // User bubble echoes the prompt
  await expect(page.getByText("List the first 3 customers")).toBeVisible({ timeout: 8000 });

  // Agent bubble shows a task id + at least "Planning…" or a step marker.
  // Stub provider succeeds fast so we should see "Done" within ~15s.
  const agentBubble = page.locator("text=/(Planning…|▸|✓|Done\\.)/").first();
  await expect(agentBubble).toBeVisible({ timeout: 20_000 });

  // Task id chip on the meta line
  await expect(page.locator("text=/Task [a-z0-9]{8}/i").first()).toBeVisible();
});

test("Voice input button appears when SpeechRecognition is available", async ({ page }) => {
  await page.goto(SHELL);
  // Chromium has webkitSpeechRecognition, so the mic button should render.
  await expect(page.getByRole("button", { name: /dictation|Voice input/i })).toBeVisible();
});

test("Module chips render + clicking HR sets scope + filters palette", async ({ page }) => {
  await page.goto(SHELL);

  // Chips visible below the input. Label changed to "HRMS" in the Oct-2026
  // module registry refactor (packages/shared-types/src/modules.ts).
  const hrChip = page.getByRole("button", { name: /^HRMS$/, exact: false }).first();
  await expect(hrChip).toBeVisible();

  await hrChip.click();

  // Placeholder changes to reflect the scope
  await expect(page.getByPlaceholder(/Ask about HR/i)).toBeVisible();

  // Clear-scope pill inside input shows the module name
  await expect(page.locator(".chip-solid-navy", { hasText: /^HR/ })).toBeVisible();

  // Palette now only shows HR tools — hit '/' and confirm HR items appear
  const input = page.getByPlaceholder(/Ask about HR/i);
  await input.fill("/");
  await expect(page.getByText("/employee.list")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("/leave_application.list")).toBeVisible();
  // Non-HR tools shouldn't appear
  await expect(page.getByText("/customer.list")).toHaveCount(0);
});
