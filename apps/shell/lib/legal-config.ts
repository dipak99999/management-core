// Legal / company metadata rendered on /legal/privacy, /legal/terms,
// /legal/cookies. Read from env vars so operators don't have to edit
// Markdown — fill in once in .env.prod, every page updates.
//
// Why env not DB? Legal copy changes rarely (quarterly at most) and
// shouldn't be editable without a code review. Env also means it's part
// of the deploy artifact — rollback restores the previous legal text.
//
// Every field has a sensible default (either empty-string or a safe
// placeholder) so a brand-new deploy renders a usable page immediately,
// then the operator fills values in without a code change.

export interface LegalConfig {
  companyName: string;
  companyAddress: string;
  privacyEmail: string;
  legalEmail: string;
  supportEmail: string;
  jurisdiction: string;    // "Karnataka, India"
  dataRegion: string;      // "ap-south-1 Mumbai"
  uptimeTargetPct: string; // "99.5"
  retentionDays: {
    audit: number;
    error: number;
    billing: number;
  };
  effectiveDate: string;   // YYYY-MM-DD
}

function env(key: string, def: string = ""): string {
  // Next.js inlines NEXT_PUBLIC_* in the client bundle at build; the
  // bare LEGAL_* vars read at request time on the server. For client
  // components we prefer NEXT_PUBLIC_LEGAL_* mirrors — see below.
  return process.env[key] || process.env[`NEXT_PUBLIC_${key}`] || def;
}

export function loadLegalConfig(): LegalConfig {
  return {
    companyName: env("LEGAL_COMPANY_NAME", "[Your Company Name]"),
    companyAddress: env("LEGAL_COMPANY_ADDRESS", "[Your Registered Office Address]"),
    privacyEmail: env("LEGAL_PRIVACY_EMAIL", "privacy@example.com"),
    legalEmail: env("LEGAL_LEGAL_EMAIL", "legal@example.com"),
    supportEmail: env("LEGAL_SUPPORT_EMAIL", "support@example.com"),
    jurisdiction: env("LEGAL_JURISDICTION", "[Your Jurisdiction]"),
    dataRegion: env("LEGAL_DATA_REGION", "[Your Data Region]"),
    uptimeTargetPct: env("LEGAL_UPTIME_TARGET", "99.5"),
    retentionDays: {
      audit: Number(env("AUDIT_LOG_RETENTION_DAYS", "365")),
      error: Number(env("ERROR_LOG_RETENTION_DAYS", "90")),
      billing: 7 * 365, // 7 years, tax law — not configurable
    },
    effectiveDate: env("LEGAL_EFFECTIVE_DATE", new Date().toISOString().slice(0, 10)),
  };
}

/**
 * `true` if the operator still hasn't filled in the critical fields.
 * UI uses this to show a visible "placeholder" banner so visitors know
 * the policy isn't finalized.
 */
export function isLegalConfigPlaceholder(c: LegalConfig): boolean {
  return (
    c.companyName.startsWith("[") ||
    c.companyAddress.startsWith("[") ||
    c.jurisdiction.startsWith("[")
  );
}
