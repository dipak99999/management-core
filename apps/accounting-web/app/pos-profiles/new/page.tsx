"use client";

// POS Profile create form. Payment methods are the meat — each row picks a
// mode (Cash/Card/UPI/Razorpay) and the leaf account that method deposits
// into. Razorpay methods additionally pick a TenantIntegration (provider =
// razorpay) whose secrets the checkout uses.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { PageHeader, Card, Button } from "../../../components/ui";

type Account = { id: string; accountName: string; rootType: string; isGroup: boolean };
type Warehouse = { id: string; warehouseName: string };
type PriceList = { id: string; name: string; currency: string; buyingOrSelling: string };
type Customer = { id: string; customerName: string };
type Letterhead = { id: string; name: string };
type Integration = { id: string; name: string; provider: string; isActive: boolean };

type MethodDraft = {
  mode: "Cash" | "Card" | "UPI" | "Razorpay";
  accountId: string;
  isDefault: boolean;
  integrationId: string;
};

export default function POSProfileNew() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [defaultCustomerId, setDefaultCustomerId] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");
  const [letterheadId, setLetterheadId] = useState("");
  const [methods, setMethods] = useState<MethodDraft[]>([
    { mode: "Cash", accountId: "", isDefault: true, integrationId: "" },
  ]);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [letterheads, setLetterheads] = useState<Letterhead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Warehouses live in stock-service — not accounting-service. Cross-fetch
    // via the shell proxy's /api/stock/* rewrite so the warehouse selector
    // populates. All other dropdowns stay on accounting (same base).
    const token = typeof window === "undefined"
      ? ""
      : (() => {
          const raw = window.localStorage.getItem("lumaara.session");
          if (!raw) return "";
          try { return (JSON.parse(raw) as { token?: string }).token ?? ""; }
          catch { return ""; }
        })();
    const warehousesFetch = fetch(
      process.env.NEXT_PUBLIC_STOCK_SERVICE_URL
        ? `${process.env.NEXT_PUBLIC_STOCK_SERVICE_URL}/warehouses`
        : "/api/stock/warehouses",
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
    )
      .then((r) => (r.ok ? (r.json() as Promise<Warehouse[]>) : []))
      .catch(() => [] as Warehouse[]);
    Promise.all([
      warehousesFetch,
      api.get<PriceList[]>("/price-lists").catch(() => []),
      api.get<Customer[]>("/customers").catch(() => []),
      api.get<Letterhead[]>("/letterheads").catch(() => []),
      api.get<Account[]>("/accounts").catch(() => []),
      api.get<Integration[]>("/integrations").catch(() => []),
    ]).then(([w, pl, c, l, a, i]) => {
      setWarehouses(w);
      setPriceLists(pl.filter((p) => p.buyingOrSelling === "Selling"));
      setCustomers(c);
      setLetterheads(l);
      setAccounts(a.filter((ac) => !ac.isGroup));
      setIntegrations(i.filter((integ) => integ.isActive));
    });
  }, []);

  function addMethod() {
    setMethods((prev) => [
      ...prev,
      { mode: "Card", accountId: "", isDefault: false, integrationId: "" },
    ]);
  }
  function removeMethod(idx: number) {
    setMethods((prev) => prev.filter((_, i) => i !== idx));
  }
  function setMethod(idx: number, patch: Partial<MethodDraft>) {
    setMethods((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        // Uncheck other isDefault when this one becomes default.
        if (patch.isDefault) {
          setMethods((old) => old.map((mm, ii) => (ii === idx ? mm : { ...mm, isDefault: false })));
        }
        return { ...m, ...patch };
      }),
    );
  }

  async function save() {
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/pos-profiles", {
        name,
        title,
        warehouseId: warehouseId || null,
        priceListId: priceListId || null,
        defaultCustomerId: defaultCustomerId || null,
        incomeAccountId: incomeAccountId || null,
        letterheadId: letterheadId || null,
        paymentMethods: methods.map((m) => ({
          mode: m.mode,
          accountId: m.accountId,
          isDefault: m.isDefault,
          integrationId: m.mode === "Razorpay" ? m.integrationId || null : null,
        })),
        disabled: false,
      });
      router.push("/pos-profiles");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader
        title="New POS Profile"
        subtitle="Configure a cashier terminal."
      />
      {error && <div className="mt-3 text-danger">{error}</div>}
      <Card className="mt-4 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-ink-muted mb-1">Slug</label>
            <input
              className="input w-full"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="store-main-01"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Title</label>
            <input
              className="input w-full"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Store Main #01"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Warehouse</label>
            <select
              className="input w-full"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              <option value="">—</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.warehouseName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Price list (Selling)</label>
            <select
              className="input w-full"
              value={priceListId}
              onChange={(e) => setPriceListId(e.target.value)}
            >
              <option value="">—</option>
              {priceLists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.currency})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Walk-in customer</label>
            <select
              className="input w-full"
              value={defaultCustomerId}
              onChange={(e) => setDefaultCustomerId(e.target.value)}
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">
              Income account (override)
            </label>
            <select
              className="input w-full"
              value={incomeAccountId}
              onChange={(e) => setIncomeAccountId(e.target.value)}
            >
              <option value="">Tenant default</option>
              {accounts
                .filter((a) => a.rootType === "Income")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-muted mb-1">Letterhead</label>
            <select
              className="input w-full"
              value={letterheadId}
              onChange={(e) => setLetterheadId(e.target.value)}
            >
              <option value="">—</option>
              {letterheads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-t pt-3 mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Payment methods</span>
            <Button size="sm" variant="ghost" onClick={addMethod}>
              + Add method
            </Button>
          </div>
          {methods.map((m, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <select
                className="input col-span-2"
                value={m.mode}
                onChange={(e) => setMethod(idx, { mode: e.target.value as MethodDraft["mode"] })}
              >
                <option>Cash</option>
                <option>Card</option>
                <option>UPI</option>
                <option>Razorpay</option>
              </select>
              <select
                className="input col-span-5"
                value={m.accountId}
                onChange={(e) => setMethod(idx, { accountId: e.target.value })}
              >
                <option value="">Account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountName}
                  </option>
                ))}
              </select>
              {m.mode === "Razorpay" ? (
                <select
                  className="input col-span-3"
                  value={m.integrationId}
                  onChange={(e) => setMethod(idx, { integrationId: e.target.value })}
                >
                  <option value="">Integration…</option>
                  {integrations
                    .filter((i) => i.provider.toLowerCase() === "razorpay")
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                </select>
              ) : (
                <div className="col-span-3" />
              )}
              <label className="col-span-1 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={m.isDefault}
                  onChange={(e) => setMethod(idx, { isDefault: e.target.checked })}
                />
                Default
              </label>
              <button
                className="col-span-1 text-ink-muted hover:text-danger"
                onClick={() => removeMethod(idx)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-3">
          <Button onClick={save} disabled={submitting || !name || !title || methods.length === 0}>
            {submitting ? "Saving…" : "Save profile"}
          </Button>
          <Button variant="ghost" onClick={() => router.push("/pos-profiles")}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
