"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { accountingApi, api } from "../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  SectionHeader,
  Segmented,
  Toast,
  money,
} from "../../../components/ui";
import { AiDraftForm, useOptionalUIBackends, useSmartDefaults } from "@lumaara/web-ui";
import { authApi } from "../../../lib/auth-api";

interface Lead { id: string; name: string; leadName: string; status: string }
interface Customer { id: string; customerName: string }
interface Item { id: string; itemCode: string; itemName: string; standardRate: string }
interface TaxTemplate {
  id: string;
  name: string;
  rate: string | null;
  templateType: string;
  rows: { id: string; description: string; rate: string; accountId: string }[];
}

// Fetch tax templates from accounting-service directly (owner). crm-service
// doesn't own tax masters; adding a read-through there was unnecessary.
async function loadSalesTaxTemplates(): Promise<TaxTemplate[]> {
  const ACC = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
  const raw = localStorage.getItem("lumaara.session");
  const token = raw ? (JSON.parse(raw).token as string) : "";
  const res = await fetch(`${ACC}/tax-templates?type=Sales`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load tax templates (${res.status})`);
  return res.json();
}

interface Line { itemId: string; qty: number; rate: number }
const emptyLine: Line = { itemId: "", qty: 1, rate: 0 };

interface ExistingQ {
  status: string;
  partyType: "Lead" | "Customer";
  leadId: string | null;
  customerId: string | null;
  validTill: string | null;
  taxTemplateId: string | null;
  remarks: string | null;
  items: { itemId: string; qty: string; rate: string }[];
}

function InnerNewQuotationPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [partyType, setPartyType] = useState<"Lead" | "Customer">("Customer");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [partyId, setPartyId] = useState("");
  const [validTill, setValidTill] = useState("");
  // Currency: crm-service defaults to the tenant's base when unset. Options
  // list is owned by accounting-service (Currency is a tenant-scoped
  // enabled-set), so this reaches across services rather than duplicating
  // state. Falls back to a single-entry [base] list on fetch failure so the
  // form still submits.
  const [currency, setCurrency] = useState<string>("");
  const [currencies, setCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [remarks, setRemarks] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([]);
  const [taxTemplateId, setTaxTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Smart defaults: most tenants file repeat quotations for the same handful
  // of customers in a given session. Pre-fill the last picked party so the
  // first field doesn't need re-selection.
  const uiBackends = useOptionalUIBackends();
  const smart = useSmartDefaults<{ partyType: "Lead" | "Customer"; partyId: string }>(
    "crm-web:quotation-create",
    uiBackends?.defaults,
  );
  useEffect(() => {
    if (editId || partyId || !smart.last) return;
    if (smart.last.partyType) setPartyType(smart.last.partyType);
    if (smart.last.partyId) setPartyId(smart.last.partyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smart.last?.partyType, smart.last?.partyId]);

  useEffect(() => {
    api
      .get<Lead[]>("/leads")
      .then((rs) => setLeads(rs.filter((l) => l.status !== "Converted" && l.status !== "Lost")))
      .catch(() => {});
    api.get<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api.get<Item[]>("/items").then(setItems).catch(() => {});
    loadSalesTaxTemplates()
      .then(setTaxTemplates)
      .catch(() => {});
    // Currency options live on accounting-service (Currency is scoped there
    // as a tenant-enabled set). accountingApi shares the same auth + 401 +
    // error-body semantics as `api`, so a stale session redirects to login
    // even from a cross-service call.
    accountingApi
      .get<{ baseCurrency: string; rows: Array<{ code: string; name: string }> }>(
        "/currencies",
      )
      .then((j) => {
        setCurrencies(
          j.rows.length ? j.rows : [{ code: j.baseCurrency, name: j.baseCurrency }],
        );
        // Auto-pick tenant base on a fresh form (skip when editing — the
        // loaded quotation's currency will overwrite anyway).
        if (!editId && !currency) setCurrency(j.baseCurrency);
      })
      .catch(() => {
        // silent — dropdown stays empty; user can proceed with tenant default.
      });
  }, [editId, currency]);

  useEffect(() => {
    if (!editId) return;
    api
      .get<ExistingQ>(`/quotations/${editId}`)
      .then((q) => {
        if (q.status !== "Draft") {
          setError(`Cannot edit quotation in status ${q.status}`);
          return;
        }
        setPartyType(q.partyType);
        setPartyId(q.customerId ?? q.leadId ?? "");
        setValidTill(q.validTill ? q.validTill.slice(0, 10) : "");
        setTaxTemplateId(q.taxTemplateId ?? "");
        setRemarks(q.remarks ?? "");
        setLines(
          q.items.length
            ? q.items.map((it) => ({
                itemId: it.itemId,
                qty: Number(it.qty),
                rate: Number(it.rate),
              }))
            : [{ ...emptyLine }],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  const parties = partyType === "Lead" ? leads : customers;

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function onItemChange(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(idx, { itemId, rate: item ? Number(item.standardRate) : 0 });
  }

  const netTotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const selectedTax = taxTemplates.find((t) => t.id === taxTemplateId) ?? null;
  const taxRows = selectedTax
    ? (selectedTax.rows.length > 0
        ? selectedTax.rows.map((r) => ({
            description: r.description,
            rate: Number(r.rate),
            amount: netTotal * (Number(r.rate) / 100),
          }))
        : selectedTax.rate != null
          ? [
              {
                description: `${selectedTax.name} @ ${Number(selectedTax.rate).toFixed(2)}%`,
                rate: Number(selectedTax.rate),
                amount: netTotal * (Number(selectedTax.rate) / 100),
              },
            ]
          : [])
    : [];
  const totalTaxes = taxRows.reduce((s, r) => s + r.amount, 0);
  const grandTotal = netTotal + totalTaxes;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = lines.filter((l) => l.itemId);
    if (validItems.length === 0) {
      setError("Add at least one item line before saving.");
      return;
    }
    if (!partyId) {
      setError(`Pick a ${partyType.toLowerCase()} before saving.`);
      return;
    }
    setBusy(true);
    try {
      const body = {
        partyType,
        leadId: partyType === "Lead" ? partyId : undefined,
        customerId: partyType === "Customer" ? partyId : undefined,
        validTill: validTill ? new Date(validTill).toISOString() : undefined,
        taxTemplateId: taxTemplateId || undefined,
        currency: currency.trim() ? currency.trim().toUpperCase() : undefined,
        remarks,
        items: validItems.map((l) => ({ ...l })),
      };
      if (editId) {
        await api.put(`/quotations/${editId}`, body);
        location.href = `/crm/quotations/${editId}`;
      } else {
        await api.post("/quotations", body);
        smart.remember({ partyType, partyId });
        location.href = "/crm/quotations";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-8 max-w-3xl space-y-6">
      <PageHeader
        breadcrumb={[
          { label: "Quotations", href: "/crm/quotations" },
          { label: editId ? "Edit" : "New" },
        ]}
        title={editId ? "Edit Quotation" : "New Quotation"}
        actions={
          <Button
            variant="secondary"
            onClick={() => history.back()}
            type="button"
          >
            ← Back
          </Button>
        }
      />

      {error && (
        <Toast kind="error" message={error} onDismiss={() => setError(null)} />
      )}

      <AiDraftForm
        scope="crm-web:quotation-draft"
        doctypeHint="Sales quotation to a customer or lead. `lines` is an array of { itemCode, itemName, qty, rate }. Dates are YYYY-MM-DD."
        placeholder="/ai Quote 10× SKU-WIDGET for Acme Industries, valid 30 days"
        fields={["customerName", "leadName", "validTill", "currency", "remarks", "lines"]}
        before={{
          partyType,
          partyId: partyId || null,
          validTill: validTill || null,
          currency: currency || null,
          remarks: remarks || null,
          lines: lines
            .filter((l) => l.itemId)
            .map((l) => {
              const it = items.find((x) => x.id === l.itemId);
              return {
                itemCode: it?.itemCode,
                itemName: it?.itemName,
                qty: l.qty,
                rate: l.rate,
              };
            }),
        }}
        post={(path, body) => authApi.post(path, body)}
        apply={(rows) => {
          for (const r of rows) {
            const after = r.after ?? "";
            if (r.field === "customerName" && typeof after === "string") {
              const match = customers.find(
                (c) => c.customerName.toLowerCase() === after.toLowerCase(),
              );
              if (match) { setPartyType("Customer"); setPartyId(match.id); }
            }
            if (r.field === "leadName" && typeof after === "string") {
              const match = leads.find(
                (l) => l.leadName.toLowerCase() === after.toLowerCase(),
              );
              if (match) { setPartyType("Lead"); setPartyId(match.id); }
            }
            if (r.field === "validTill" && typeof after === "string") setValidTill(after);
            if (r.field === "currency" && typeof after === "string") setCurrency(after);
            if (r.field === "remarks" && typeof after === "string") setRemarks(after);
            if (r.field === "lines") {
              try {
                const parsed = typeof after === "string" ? JSON.parse(after) : after;
                if (Array.isArray(parsed)) {
                  const resolved: Line[] = parsed
                    .map((l: { itemCode?: string; qty?: number; rate?: number }) => {
                      const found = l.itemCode
                        ? items.find(
                            (it) => it.itemCode.toUpperCase() === l.itemCode!.toUpperCase(),
                          )
                        : undefined;
                      if (!found) return null;
                      return {
                        itemId: found.id,
                        qty: Number(l.qty ?? 1),
                        rate: Number(l.rate ?? found.standardRate ?? 0),
                      };
                    })
                    .filter((l): l is Line => l !== null);
                  if (resolved.length > 0) setLines(resolved);
                }
              } catch { /* malformed JSON */ }
            }
          }
        }}
      />

      <form onSubmit={submit}>
        <Card className="p-5 space-y-4">
          <Segmented<"Customer" | "Lead">
            value={partyType}
            onChange={(v) => {
              setPartyType(v);
              setPartyId("");
            }}
            options={[
              { value: "Customer", label: "To Customer" },
              { value: "Lead", label: "To Lead" },
            ]}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField label={partyType} required>
              <select
                required
                className="input"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">Select…</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {"customerName" in p
                      ? p.customerName
                      : `${p.name} — ${p.leadName}`}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Valid till">
              <input
                type="date"
                className="input"
                value={validTill}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setValidTill(e.target.value)}
              />
            </FormField>
            <FormField label="Currency">
              <select
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {currencies.length === 0 && <option value="">— Loading —</option>}
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div>
            <SectionHeader title="Line items" />
            <div className="table-wrap overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: 100 }}>Qty</th>
                    <th style={{ width: 120 }}>Rate</th>
                    <th className="text-end" style={{ width: 120 }}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td>
                        <select
                          className="input"
                          value={l.itemId}
                          onChange={(e) => onItemChange(idx, e.target.value)}
                        >
                          <option value="">Select…</option>
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.itemCode} — {i.itemName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min={0.0001}
                          className="input"
                          value={l.qty}
                          onChange={(e) =>
                            updateLine(idx, { qty: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          className="input"
                          value={l.rate}
                          onChange={(e) =>
                            updateLine(idx, { rate: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td className="text-end tabular-nums">
                        {money(l.qty * l.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setLines([...lines, { ...emptyLine }])}
              className="mt-2 text-brand-600"
            >
              + Add line
            </Button>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-sm text-brew hover:underline"
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? "Hide advanced options" : "Show advanced options (tax template)"}
          </button>
          {showAdvanced && (
          <FormField label="Tax template (optional)">
            <select
              className="input"
              value={taxTemplateId}
              onChange={(e) => setTaxTemplateId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxTemplates.map((t) => {
                const total =
                  t.rows.length > 0
                    ? t.rows.reduce((s, r) => s + Number(r.rate), 0)
                    : Number(t.rate ?? 0);
                const label =
                  t.rows.length > 1
                    ? ` (${t.rows.length} rows, ${total.toFixed(2)}%)`
                    : ` (${total.toFixed(2)}%)`;
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {label}
                  </option>
                );
              })}
            </select>
          </FormField>
          )}

          <FormField label="Remarks">
            <textarea
              className="input"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>

          <div className="flex items-center justify-between border-t border-ink-muted/10 pt-3">
            <div className="text-sm space-y-0.5 text-end w-64">
              <div className="flex justify-between">
                <span className="text-ink-muted">Net total:</span>
                <span className="tabular-nums">{money(netTotal)}</span>
              </div>
              {taxRows.map((r, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-ink-muted">{r.description}:</span>
                  <span className="tabular-nums">{money(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between font-semibold border-t border-ink-muted/10 pt-1">
                <span>Grand total:</span>
                <span className="tabular-nums">{money(grandTotal)}</span>
              </div>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !partyId}
            >
              {busy ? "Saving…" : "Save Quotation"}
            </Button>
          </div>
        </Card>
      </form>
    </main>
  );
}

export default function NewQuotationPage() {
  return (
    <Suspense fallback={null}>
      <InnerNewQuotationPage />
    </Suspense>
  );
}
