"use client";

const KEY = "lumaara.session";

export interface Session {
  token: string;
  tenant: { id: string; name: string; slug: string; locale?: string };
  user: { id: string; email: string; fullName: string; role: string; roles?: string[] };
}

// Returns true if the session's user holds `role`. SystemManager always
// returns true. The legacy `role === "admin"` also acts as SystemManager for
// tokens issued before roles were added to JWT.
export function hasRole(session: Session | null, role: string): boolean {
  if (!session) return false;
  if (session.user.role === "admin") return true;
  const roles = session.user.roles ?? [];
  return roles.includes("SystemManager") || roles.includes(role);
}

export function saveSession(s: Session) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
