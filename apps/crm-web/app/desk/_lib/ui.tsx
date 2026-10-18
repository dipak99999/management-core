"use client";

// Desk-shared visual helpers — kept in a leaf file (not a page) so multiple
// pages can import them without Next complaining about extra exports on a
// page module. These are trivial pills that map the Desk vocabulary
// (Urgent/High/Medium/Low, New/Open/InProgress/…) to the standard badge
// classes; per the spec:
//   • Priority: Urgent=red, High=amber, Medium=blue, Low=gray
//   • Status:   New=blue, Open=amber, InProgress=violet, OnHold=gray,
//               Resolved=green, Closed=gray

import { dateShort, relativeTime } from "../../../components/ui";

export type TicketStatus =
  | "New"
  | "Open"
  | "InProgress"
  | "OnHold"
  | "Resolved"
  | "Closed";
export type TicketPriority = "Urgent" | "High" | "Medium" | "Low";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const cls =
    priority === "Urgent"
      ? "badge-red"
      : priority === "High"
        ? "badge-amber"
        : priority === "Medium"
          ? "badge-blue"
          : "badge-gray";
  return <span className={cls}>{priority}</span>;
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const cls =
    status === "New"
      ? "badge-blue"
      : status === "Open"
        ? "badge-amber"
        : status === "InProgress"
          ? "badge-violet"
          : status === "OnHold"
            ? "badge-gray"
            : status === "Resolved"
              ? "badge-green"
              : "badge-gray";
  const label =
    status === "InProgress"
      ? "In Progress"
      : status === "OnHold"
        ? "On Hold"
        : status;
  return <span className={cls}>{label}</span>;
}

export function SlaIndicator({
  dueAt,
  breached,
  metAt,
}: {
  dueAt: string | null;
  breached: boolean;
  metAt: string | null;
}) {
  if (!dueAt) return <span className="text-ink-muted/50">—</span>;
  if (metAt) {
    return (
      <span
        className="text-[11px] text-green-700"
        title={`Met at ${dateShort(metAt)}`}
      >
        ✓ {relativeTime(metAt)}
      </span>
    );
  }
  if (breached) {
    return (
      <span
        className="badge-red"
        title={`Breached (was due ${dateShort(dueAt)})`}
      >
        ⚠ Breached
      </span>
    );
  }
  const now = Date.now();
  const due = new Date(dueAt).getTime();
  const total = due - now;
  // "<15% remaining" is expensive to derive exactly (we'd need policy
  // start-time). 15 minutes is a good approximation for typical SLAs
  // (minutes-to-hours) and matches the intent: draw attention when the
  // deadline is imminent.
  if (total > 0 && total < 15 * 60 * 1000) {
    return (
      <span className="badge-amber" title={`Due ${dateShort(dueAt)}`}>
        ⏰ Soon
      </span>
    );
  }
  return (
    <span
      className="text-[11px] text-ink-muted"
      title={new Date(dueAt).toLocaleString()}
    >
      {dateShort(dueAt)}
    </span>
  );
}

const AUTH_URL =
  process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";

export interface DeskUser {
  id: string;
  email: string;
  fullName: string;
}

function jwt(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return "";
  try {
    return (JSON.parse(raw) as { token?: string }).token ?? "";
  } catch {
    return "";
  }
}

// Assignee dropdown data — auth-service lives on a different port than
// crm-service, so we hit it directly with the same JWT.
export async function fetchDeskUsers(): Promise<DeskUser[]> {
  try {
    const res = await fetch(`${AUTH_URL}/roles/users/list`, {
      headers: { authorization: `Bearer ${jwt()}` },
    });
    if (!res.ok) return [];
    return (await res.json()) as DeskUser[];
  } catch {
    return [];
  }
}
