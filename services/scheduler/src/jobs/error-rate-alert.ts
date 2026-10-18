import { decryptSecrets, postSlackMessage, prisma } from "@lumaara/db";

// M-alert: rolling-window error-rate check. Runs every N minutes, counts
// ErrorLog rows per tenant in the last WINDOW minutes, fires an alert when
// count ≥ THRESHOLD. Alerts fan out to:
//   1. any active + default Slack integration in the tenant
//   2. every SystemManager user's in-app Notification
//
// Env config:
//   ALERT_ERROR_WINDOW_MIN   (default 10)
//   ALERT_ERROR_THRESHOLD    (default 25)  — set to 0 to disable
//   ALERT_ERROR_COOLDOWN_MIN (default 60)  — min gap between alerts / tenant

interface AlertResult {
  tenantsChecked: number;
  alertsFired: number;
  errors: number;
}

// In-memory cooldown map. Fine for a singleton scheduler; if we ever run
// multiple schedulers we'd promote this to a DB row.
const lastAlertAt = new Map<string, number>();

export async function runErrorRateCheck(): Promise<AlertResult> {
  const threshold = Number(process.env.ALERT_ERROR_THRESHOLD ?? 25);
  const windowMin = Number(process.env.ALERT_ERROR_WINDOW_MIN ?? 10);
  const cooldownMin = Number(process.env.ALERT_ERROR_COOLDOWN_MIN ?? 60);
  if (threshold <= 0) return { tenantsChecked: 0, alertsFired: 0, errors: 0 };

  const cutoff = new Date(Date.now() - windowMin * 60_000);
  const grouped = await prisma.errorLog.groupBy({
    by: ["tenantId"],
    where: { createdAt: { gte: cutoff } },
    _count: { _all: true },
  });

  let alertsFired = 0;
  let errors = 0;
  const now = Date.now();
  for (const row of grouped) {
    if (!row.tenantId) continue; // ErrorLog.tenantId is nullable — skip cross-tenant errors
    if (row._count._all < threshold) continue;
    const tenantId = row.tenantId;
    const last = lastAlertAt.get(tenantId) ?? 0;
    if (now - last < cooldownMin * 60_000) continue;
    try {
      await fireTenantAlert(tenantId, row._count._all, windowMin);
      lastAlertAt.set(tenantId, now);
      alertsFired += 1;
    } catch {
      errors += 1;
    }
  }
  return { tenantsChecked: grouped.length, alertsFired, errors };
}

async function fireTenantAlert(
  tenantId: string,
  count: number,
  windowMin: number,
): Promise<void> {
  const subject = `⚠︎ Error rate alert: ${count} errors in the last ${windowMin} min`;
  const body =
    `The scheduler detected ${count} ErrorLog entries in the last ${windowMin} minute(s), ` +
    `above the configured threshold. Investigate at /admin/error-logs.`;

  // Slack — fire-and-forget per active default Slack integration.
  const slackInt = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "slack", isActive: true, isDefault: true },
  });
  if (slackInt) {
    const secrets = decryptSecrets(slackInt.secrets) as { webhookUrl?: string };
    if (secrets.webhookUrl) {
      await postSlackMessage(secrets.webhookUrl, {
        text: subject,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${subject}*\n${body}` },
          },
        ],
      }).catch(() => undefined);
    }
  }

  // In-app notifications for SystemManager users.
  const smRole = await prisma.role.findFirst({
    where: { tenantId, roleName: "SystemManager" },
    select: { id: true },
  });
  if (!smRole) return;
  const userRoles = await prisma.userRole.findMany({
    where: { roleId: smRole.id },
    select: { userId: true },
  });
  if (userRoles.length === 0) return;
  await prisma.notification.createMany({
    data: userRoles.map((ur) => ({
      tenantId,
      userId: ur.userId,
      subject,
      body,
      category: "updates",
    })),
    skipDuplicates: true,
  });
}
