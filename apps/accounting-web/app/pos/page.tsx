"use client";

// Cashier register. Single page with three states:
//   1. No active session → "Open session" form.
//   2. Active session → item grid + cart + Pay button.
//   3. Pay clicked → payment modal (split tender + Razorpay).
// After a successful checkout, cart clears and the receipt PDF opens in a
// new tab so the cashier can send it to the receipt printer.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { PageHeader, Button, Card } from "../../components/ui";

type PaymentMethod = {
  mode: "Cash" | "Card" | "UPI" | "Razorpay";
  accountId: string;
  isDefault?: boolean;
  integrationId?: string | null;
};

type Profile = {
  id: string;
  title: string;
  name: string;
  warehouseId: string | null;
  priceListId: string | null;
  defaultCustomerId: string | null;
  paymentMethods: PaymentMethod[];
  warehouse?: { warehouseName: string } | null;
  priceList?: { name: string; currency: string } | null;
  defaultCustomer?: { customerName: string } | null;
};

type ActiveSession = {
  id: string;
  name: string;
  posProfile: Profile;
} | null;

type Item = {
  id: string;
  itemCode: string;
  itemName: string;
  standardRate: string | number;
  defaultSalesTaxTemplateId?: string | null;
};

type Customer = { id: string; customerName: string };

type CartLine = {
  itemId: string;
  itemCode: string;
  itemName: string;
  qty: number;
  rate: number;
  taxTemplateId?: string | null;
};

export default function POSPage() {
  const [active, setActive] = useState<ActiveSession>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<ActiveSession>("/pos-openings/mine/active")
      .then((s) => alive && setActive(s))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className="p-6 text-ink-muted">Loading…</div>;
  if (error) return <div className="p-6 text-danger">{error}</div>;

  return active ? (
    <Cashier session={active} onSessionEnded={() => setActive(null)} />
  ) : (
    <OpenSession onOpened={setActive} />
  );
}

// ── 1. Session-open form ─────────────────────────────────────────────────
function OpenSession({ onOpened }: { onOpened: (s: ActiveSession) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [openingAmounts, setOpeningAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Profile[]>("/pos-profiles")
      .then((rows) => {
        const enabled = rows.filter((r) => !("disabled" in r) || !(r as { disabled?: boolean }).disabled);
        setProfiles(enabled);
        if (enabled.length > 0) setSelectedId(enabled[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const profile = profiles.find((p) => p.id === selectedId);

  async function open() {
    if (!profile) return;
    setSubmitting(true);
    setError(null);
    try {
      const openingBalances = profile.paymentMethods.map((m) => ({
        mode: m.mode,
        amount: Number(openingAmounts[m.mode] ?? "0") || 0,
      }));
      await api.post<{ id: string; name: string }>("/pos-openings", {
        posProfileId: profile.id,
        openingBalances,
        notes: notes || null,
      });
      // Refetch with the full profile joined.
      const active = await api.get<ActiveSession>("/pos-openings/mine/active");
      onOpened(active);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-xl">
      <PageHeader
        title="Open POS session"
        subtitle="Pick a terminal and declare the opening drawer float."
      />
      {error && <div className="mt-2 text-danger">{error}</div>}
      <Card className="p-4 mt-4 space-y-4">
        <div>
          <label className="block text-xs text-ink-muted mb-1">POS Profile</label>
          <select
            className="input w-full"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {profiles.length === 0 && <option value="">No profiles configured</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {profile && (
          <>
            <div className="text-xs text-ink-muted">
              Warehouse: {profile.warehouse?.warehouseName ?? "—"} · Price list:{" "}
              {profile.priceList?.name ?? "—"} · Default customer:{" "}
              {profile.defaultCustomer?.customerName ?? "—"}
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                Opening balance per method
              </label>
              <div className="space-y-2">
                {profile.paymentMethods.map((m) => (
                  <div key={m.mode} className="flex items-center gap-2">
                    <span className="w-20 text-sm">{m.mode}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input flex-1"
                      value={openingAmounts[m.mode] ?? ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        setOpeningAmounts((prev) => ({ ...prev, [m.mode]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-ink-muted mb-1">Notes (optional)</label>
              <input
                className="input w-full"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button
              onClick={open}
              disabled={submitting || !profile}
            >
              {submitting ? "Opening…" : "Open session"}
            </Button>
          </>
        )}
      </Card>
      {profiles.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">
          No POS profiles yet.{" "}
          <Link href="/accounting/pos-profiles" className="text-brand-600 underline">
            Configure one
          </Link>{" "}
          first.
        </p>
      )}
    </div>
  );
}

// ── 2. Cashier register ─────────────────────────────────────────────────
function Cashier({
  session,
  onSessionEnded: _onSessionEnded,
}: {
  session: NonNullable<ActiveSession>;
  onSessionEnded: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>(
    session.posProfile.defaultCustomerId ?? "",
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.get<Item[]>("/items"), api.get<Customer[]>("/customers")]).then(
      ([its, cs]) => {
        setItems(its);
        setCustomers(cs);
        if (!customerId && session.posProfile.defaultCustomerId) {
          setCustomerId(session.posProfile.defaultCustomerId);
        } else if (!customerId && cs.length > 0) {
          setCustomerId(cs[0].id);
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 60);
    return items
      .filter(
        (i) =>
          i.itemCode.toLowerCase().includes(q) ||
          i.itemName.toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [items, search]);

  function addToCart(item: Item) {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          itemCode: item.itemCode,
          itemName: item.itemName,
          qty: 1,
          rate: Number(item.standardRate) || 0,
          taxTemplateId: item.defaultSalesTaxTemplateId ?? null,
        },
      ];
    });
  }

  function updateQty(itemId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
    } else {
      setCart((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l)));
    }
  }

  const subtotal = cart.reduce((s, l) => s + l.qty * l.rate, 0);

  async function endSession() {
    if (!confirm("End the session and start reconciliation?")) return;
    // Cashier lands on the closing form; server enforces that only they can
    // close their own session.
    window.location.href = `/accounting/pos/closing/${session.id}`;
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Item grid */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="flex items-center gap-3 mb-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <span className="text-xs text-ink-muted">
            Session {session.name} · {session.posProfile.title}
          </span>
          <Button variant="ghost" size="sm" onClick={endSession}>
            End session
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {filtered.map((it) => (
            <button
              key={it.id}
              onClick={() => addToCart(it)}
              className="card hover:shadow-md active:scale-[0.98] transition-all p-3 text-start"
            >
              <div className="text-xs text-ink-muted">{it.itemCode}</div>
              <div className="text-sm font-medium truncate">{it.itemName}</div>
              <div className="text-sm mt-1">
                {session.posProfile.priceList?.currency ?? "INR"}{" "}
                {Number(it.standardRate).toFixed(2)}
              </div>
            </button>
          ))}
        </div>
        {filtered.length === 0 && (
          <div className="text-ink-muted mt-8 text-center">No items match.</div>
        )}
      </div>

      {/* Cart */}
      <div className="w-96 border-s bg-surface-2 flex flex-col">
        <div className="p-3 border-b">
          <label className="text-xs text-ink-muted">Customer</label>
          <select
            className="input w-full mt-1"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.customerName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 && (
            <div className="text-ink-muted text-center text-sm py-8">
              Tap items to add.
            </div>
          )}
          {cart.map((l) => (
            <div key={l.itemId} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate">{l.itemName}</div>
                <div className="text-xs text-ink-muted">
                  {l.rate.toFixed(2)} × {l.qty} = {(l.qty * l.rate).toFixed(2)}
                </div>
              </div>
              <input
                type="number"
                className="input w-16"
                min="0"
                step="1"
                value={l.qty}
                onChange={(e) => updateQty(l.itemId, Number(e.target.value))}
              />
              <button
                className="text-ink-muted hover:text-danger"
                onClick={() => updateQty(l.itemId, 0)}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="p-3 border-t">
          <div className="flex justify-between text-sm mb-1">
            <span>Subtotal</span>
            <span>{subtotal.toFixed(2)}</span>
          </div>
          <div className="text-xs text-ink-muted mb-3">
            Taxes computed at checkout.
          </div>
          <Button
            className="w-full"
            disabled={cart.length === 0 || !customerId}
            onClick={() => setPayOpen(true)}
          >
            Pay {subtotal.toFixed(2)}
          </Button>
        </div>
      </div>

      {payOpen && (
        <PaymentModal
          session={session}
          cart={cart}
          customerId={customerId}
          onClose={() => setPayOpen(false)}
          onCompleted={(invoiceId) => {
            setCart([]);
            setPayOpen(false);
            // Open receipt in a new tab. Uses inline disposition so browsers
            // preview PDF — cashier hits Cmd+P to send to thermal printer.
            const base =
              process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ??
              "/api/accounting";
            window.open(`${base}/print/pos-invoices/${invoiceId}`, "_blank");
          }}
        />
      )}
    </div>
  );
}

// ── 3. Payment modal (split tender) ──────────────────────────────────────
function PaymentModal({
  session,
  cart,
  customerId,
  onClose,
  onCompleted,
}: {
  session: NonNullable<ActiveSession>;
  cart: CartLine[];
  customerId: string;
  onClose: () => void;
  onCompleted: (invoiceId: string) => void;
}) {
  const total = cart.reduce((s, l) => s + l.qty * l.rate, 0);
  const [tenderAmounts, setTenderAmounts] = useState<Record<string, string>>({
    // Default the primary (or first) method to the full total.
    ...(() => {
      const primary =
        session.posProfile.paymentMethods.find((m) => m.isDefault) ??
        session.posProfile.paymentMethods[0];
      return primary ? { [primary.mode]: total.toFixed(2) } : {};
    })(),
  });
  const [reference, setReference] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tendered = session.posProfile.paymentMethods.reduce(
    (s, m) => s + (Number(tenderAmounts[m.mode] ?? "0") || 0),
    0,
  );
  const change = tendered - total;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const tenders = session.posProfile.paymentMethods
        .map((m) => ({
          mode: m.mode,
          amount: Number(tenderAmounts[m.mode] ?? "0") || 0,
          reference: reference[m.mode] || null,
        }))
        .filter((t) => t.amount > 0);

      const result = await api.post<{ invoiceId: string; invoiceName: string }>(
        "/pos-invoices/checkout",
        {
          posOpeningId: session.id,
          customerId,
          items: cart.map((l) => ({
            itemId: l.itemId,
            qty: l.qty,
            rate: l.rate,
            taxTemplateId: l.taxTemplateId ?? null,
          })),
          tenders,
        },
      );
      onCompleted(result.invoiceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[420px] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Payment</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>
        <div className="text-2xl font-semibold">Total {total.toFixed(2)}</div>
        <div className="space-y-3">
          {session.posProfile.paymentMethods.map((m) => (
            <div key={m.mode} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-20 text-sm">{m.mode}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input flex-1"
                  placeholder="0.00"
                  value={tenderAmounts[m.mode] ?? ""}
                  onChange={(e) =>
                    setTenderAmounts((prev) => ({ ...prev, [m.mode]: e.target.value }))
                  }
                />
              </div>
              {m.mode !== "Cash" && (
                <input
                  type="text"
                  className="input w-full text-xs"
                  placeholder={
                    m.mode === "Card"
                      ? "Card last 4 / auth code"
                      : m.mode === "UPI"
                        ? "UPI transaction id"
                        : "Razorpay payment id"
                  }
                  value={reference[m.mode] ?? ""}
                  onChange={(e) =>
                    setReference((prev) => ({ ...prev, [m.mode]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm">
          <span>Tendered</span>
          <span>{tendered.toFixed(2)}</span>
        </div>
        <div
          className={`flex justify-between text-sm ${change < 0 ? "text-danger" : "text-brand-600"}`}
        >
          <span>{change < 0 ? "Short" : "Change"}</span>
          <span>{Math.abs(change).toFixed(2)}</span>
        </div>
        {error && <div className="text-danger text-sm">{error}</div>}
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={submit}
            disabled={submitting || Math.abs(change) > 0.01}
          >
            {submitting ? "Posting…" : "Charge"}
          </Button>
        </div>
      </div>
    </div>
  );
}
