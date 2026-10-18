import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

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
import { AppShell } from "../components/app-shell";
import { MODULE_NAME, MODULE_NAV } from "../components/module-nav";

export const metadata = {
  title: "Lumaara · HR",
  manifest: "/manifest.webmanifest",
};

export const viewport = { themeColor: "#be185d" };

// PWA: register the shared service worker after mount. Inline script
// keeps the layout a plain server component (no client-only wrapper).
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
            <AppShell moduleName={MODULE_NAME} nav={MODULE_NAV}>
              {children}
            </AppShell>
          </UIProviders>
        </I18nBoot>
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
      </body>
    </html>
  );
}
