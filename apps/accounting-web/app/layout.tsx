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
  title: "Lumaara · Accounting",
  manifest: "/manifest.webmanifest",
};

// Next 15 moved `themeColor` out of `metadata` into a dedicated `viewport`
// export. Keeping it in metadata still works but logs a warning on every
// page render in dev. Move explicit to silence it.
export const viewport = {
  themeColor: "#1e40af",
};

const REGISTER_SW = `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`;

// Blocking inline script that runs before React hydrates. Sets the dark-mode
// and sidebar-collapsed classes on <html> from localStorage so the first
// paint matches the user's saved prefs. Prevents FOUC (dark-mode users
// previously flashed a light theme on cold load) and eliminates any
// post-hydration className flip from the AppShell's useEffect.
const PREHYDRATE_PREFS = `try{var d=localStorage.getItem('appshell.darkMode')==='1';var c=localStorage.getItem('appshell.collapsed')==='1';var r=document.documentElement;if(d)r.classList.add('dark');if(c)r.classList.add('sidebar-collapsed');}catch(e){}`;

import { I18nBoot } from "../components/i18n-boot";
import { UIProviders } from "../components/ui-providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning on <html> — the PREHYDRATE_PREFS script
    // below mutates classList before React hydrates (to apply saved dark /
    // sidebar-collapsed prefs). Without the flag, React logs a hydration
    // mismatch for the differing className. Only suppresses this element,
    // not its children.
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
