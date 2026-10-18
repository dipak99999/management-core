import Link from "next/link";
import { loadLegalConfig } from "../../../lib/legal-config";

export const metadata = { title: "Cookie Policy" };

export default function CookiesPage() {
  const c = loadLegalConfig();
  return (
    <main className="min-h-screen bg-canvas p-8">
      <article className="max-w-3xl mx-auto prose">
        <nav className="text-xs text-ink-muted mb-2">
          <Link href="/" className="hover:text-ink">← Back to app</Link>
        </nav>
        <h1 className="text-3xl font-semibold mb-2">Cookie Policy</h1>
        <p className="text-sm text-ink-muted mb-6">Effective date: {c.effectiveDate}</p>

        <h2 className="text-xl font-semibold mt-6 mb-2">What we store</h2>
        <p>
          {c.companyName} doesn&apos;t use third-party cookies or analytics by default. The storage
          we DO use is strictly necessary to run the app:
        </p>

        <table className="table w-full my-4 text-sm">
          <thead>
            <tr>
              <th className="text-start">Key</th>
              <th className="text-start">Type</th>
              <th className="text-start">Purpose</th>
              <th className="text-start">Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>lumaara.session</code></td><td>localStorage</td><td>Signed JWT so you stay logged in.</td><td>Until logout or 7-day JWT expiry</td></tr>
            <tr><td><code>lumaara.uiMode</code></td><td>localStorage</td><td>AI vs Manual mode preference.</td><td>Until changed</td></tr>
            <tr><td><code>appshell.darkMode</code></td><td>localStorage</td><td>Dark/light preference.</td><td>Until changed</td></tr>
            <tr><td><code>appshell.collapsed</code></td><td>localStorage</td><td>Sidebar collapsed state.</td><td>Until changed</td></tr>
            <tr><td><code>lumaara.locale</code></td><td>localStorage</td><td>Language choice.</td><td>Until changed</td></tr>
            <tr><td><code>lumaara.cookieConsent</code></td><td>localStorage</td><td>Dismissed-banner flag.</td><td>Until browser storage cleared</td></tr>
          </tbody>
        </table>

        <h2 className="text-xl font-semibold mt-6 mb-2">Third-party storage</h2>
        <p>
          <strong>Razorpay Checkout</strong> (loaded only when you open a payment flow) may set its
          own cookies for fraud detection. See{" "}
          <a href="https://razorpay.com/privacy" className="underline" rel="noopener noreferrer" target="_blank">
            Razorpay&apos;s privacy policy
          </a>.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-2">How to clear it</h2>
        <p>
          Browser settings → Privacy → &quot;Clear browsing data&quot;. You&apos;ll be logged out and
          preferences reset. All business data stays in our database — localStorage is per-browser.
        </p>

        <footer className="mt-10 pt-6 border-t border-ink/10 text-xs text-ink-muted">
          Questions? <a href={`mailto:${c.privacyEmail}`} className="underline">{c.privacyEmail}</a>
        </footer>
      </article>
    </main>
  );
}
