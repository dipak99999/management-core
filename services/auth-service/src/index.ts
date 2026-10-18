import { initOtel } from "@lumaara/service-auth";
initOtel("auth-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("auth-service");

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { authRouter } from "./routes/auth";
import { ssoRouter } from "./routes/sso";
import { ssoAdminRouter } from "./routes/sso-admin";
import { superAdminRouter, myPlanRouter } from "./routes/super-admin";
import { superAiProvidersRouter } from "./routes/super-ai-providers";
import { superBillingGatewaysRouter } from "./routes/super-billing-gateways";
import { billingRouter, billingWebhookRouter } from "./routes/billing";
import { tenantRouter } from "./routes/tenants";
import { roleRouter } from "./routes/roles";
import { workflowRouter } from "./routes/workflows";
import { customFieldRouter } from "./routes/custom-fields";
import { attachmentRouter } from "./routes/attachments";
import { workdriveRouter, workdrivePublicRouter } from "./routes/workdrive";
import { notebookRouter } from "./routes/notebook";
import { learnRouter } from "./routes/learn";
import { commentRouter } from "./routes/comments";
import { notificationRouter } from "./routes/notifications";
import { todoRouter } from "./routes/todos";
import { auditLogRouter } from "./routes/audit-logs";
import { activityRouter } from "./routes/activity";
import { previewRouter } from "./routes/preview";
import { streamRouter } from "./routes/stream";
import { searchRouter } from "./routes/search";
import { userViewRouter } from "./routes/user-views";
import { formDefaultRouter } from "./routes/form-defaults";
import { aiRuleRouter } from "./routes/ai-rules";
import { aiBudgetRouter } from "./routes/ai-budget";
import { aiDraftRouter } from "./routes/ai-draft";
import { aiNextActionsRouter } from "./routes/ai-next-actions";
import { apiTokenRouter } from "./routes/api-tokens";
import { scimRouter } from "./routes/scim";
import { scimTokensRouter } from "./routes/scim-tokens";
import { oauthRouter } from "./routes/oauth";
import { twoFactorRouter } from "./routes/two-factor";
import { passwordResetRouter } from "./routes/password-reset";
import { emailVerificationRouter } from "./routes/email-verification";
import { sessionRouter } from "./routes/sessions";
import { emailTemplateRouter } from "./routes/email-templates";
import { emailMessageRouter, unsubscribeRouter } from "./routes/email-messages";
import { emailTrackingRouter } from "./routes/email-tracking";
import { transactionalRouter } from "./routes/transactional";
import { smsTemplateRouter, smsMessageRouter } from "./routes/sms";
import { docSubscriptionRouter } from "./routes/doc-subscriptions";
import { notificationPreferenceRouter } from "./routes/notification-preferences";
import { digestRouter } from "./routes/digests";
import { broadcastRouter } from "./routes/broadcasts";
import { suppressionRouter } from "./routes/suppressions";
import { communicationLogRouter } from "./routes/communication-log";
import { listViewRouter } from "./routes/list-views";
import { portalAuthRouter } from "./routes/portal-auth";
import {
  auditMiddleware,
  corsMiddleware,
  errorCapture,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  requestLogger,
  requirePortalAuth,
  securityHeaders,
  validateEnv,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "PORTAL_JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4001" },
});
// Prod-only: SMTP_FROM must be set so transactional email ships with a real
// sender. The dev fallback (`no-reply@lumaara.local`) is a reserved TLD that
// mail servers reject outright — safe for dev but we don't want it in prod.
if (process.env.NODE_ENV === "production" && !process.env.SMTP_FROM) {
  throw new Error(
    "SMTP_FROM must be set in production — used as the From address for every outbound transactional email. See PRODUCTION.md.",
  );
}
installCrashHandlers("auth-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("auth-service"));
// Razorpay webhook — MUST mount BEFORE express.json() so the body stays
// raw bytes for HMAC signature verification. JSON parsing would strip
// whitespace and the signature would never match. The router applies its
// own express.raw() for just this one path.
app.use("/billing", billingWebhookRouter);
// Bumped limit for base64-encoded file uploads via /attachments. 25MB payload
// ~= 18MB binary — reasonable ceiling for demo attachments (invoices, PDFs).
// Accept both application/json AND application/scim+json so SCIM clients
// (Okta, Azure AD) that send the spec-mandated scim+json content-type
// get their body parsed. Without this the /scim/v2 routes see req.body
// as undefined and reject every Create as "missing userName".
app.use(express.json({ limit: "25mb", type: ["application/json", "application/scim+json"] }));
app.use(normalizeBody);
// OAuth /token endpoint per RFC 6749 accepts application/x-www-form-urlencoded.
app.use(express.urlencoded({ extended: false }));
app.use(
  auditMiddleware({
    routeMap: {
      "auth": "Auth",
      "tenants": "Tenant",
      "roles": "Role",
      "workflows": "Workflow",
      "custom-fields": "CustomField",
      "attachments": "Attachment",
      "folders": "WorkDriveFolder",
      "files": "WorkDriveFile",
      "share-links": "WorkDriveShareLink",
      "drive": "WorkDriveFile",
      "notebooks": "Notebook",
      "notes": "Note",
      "notebook": "Note",
      "courses": "LearnCourse",
      "lessons": "LearnLesson",
      "enrollments": "LearnEnrollment",
      "certificates": "LearnCertificate",
      "learn": "LearnCourse",
      "comments": "Comment",
      "notifications": "Notification",
      "todos": "Todo",
      "email-templates": "EmailTemplate",
      "emails": "EmailMessage",
      "sms-templates": "SmsTemplate",
      "sms": "SmsMessage",
      "doc-subscriptions": "DocSubscription",
      "notification-preferences": "NotificationPreference",
      "digests": "DigestSchedule",
      "broadcasts": "Broadcast",
      "list-views": "ListView",
    },
  }),
);

mountBasicOps(app, "auth-service");

// Bypass hook: when RATE_LIMIT_DISABLED=1 (test / CI only) every limiter's
// `skip` function returns true. NEVER set this in production — it neuters
// brute-force protection. Local dev leaves it unset (limits enforced).
const skipLimit = () => process.env.RATE_LIMIT_DISABLED === "1";

// Brute-force protection for credential endpoints. Two layered limiters:
//   - loginFailureLimiter: keyed on IP+email, counts FAILED logins only
//     (skipSuccessfulRequests). A legitimate user typing the right password
//     doesn't accrue against the limit. 8 wrong attempts per 15 min per
//     (ip, email) pair.
//   - loginIpLimiter: keyed on IP alone, counts every request. Blunts
//     enumeration + distributed-guess-per-account attacks (attacker rotates
//     the email each request). 60 per 5 min per IP — a shared-NAT office
//     of 30 users can each try twice without hitting it.
// Signup gets a coarser per-IP limit only — 5 signups per hour per IP —
// since there's no legitimate reason for many signups from one IP.
const loginFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email as string | undefined)?.toLowerCase() ?? "-";
    return `login-fail::${req.ip ?? "-"}::${email}`;
  },
  message: {
    error:
      "Too many failed attempts for this email — try again in 15 minutes or reset your password.",
  },
  skip: skipLimit,
});
const loginIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `login-ip::${req.ip ?? "-"}`,
  message: {
    error: "Too many login attempts from your network — try again shortly.",
  },
  skip: skipLimit,
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `signup::${req.ip ?? "-"}`,
  message: { error: "Signup rate limit reached — try again in an hour." },
  skip: skipLimit,
});
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email as string | undefined)?.toLowerCase() ?? "-";
    return `pw-reset::${req.ip ?? "-"}::${email}`;
  },
  message: { error: "Too many password reset requests — try again in an hour." },
  skip: skipLimit,
});
app.use("/auth/login", loginIpLimiter, loginFailureLimiter);
app.use("/auth/signup", signupLimiter);

app.use("/auth", authRouter);
// SSO — inbound OIDC login (Google, Microsoft, generic OIDC). Public routes
// (/discover, /:provider/:tenant/authorize, /:provider/:tenant/callback) —
// no bearer token required, the state cookie is the anti-CSRF.
app.use("/auth/sso", ssoRouter);
// Admin API for managing per-tenant SSO providers (SystemManager only).
app.use("/sso-providers", ssoAdminRouter);
// Super admin: cross-tenant subscription + plan management.
app.use("/super", superAdminRouter);
app.use("/super/ai-providers", superAiProvidersRouter);
app.use("/super/billing-gateways", superBillingGatewaysRouter);
// Billing: tenant-facing routes (require auth, JSON body). Webhook router
// was already mounted above express.json() for raw-body signature check.
app.use("/billing", billingRouter);
// Any authed user can query their own tenant's active plan — shell uses
// this to hide modules they don't have access to.
app.use("/my-plan", myPlanRouter);
app.use("/tenants", tenantRouter);
app.use("/roles", roleRouter);
app.use("/workflows", workflowRouter);
app.use("/custom-fields", customFieldRouter);
app.use("/attachments", attachmentRouter);
// Zoho-WorkDrive-style file library — hierarchical folders + files w/ versions.
app.use("/drive", workdriveRouter);
// Public no-auth download for shared files. Path guarded by opaque token.
app.use("/public/drive", workdrivePublicRouter);
// Zoho-Notebook-style notes.
app.use("/notebook", notebookRouter);
// Zoho-Learn-style LMS.
app.use("/learn", learnRouter);
app.use("/comments", commentRouter);
app.use("/notifications", notificationRouter);
app.use("/todos", todoRouter);
app.use("/audit-logs", auditLogRouter);
// General-user activity feed (merged audit + comments) — any authed user.
app.use("/activity", activityRouter);
// Hover-preview summaries for doctypes referenced across the UI.
app.use("/preview", previewRouter);
// Global cross-doctype search (⌘K palette fuzzy-finder).
app.use("/search", searchRouter);
// Server-sent events stream for realtime list updates.
app.use("/stream", streamRouter);
// Per-user UI state (backs @lumaara/web-ui hooks).
app.use("/user-views", userViewRouter);
app.use("/form-defaults", formDefaultRouter);
app.use("/ai-rules", aiRuleRouter);
app.use("/ai-budget", aiBudgetRouter);
// AI slash-command drafts + contextual next-best-actions.
app.use("/ai/draft", aiDraftRouter);
app.use("/ai/next-actions", aiNextActionsRouter);
app.use("/api-tokens", apiTokenRouter);
// SCIM 2.0 provisioning — the public RFC 7644 surface. The scimRouter
// uses its own ScimToken bearer auth (NOT JWT). Mount early so the
// identity provider doesn't collide with the login/signup rate limits.
app.use("/scim/v2", scimRouter);
app.use("/scim-tokens", scimTokensRouter);
app.use("/oauth", oauthRouter);
app.use("/2fa", twoFactorRouter);
// Rate-limit password-reset request (email flooding protection) — must be
// registered BEFORE the router mount so it intercepts.
app.use("/password-reset/request", passwordResetLimiter);
app.use("/password-reset", passwordResetRouter);
app.use("/verify-email", emailVerificationRouter);
app.use("/sessions", sessionRouter);

// Communication (Phase F)
app.use("/email-templates", emailTemplateRouter);
app.use("/emails", emailMessageRouter);
// F5: Public unsubscribe endpoint — no auth. Token carries tenant + user + category.
app.use("/unsubscribe", unsubscribeRouter);
// F5.5: public email-tracking endpoints (open pixel + click redirect). No
// auth — recipients hit these directly from their inbox.
app.use("/email/track", emailTrackingRouter);
// Marketing P1: public transactional email API. Auth via ApiToken (Bearer)
// enforced inside the router; do NOT wrap in requireAuth here (that path uses
// session JWT, not API tokens).
app.use("/v1/tx", transactionalRouter);
app.use("/sms-templates", smsTemplateRouter);
app.use("/sms", smsMessageRouter);
app.use("/doc-subscriptions", docSubscriptionRouter);
app.use("/notification-preferences", notificationPreferenceRouter);
app.use("/digests", digestRouter);
app.use("/broadcasts", broadcastRouter);
app.use("/suppressions", suppressionRouter);
app.use("/communication-log", communicationLogRouter);
app.use("/list-views", listViewRouter);

// Phase K: Portal
// The router handles both public and staff endpoints internally; only the
// `/change-password` + `/me` paths need portal JWT, which we inject via
// path-scoped middleware.
app.use("/portal-auth/change-password", requirePortalAuth);
app.use("/portal-auth/me", requirePortalAuth);
app.use("/portal-auth", portalAuthRouter);

app.use(errorCapture("auth-service"));
// jsonErrorHandler is the last-line handler: catches body-too-large, CORS
// rejections, and any exception that slipped past route-level try/catch.
// Must come after errorCapture (which persists to ErrorLog).
app.use(jsonErrorHandler("auth-service"));

const port = Number(process.env.PORT) || 4001;
const server = app.listen(port, () => getLogger("auth-service").info("service listening", { port }));
installGracefulShutdown(server, "auth-service");
