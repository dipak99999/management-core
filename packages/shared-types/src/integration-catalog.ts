// Integration catalog — canonical list of TenantIntegration.provider
// slugs the platform recognizes plus the shape of each provider's
// secrets bag. UI-facing integrations page renders forms off this
// metadata so users don't have to guess key names.
//
// When you add a new integration:
//   1. Add its slug to PROVIDERS
//   2. Add its secrets schema entry
//   3. The catalog UI at /admin/integrations picks it up automatically

export type ProviderSlug =
  | "Anthropic"
  | "OpenAI"
  | "Ollama"
  | "BrewAI"
  | "LLMRouter"
  | "Zoom"
  | "Webex"
  | "GoogleMeet"
  | "Razorpay"
  | "Stripe"
  | "Plaid"
  | "Gmail"
  | "Outlook"
  | "LinkedIn"
  | "Facebook"
  | "Instagram"
  | "Twitter"
  | "FaceRecognition"
  | "S3"
  | "SendGrid"
  | "Twilio"
  | "WhatsappCloud"
  | "Slack"
  | "Msg91"
  | "IRP"
  | "DocuSign"
  | "ZohoSign"
  | "EasyPost";

export interface SecretField {
  key: string;
  label: string;
  type: "text" | "password" | "url" | "select";
  required: boolean;
  help?: string;
  options?: string[]; // for type="select"
}

export interface ProviderSpec {
  slug: ProviderSlug;
  category:
    | "AI"
    | "Payments"
    | "Banking"
    | "Email"
    | "Meetings"
    | "Social"
    | "Attendance"
    | "Storage"
    | "SMS"
    | "Chat"
    | "eSignature"
    | "Shipping"
    | "Compliance";
  displayName: string;
  description: string;
  docsUrl: string;
  secretFields: SecretField[];
  // Per-provider extra config bag (non-secret). Rendered as a second
  // form section — e.g. Gmail's `historyId` cursor lives here (auto,
  // not user-set), Outlook's `deltaLink` similarly.
  configFields?: SecretField[];
}

const gmailShared: SecretField[] = [
  { key: "clientId", label: "Client ID", type: "text", required: true },
  { key: "clientSecret", label: "Client secret", type: "password", required: true },
  { key: "refreshToken", label: "Refresh token", type: "password", required: true, help: "Obtained via /integrations/gmail/oauth/callback" },
];

export const INTEGRATION_CATALOG: ProviderSpec[] = [
  // ── AI providers ─────────────────────────────────────────────────
  {
    slug: "LLMRouter",
    category: "AI",
    displayName: "LLM Router (default provider chooser)",
    description:
      "Chooses which LLM handles each use-case (agent.plan, invoice.extract, etc). If unset, falls back to the built-in stub.",
    docsUrl: "https://modelcontextprotocol.io",
    secretFields: [
      {
        key: "defaultProvider",
        label: "Default provider",
        type: "select",
        required: true,
        options: ["anthropic", "openai", "ollama", "brew", "stub"],
        help: "Fallback used when a route doesn't specify a provider.",
      },
    ],
  },
  {
    slug: "Anthropic",
    category: "AI",
    displayName: "Anthropic (Claude)",
    description:
      "Claude Sonnet / Opus / Haiku for planning + tool-calling + content assist.",
    docsUrl: "https://docs.anthropic.com",
    secretFields: [
      { key: "apiKey", label: "API key", type: "password", required: true },
      { key: "defaultModel", label: "Default model", type: "text", required: false, help: "e.g. claude-3-5-sonnet-latest" },
      { key: "baseUrl", label: "Base URL", type: "url", required: false, help: "Only override for self-hosted proxies" },
    ],
  },
  {
    slug: "OpenAI",
    category: "AI",
    displayName: "OpenAI",
    description: "GPT-4o / GPT-4o-mini for planning + tool-calling + content assist.",
    docsUrl: "https://platform.openai.com/docs",
    secretFields: [
      { key: "apiKey", label: "API key", type: "password", required: true },
      { key: "defaultModel", label: "Default model", type: "text", required: false, help: "e.g. gpt-4o-mini" },
      { key: "baseUrl", label: "Base URL", type: "url", required: false, help: "e.g. Azure OpenAI or a self-hosted proxy" },
    ],
  },
  {
    slug: "Ollama",
    category: "AI",
    displayName: "Ollama (local models)",
    description: "Self-hosted models (Llama, Mistral, etc.) via Ollama HTTP.",
    docsUrl: "https://ollama.com/docs",
    secretFields: [
      { key: "baseUrl", label: "Ollama URL", type: "url", required: true, help: "e.g. http://ollama:11434" },
      { key: "defaultModel", label: "Default model", type: "text", required: true },
    ],
  },
  {
    slug: "BrewAI",
    category: "AI",
    displayName: "Brew AI",
    description: "Brew's OpenAI-compatible endpoint (see docs for base URL).",
    docsUrl: "https://brew.ai",
    secretFields: [
      { key: "apiKey", label: "API key", type: "password", required: true },
      { key: "baseUrl", label: "Base URL", type: "url", required: true },
      { key: "defaultModel", label: "Default model", type: "text", required: false },
    ],
  },
  {
    slug: "Razorpay",
    category: "Payments",
    displayName: "Razorpay",
    description: "Payment gateway; webhook auto-submits Payment Entries.",
    docsUrl: "https://razorpay.com/docs/",
    secretFields: [
      { key: "keyId", label: "Key ID", type: "text", required: true },
      { key: "keySecret", label: "Key secret", type: "password", required: true },
      { key: "webhookSecret", label: "Webhook secret", type: "password", required: true },
    ],
  },
  {
    slug: "Stripe",
    category: "Payments",
    displayName: "Stripe",
    description: "Payment gateway; webhook auto-submits Payment Entries.",
    docsUrl: "https://stripe.com/docs/webhooks",
    secretFields: [
      { key: "secretKey", label: "Secret key", type: "password", required: true },
      { key: "webhookSecret", label: "Webhook signing secret", type: "password", required: true },
    ],
  },
  {
    slug: "Plaid",
    category: "Banking",
    displayName: "Plaid (bank feed)",
    description: "Pulls bank transactions into Bank Reconciliation.",
    docsUrl: "https://plaid.com/docs/api/",
    secretFields: [
      { key: "plaidClientId", label: "Client ID", type: "text", required: true },
      { key: "plaidSecret", label: "Secret", type: "password", required: true },
      { key: "plaidAccessToken", label: "Access token", type: "password", required: true, help: "Per bank item, from Plaid Link" },
      { key: "plaidEnv", label: "Environment", type: "select", required: false, options: ["sandbox", "development", "production"] },
    ],
  },
  {
    slug: "Gmail",
    category: "Email",
    displayName: "Gmail",
    description: "Two-way sync: inbound emails become CrmActivity on Leads/Customers.",
    docsUrl: "https://developers.google.com/gmail/api",
    secretFields: gmailShared,
  },
  {
    slug: "Outlook",
    category: "Email",
    displayName: "Outlook / Microsoft 365",
    description: "Two-way sync via Microsoft Graph.",
    docsUrl: "https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview",
    secretFields: [
      ...gmailShared,
      { key: "tenantId", label: "Azure tenant ID", type: "text", required: false, help: "Use 'common' for multi-tenant apps" },
    ],
  },
  {
    slug: "Zoom",
    category: "Meetings",
    displayName: "Zoom",
    description: "Auto-create Zoom webinars from Lumaara Webinar events.",
    docsUrl: "https://developers.zoom.us/docs/api/",
    secretFields: [
      { key: "accountId", label: "Account ID", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret", type: "password", required: true },
    ],
  },
  {
    slug: "Webex",
    category: "Meetings",
    displayName: "Webex",
    description: "Auto-create Webex meetings.",
    docsUrl: "https://developer.webex.com/docs/api/v1/meetings",
    secretFields: [
      { key: "token", label: "Bot / OAuth token", type: "password", required: true },
    ],
  },
  {
    slug: "GoogleMeet",
    category: "Meetings",
    displayName: "Google Meet",
    description: "Auto-provision Google Calendar events with a Meet conference link.",
    docsUrl: "https://developers.google.com/calendar/api/guides/create-events#video",
    secretFields: [
      { key: "accessToken", label: "OAuth access token", type: "password", required: true, help: "Scope: calendar.events" },
      { key: "calendarId", label: "Calendar ID", type: "text", required: false, help: "Defaults to 'primary'" },
    ],
  },
  {
    slug: "LinkedIn",
    category: "Social",
    displayName: "LinkedIn",
    description: "Publish posts to a LinkedIn Company Page from Social Composer.",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/",
    secretFields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret", type: "password", required: true },
    ],
  },
  {
    slug: "Facebook",
    category: "Social",
    displayName: "Facebook Pages",
    description: "Publish posts to a Facebook Page.",
    docsUrl: "https://developers.facebook.com/docs/pages/",
    secretFields: [
      { key: "clientId", label: "App ID", type: "text", required: true },
      { key: "clientSecret", label: "App secret", type: "password", required: true },
    ],
  },
  {
    slug: "Instagram",
    category: "Social",
    displayName: "Instagram Business",
    description: "Publish images / captions to an IG Business account (via Facebook).",
    docsUrl: "https://developers.facebook.com/docs/instagram-api",
    secretFields: [
      { key: "clientId", label: "App ID", type: "text", required: true },
      { key: "clientSecret", label: "App secret", type: "password", required: true },
    ],
  },
  {
    slug: "Twitter",
    category: "Social",
    displayName: "Twitter / X",
    description: "Publish tweets via OAuth 2 + PKCE.",
    docsUrl: "https://developer.twitter.com/en/docs/twitter-api",
    secretFields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret (optional for public clients)", type: "password", required: false },
    ],
  },
  {
    slug: "FaceRecognition",
    category: "Attendance",
    displayName: "Face Recognition",
    description: "AWS Rekognition or Azure Face for attendance check-in.",
    docsUrl: "https://docs.aws.amazon.com/rekognition/",
    secretFields: [
      { key: "provider", label: "Provider", type: "select", required: true, options: ["stub", "aws", "azure"] },
      { key: "awsRegion", label: "AWS region", type: "text", required: false },
      { key: "awsAccessKeyId", label: "AWS access key ID", type: "text", required: false },
      { key: "awsSecretAccessKey", label: "AWS secret access key", type: "password", required: false },
      { key: "azureEndpoint", label: "Azure Face endpoint", type: "url", required: false },
      { key: "azureKey", label: "Azure Face key", type: "password", required: false },
      { key: "faceMatchThreshold", label: "Match threshold (0..1, default 0.85)", type: "text", required: false },
    ],
  },
  {
    slug: "S3",
    category: "Storage",
    displayName: "AWS S3",
    description: "Attachment + backup storage.",
    docsUrl: "https://docs.aws.amazon.com/s3/",
    secretFields: [
      { key: "region", label: "Region", type: "text", required: true },
      { key: "accessKeyId", label: "Access key ID", type: "text", required: true },
      { key: "secretAccessKey", label: "Secret access key", type: "password", required: true },
      { key: "bucket", label: "Bucket", type: "text", required: true },
    ],
  },
  {
    slug: "SendGrid",
    category: "Email",
    displayName: "SendGrid",
    description: "Transactional email provider.",
    docsUrl: "https://docs.sendgrid.com/",
    secretFields: [
      { key: "apiKey", label: "API key", type: "password", required: true },
    ],
  },
  {
    slug: "Twilio",
    category: "SMS",
    displayName: "Twilio",
    description: "SMS + WhatsApp channel.",
    docsUrl: "https://www.twilio.com/docs",
    secretFields: [
      { key: "accountSid", label: "Account SID", type: "text", required: true },
      { key: "authToken", label: "Auth token", type: "password", required: true },
      { key: "fromNumber", label: "From number", type: "text", required: true },
    ],
  },
  {
    slug: "WhatsappCloud",
    category: "Chat",
    displayName: "WhatsApp Cloud API",
    description: "Meta's WhatsApp Cloud API (business messaging).",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    secretFields: [
      { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true },
      { key: "accessToken", label: "Access token", type: "password", required: true },
      { key: "verifyToken", label: "Webhook verify token", type: "password", required: true },
    ],
  },
  {
    slug: "Slack",
    category: "Chat",
    displayName: "Slack",
    description: "Post workflow / broadcast notifications to a Slack channel.",
    docsUrl: "https://api.slack.com/messaging",
    secretFields: [
      { key: "webhookUrl", label: "Incoming webhook URL", type: "password", required: true },
      { key: "defaultChannel", label: "Default channel", type: "text", required: false, help: "e.g. #ops" },
    ],
  },
  {
    slug: "Msg91",
    category: "SMS",
    displayName: "MSG91 (India SMS)",
    description: "India-first SMS provider used for OTPs + transactional SMS.",
    docsUrl: "https://docs.msg91.com/",
    secretFields: [
      { key: "authKey", label: "Auth key", type: "password", required: true },
      { key: "senderId", label: "Sender ID", type: "text", required: true, help: "6-char alphanumeric" },
      { key: "templateId", label: "DLT template ID", type: "text", required: false },
    ],
  },
  {
    slug: "IRP",
    category: "Compliance",
    displayName: "GST IRP (e-invoice)",
    description:
      "India IRN generation via a GSP adapter. Stores GSP username / password / GSTIN.",
    docsUrl: "https://einvoice1.gst.gov.in/",
    secretFields: [
      { key: "gspEndpoint", label: "GSP endpoint URL", type: "url", required: true },
      { key: "username", label: "GSP username", type: "text", required: true },
      { key: "password", label: "GSP password", type: "password", required: true },
      { key: "gstin", label: "Tenant GSTIN", type: "text", required: true },
    ],
  },
  {
    slug: "DocuSign",
    category: "eSignature",
    displayName: "DocuSign",
    description: "E-signature provider — sends envelopes + captures signer status.",
    docsUrl: "https://developers.docusign.com/",
    secretFields: [
      { key: "accountId", label: "Account ID", type: "text", required: true },
      { key: "integratorKey", label: "Integrator key", type: "text", required: true },
      { key: "userId", label: "Impersonated user ID", type: "text", required: true },
      { key: "privateKey", label: "RSA private key (PEM)", type: "password", required: true },
      { key: "baseUrl", label: "Base URL", type: "url", required: false, help: "Default: https://demo.docusign.net/restapi" },
    ],
  },
  {
    slug: "ZohoSign",
    category: "eSignature",
    displayName: "Zoho Sign",
    description: "Zoho Sign envelope creation + status webhook.",
    docsUrl: "https://www.zoho.com/sign/api/",
    secretFields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "clientSecret", label: "Client secret", type: "password", required: true },
      { key: "refreshToken", label: "Refresh token", type: "password", required: true },
      { key: "region", label: "Region", type: "select", required: false, options: ["com", "in", "eu", "com.au"] },
    ],
  },
  {
    slug: "EasyPost",
    category: "Shipping",
    displayName: "EasyPost",
    description: "Multi-carrier shipping rates + label generation.",
    docsUrl: "https://www.easypost.com/docs/api",
    secretFields: [
      { key: "apiKey", label: "API key", type: "password", required: true },
    ],
  },
];

export function catalogFor(slug: string): ProviderSpec | undefined {
  return INTEGRATION_CATALOG.find((p) => p.slug === slug);
}
