import Link from "next/link";
import { loadLegalConfig, isLegalConfigPlaceholder } from "../../../lib/legal-config";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const c = loadLegalConfig();
  const draft = isLegalConfigPlaceholder(c);
  return (
    <main className="min-h-screen bg-canvas p-8">
      <article className="max-w-3xl mx-auto prose">
        <nav className="text-xs text-ink-muted mb-2">
          <Link href="/" className="hover:text-ink">← Back to app</Link>
        </nav>
        <h1 className="text-3xl font-semibold mb-2">Terms of Service</h1>
        <p className="text-sm text-ink-muted mb-6">
          Effective date: {c.effectiveDate} · {c.companyName}
        </p>

        {draft && (
          <div className="card p-5 border-amber-200 bg-amber-50 text-sm text-amber-900 mb-6">
            <strong>Draft — needs legal review.</strong> Fill in LEGAL_COMPANY_NAME,
            LEGAL_JURISDICTION, and LEGAL_UPTIME_TARGET in production env and have an
            attorney review the liability caps + dispute-resolution clauses before publishing.
          </div>
        )}

        <h2 className="text-xl font-semibold mt-6 mb-2">1. Agreement</h2>
        <p>
          By creating an account on Lumaara ERP (the &quot;Service&quot;) you agree to these Terms. If
          you&apos;re acting on behalf of a company, you represent that you have authority to bind
          that company. &quot;You&quot; = that company; &quot;we&quot; / &quot;us&quot; = <strong>{c.companyName}</strong>.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">2. The service</h2>
        <p>
          Lumaara is a multi-tenant SaaS ERP. We provide the software; you provide the data.
          Features included in your plan are listed at Settings → Billing. We may add features; we
          may deprecate low-use features with 90 days&apos; notice.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">3. Subscriptions &amp; payment</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li>Monthly plans, billed in advance via Razorpay (INR).</li>
          <li>Upgrades are prorated for the remainder of the current cycle.</li>
          <li>Downgrades take effect at the next billing cycle (no partial refund).</li>
          <li>Failed payments: 7-day grace, then access suspended until paid.</li>
          <li>Refunds: within 7 days of initial subscription, no questions asked.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">4. Your responsibilities</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li>Keep credentials secure. 2FA is strongly recommended.</li>
          <li>Don&apos;t probe for vulnerabilities without written authorization.</li>
          <li>Don&apos;t use AI features to generate CSAM, weapons instructions, or targeted harassment.</li>
          <li>Comply with laws applicable to your uploaded data.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">5. Data ownership</h2>
        <p>
          You own your data. We process it on your behalf. On cancellation we delete it within 30
          days (or immediately on request). We will never sell your data or train AI models on it
          without your explicit opt-in.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">6. Service level</h2>
        <p>
          Target <strong>{c.uptimeTargetPct}% monthly uptime</strong> (planned maintenance excluded).
          Public status at <Link href="/status" className="underline">/status</Link>. SLA credits for
          sub-target months available on request (max 10% of the month&apos;s fee).
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">7. Limitation of liability</h2>
        <p>
          To the extent permitted by law, our aggregate liability is capped at the fees you paid in
          the 12 months preceding the claim. We&apos;re not liable for indirect, incidental, or
          consequential damages.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">8. Termination</h2>
        <ul className="list-disc ms-6 space-y-1">
          <li>You can cancel anytime via Settings → Billing or by email.</li>
          <li>We can terminate for breach after 14 days&apos; notice to cure.</li>
          <li>Either side can terminate for convenience with 30 days&apos; notice.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-2">9. Jurisdiction</h2>
        <p>
          Governed by the laws of <strong>{c.jurisdiction}</strong>. Disputes go to the courts of
          that jurisdiction.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">10. Changes</h2>
        <p>
          Material changes: 30 days&apos; email notice. Minor clarifications: effective immediately
          on posting.
        </p>

        <footer className="mt-10 pt-6 border-t border-ink/10 text-xs text-ink-muted">
          Questions? <a href={`mailto:${c.legalEmail}`} className="underline">{c.legalEmail}</a>
          {" · "}Last updated {c.effectiveDate}
        </footer>
      </article>
    </main>
  );
}
