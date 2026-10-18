import Link from "next/link";
import { loadLegalConfig, isLegalConfigPlaceholder } from "../../../lib/legal-config";

export const metadata = { title: "Privacy Policy" };

// Server component — reads legal metadata from env at request time so an
// env change takes effect without a rebuild. Fallbacks show in square
// brackets so operator knows exactly which vars to set.

export default function PrivacyPage() {
  const c = loadLegalConfig();
  const draft = isLegalConfigPlaceholder(c);
  return (
    <main className="min-h-screen bg-canvas p-8">
      <article className="max-w-3xl mx-auto prose">
        <nav className="text-xs text-ink-muted mb-2">
          <Link href="/" className="hover:text-ink">← Back to app</Link>
        </nav>
        <h1 className="text-3xl font-semibold mb-2">Privacy Policy</h1>
        <p className="text-sm text-ink-muted mb-6">
          Effective date: {c.effectiveDate} · {c.companyName}
        </p>

        {draft && (
          <div className="card p-5 border-amber-200 bg-amber-50 text-sm text-amber-900 mb-6">
            <strong>Draft — needs legal review.</strong> Fill in LEGAL_COMPANY_NAME,
            LEGAL_COMPANY_ADDRESS, and LEGAL_JURISDICTION in your production env (or
            via Super Admin → Legal) and have a privacy lawyer review before publishing.
          </div>
        )}

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Who we are</h2>
        <p>
          Lumaara ERP (&quot;we&quot;, &quot;us&quot;) is operated by <strong>{c.companyName}</strong>,
          with its registered office at <strong>{c.companyAddress}</strong>. For privacy inquiries
          contact our Data Protection Officer at{" "}
          <a href={`mailto:${c.privacyEmail}`} className="underline">{c.privacyEmail}</a>.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. What data we collect</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li><strong>Account data</strong> — name, email, phone, hashed password, role.</li>
          <li><strong>Business data</strong> — records you create (customers, invoices, employees, etc). Processed on your instructions as a data processor.</li>
          <li><strong>Technical data</strong> — IP address, user-agent, request timestamps, feature-usage via our structured logs; no third-party analytics without consent.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Why we collect it</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li>Provide the service (storage, retrieval, computation).</li>
          <li>Bill you (payments by Razorpay — we never see card details).</li>
          <li>Secure the service (fraud detection, rate limiting, incident response).</li>
          <li>Comply with legal obligations (tax, accounting, lawful requests).</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Where your data lives</h2>
        <p>
          Primary data store: PostgreSQL in <strong>{c.dataRegion}</strong>. Encrypted secrets
          (API keys, OAuth tokens) use AES-256-GCM with a per-deployment master key. Backups
          retained {c.retentionDays.audit} days and tested monthly.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Sub-processors</h2>
        <p>We rely on these third parties:</p>
        <ul className="list-disc ms-6 space-y-1">
          <li><strong>Razorpay</strong> — payment processing.</li>
          <li><strong>Anthropic / OpenAI / Brew</strong> — AI features when enabled by you. Prompt + retrieved context passed per request; neither trains on your data per their enterprise terms.</li>
          <li><strong>Your configured SMTP + cloud provider</strong> — transactional email + compute/storage.</li>
        </ul>
        <p>
          Full sub-processor list on request to{" "}
          <a href={`mailto:${c.privacyEmail}`} className="underline">{c.privacyEmail}</a>.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">6. How long we keep it</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li><strong>Active account</strong> — while subscription is active.</li>
          <li><strong>After cancellation</strong> — 30 days (reactivation window), then deleted.</li>
          <li><strong>Audit logs</strong> — {c.retentionDays.audit} days.</li>
          <li><strong>Error logs</strong> — {c.retentionDays.error} days.</li>
          <li><strong>Billing records</strong> — 7 years (tax law).</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">7. Your rights</h2>
        <p>Under DPDP / GDPR you have the right to:</p>
        <ul className="list-disc ms-6 space-y-1">
          <li>Access your personal data (export via Admin → Users).</li>
          <li>Correct inaccurate data (edit in the app).</li>
          <li>Erase your data (contact support; honoured within 30 days unless retention applies).</li>
          <li>Object to processing (we&apos;ll suspend the account).</li>
          <li>Lodge a complaint with your data protection authority.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">8. Changes</h2>
        <p>Material changes: 30 days&apos; email notice. Continued use after that is acceptance.</p>

        <footer className="mt-10 pt-6 border-t border-ink/10 text-xs text-ink-muted">
          Questions? <a href={`mailto:${c.privacyEmail}`} className="underline">{c.privacyEmail}</a>
          {" · "}Last updated {c.effectiveDate}
        </footer>
      </article>
    </main>
  );
}
