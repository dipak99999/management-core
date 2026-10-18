// Static help-center content. Edit this file to add articles — no DB
// migration, no CMS, no deploy ceremony. Markdown-ish body (we render
// headings + lists + code + links) keeps authoring simple.
//
// Articles are grouped into categories; the index lists categories first
// then articles within each. Keep slug stable once published — it's the
// URL that users bookmark.

export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string; // light markdown — see renderBody() in [slug]/page.tsx
  lastReviewed: string; // ISO date
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ─── Getting started ────────────────────────────────────────────────
  {
    slug: "first-login",
    title: "Your first login",
    category: "Getting started",
    summary: "Log in, invite teammates, pick a plan.",
    lastReviewed: "2026-10-01",
    body: `
## Logging in for the first time

When your admin invites you, you'll get an email with a link that sets your password. The link is good for 24 hours.

If the link expired, go to the login page and click **Forgot password?** — we'll email you a fresh one.

## What to do first

1. **Set up two-factor auth** — Settings → Two Factor. Takes 60 seconds; dramatically reduces account-takeover risk.
2. **Invite your team** — Admin → Users → Invite. New users get the same password-link email.
3. **Pick your subscription plan** — Settings → Billing. The admin can switch between tiers; the plan controls which modules are visible.

## Keyboard shortcuts

- \`⌘K\` / \`Ctrl K\` — open the global search anywhere in the app
- \`/\` — focus the Brew bar
- \`⌘.\` — toggle the sidebar
`,
  },
  {
    slug: "modules-and-submodules",
    title: "Modules & submodules — what you can see",
    category: "Getting started",
    summary: "Your plan controls which parts of the product are visible.",
    lastReviewed: "2026-10-01",
    body: `
Lumaara ships five business modules: **HRMS**, **Payroll**, **Finance & Accounting**, **Sales & CRM**, and **Manufacturing & Inventory**.

Your subscription plan says which modules are enabled. If a sidebar group is missing, your plan doesn't include it — ask the admin to upgrade in Settings → Billing.

## Submodules

Each module is broken into submodules (e.g. HRMS → Employees, Attendance, Leave, Appraisals). Plans can enable modules partially — you might get the Finance module with just invoicing + payments, without the full GL.

Super-admins see everything regardless of plan.
`,
  },

  // ─── Billing & subscription ────────────────────────────────────────
  {
    slug: "subscribe-to-a-plan",
    title: "Subscribing to a paid plan",
    category: "Billing",
    summary: "Walk through the Razorpay checkout flow.",
    lastReviewed: "2026-10-01",
    body: `
## Step by step

1. Go to **Settings → Billing**.
2. Pick a plan from the "Available plans" grid.
3. Click **Subscribe for ₹…** — Razorpay Checkout opens inside the page.
4. Pay with card / UPI / netbanking / wallet. Payment is confirmed in a few seconds.
5. You're returned to Billing; the new plan is active immediately.

## Receipts & invoices

Every successful charge creates an entry in the **Payment history** table at the bottom of the Billing page. The Razorpay payment ID is shown — your finance team can use it to reconcile against your bank statement.

## Changing plans mid-cycle

If you upgrade mid-cycle, the new plan is prorated by Razorpay automatically. Downgrades take effect at the next renewal (we don't refund partial months).

## Canceling

Email support — in-app cancel is coming soon. We honour the current paid-through date; you keep access until the period ends.
`,
  },
  {
    slug: "payment-failed",
    title: "What to do if a payment fails",
    category: "Billing",
    summary: "Payment errors, retries, and when to contact support.",
    lastReviewed: "2026-10-01",
    body: `
## Common reasons

- **Card declined**: your bank blocked the transaction. Try a different card or ask your bank to allow international/recurring charges.
- **UPI timeout**: the UPI network is slow. Retry after 60 seconds.
- **Insufficient balance**: self-explanatory. Topup and retry.

## Status in the Payment history

The **Status** column shows what happened:

- \`CREATED\` — order was created but no payment attempt reached our server
- \`PAID\` — all good
- \`FAILED\` — payment attempted but didn't go through

If you see \`CREATED\` and never \`PAID\` after an attempt, the payment likely did complete at Razorpay but our server missed the webhook. Email support with the order ID — we'll reconcile manually.
`,
  },

  // ─── AI & Brew ──────────────────────────────────────────────────────
  {
    slug: "ai-providers",
    title: "AI providers (Claude, OpenAI, Brew)",
    category: "AI",
    summary: "How to configure the AI backend that powers Brew + RAG.",
    lastReviewed: "2026-10-01",
    body: `
## Where keys live

Super admins configure AI provider keys at **Admin → AI Providers**. We support **Anthropic (Claude)**, **OpenAI**, **Brew (OpenAI-compat)**, **Azure OpenAI**, and **Ollama**.

Keys are encrypted at rest with the platform's \`MASTER_SECRET_KEY\`. The redacted view in the UI shows a "CONFIGURED" badge instead of the raw key.

## Resolution order

When you ask Brew a question, we pick the first configured provider from this chain:

1. **Your tenant's** TenantIntegration row (if you've added your own key under Admin → Integrations)
2. **Platform default** — the row marked "default" in Admin → AI Providers
3. **Platform active** — any active row, picked by priority
4. **Env fallback** — only in development

So you can either run on the platform's shared key or bring your own.

## Streaming

Brew now streams responses as they're generated — you see the text appear word by word instead of waiting for the full answer. If your model doesn't support streaming (older Ollama models, some proxies), it degrades to a single reply at the end.
`,
  },
  {
    slug: "brew-tips",
    title: "Getting good answers from Brew",
    category: "AI",
    summary: "Prompt patterns that work well with the ERP data.",
    lastReviewed: "2026-10-01",
    body: `
Brew has access to your tenant's data (customers, invoices, items, leads, employees) through semantic search. It can answer questions grounded in your actual records.

## Patterns that work

- **"List all customers in Mumbai with pending invoices"** — Brew will search Customer records filtered by city + joined to SalesInvoice status.
- **"Show me the top 5 items by revenue this quarter"** — aggregate query over SalesInvoiceItem.
- **"What's the status of PO-0042?"** — specific record lookup.

## Patterns that don't

- "Create a new invoice for Acme" — Brew doesn't take write actions in the current version. Use the UI or an API call.
- "What were our sales last October?" — if we don't have historical data in the ERP yet, Brew can't invent it.

## Citations

Every Brew answer that references a record includes a \`[doctype:docId]\` tag so you can click through to the original. If an answer has no citations, treat it as hearsay — Brew made it up.
`,
  },

  // ─── Admin & security ──────────────────────────────────────────────
  {
    slug: "two-factor-auth",
    title: "Enabling two-factor authentication",
    category: "Security",
    summary: "Add TOTP (Google Authenticator, 1Password, etc).",
    lastReviewed: "2026-10-01",
    body: `
## How to enable

1. **Settings → Two Factor → Enable**.
2. Scan the QR code with Google Authenticator, 1Password, or Authy.
3. Enter the 6-digit code from your app to confirm.
4. **Save your recovery codes.** You'll need them if you lose your phone.

## Recovery codes

We generate 8 one-time codes. Store them in your password manager — treat them like root passwords. If you lose both your phone AND your recovery codes, an admin can disable 2FA for your account from Admin → Users.

## When 2FA kicks in

Every login + every "sensitive action" (changing your password, rotating API tokens, viewing audit logs). You'll see the 6-digit prompt right after password entry.
`,
  },
  {
    slug: "api-tokens",
    title: "API tokens for integrations",
    category: "Security",
    summary: "Issue, scope, and rotate tokens for scripts + webhooks.",
    lastReviewed: "2026-10-01",
    body: `
## When to use an API token vs OAuth

- **API token** — for scripts you own (cron jobs, data syncs, Zapier). Tied to your user; dies when your user is deactivated.
- **OAuth app** — for third-party apps that act on behalf of users (BI tools, mobile clients). Admin configures the app at Admin → OAuth Clients.

## Issuing a token

**Settings → API Tokens → Create**. Give it a descriptive name ("Zapier Slack integration"). You'll see the raw token ONCE — copy it immediately. We only store the hash.

## Scopes

Tokens inherit your user's permissions. We don't currently support reduced-scope tokens — if you want a read-only integration, create a dedicated low-privilege user for it.

## Rotation

Rotate tokens quarterly minimum, immediately if you suspect leakage. Create the new one first, update your integration, then delete the old one.
`,
  },

  // ─── Troubleshooting ───────────────────────────────────────────────
  {
    slug: "something-is-broken",
    title: "Something is broken — what do I do?",
    category: "Troubleshooting",
    summary: "A triage checklist.",
    lastReviewed: "2026-10-01",
    body: `
## Step 1: Check the status page

Visit **/status** — tells you whether a service is down. If anything is red there, the problem is on our end + we're already working on it.

## Step 2: Reload + retry

Browser caches sometimes get stale (particularly after a deploy). \`⌘⇧R\` (Mac) or \`Ctrl⇧R\` (Windows) forces a hard refresh.

## Step 3: Check the browser console

Right-click → Inspect → Console. If you see red errors, screenshot them and include in your bug report.

## Step 4: File a bug

**Admin → Tickets → New** or email support. Include:

- what you were trying to do
- what you expected
- what happened instead
- URL you were on
- browser + OS
- any screenshots or console errors

Response SLAs depend on your plan — Enterprise gets 4h, Pro gets same-business-day.
`,
  },
];

export function allCategories(): string[] {
  const seen = new Set<string>();
  for (const a of HELP_ARTICLES) seen.add(a.category);
  return Array.from(seen);
}

export function articlesByCategory(category: string): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}

export function findArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}
