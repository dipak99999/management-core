"use client";

import { useEffect, useState } from "react";

// Fetches the authed user's tenant's active subscription plan from
// /api/auth-svc/my-plan via the shell proxy. Cached in sessionStorage so
// re-renders don't thrash the API. Null while loading; empty plan when
// not configured (user still sees Overview + Admin groups).

export interface MyPlan {
  allowedModules: string[];
  allowedSubmodules: string[];
  tier: string | null;
  planName?: string;
  isSuperAdmin: boolean;
}

const CACHE_KEY = "lumaara.myPlan";

function readCache(): MyPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MyPlan;
  } catch { return null; }
}

export function usePlan(): { plan: MyPlan | null; loading: boolean } {
  const [plan, setPlan] = useState<MyPlan | null>(() => readCache());
  const [loading, setLoading] = useState(plan === null);

  useEffect(() => {
    const token = (() => {
      try {
        const raw = localStorage.getItem("lumaara.session");
        if (!raw) return "";
        return (JSON.parse(raw) as { token?: string }).token ?? "";
      } catch { return ""; }
    })();
    if (!token) { setLoading(false); return; }

    fetch("/api/auth-svc/my-plan", {
      headers: { authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MyPlan | null) => {
        if (!data) return;
        setPlan(data);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
      })
      .finally(() => setLoading(false));
  }, []);

  return { plan, loading };
}
