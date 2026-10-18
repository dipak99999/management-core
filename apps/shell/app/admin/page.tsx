"use client";

import { AppShell, Icon } from "../../components/app-shell";
import { SHELL_NAV } from "../../components/shell-nav";
import { PageHeader } from "../../components/ui";
import type { ReactNode } from "react";

interface AdminLink {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}

const LINKS: AdminLink[] = [
  {
    href: "/admin/roles",
    title: "Roles",
    icon: Icon.shield,
    description:
      "View, create, and manage role permissions. Grants govern who can read, write, create, delete, submit, and cancel each doctype.",
  },
  {
    href: "/admin/users",
    title: "Users",
    icon: Icon.users,
    description: "List users in this tenant and assign roles to each.",
  },
  {
    href: "/admin/workflows",
    title: "Workflows",
    icon: Icon.layers,
    description:
      "Define state machines that layer on top of a doctype's status field. Transition buttons appear on detail pages for allowed roles.",
  },
  {
    href: "/admin/custom-fields",
    title: "Custom Fields",
    icon: Icon.tag,
    description:
      "Add ad-hoc fields to any doctype without a schema migration. Values live in the target row's JSONB column and are validated server-side.",
  },
  {
    href: "/admin/marketing",
    title: "Marketing",
    icon: Icon.megaphone,
    description:
      "Suppressions, tracking events, media library, and public archives. Manages deliverability + public-facing surfaces for the CRM's campaigns.",
  },
  {
    href: "/admin/audit-logs",
    title: "Audit Log",
    icon: Icon.clock,
    description:
      "Immutable trail of every write action across the tenant: who, when, what doctype, what payload. Filterable by doctype and user.",
  },
  {
    href: "/admin/oauth-clients",
    title: "OAuth Clients",
    icon: Icon.shield,
    description:
      "Register third-party apps that request access via OAuth 2. Supports authorization_code + PKCE, refresh tokens, and client_credentials.",
  },
  {
    href: "/admin/reports/tds-26q",
    title: "TDS 26Q",
    icon: Icon.clock,
    description:
      "Quarterly TDS return — aggregates deducted TDS by supplier + IT section. Download NSDL-friendly CSV for your CA.",
  },
  {
    href: "/admin/reports/tcs-27eq",
    title: "TCS 27EQ",
    icon: Icon.clock,
    description:
      "Quarterly TCS return (Section 206C(1H)) — sales-side counterpart to 26Q. Download the CSV your CA imports for filing.",
  },
  {
    href: "/admin/reports/tds-challans",
    title: "TDS challans",
    icon: Icon.clock,
    description:
      "Track monthly TDS deposits to the government. Enter every bank challan (BSR + serial + paidDate). Monthly-due panel highlights months where deducted TDS hasn't been deposited yet.",
  },
];

export default function AdminHomePage() {
  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        title="Administration"
        subtitle="Tenant-scoped administration. Only users with the SystemManager role can access these pages."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="card p-5 hover:shadow-brand-glow transition"
          >
            <div className="flex items-center gap-2 text-brand-600 mb-2">
              <span className="w-4 h-4 grid place-items-center">{l.icon}</span>
              <div className="text-base font-semibold text-ink">{l.title}</div>
            </div>
            <div className="text-sm text-ink-soft">{l.description}</div>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
