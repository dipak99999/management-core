"use client";

import { useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { accApi, loadSession } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FilterBar,
  FormField,
  PageHeader,
  Segmented,
  SectionHeader,
  Skeleton,
  StatusBadge,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface Invoice {
  id: string;
  name: string;
  postingDate: string;
  dueDate: string | null;
  grandTotal: string;
  outstandingAmt: string;
  status: string;
  currency?: string;
}

const ACC =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.split(",")[1] ?? "");
    };
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

type Tab = "all" | "outstanding" | "overdue" | "paid";

export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    invoiceId: "",
    paidAmount: "",
    reference: "",
    modeOfPayment: "Bank" as "Bank" | "UPI" | "Card" | "Cash",
    remarks: "",
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [isCustomer, setIsCustomer] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [showUploader, setShowUploader] = useState(false);

  async function load() {
    try {
      setRows(await accApi.get<Invoice[]>("/portal/invoices"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      window.location.href = "/login";
      return;
    }
    setIsCustomer(s.user.partyType === "Customer");
    load();
  }, []);

  useListPageCommands({
    singular: "Invoice",
    plural: "Invoices",
    refresh: load,
  });
  async function downloadPdf(id: string) {
    const s = loadSession();
    if (!s) return;
    const r = await fetch(`${ACC}/portal/invoices/${id}/pdf?download=1`, {
      headers: { authorization: `Bearer ${s.token}` },
    });
    if (!r.ok) {
      setError(`PDF download failed (${r.status})`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function payRazorpay(invId: string) {
    setPayingId(invId);
    setError(null);
    setMsg(null);
    let modalOpened = false;
    try {
      const r = await accApi.post<{
        keyId: string;
        orderId: string;
        amount: number;
        currency: string;
        receipt: string;
      }>("/portal/checkout/razorpay/order", { invoiceId: invId });

      const scriptId = "razorpay-checkout-js";
      if (!document.getElementById(scriptId)) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.id = scriptId;
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load Razorpay"));
          document.body.appendChild(s);
        });
      }
      const w = window as unknown as {
        Razorpay: new (opts: Record<string, unknown>) => { open: () => void };
      };
      const rz = new w.Razorpay({
        key: r.keyId,
        order_id: r.orderId,
        amount: r.amount,
        currency: r.currency,
        name: "Lumaara",
        description: r.receipt,
        // Razorpay fires modal.ondismiss when the user closes the popup
        // without paying. Reset paying state so the button becomes clickable
        // again instead of showing an indefinite "Paying…" spinner.
        modal: {
          ondismiss: () => setPayingId(null),
        },
        handler: async (resp: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const v = await accApi.post<{ name: string }>(
              "/portal/checkout/razorpay/verify",
              {
                invoiceId: invId,
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
                amount: r.amount / 100,
              },
            );
            setMsg(`Payment received — receipt ${v.name}`);
            load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Verification failed");
          } finally {
            // Payment completed (or verify failed) — either way, this
            // invoice is no longer "paying". Match the ondismiss handler.
            setPayingId(null);
          }
        },
      });
      rz.open();
      modalOpened = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      // Only reset here if the modal never opened; otherwise the modal's
      // ondismiss / handler owns the reset (they fire after the user acts).
      if (!modalOpened) setPayingId(null);
    }
  }

  async function payStripe(invId: string) {
    setPayingId(invId);
    setError(null);
    setMsg(null);
    try {
      const r = await accApi.post<{
        publishableKey: string | null;
        clientSecret: string;
      }>("/portal/checkout/stripe/intent", { invoiceId: invId });
      if (!r.publishableKey) {
        setError("Stripe publishableKey missing in tenant integration");
        return;
      }
      if (!document.getElementById("stripe-js")) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.id = "stripe-js";
          s.src = "https://js.stripe.com/v3/";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load Stripe"));
          document.body.appendChild(s);
        });
      }
      const w = window as unknown as {
        Stripe: (key: string) => {
          confirmCardPayment: (secret: string) => Promise<{
            paymentIntent?: { status: string };
            error?: { message: string };
          }>;
        };
      };
      const stripe = w.Stripe(r.publishableKey);
      const res = await stripe.confirmCardPayment(r.clientSecret);
      if (res.error) {
        setError(res.error.message);
      } else if (res.paymentIntent?.status === "succeeded") {
        setMsg("Payment succeeded — receipt will appear once staff confirms");
        load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPayingId(null);
    }
  }

  async function uploadPayment(e: React.FormEvent) {
    e.preventDefault();
    setUploading(true);
    setError(null);
    setMsg(null);
    try {
      const attachment = proofFile
        ? {
            filename: proofFile.name,
            mimeType: proofFile.type || "application/octet-stream",
            base64: await fileToBase64(proofFile),
          }
        : null;
      const r = await accApi.post<{ name: string }>("/portal/payments", {
        invoiceId: uploadForm.invoiceId || null,
        paidAmount: Number(uploadForm.paidAmount),
        reference: uploadForm.reference,
        modeOfPayment: uploadForm.modeOfPayment,
        remarks: uploadForm.remarks || null,
        attachment,
      });
      setMsg(`Submitted ${r.name} — pending staff review`);
      setUploadForm({
        invoiceId: "",
        paidAmount: "",
        reference: "",
        modeOfPayment: "Bank",
        remarks: "",
      });
      setProofFile(null);
      setShowUploader(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setUploading(false);
    }
  }

  const counts = useMemo(() => {
    const list = rows ?? [];
    const now = Date.now();
    let outstanding = 0;
    let overdue = 0;
    let paid = 0;
    for (const r of list) {
      const out = Number(r.outstandingAmt);
      const isOverdue =
        r.dueDate && new Date(r.dueDate).getTime() < now && out > 0;
      if (out > 0) outstanding += 1;
      if (isOverdue) overdue += 1;
      if (out === 0 && Number(r.grandTotal) > 0) paid += 1;
    }
    return {
      all: list.length,
      outstanding,
      overdue,
      paid,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return list.filter((r) => {
      const out = Number(r.outstandingAmt);
      if (tab === "outstanding" && out <= 0) return false;
      if (tab === "paid" && (out !== 0 || Number(r.grandTotal) === 0))
        return false;
      if (tab === "overdue") {
        const isOverdue =
          r.dueDate && new Date(r.dueDate).getTime() < now && out > 0;
        if (!isOverdue) return false;
      }
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, tab, search]);

  const totals = useMemo(() => {
    let outstanding = 0;
    let grand = 0;
    for (const r of filtered) {
      outstanding += Number(r.outstandingAmt);
      grand += Number(r.grandTotal);
    }
    return { outstanding, grand };
  }, [filtered]);

  const label = isCustomer ? "Invoices" : "Bills";

  const columns: Column<Invoice>[] = [
    {
      header: "Number",
      cell: (r) => <span className="font-mono text-sm text-ink">{r.name}</span>,
    },
    { header: "Issued", cell: (r) => dateShort(r.postingDate) },
    {
      header: "Due",
      cell: (r) => {
        const out = Number(r.outstandingAmt);
        const overdue =
          isCustomer &&
          r.dueDate &&
          new Date(r.dueDate).getTime() < Date.now() &&
          out > 0;
        return (
          <span
            className={
              overdue ? "text-red-700 font-medium" : "text-ink-soft"
            }
          >
            {dateShort(r.dueDate)}
          </span>
        );
      },
    },
    {
      header: "Total",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {money(Number(r.grandTotal), r.currency)}
        </span>
      ),
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (r) => {
        const out = Number(r.outstandingAmt);
        return (
          <span
            className={`tabular-nums ${out > 0 ? "text-ink font-medium" : "text-ink-muted"}`}
          >
            {money(out, r.currency)}
          </span>
        );
      },
    },
    { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      header: "",
      align: "right",
      cell: (r) => {
        const out = Number(r.outstandingAmt);
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => downloadPdf(r.id)}
            >
              PDF
            </Button>
            {isCustomer && out > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={payingId === r.id}
                  onClick={() => payRazorpay(r.id)}
                >
                  Razorpay
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={payingId === r.id}
                  onClick={() => payStripe(r.id)}
                >
                  Stripe
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  if (rows === null && !error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Home", href: "/" }, { label }]}
          title="Loading…"
        />
        <Skeleton className="h-12 w-full" rounded="rounded-lg" />
        <Skeleton className="h-64 w-full" rounded="rounded-lg" />
      </main>
    );
  }

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label }]}
        title={label}
        subtitle={
          isCustomer
            ? "Download PDFs, pay online, or record a bank-transfer reference."
            : "Bills you have submitted against purchase orders."
        }
        actions={
          isCustomer ? (
            <Button
              variant="primary"
              type="button"
              onClick={() => setShowUploader((s) => !s)}
            >
              {showUploader ? "Cancel upload" : "+ Record payment"}
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Toast
          kind="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {msg && (
        <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
      )}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: `Search ${label.toLowerCase()}…`,
        }}
        filters={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "All", count: counts.all },
              {
                value: "outstanding",
                label: "Outstanding",
                count: counts.outstanding,
              },
              { value: "overdue", label: "Overdue", count: counts.overdue },
              { value: "paid", label: "Paid", count: counts.paid },
            ]}
          />
        }
        actions={<SavedViewsControls listKey="portal-web:invoices" current={{ search, tab }} onApply={(fv) => { setSearch(fv.search); setTab(fv.tab); }} />}
      />

      <DataTable<Invoice>
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        empty={{
          title: `No ${label.toLowerCase()} to show`,
          description:
            tab === "all"
              ? "You have no records yet."
              : "Try switching the tab or clearing the search.",
        }}
      />

      {filtered.length > 0 && (
        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Rows
              </div>
              <div className="font-semibold text-ink mt-0.5 tabular-nums">
                {filtered.length}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Total billed
              </div>
              <div className="font-semibold text-ink mt-0.5 tabular-nums">
                {money(totals.grand)}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                Total outstanding
              </div>
              <div
                className={`font-semibold mt-0.5 tabular-nums ${
                  totals.outstanding > 0 ? "text-amber-700" : "text-ink"
                }`}
              >
                {money(totals.outstanding)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {isCustomer && showUploader && (
        <Card className="p-5 max-w-xl">
          <SectionHeader title="Record a payment" />
          <p className="text-xs text-ink-muted mb-4">
            Submit a payment reference (bank transfer / UPI). Staff will review
            and post it against your account. Optionally attach a payment
            screenshot or receipt.
          </p>
          <form onSubmit={uploadPayment} className="space-y-3">
            <FormField label="Apply to invoice">
              <select
                className="input"
                value={uploadForm.invoiceId}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, invoiceId: e.target.value })
                }
              >
                <option value="">On-account (unapplied)…</option>
                {(rows ?? [])
                  .filter((r) => Number(r.outstandingAmt) > 0)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {money(Number(r.outstandingAmt), r.currency)}{" "}
                      outstanding
                    </option>
                  ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Amount" required>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="input tabular-nums"
                  value={uploadForm.paidAmount}
                  onChange={(e) =>
                    setUploadForm({
                      ...uploadForm,
                      paidAmount: e.target.value,
                    })
                  }
                  required
                />
              </FormField>
              <FormField label="Mode" required>
                <select
                  className="input"
                  value={uploadForm.modeOfPayment}
                  onChange={(e) =>
                    setUploadForm({
                      ...uploadForm,
                      modeOfPayment: e.target.value as
                        | "Bank"
                        | "UPI"
                        | "Card"
                        | "Cash",
                    })
                  }
                >
                  <option>Bank</option>
                  <option>UPI</option>
                  <option>Card</option>
                  <option>Cash</option>
                </select>
              </FormField>
            </div>
            <FormField label="Reference (UTR / txn id)" required>
              <input
                className="input"
                value={uploadForm.reference}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, reference: e.target.value })
                }
                required
              />
            </FormField>
            <FormField label="Remarks (optional)">
              <input
                className="input"
                value={uploadForm.remarks}
                onChange={(e) =>
                  setUploadForm({ ...uploadForm, remarks: e.target.value })
                }
              />
            </FormField>
            <FormField
              label="Attach payment proof (optional)"
              hint="Screenshot or PDF receipt"
            >
              <input
                type="file"
                className="text-sm"
                accept="image/*,application/pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              />
            </FormField>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setShowUploader(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={uploading}>
                {uploading ? "Submitting…" : "Submit payment"}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </main>
  );
}
