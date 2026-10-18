"use client";

// Lumaara Portal shell — customer-facing chrome. Same design tokens as
// the staff apps but with a smaller sidebar (no groups, just a flat list
// of the customer's self-service pages) and a lighter top bar (no search
// or app-switcher, since the portal only has one persona).

import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { clearSession, loadSession, type PortalSession } from "../lib/api";

export interface PortalNavLink {
  href: string;
  label: string;
  icon?: ReactNode;
}

function useSession(): { session: PortalSession | null; ready: boolean } {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);
  return { session, ready };
}

function initials(email: string | null | undefined): string {
  if (!email) return "?";
  return email.split("@")[0].slice(0, 2).toUpperCase();
}

function Wordmark() {
  return (
    <a href="/" className="flex items-center gap-2.5 ps-2 pe-3 py-4">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <g fill="#C09040">
          <circle cx="16" cy="6" r="3" />
          <circle cx="24.66" cy="11" r="3" />
          <circle cx="24.66" cy="21" r="3" />
          <circle cx="16" cy="26" r="3" />
          <circle cx="7.34" cy="21" r="3" />
          <circle cx="7.34" cy="11" r="3" />
          <circle cx="16" cy="16" r="3.5" fill="#DDBB77" />
        </g>
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-wordmark text-[20px] text-ink">LUMAARA</span>
        <span className="text-[9px] tracking-[0.14em] text-ink-muted uppercase mt-0.5">
          Self-service
        </span>
      </span>
    </a>
  );
}

function UserMenu({ session }: { session: PortalSession | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    if (open) {
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 pe-1 ps-2 py-1 rounded-xl hover:bg-canvas-warm transition"
      >
        <div className="text-end leading-tight hidden sm:block">
          <div className="text-xs font-semibold text-ink">
            {session?.user.displayName ?? session?.user.email ?? "—"}
          </div>
          <div className="text-[10px] text-ink-muted">
            {session?.user.partyType ?? ""}
          </div>
        </div>
        <span className="h-9 w-9 rounded-full bg-ink text-gold-300 grid place-items-center text-xs font-bold">
          {initials(session?.user.email)}
        </span>
      </button>
      {open && (
        <div className="absolute end-0 top-12 w-56 card py-1 text-sm z-50">
          <a
            href="/settings"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            Account settings
          </a>
          <a
            href="/privacy"
            className="block px-3 py-2 hover:bg-canvas-warm text-ink-soft"
          >
            Privacy &amp; data
          </a>
          <div className="border-t border-ink/8 my-1" />
          <button
            onClick={() => {
              clearSession();
              window.location.href = "/login";
            }}
            className="w-full text-start px-3 py-2 hover:bg-red-50 text-red-600"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { session, ready } = useSession();

  // Public routes render bare — no auth chrome. Storefront / CMS pages have
  // their own presentation.
  const isPublic =
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/accept-invite" ||
    pathname === "/blog" ||
    pathname === "/shop" ||
    pathname === "/cart" ||
    pathname === "/checkout" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/forgot-password/") ||
    pathname.startsWith("/accept-invite/") ||
    pathname.startsWith("/site/") ||
    pathname.startsWith("/blog/") ||
    pathname.startsWith("/shop/") ||
    pathname.startsWith("/checkout/");

  useEffect(() => {
    if (!ready || isPublic) return;
    if (!session) window.location.href = "/login";
  }, [ready, isPublic, session]);

  if (isPublic) return <>{children}</>;
  if (!ready) return null;
  if (!session) return null;

  const isCustomer = session.user.partyType === "Customer";

  const nav: PortalNavLink[] = [
    { href: "/", label: "Dashboard" },
    { href: "/invoices", label: isCustomer ? "Invoices" : "Bills" },
    { href: "/statement", label: "Statement" },
    ...(isCustomer
      ? [
          { href: "/quotations", label: "Quotations" },
          { href: "/dsr", label: "Daily sales" },
        ]
      : [{ href: "/purchase-orders", label: "Purchase orders" }]),
    { href: "/tickets", label: "Support tickets" },
    { href: "/privacy", label: "Privacy & data" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <div className="min-h-screen">
      <aside className="app-sidebar">
        <Wordmark />
        <div className="app-sidebar-scroll">
          <div className="nav-group">
            <div className="nav-group-label">Self-service</div>
            {nav.map((l) => {
              const active =
                pathname === l.href ||
                (l.href !== "/" && pathname.startsWith(l.href + "/"));
              return (
                <a
                  key={l.href}
                  href={l.href}
                  className={active ? "nav-link-active" : "nav-link"}
                >
                  <span className="flex-1 truncate">{l.label}</span>
                  {active && <span className="nav-dot" />}
                </a>
              );
            })}
          </div>
        </div>
        <div className="app-sidebar-footer">
          <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
            V0.1.0
          </span>
          <span className="live-pill">
            <span className="live-dot" />
            LIVE
          </span>
        </div>
      </aside>

      <header className="app-topbar">
        <div className="h-full ps-6 pe-4 flex items-center justify-end gap-3">
          <UserMenu session={session} />
        </div>
      </header>

      <main className="app-main">
        <div key={pathname} className="app-content animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
