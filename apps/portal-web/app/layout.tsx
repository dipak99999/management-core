import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { ConsentBanner } from "../components/consent-banner";
import { PortalShell } from "../components/portal-shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-serif",
  display: "swap",
});

// Base metadata — every page inherits unless it exports its own
// `generateMetadata`. For the public SEO surfaces (blog/[slug],
// shop/[slug], book/[tenantId]/[slug]) individual pages should override
// `title` + `description` + `openGraph.images` so social previews are
// per-post and crawlers rank correctly. See docs/SEO.md for the roadmap.
const PORTAL_BASE =
  process.env.NEXT_PUBLIC_PORTAL_PUBLIC_URL ??
  process.env.PORTAL_PUBLIC_URL ??
  "https://portal.example.com";

export const metadata = {
  metadataBase: new URL(PORTAL_BASE),
  title: {
    default: "Lumaara · Self-Service Portal",
    template: "%s · Lumaara",
  },
  description:
    "Customer self-service portal: invoices, statements, orders, support.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Lumaara Portal",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport = { themeColor: "#FBF7EE" };

const REGISTER_SW = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`;

// Blocking inline script — sets html.dark + html.sidebar-collapsed from
// localStorage before React hydrates. Prevents FOUC (dark-mode users
// flashing a light theme on cold load) and eliminates post-hydrate
// className flips from AppShell useEffects.
const PREHYDRATE_PREFS = `try{var d=localStorage.getItem('appshell.darkMode')==='1';var c=localStorage.getItem('appshell.collapsed')==='1';var r=document.documentElement;if(d)r.classList.add('dark');if(c)r.classList.add('sidebar-collapsed');}catch(e){}`;

import { I18nBoot } from "../components/i18n-boot";
import { UIProviders } from "../components/ui-providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREHYDRATE_PREFS }} />
      </head>
      <body>
        <I18nBoot>
          <UIProviders>
            <PortalShell>{children}</PortalShell>
          </UIProviders>
        </I18nBoot>
        <ConsentBanner />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
      </body>
    </html>
  );
}
