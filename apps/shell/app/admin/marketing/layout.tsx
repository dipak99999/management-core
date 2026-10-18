import type { ReactNode } from "react";

// Marketing admin section — shares the standard AppShell chrome via the page
// components (each page wraps its own AppShell so it can pick the correct
// module accent + nav). This layout is a passthrough so future marketing-
// only shared UI (e.g. sub-nav tabs across suppressions/tracking/media)
// has a mount point without touching every page.

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
