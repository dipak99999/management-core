"use client";

// Shared types + tiny helpers for the Lumaara Social pages. This is not a
// component library — just constants and pure functions consumed by the five
// pages under /crm/social/*. Keeping them here means all the pages agree on
// platform → color mapping and post-status → badge mapping without a wider
// change surface.

import type { ReactNode } from "react";

export type Platform =
  | "Twitter"
  | "Facebook"
  | "Instagram"
  | "LinkedIn"
  | "GoogleMyBusiness"
  | "YouTube";

export type PostStatus =
  | "Draft"
  | "Scheduled"
  | "Publishing"
  | "Published"
  | "Failed";

export type Sentiment = "Positive" | "Neutral" | "Negative";

export type MonitorType = "Keyword" | "Hashtag" | "Mention";

export const PLATFORMS: Platform[] = [
  "Twitter",
  "Facebook",
  "Instagram",
  "LinkedIn",
  "GoogleMyBusiness",
  "YouTube",
];

// Tailwind color class per platform, used for chips and connected-channel
// gradients. Matches the spec's requested palette.
export const PLATFORM_BG: Record<Platform, string> = {
  Twitter: "bg-sky-500",
  Facebook: "bg-blue-600",
  Instagram: "bg-fuchsia-500",
  LinkedIn: "bg-blue-700",
  GoogleMyBusiness: "bg-amber-500",
  YouTube: "bg-red-600",
};

// Gradient variants for the Channels cards.
export const PLATFORM_GRADIENT: Record<Platform, string> = {
  Twitter: "bg-gradient-to-br from-sky-400 to-sky-600",
  Facebook: "bg-gradient-to-br from-blue-500 to-blue-700",
  Instagram: "bg-gradient-to-br from-fuchsia-400 to-pink-600",
  LinkedIn: "bg-gradient-to-br from-blue-600 to-blue-800",
  GoogleMyBusiness: "bg-gradient-to-br from-amber-400 to-orange-500",
  YouTube: "bg-gradient-to-br from-red-500 to-red-700",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  Twitter: "Twitter",
  Facebook: "Facebook",
  Instagram: "Instagram",
  LinkedIn: "LinkedIn",
  GoogleMyBusiness: "Google My Business",
  YouTube: "YouTube",
};

// Single letter (or two) shown inside the little platform disc so operators
// can eyeball the network at a glance without reading the label.
export function platformInitial(p: Platform): string {
  if (p === "GoogleMyBusiness") return "G";
  return p.charAt(0);
}

// Colored disc used everywhere we render a platform (chips, tables, cards).
export function PlatformDot({
  platform,
  size = 20,
  title,
}: {
  platform: Platform;
  size?: number;
  title?: string;
}): ReactNode {
  return (
    <span
      title={title ?? PLATFORM_LABEL[platform]}
      className={`${PLATFORM_BG[platform]} inline-flex items-center justify-center rounded-full text-white font-bold`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.55) }}
    >
      {platformInitial(platform)}
    </span>
  );
}

// Map post status → badge class. Uses the shared badge-* Tailwind utility
// classes defined in globals.css.
export const POST_STATUS_BADGE: Record<PostStatus, string> = {
  Draft: "badge-gray",
  Scheduled: "badge-amber",
  Publishing: "badge-blue",
  Published: "badge-green",
  Failed: "badge-red",
};

// Solid-color pill used inside calendar day cells (badge-* classes are
// pastel; the calendar reads better with saturated pills).
export const POST_STATUS_PILL: Record<PostStatus, string> = {
  Draft: "bg-ink-muted/40 text-white",
  Scheduled: "bg-amber-500 text-white",
  Publishing: "bg-blue-500 text-white",
  Published: "bg-green-600 text-white",
  Failed: "bg-red-600 text-white",
};

// Sentiment → pill class for the engagement inbox.
export const SENTIMENT_PILL: Record<Sentiment, string> = {
  Positive: "badge-green",
  Neutral: "badge-gray",
  Negative: "badge-red",
};

// datetime-local <input> value ↔ ISO helpers. HTML datetime-local wants a
// "YYYY-MM-DDTHH:mm" string in the *local* timezone; we translate to/from
// ISO for API calls.
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}
export function localInputToIso(local: string): string | null {
  if (!local) return null;
  // new Date("YYYY-MM-DDTHH:mm") parses as local — that's what we want.
  return new Date(local).toISOString();
}

// Post/Account shared shapes (see spec for full API contract).
export interface Account {
  id: string;
  platform: Platform;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  externalId?: string | null;
  isActive: boolean;
  addedAt: string;
}

export interface PostResult {
  accountId: string;
  status: string;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  account: { platform: Platform; handle: string };
}

export interface Post {
  id: string;
  content: string;
  mediaUrls: string[];
  linkUrl: string | null;
  channelIds: string[];
  status: PostStatus;
  scheduledFor: string | null;
  publishedAt: string | null;
  results: PostResult[];
  createdAt: string;
}

export interface PostStats {
  drafts: number;
  scheduled: number;
  published: number;
  failed: number;
  publishedLast7d: number;
}

export interface Mention {
  id: string;
  platform: Platform;
  authorHandle: string;
  authorName: string;
  avatarUrl?: string | null;
  content: string;
  postedAt: string;
  keyword: string | null;
  sentiment: Sentiment;
  isReplied: boolean;
}

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  query: string;
  platforms: Platform[];
  isActive: boolean;
}
