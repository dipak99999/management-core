import { initOtel } from "@lumaara/service-auth";
initOtel("crm-service");
// Sentry — env-gated via SENTRY_DSN. No-op when unset.
import { initSentry } from "@lumaara/service-auth";
initSentry("crm-service");

import express from "express";
import { leadRouter } from "./routes/leads";
import { opportunityRouter } from "./routes/opportunities";
import { quotationRouter } from "./routes/quotations";
import { salesOrderRouter } from "./routes/sales-orders";
import { campaignRouter } from "./routes/campaigns";
import { activityRouter } from "./routes/activities";
import { contactListRouter } from "./routes/contact-lists";
import { emailSequenceRouter } from "./routes/email-sequences";
import { salesiqPublicRouter, salesiqOperatorRouter } from "./routes/salesiq";
import { salesiqWidgetRouter } from "./routes/salesiq-widget";
import { deskRouter } from "./routes/desk";
import { kbCategoryRouter, kbArticleRouter } from "./routes/kb";
import { serviceContractRouter } from "./routes/service-contracts";
import { webFormRouter, webFormPublicRouter } from "./routes/web-forms";
import { meetingTypeRouter } from "./routes/meeting-types";
import { bookedMeetingRouter } from "./routes/booked-meetings";
import { publicBookingRouter } from "./routes/public-bookings";
import { pipelineBlueprintRouter } from "./routes/pipeline-blueprints";
import { leadScoreRuleRouter } from "./routes/lead-score-rules";
import { landingPageRouter, landingPagePublicRouter } from "./routes/landing-pages";
import { webPageRouter, webPagePublicRouter } from "./routes/web-pages";
import { blogPostRouter, blogPostPublicRouter } from "./routes/blog-posts";
import { websiteItemRouter, websiteItemPublicRouter } from "./routes/website-items";
import { shopCheckoutRouter } from "./routes/shop-checkout";
import { surveyRouter, surveyPublicRouter } from "./routes/surveys";
import { socialRouter } from "./routes/social";
import { socialOAuthRouter } from "./routes/social-oauth";
import { cliqRouter } from "./routes/cliq";
import { printRouter } from "./routes/print";
import { reportsRouter } from "./routes/reports";
import {
  warrantyRouter,
  purchaseWarrantyRouter,
  locationCaptureRouter,
  autoDealerRouter,
  crmTargetRouter,
  crmTargetActualRouter,
  workPlanRouter,
  dailyWorksheetRouter,
  crmProcessRouter,
  projectPlanningRouter,
} from "./routes/crm-p2-masters";
import { crmAnalyticsRouter } from "./routes/crm-analytics";
import { webhooksInboundRouter } from "./routes/webhooks-inbound";
import { campaignArchiveRouter } from "./routes/campaign-archive";
import { mediaRouter } from "./routes/media";
import { trackingRouter } from "./routes/tracking";
import { journeysRouter } from "./routes/journeys";
import { whatsappRouter } from "./routes/whatsapp";
import { smsWebhooksRouter } from "./routes/sms-webhooks";
import { webinarsRouter } from "./routes/webinars";
import { approvalsRouter } from "./routes/approvals";
import { brandKitRouter } from "./routes/brand-kit";
import { editorialRouter } from "./routes/editorial";
import { attributionRouter } from "./routes/attribution";
import { aiAssistRouter } from "./routes/ai-assist";
import {
  itemsReadRouter,
  customersReadRouter,
  warehousesReadRouter,
} from "./routes/masters-read";
import { requireAuth } from "./middleware/require-auth";
import {
  auditMiddleware,
  corsMiddleware,
  customFieldsReadRouter,
  errorCapture,
  getLogger,
  installCrashHandlers,
  installGracefulShutdown,
  jsonErrorHandler,
  normalizeBody,
  mountBasicOps,
  pdfLimiter,
  apiLimiter,
  aiLimiter,
  aiTenantDailyLimiter,
  requestLogger,
  securityHeaders,
  validateEnv,
  workflowEndpoints,
} from "@lumaara/service-auth";

validateEnv({
  required: ["DATABASE_URL", "JWT_SECRET", "MASTER_SECRET_KEY"],
  optional: { PORT: "4004" },
});
installCrashHandlers("crm-service");

const app = express();
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger("crm-service"));
app.use(apiLimiter);
// Skip express.json() for webhooks that sign the RAW bytes. If json() ran
// first the stream would be consumed before the router-scoped express.raw()
// could see it, and any HMAC / ECDSA verification would fail.
//   - WhatsApp: Meta HMAC-SHA256 over raw body
//   - SendGrid: ECDSA (P-256) over `timestamp + raw body`
app.use((req, res, next) => {
  if (req.path.startsWith("/whatsapp/webhook/")) return next();
  if (req.path.startsWith("/webhooks-inbound/sendgrid/")) return next();
  return express.json()(req, res, next);
});
app.use(normalizeBody);
app.use(
  auditMiddleware({
    routeMap: {
      "leads": "Lead",
      "opportunities": "Opportunity",
      "quotations": "Quotation",
      "sales-orders": "SalesOrder",
      "campaigns": "Campaign",
      "activities": "CrmActivity",
      "contact-lists": "ContactList",
      "email-sequences": "EmailSequence",
      "siq/chat-sessions": "SiqChatSession",
      "siq/visitors": "SiqVisitor",
      "desk/tickets": "DeskTicket",
      "desk/sla-policies": "DeskSlaPolicy",
      "desk/assignment-rules": "DeskAssignmentRule",
      "desk/canned-responses": "DeskCannedResponse",
      "kb-categories": "KBCategory",
      "kb-articles": "KBArticle",
      "service-contracts": "ServiceContract",
      "web-forms": "WebForm",
      "landing-pages": "LandingPage",
      "web-pages": "WebPage",
      "blog-posts": "BlogPost",
      "website-items": "WebsiteItem",
      "surveys": "Survey",
      "social/accounts": "SocialAccount",
      "social/posts": "SocialPost",
      "social/monitors": "SocialMonitor",
      "social/mentions": "SocialMention",
      "cliq/channels": "CliqChannel",
      "cliq/messages": "CliqMessage",
      "meeting-types": "MeetingType",
      "booked-meetings": "BookedMeeting",
      "pipeline-blueprints": "PipelineBlueprint",
      "lead-score-rules": "LeadScoreRule",
    },
  }),
);

mountBasicOps(app, "crm-service");

app.use("/leads", requireAuth, leadRouter);
app.use("/opportunities", requireAuth, opportunityRouter);
app.use("/quotations", requireAuth, quotationRouter);
app.use("/sales-orders", requireAuth, salesOrderRouter);
app.use("/campaigns", requireAuth, campaignRouter);
app.use("/activities", requireAuth, activityRouter);
app.use("/contact-lists", requireAuth, contactListRouter);
app.use("/email-sequences", requireAuth, emailSequenceRouter);
// SalesIQ — public routes (widget + visitor tracking, no auth) live at
// /siq/public + /siq/widget.js; operator routes (JWT) at /siq.
app.use("/siq/public", salesiqPublicRouter);
app.use("/siq", salesiqWidgetRouter);
app.use("/siq", requireAuth, salesiqOperatorRouter);
// Desk — POST /desk/tickets/:id/rate is the ONLY public route (customer
// CSAT submission from the resolution email). Everything else needs a JWT.
app.use("/desk", (req, res, next) => {
  if (req.method === "POST" && /^\/tickets\/[^/]+\/rate$/.test(req.path)) return next();
  return requireAuth(req, res, next);
}, deskRouter);
app.use("/kb-categories", requireAuth, kbCategoryRouter);
app.use("/kb-articles", requireAuth, kbArticleRouter);
app.use("/service-contracts", requireAuth, serviceContractRouter);
// Marketing Plus: web forms + landing pages.
// PUBLIC endpoints (no auth) — these are the pages/forms embedded on public sites.
app.use("/public/web-forms",    webFormPublicRouter);
app.use("/public/pages",        landingPagePublicRouter);
app.use("/public/surveys",      surveyPublicRouter);
// Website / CMS public reads — no auth, published-only enforced server-side.
app.use("/public/web-pages",    webPagePublicRouter);
app.use("/public/blog-posts",   blogPostPublicRouter);
// E-commerce public routes — shop index/detail (read-only) + checkout
// (creates a Draft SalesOrder + guest Customer). No auth.
app.use("/public/shop",         websiteItemPublicRouter);
app.use("/public/checkout",     shopCheckoutRouter);
// Meeting Scheduler — public booking flow. See routes/public-bookings.ts.
app.use("/public/bookings",     publicBookingRouter);
// Operator CRUD (JWT).
app.use("/web-forms",     requireAuth, webFormRouter);
app.use("/landing-pages", requireAuth, landingPageRouter);
// Meeting Scheduler — owner-side management + booking list.
app.use("/meeting-types",   requireAuth, meetingTypeRouter);
app.use("/booked-meetings", requireAuth, bookedMeetingRouter);
// Pipeline Blueprints — stage-transition guardrails.
app.use("/pipeline-blueprints", requireAuth, pipelineBlueprintRouter);
app.use("/lead-score-rules",   requireAuth, leadScoreRuleRouter);
app.use("/surveys",       requireAuth, surveyRouter);
app.use("/web-pages",     requireAuth, webPageRouter);
app.use("/blog-posts",    requireAuth, blogPostRouter);
app.use("/website-items", requireAuth, websiteItemRouter);
// Social OAuth mount MUST come before the generic /social mount so
// /social/oauth/* resolves to the OAuth router first (Express matches in
// registration order). Both routers require auth.
app.use("/social/oauth",  requireAuth, socialOAuthRouter);
app.use("/social",        requireAuth, socialRouter);
// Marketing P1: inbound bounce/complaint webhooks (public — per-provider
// signature verification handled inside), campaign public archive at /a/:slug
// (public), media library (JWT), tracking URL shortener (public).
app.use("/webhooks-inbound", webhooksInboundRouter);
app.use("/a",                campaignArchiveRouter);
app.use("/media",            requireAuth, mediaRouter);
app.use("/t",                trackingRouter);
// Marketing P2: journeys (JWT), whatsapp (mixed — CRUD JWT'd inside; /webhook
// is public with WABA HMAC verified in-router).
app.use("/journeys", requireAuth, journeysRouter);
app.use("/whatsapp", whatsappRouter);
// SMS provider delivery-receipt webhooks (public — per-provider signature or
// bearer verification handled inside). Twilio route installs its own
// urlencoded body parser because Twilio POSTs form-urlencoded not JSON.
app.use("/sms-webhooks", smsWebhooksRouter);
// Marketing P3: webinars, approvals, brand kit, editorial notes / calendar,
// attribution / ROI, AI content assist. All JWT'd (auth via ApiToken enforced
// inside ai-assist for external CI-style callers). Webinars is a mixed-auth
// router — POST /:id/register is public (form-target for public registration
// pages); every other route stamps `requireAuth` in-line.
app.use("/webinars",     webinarsRouter);
app.use("/approvals",    requireAuth, approvalsRouter);
app.use("/brand-kit",    requireAuth, brandKitRouter);
app.use("/editorial",    requireAuth, editorialRouter);
app.use("/attribution",  requireAuth, attributionRouter);
app.use("/ai-assist",    requireAuth, aiLimiter, aiTenantDailyLimiter, aiAssistRouter);
// Cliq — internal chat. Handles its own auth per-route (via requireAuth
// imported in the router file) so we mount unprotected here.
app.use("/cliq", cliqRouter);
app.use("/print", requireAuth, pdfLimiter, printRouter);
app.use("/reports", requireAuth, reportsRouter);
// Read-through masters for form dropdowns.
app.use("/items", requireAuth, itemsReadRouter);
app.use("/customers", requireAuth, customersReadRouter);
app.use("/warehouses", requireAuth, warehousesReadRouter);
app.use("/custom-fields-for", customFieldsReadRouter());
app.use("/workflow-actions", workflowEndpoints());

// P4 CRM masters + analytics
app.use("/warranties",          requireAuth, warrantyRouter);
app.use("/purchase-warranties", requireAuth, purchaseWarrantyRouter);
app.use("/location-captures",   requireAuth, locationCaptureRouter);
app.use("/auto-dealers",        requireAuth, autoDealerRouter);
app.use("/crm-targets",         requireAuth, crmTargetRouter);
app.use("/crm-target-actuals",  requireAuth, crmTargetActualRouter);
app.use("/work-plans",          requireAuth, workPlanRouter);
app.use("/daily-worksheets",    requireAuth, dailyWorksheetRouter);
app.use("/crm-processes",       requireAuth, crmProcessRouter);
app.use("/project-plannings",   requireAuth, projectPlanningRouter);
app.use("/crm-analytics",       requireAuth, crmAnalyticsRouter);

app.use(errorCapture("crm-service"));
app.use(jsonErrorHandler("crm-service"));

const port = Number(process.env.PORT) || 4004;
const server = app.listen(port, () => getLogger("crm-service").info("service listening", { port }));
installGracefulShutdown(server, "crm-service");
