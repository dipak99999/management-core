"use client";

// Recently-viewed records — tracked per user in localStorage. Any detail
// page can call `trackRecent({doctype, id, label, href})` on mount; the
// dashboard reads the latest N for its "Recent" strip.
//
// Capped at 20 entries, dedup'd by href, newest first. No network — fast
// to read, fine on cold boot.

const KEY = "lumaara.recent";
const MAX = 20;

export interface RecentItem {
  doctype: string; // "Invoice", "Customer", "Lead", ...
  id: string;
  label: string;  // display name
  href: string;   // internal route to open the record
  at: number;     // unix ms
}

function read(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(items: RecentItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage disabled */ }
}

export function trackRecent(item: Omit<RecentItem, "at">): void {
  if (!item?.href || !item?.label) return;
  const existing = read().filter((x) => x.href !== item.href);
  const next = [{ ...item, at: Date.now() }, ...existing].slice(0, MAX);
  write(next);
  // Same-tab + cross-tab change event so the dashboard can live-refresh.
  try { window.dispatchEvent(new CustomEvent("lumaara:recent-change")); } catch { /* ignore */ }
}

export function readRecent(limit = 6): RecentItem[] {
  return read().slice(0, limit);
}
