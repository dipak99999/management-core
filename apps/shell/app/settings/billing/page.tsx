"use client";

// Tenant-facing subscription + invoice history. Flow:
//   1. Load available plans (filtered to this tenant's plans)
//   2. Load current subscription + invoice history
//   3. "Upgrade" on a plan → POST /billing/orders → open Razorpay Checkout
//      → on success POST /billing/verify → activate subscription
//
// The Razorpay Checkout script is loaded lazily — no cost for users
// who never visit the billing page.

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { AppShell } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { Button, Card, PageHeader, Toast } from "../../../components/ui";

interface Plan {
  id: string;
  name: string;
  tier: string;
  priceMonthlyInr: string;
  allowedModules: string[];
  allowedSubmodules: string[];
}
interface Subscription {
  id: string;
  planId: string;
  isActive: boolean;
  startDate: string;
  currentPeriodEnd: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}
interface Invoice {
  id: string;
  amountInr: string;
  currency: string;
  status: string;
  createdAt: string;
  upstreamOrderId: string | null;
  upstreamPaymentId: string | null;
  metadata: Record<string, unknown>;
}
interface Session { token: string; tenant?: { id: string; name?: string }; email?: string }

function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("lumaara.session") ?? "null") as Session | null; } catch { return null; }
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const sess = getSession();
  const r = await fetch(`/api/auth-svc${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(sess?.token ? { authorization: `Bearer ${sess.token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

// Load Razorpay Checkout script once, cached globally. Returns a promise
// that resolves when window.Razorpay is callable.
let checkoutLoader: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Razorpay) return Promise.resolve();
  if (!checkoutLoader) {
    checkoutLoader = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Razorpay Checkout"));
      document.head.appendChild(s);
    });
  }
  return checkoutLoader;
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      // my-plan returns allowedModules + planName for the current tenant;
      // for the full plan list we use the super-admin tenant plans endpoint
      // scoped to this tenant.
      const sess = getSession();
      if (!sess?.tenant?.id) throw new Error("No tenant in session");
      const [subRes, invRes, plansRes] = await Promise.all([
        api<Subscription | null>("/billing/subscription").catch(() => null),
        api<Invoice[]>("/billing/invoices").catch(() => []),
        api<Plan[]>(`/super/tenants/${sess.tenant.id}/plans`).catch(() => []),
      ]);
      setSub(subRes);
      setInvoices(invRes ?? []);
      setPlans(plansRes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  useListPageCommands({
    singular: "Billing",
    plural: "Billing",
    refresh: load,
  });

  async function subscribe(plan: Plan) {
    setPaying(plan.id);
    setError(null);
    try {
      const order = await api<{
        orderId: string;
        keyId: string;
        amount: number;
        currency: string;
        invoiceId: string;
        planName: string;
      }>("/billing/orders", {
        method: "POST",
        body: JSON.stringify({ planId: plan.id }),
      });

      await loadCheckout();
      const sess = getSession();

      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rzp = new (window as any).Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: "Lumaara ERP",
          description: `Subscribe to ${plan.name}`,
          order_id: order.orderId,
          prefill: {
            email: sess?.email,
            name: sess?.tenant?.name,
          },
          theme: { color: "#0f172a" },
          handler: async (resp: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const r = await api<{ ok: boolean; alreadyProcessed?: boolean }>(
                "/billing/verify",
                { method: "POST", body: JSON.stringify(resp) },
              );
              if (r.ok) {
                setMsg(`Subscribed to ${plan.name}. Welcome!`);
                await load();
                resolve();
              } else {
                reject(new Error("Verification failed"));
              }
            } catch (e) {
              reject(e);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment cancelled")),
          },
        });
        rzp.open();
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Payment failed";
      // "Payment cancelled" is user action, not an error worth yelling about
      if (m === "Payment cancelled") setMsg("Payment cancelled.");
      else setError(m);
    } finally {
      setPaying(null);
    }
  }

  const activeId = sub?.plan.id;

  return (
    <AppShell moduleName="Settings" nav={SHELL_NAV}>
      <PageHeader
        title="Subscription & Billing"
        subtitle="Manage your plan and view payment history. Payments processed securely via Razorpay."
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {msg && <div className="mb-4"><Toast kind="success" message={msg} onDismiss={() => setMsg(null)} /></div>}

      {loading ? (
        <Card className="p-8 text-center text-ink-muted">Loading…</Card>
      ) : (
        <>
          {sub ? (
            <Card className="p-6 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-muted mb-1">Current plan</div>
                  <h2 className="text-2xl font-semibold">{sub.plan.name}</h2>
                  <div className="text-sm text-ink-muted mt-1">{sub.plan.tier} · ₹{sub.plan.priceMonthlyInr}/mo</div>
                </div>
                {sub.nextBillingAt && (
                  <div className="text-end text-sm">
                    <div className="text-ink-muted">Renews on</div>
                    <div className="font-semibold">{new Date(sub.nextBillingAt).toLocaleDateString()}</div>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-6 mb-6 bg-amber-50 border-amber-200">
              <h2 className="font-semibold text-amber-900">No active subscription</h2>
              <p className="text-sm text-amber-800 mt-1">Pick a plan below to activate your access.</p>
            </Card>
          )}

          <h3 className="section-title mb-3">Available plans</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {plans.length === 0 && (
              <Card className="p-6 col-span-3 text-ink-muted">
                No plans configured yet. Ask your admin to create plans at Admin → Subscription Plans.
              </Card>
            )}
            {plans.map((p) => {
              const isActive = p.id === activeId;
              const isFree = Number(p.priceMonthlyInr) <= 0;
              return (
                <Card key={p.id} className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold">{p.name}</h4>
                    {isActive && <span className="chip chip-solid-navy text-[10px]">CURRENT</span>}
                  </div>
                  <div className="text-2xl font-semibold mb-1">
                    ₹{p.priceMonthlyInr}<span className="text-sm font-normal text-ink-muted">/mo</span>
                  </div>
                  <div className="text-xs uppercase tracking-wider text-ink-muted mb-3">{p.tier}</div>
                  <div className="text-xs text-ink-muted mb-4 space-y-0.5">
                    {p.allowedModules.length > 0 ? (
                      <div>Modules: {p.allowedModules.join(", ")}</div>
                    ) : (
                      <div>No modules enabled</div>
                    )}
                    <div>{p.allowedSubmodules.length} submodules</div>
                  </div>
                  {isActive ? (
                    <Button variant="secondary" size="sm" disabled>Active</Button>
                  ) : isFree ? (
                    <Button variant="secondary" size="sm" disabled>Free — contact admin to switch</Button>
                  ) : (
                    <Button
                      variant="brand"
                      size="sm"
                      onClick={() => subscribe(p)}
                      disabled={paying !== null}
                    >
                      {paying === p.id ? "Opening checkout…" : `Subscribe for ₹${p.priceMonthlyInr}`}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>

          <h3 className="section-title mb-3">Payment history</h3>
          <Card className="p-0 overflow-x-auto">
            {invoices.length === 0 ? (
              <div className="p-6 text-sm text-ink-muted">No payments yet.</div>
            ) : (
              <table className="table w-full">
                <thead>
                  <tr>
                    <th className="text-start">Date</th>
                    <th className="text-start">Amount</th>
                    <th className="text-start">Status</th>
                    <th className="text-start">Razorpay Payment ID</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="text-sm">{new Date(i.createdAt).toLocaleString()}</td>
                      <td className="text-sm">₹{i.amountInr} {i.currency}</td>
                      <td>
                        <span className={`text-xs font-semibold ${
                          i.status === "paid" ? "text-green-700" :
                          i.status === "failed" ? "text-red-700" :
                          "text-ink-muted"
                        }`}>
                          {i.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-xs font-mono text-ink-muted">{i.upstreamPaymentId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
