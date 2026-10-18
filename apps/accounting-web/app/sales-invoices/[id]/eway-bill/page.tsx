"use client";

// E-way bill generator for a single Sales Invoice. Collects transport
// details (mode, vehicle, distance, transporter) that don't live on the
// invoice, then POSTs to /gst/eway-bill/:invoiceId to build the NIC-spec
// JSON payload. The payload is shown for review + downloaded as a .json
// file the operator can upload to the government portal (or proxy via a
// GSP integration).

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  Toast,
} from "../../../../components/ui";

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

const SUB_SUPPLY = [
  { value: "1", label: "Supply" },
  { value: "3", label: "Export" },
  { value: "4", label: "Job Work" },
  { value: "5", label: "For Own Use" },
  { value: "7", label: "Sales Return" },
  { value: "8", label: "Others" },
];

const TRANSACTION_TYPE = [
  { value: 1, label: "Regular" },
  { value: 2, label: "Bill To - Ship To" },
  { value: 3, label: "Bill From - Dispatch From" },
  { value: 4, label: "Combination" },
];

const TRANS_MODE = [
  { value: 1, label: "Road" },
  { value: 2, label: "Rail" },
  { value: 3, label: "Air" },
  { value: 4, label: "Ship" },
];

interface FormState {
  subSupplyType: string;
  transactionType: number;
  transMode: number;
  transDistance: string;
  transporterId: string;
  transporterName: string;
  vehicleNo: string;
  transDocNo: string;
  transDocDate: string;
}

const emptyForm: FormState = {
  subSupplyType: "1",
  transactionType: 1,
  transMode: 1,
  transDistance: "",
  transporterId: "",
  transporterName: "",
  vehicleNo: "",
  transDocNo: "",
  transDocDate: "",
};

interface Invoice {
  id: string;
  name: string;
  status: string;
  customer: { customerName: string; gstin: string | null };
  grandTotal: string;
  currency: string;
}

export default function EwayBillPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [payload, setPayload] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    api
      .get<Invoice>(`/sales-invoices/${params.id}`)
      .then(setInvoice)
      .catch((e: Error) => setError(e.message));
  }, [params?.id]);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      const body = {
        subSupplyType: form.subSupplyType,
        transactionType: form.transactionType,
        transMode: form.transMode,
        transDistance: Number(form.transDistance) || 0,
        transporterId: form.transporterId || null,
        transporterName: form.transporterName || null,
        vehicleNo: form.vehicleNo || null,
        transDocNo: form.transDocNo || null,
        transDocDate: form.transDocDate || null,
      };
      const r = await api.post<{ payload: unknown; invoiceName: string }>(
        `/gst/eway-bill/${params!.id}`,
        body,
      );
      setPayload(r.payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!invoice) return;
    // Re-hit the endpoint with ?download=1 for a file save (attachment
    // disposition). Passes the same form state so the payload is identical.
    const body = {
      subSupplyType: form.subSupplyType,
      transactionType: form.transactionType,
      transMode: form.transMode,
      transDistance: Number(form.transDistance) || 0,
      transporterId: form.transporterId || null,
      transporterName: form.transporterName || null,
      vehicleNo: form.vehicleNo || null,
      transDocNo: form.transDocNo || null,
      transDocDate: form.transDocDate || null,
    };
    const token =
      typeof window !== "undefined"
        ? JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""
        : "";
    fetch(`${ACC}/gst/eway-bill/${invoice.id}?download=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? r.statusText);
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `eway-${invoice.name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch((e: Error) => setError(e.message));
  }

  return (
    <>
      <PageHeader
        title="Generate E-way Bill"
        subtitle={invoice ? `${invoice.name} · ${invoice.customer.customerName}` : "Loading…"}
        breadcrumb={[
          { label: "Sales Invoices", href: "/sales-invoices" },
          {
            label: invoice?.name ?? "…",
            href: invoice ? `/sales-invoices/${invoice.id}` : "#",
          },
          { label: "E-way Bill" },
        ]}
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <FormField label="Sub-supply type" required>
            <select
              className="input"
              value={form.subSupplyType}
              onChange={(e) => setForm({ ...form, subSupplyType: e.target.value })}
            >
              {SUB_SUPPLY.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Transaction type" required>
            <select
              className="input"
              value={form.transactionType}
              onChange={(e) =>
                setForm({ ...form, transactionType: Number(e.target.value) })
              }
            >
              {TRANSACTION_TYPE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Transport mode" required>
            <select
              className="input"
              value={form.transMode}
              onChange={(e) => setForm({ ...form, transMode: Number(e.target.value) })}
            >
              {TRANS_MODE.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Distance (km)" required>
            <input
              type="number"
              min={1}
              className="input tabular-nums"
              value={form.transDistance}
              onChange={(e) => setForm({ ...form, transDistance: e.target.value })}
            />
          </FormField>
          {form.transMode === 1 && (
            <FormField label="Vehicle no.">
              <input
                className="input font-mono"
                placeholder="MH04AB1234"
                value={form.vehicleNo}
                onChange={(e) =>
                  setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })
                }
              />
            </FormField>
          )}
          {form.transMode !== 1 && (
            <>
              <FormField label="Transport doc no.">
                <input
                  className="input"
                  placeholder="LR / AWB / BL number"
                  value={form.transDocNo}
                  onChange={(e) => setForm({ ...form, transDocNo: e.target.value })}
                />
              </FormField>
              <FormField label="Transport doc date">
                <input
                  type="date"
                  className="input"
                  value={form.transDocDate}
                  onChange={(e) => setForm({ ...form, transDocDate: e.target.value })}
                />
              </FormField>
            </>
          )}
          <FormField label="Transporter GSTIN">
            <input
              className="input font-mono text-xs"
              maxLength={15}
              value={form.transporterId}
              onChange={(e) =>
                setForm({ ...form, transporterId: e.target.value.toUpperCase() })
              }
            />
          </FormField>
          <FormField label="Transporter name">
            <input
              className="input"
              value={form.transporterName}
              onChange={(e) => setForm({ ...form, transporterName: e.target.value })}
            />
          </FormField>
        </div>
        <div className="flex gap-2 pt-2">
          <Button
            variant="brand"
            onClick={generate}
            disabled={busy || !form.transDistance}
          >
            {busy ? "Generating…" : "Preview payload"}
          </Button>
          <Button
            variant="secondary"
            onClick={download}
            disabled={busy || !form.transDistance}
          >
            Download JSON
          </Button>
          <Button variant="ghost" onClick={() => router.back()}>
            Back
          </Button>
        </div>
        <p className="text-xs text-ink-muted">
          The downloaded JSON follows the NIC e-way bill spec v1.03. Upload it
          to the government e-way bill portal, or proxy via a registered GSP.
          Live portal submission is not wired in this build.
        </p>
      </Card>

      {payload !== null && (
        <Card className="mt-6 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">
              Payload preview
            </h3>
            <button
              onClick={() => setPayload(null)}
              className="text-xs text-ink-muted hover:text-ink"
            >
              Close
            </button>
          </div>
          <pre className="text-xs bg-surface-2 p-3 rounded overflow-x-auto max-h-96">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </Card>
      )}
    </>
  );
}
