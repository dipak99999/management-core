// Two-way email sync tick.
//
// Runs every 5 minutes. For every active TenantIntegration with
// provider="Gmail" or "Outlook":
//   1. Refresh the access token via the stored refresh_token.
//   2. Poll new messages since the last historyId (Gmail) or deltaLink
//      (Outlook).
//   3. For each new message, try to match the sender email against a
//      Lead / Customer / Contact in that tenant. When matched, insert a
//      CrmActivity(type="Email") linked to the record.
//   4. Persist the new historyId/deltaLink back into the integration's
//      `config` bag so the next poll starts from there.
//
// Unmatched senders are ignored (no orphan activity rows). Match is by
// exact lowercase email — no fuzzy heuristics; too easy to attach
// activity to the wrong record and mislead a salesperson.

import {
  Prisma,
  decryptSecrets,
  encryptSecrets,
  pollGmailNewMessages,
  pollOutlookNewMessages,
  prisma,
  refreshGmailAccessToken,
  refreshOutlookAccessToken,
  type InboundMessage,
} from "@lumaara/db";

export interface EmailSyncTickResult {
  integrationsPolled: number;
  messagesFetched: number;
  activitiesCreated: number;
  errors: number;
}

async function matchAndStore(
  tenantId: string,
  msg: InboundMessage,
): Promise<boolean> {
  const email = msg.fromEmail;
  if (!email) return false;

  // Priority: Lead → Customer → Contact. First hit wins so we don't
  // duplicate the same activity onto multiple records.
  const [lead, customer, contact] = await Promise.all([
    prisma.lead.findFirst({
      where: { tenantId, email },
      select: { id: true },
    }),
    prisma.customer.findFirst({
      where: { tenantId, email },
      select: { id: true },
    }),
    prisma.contact.findFirst({
      where: { tenantId, email },
      select: { id: true, linkedDoctype: true, linkedId: true },
    }),
  ]);

  let parentType: "Lead" | "Customer" | null = null;
  let parentId: string | null = null;
  if (lead) {
    parentType = "Lead";
    parentId = lead.id;
  } else if (customer) {
    parentType = "Customer";
    parentId = customer.id;
  } else if (contact && (contact.linkedDoctype === "Lead" || contact.linkedDoctype === "Customer")) {
    parentType = contact.linkedDoctype;
    parentId = contact.linkedId;
  }
  if (!parentType || !parentId) return false;

  // De-dupe against re-processing the same providerMessageId. We store
  // the provider id in `emailFrom` via a stable prefix marker so a
  // schema change isn't required — a follow-up can add a dedicated
  // column if the volume grows.
  const stampedFrom = `[msg:${msg.providerMessageId}] ${msg.fromName ? `${msg.fromName} ` : ""}<${email}>`;
  const existing = await prisma.crmActivity.findFirst({
    where: { tenantId, emailFrom: stampedFrom, type: "Email" },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.crmActivity.create({
    data: {
      tenantId,
      type: "Email",
      subject: msg.subject || "(no subject)",
      description: msg.snippet,
      parentType,
      parentId,
      emailFrom: stampedFrom,
      emailTo: msg.toEmails.join(", "),
      startAt: msg.sentAt,
      // The tick has no user context — attribute to the tenant "system"
      // account. Route handlers on Activity list mask this to "System".
      ownerUserId: "system",
      status: "Completed",
    },
  });
  return true;
}

async function pollOne(
  integration: {
    id: string;
    tenantId: string;
    provider: string;
    secrets: unknown;
    config: unknown;
  },
): Promise<{ fetched: number; created: number; errored: boolean }> {
  const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
  const config = (integration.config as Record<string, unknown> | null) ?? {};
  const clientId = String(secrets.clientId ?? "");
  const clientSecret = String(secrets.clientSecret ?? "");
  const refreshToken = String(secrets.refreshToken ?? "");
  if (!clientId || !clientSecret || !refreshToken) {
    return { fetched: 0, created: 0, errored: true };
  }
  let messages: InboundMessage[] = [];
  let newCursor: string | null = null;
  try {
    if (integration.provider === "Gmail") {
      const accessToken = await refreshGmailAccessToken(clientId, clientSecret, refreshToken);
      const startCursor = typeof config.historyId === "string" ? config.historyId : null;
      const r = await pollGmailNewMessages(accessToken, startCursor);
      messages = r.messages;
      newCursor = r.newHistoryId;
    } else if (integration.provider === "Outlook") {
      const msTenantId = typeof secrets.tenantId === "string" ? secrets.tenantId : "common";
      const accessToken = await refreshOutlookAccessToken(
        clientId,
        clientSecret,
        refreshToken,
        msTenantId,
      );
      const startCursor = typeof config.deltaLink === "string" ? config.deltaLink : null;
      const r = await pollOutlookNewMessages(accessToken, startCursor);
      messages = r.messages;
      newCursor = r.newDeltaLink;
    } else {
      return { fetched: 0, created: 0, errored: false };
    }
  } catch {
    return { fetched: 0, created: 0, errored: true };
  }

  let created = 0;
  for (const m of messages) {
    try {
      if (await matchAndStore(integration.tenantId, m)) created++;
    } catch {
      // Skip a single bad message; keep polling.
    }
  }

  // Persist the new cursor. Store under config.historyId or
  // config.deltaLink keyed by provider.
  if (newCursor) {
    const cursorKey = integration.provider === "Gmail" ? "historyId" : "deltaLink";
    const nextConfig = { ...config, [cursorKey]: newCursor };
    await prisma.tenantIntegration.update({
      where: { id: integration.id },
      data: { config: nextConfig as Prisma.InputJsonValue },
    });
  }
  return { fetched: messages.length, created, errored: false };
}

export async function runEmailSyncTick(): Promise<EmailSyncTickResult> {
  const integrations = await prisma.tenantIntegration.findMany({
    where: { isActive: true, provider: { in: ["Gmail", "Outlook"] } },
    take: 100, // bounded — huge multi-tenant deployments will need pagination
  });
  let fetched = 0;
  let created = 0;
  let errors = 0;
  for (const it of integrations) {
    const r = await pollOne(it);
    fetched += r.fetched;
    created += r.created;
    if (r.errored) errors++;
  }
  return {
    integrationsPolled: integrations.length,
    messagesFetched: fetched,
    activitiesCreated: created,
    errors,
  };
}

// Silence the "unused" lint on the encrypt symbol — we re-export it for
// completeness (future tick that writes back a rotated refresh token).
void encryptSecrets;
