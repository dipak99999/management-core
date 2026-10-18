import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { CookieBanner } from "../components/cookie-banner";
import { I18nBoot } from "../components/i18n-boot";
import { UIProviders } from "../components/ui-providers";

// Serif family behind the LUMAARA wordmark; sans for everything else.
// Self-hosted through next/font so the fallback stack never blinks in.
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

export const metadata: Metadata = {
  title: "Lumaara",
  description: "Multi-tenant ERP",
  manifest: "/manifest.webmanifest",
};

// Next 15: themeColor belongs in `viewport` not `metadata`.
export const viewport = { themeColor: "#FBF7EE" };

const REGISTER_SW = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`;

// Blocking inline script — sets html.dark + html.sidebar-collapsed from
// localStorage before React hydrates. Prevents FOUC (dark-mode users
// flashing a light theme on cold load) and eliminates post-hydrate
// className flips from AppShell useEffects.
const PREHYDRATE_PREFS = `try{var d=localStorage.getItem('appshell.darkMode')==='1';var c=localStorage.getItem('appshell.collapsed')==='1';var r=document.documentElement;if(d)r.classList.add('dark');if(c)r.classList.add('sidebar-collapsed');}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREHYDRATE_PREFS }} />
      </head>
      <body>
        <I18nBoot>
          <UIProviders>{children}</UIProviders>
        </I18nBoot>
        <CookieBanner />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
      </body>
    </html>
  );
}
