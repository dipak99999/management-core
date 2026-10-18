// Mail transport for auth-service (password reset, email verification,
// signup invite).
//
// Three-tier resolution, cheapest-first:
//   1. NODE_ENV !== production
//      → log to structured logger + emit `devToken` in API responses so
//        integration tests + local dev don't need an inbox.
//   2. NODE_ENV === production + SendGrid API key set
//        (SENDGRID_API_KEY env OR system-wide TenantIntegration
//         provider="SendGrid" with tenantId "system")
//      → POST /v3/mail/send. No extra dep needed — fetch is enough.
//   3. NODE_ENV === production + SMTP_HOST set
//      → nodemailer SMTP transport. Reuses the connection pool across
//        calls.
//   4. NODE_ENV === production + neither configured
//      → throw with a clear "wire an email provider" message so a silent
//        failure never masks a broken forgot-password flow.
//
// System-tenant credentials via TenantIntegration are supported so the
// super-admin UI can rotate the key without a redeploy — the same pattern
// every other integration uses.

import nodemailer, { type Transporter } from "nodemailer";
import { getLogger } from "@lumaara/service-auth";
import { decryptSecrets, prisma } from "@lumaara/db";

const log = getLogger("auth-service").child({ component: "mail" });

const IS_DEV = process.env.NODE_ENV !== "production";
const DEFAULT_FROM =
  process.env.SMTP_FROM || process.env.MAIL_FROM || "no-reply@lumaara.local";

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// ── Cached SMTP transport ───────────────────────────────────────────
let smtpTransport: Transporter | null = null;
function getSmtpTransport(): Transporter | null {
  if (smtpTransport) return smtpTransport;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  smtpTransport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true", // implicit TLS on 465
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    // Reasonable defaults so a slow relay doesn't hang the request.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return smtpTransport;
}

// ── SendGrid API key resolver ───────────────────────────────────────
// Looks up a system-tenant TenantIntegration first so super-admins can
// rotate the key from /admin/integrations without redeploying. Falls
// back to SENDGRID_API_KEY env for boot-time / self-hosted single-tenant
// deployments.
async function resolveSendgridKey(): Promise<string | null> {
  try {
    const row = await prisma.tenantIntegration.findFirst({
      where: {
        provider: { in: ["SendGrid", "sendgrid"] },
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    if (row) {
      const s = decryptSecrets(row.secrets);
      if (typeof s.apiKey === "string" && s.apiKey.length > 0) return s.apiKey;
    }
  } catch {
    // fall through to env
  }
  const envKey = process.env.SENDGRID_API_KEY;
  return envKey && envKey.length > 0 ? envKey : null;
}

async function sendViaSendgrid(msg: MailPayload, apiKey: string): Promise<void> {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: DEFAULT_FROM },
      subject: msg.subject,
      content: [
        { type: "text/plain", value: msg.text },
        ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
      ],
    }),
    // Mail sending on the request path (signup, password reset) must not
    // hang forever — SendGrid API is usually sub-second, 15s is generous.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function sendViaSmtp(msg: MailPayload, tx: Transporter): Promise<void> {
  await tx.sendMail({
    from: DEFAULT_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

// ── Public API ─────────────────────────────────────────────────────
export async function sendMail(msg: MailPayload): Promise<void> {
  if (IS_DEV) {
    log.info("dev-mail delivered to logger", {
      to: msg.to,
      subject: msg.subject,
      body: msg.text,
    });
    return;
  }

  // Prod: prefer SendGrid (managed, no DNS setup needed), then SMTP.
  const key = await resolveSendgridKey();
  if (key) {
    await sendViaSendgrid(msg, key);
    log.info("mail sent via sendgrid", { to: msg.to, subject: msg.subject });
    return;
  }

  const smtp = getSmtpTransport();
  if (smtp) {
    await sendViaSmtp(msg, smtp);
    log.info("mail sent via smtp", { to: msg.to, subject: msg.subject });
    return;
  }

  throw new Error(
    "sendMail: no email transport configured. Add a SendGrid integration under /admin/integrations, or set SMTP_HOST/SMTP_USER/SMTP_PASS env vars.",
  );
}

// Devs need the token to test password reset / email verification without an
// inbox. Emit it in API responses only when NODE_ENV !== "production".
export function includeDevToken<T extends object>(
  payload: T,
  token: string,
): T & { devToken?: string } {
  if (!IS_DEV) return payload as T & { devToken?: string };
  return { ...payload, devToken: token };
}
