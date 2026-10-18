import { Prisma, prisma, withCrossTenant } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Daily AI Inbox digest email — one email per user who opted in via
// AiInboxPreference.dailyDigest = true. Only sends when the user has at
// least one open finding at-or-above their `digestMinSeverity` threshold
// (so we don't spam empty "nothing to flag today" emails).
//
// Enqueues to EmailMessage with status="Pending"; the auth-service's
// email worker drains the queue via SMTP / SendGrid.
//
// Env:
//   AI_INBOX_DIGEST_ENABLE=1               activate (default off)
//   AI_INBOX_DIGEST_HOUR_UTC=13            hour of day (UTC) to send (default: 13 = ~09:00 EST / 18:30 IST)
//   AI_INBOX_DIGEST_TICK_MS=1800000        outer wake-up cadence (default 30 min)
//
// The tick is cadence-safe: it only sends to a (user,day) pair once by
// consulting the user's last digest timestamp (persisted on the pref row).

const log = getLogger("scheduler");

const SEV_ORDER: Record<string, number> = { info: 0, watch: 1, critical: 2 };

// Per-category delivery cadence. Users with weekly cadence only get a
// digest once per 7 days; "never" categories are excluded entirely.
// Missing categories fall back to the top-level `dailyDigest` toggle.
type CatFreq = "daily" | "weekly" | "never";
function isDue(freq: CatFreq, lastSentAt: Date | null, now: Date): boolean {
  if (freq === "never") return false;
  if (!lastSentAt) return true;
  const ageMs = now.getTime() - lastSentAt.getTime();
  if (freq === "daily") return ageMs >= 20 * 60 * 60 * 1000; // 20h gives slack vs same-UTC-hour drift
  if (freq === "weekly") return ageMs >= 6.5 * 24 * 60 * 60 * 1000;
  return false;
}

export interface InboxDigestTickResult {
  recipients: number;
  sent: number;
  webhooksSent: number;
  skippedEmpty: number;
  errors: string[];
}

export async function runAiInboxDigestTick(): Promise<InboxDigestTickResult> {
  const result: InboxDigestTickResult = { recipients: 0, sent: 0, webhooksSent: 0, skippedEmpty: 0, errors: [] };
  if (process.env.AI_INBOX_DIGEST_ENABLE !== "1") return result;

  const sendHourUtc = Math.max(0, Math.min(23, Number(process.env.AI_INBOX_DIGEST_HOUR_UTC ?? 13)));
  const now = new Date();
  if (now.getUTCHours() !== sendHourUtc) return result; // only run in the configured hour

  // Guard against double-sending within the same UTC day: look for any
  // digest EmailMessage sent in the last 20 hours per user. Cheap enough
  // on a daily-send volume.
  const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000);

  // Pick up subscribers who have ANY delivery channel enabled —
  // dailyDigest email, a webhook, or per-category frequency with at
  // least one non-"never" value.
  // AiInboxPreference has no `user`/`tenant` relations defined in the
  // Prisma schema, so we can't `include` them. Fetch the prefs cross-tenant
  // (one query), then batch-resolve the users and tenants in two more
  // queries. Three round-trips total vs. the N+1 we'd get if we joined
  // one-by-one per subscriber.
  const prefs = await prisma.aiInboxPreference.findMany(withCrossTenant({
    where: {
      OR: [
        { dailyDigest: true },
        { webhookUrl: { not: null } },
        { categoryFrequency: { not: Prisma.JsonNull } },
      ],
    },
  }));
  const userIds = Array.from(new Set(prefs.map((p) => p.userId)));
  const tenantIds = Array.from(new Set(prefs.map((p) => p.tenantId)));
  const users = await prisma.user.findMany(withCrossTenant({
    where: { id: { in: userIds } },
    select: { id: true, email: true, fullName: true },
  }));
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, slug: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const subscribers = prefs.map((p) => ({
    ...p,
    user: userById.get(p.userId) ?? null,
    tenant: tenantById.get(p.tenantId) ?? null,
  }));

  for (const pref of subscribers) {
    if (!pref.user || !pref.tenant) continue;
    result.recipients++;
    try {
      const sevFloor = SEV_ORDER[pref.digestMinSeverity] ?? SEV_ORDER.watch;
      const findings = await prisma.aiInsightInbox.findMany({
        where: {
          tenantId: pref.tenantId,
          acknowledgedAt: null,
          OR: [{ dismissedUntil: null }, { dismissedUntil: { lt: now } }],
          category: pref.mutedCategories.length > 0 ? { notIn: pref.mutedCategories } : undefined,
        },
        orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }],
        take: 50,
      });
      const sevOk = findings.filter((f) => (SEV_ORDER[f.severity] ?? 0) >= sevFloor);

      // Per-category frequency filter. Users with no `categoryFrequency`
      // set behave the same as before (daily if dailyDigest=true).
      const freq = (pref.categoryFrequency ?? {}) as Record<string, CatFreq>;
      const relevant = [];
      for (const f of sevOk) {
        const catFreq = freq[f.category] ?? (pref.dailyDigest ? "daily" : "never");
        if (!isDue(catFreq, pref.updatedAt, now)) continue; // use updatedAt as cheap "last sent" proxy
        relevant.push(f);
      }
      if (relevant.length === 0) {
        result.skippedEmpty++;
        continue;
      }

      const { subject, html } = renderDigest(pref.tenant.name, relevant);

      // Email channel — only if dailyDigest=true + no recent send for dedup.
      if (pref.dailyDigest && pref.user.email) {
        const already = await prisma.emailMessage.findFirst({
          where: {
            tenantId: pref.tenantId,
            toEmail: pref.user.email,
            linkedDoctype: "AiInboxDigest",
            createdAt: { gte: twentyHoursAgo },
          },
          select: { id: true },
        });
        if (!already) {
          await prisma.emailMessage.create({
            data: {
              tenantId: pref.tenantId,
              toEmail: pref.user.email,
              subject,
              body: html,
              status: "Pending",
              linkedDoctype: "AiInboxDigest",
              linkedId: pref.id,
            },
          });
          result.sent++;
        }
      }

      // Webhook channel — Slack / Teams / generic. Both Slack and MS Teams
      // accept a simple `{text, blocks}` payload shape. Teams is picky about
      // "blocks" — if the admin picked "teams", we send `text` only.
      if (pref.webhookUrl) {
        const sentOK = await sendWebhook(pref.webhookUrl, pref.webhookType, pref.tenant.name, relevant, subject);
        if (sentOK) result.webhooksSent++;
      }

      // Mark the pref row touched so our "last sent" proxy advances.
      await prisma.aiInboxPreference.update({
        where: { id: pref.id },
        data: { updatedAt: new Date() },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("ai-inbox digest failed for user", { userId: pref.userId, msg });
      result.errors.push(`${pref.user?.email ?? pref.userId}: ${msg}`);
    }
  }
  return result;
}

// Slack-style webhook POST. 8s timeout to keep the scheduler loop snappy
// even if the webhook endpoint is slow.
async function sendWebhook(
  url: string,
  type: string | null,
  tenantName: string,
  findings: Finding[],
  subject: string,
): Promise<boolean> {
  const isTeams = type === "teams";
  const summaryLines = findings.slice(0, 6).map((f) => {
    const sev = f.severity === "critical" ? "🔴" : f.severity === "watch" ? "🟡" : "🔵";
    return `${sev} *[${f.category}]* ${f.title}`;
  });
  const text = `*${subject}*\n${summaryLines.join("\n")}${findings.length > 6 ? `\n…and ${findings.length - 6} more.` : ""}\n<${process.env.PUBLIC_URL ?? "https://your-app"}/ai-inbox|Open AI Inbox>`;
  const payload: Record<string, unknown> = isTeams
    ? { text: text.replace(/\*/g, "**").replace(/<(.*?)\|(.*?)>/g, "[$2]($1)") } // Teams prefers Markdown
    : {
        text: subject,
        blocks: [
          { type: "header", text: { type: "plain_text", text: subject } },
          { type: "section", text: { type: "mrkdwn", text: summaryLines.join("\n") || "No findings." } },
          { type: "context", elements: [{ type: "mrkdwn", text: `_From Lumaara workspace: ${tenantName}_` }] },
        ],
      };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    return r.ok;
  } catch (e) {
    log.warn("ai-inbox webhook failed", { url: url.slice(0, 60), err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ── Rendering ────────────────────────────────────────────────────────

type Finding = {
  id: string; title: string; finding: string; severity: string;
  category: string; actionLabel: string | null; actionHref: string | null;
};

function renderDigest(tenantName: string, findings: Finding[]): { subject: string; html: string } {
  const criticalCount = findings.filter((f) => f.severity === "critical").length;
  const subject = criticalCount > 0
    ? `[${tenantName}] ${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} + ${findings.length - criticalCount} other`
    : `[${tenantName}] ${findings.length} finding${findings.length === 1 ? "" : "s"} to review`;

  // Group by category for a tidy email.
  const byCat: Record<string, Finding[]> = {};
  for (const f of findings) (byCat[f.category] ??= []).push(f);

  // HTML with semantic markup; safe for Gmail/Outlook (no CSS tricks).
  const dot = (sev: string) =>
    sev === "critical" ? "#dc2626" : sev === "watch" ? "#d97706" : "#0284c7";
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#1f1f1f;">
<h1 style="font-size:20px;margin:0 0 8px;">${escape(subject)}</h1>
<p style="color:#666;margin:0 0 24px;">Your Lumaara AI Inbox digest for ${escape(tenantName)}.</p>
${Object.entries(byCat).map(([cat, items]) => `
  <h2 style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#999;margin:16px 0 8px;">${escape(cat)}</h2>
  ${items.map((f) => `
    <div style="border:1px solid #e5e5e5;border-radius:12px;padding:14px;margin-bottom:10px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dot(f.severity)};margin-top:5px;flex-shrink:0;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;margin-bottom:4px;">${escape(f.title)}</div>
          <div style="color:#555;line-height:1.5;">${escape(f.finding)}</div>
          ${f.actionHref ? `<div style="margin-top:8px;"><a href="${escape(f.actionHref)}" style="color:#1a1a1a;font-weight:500;">${escape(f.actionLabel ?? "Open")} →</a></div>` : ""}
        </div>
      </div>
    </div>`).join("")}
`).join("")}
<p style="color:#888;font-size:12px;margin-top:24px;">
  <a href="/ai-inbox" style="color:#1a1a1a;">Open the AI Inbox</a> ·
  <a href="/settings/ai-inbox" style="color:#1a1a1a;">Digest preferences</a>
</p>
</body></html>`;

  return { subject, html };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
