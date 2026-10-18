"use client";

// Scan a receipt image / PDF → draft Expense Claim.
//
// Flow:
//   1. User clicks "Scan receipt" → file picker opens
//   2. File is read as base64, posted to /ai/extract-receipt
//   3. Shows a preview drawer with the extracted fields (merchant,
//      amount, date, category, description) — operator can edit any
//      field before committing
//   4. On "Save as draft claim" we POST to /expense-claims the normal
//      way; no privileged create path. If anything goes wrong the user
//      sees a toast + can still fall back to the manual form.

import { useState } from "react";
import { api } from "../lib/api";
import { showToast } from "../lib/toast";
import { Button, Drawer, FormField } from "./ui";

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface ExtractedReceipt {
  merchantName: string;
  category: string;
  receiptDate: string | null;
  currency: string;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  grandTotal: number;
  description: string;
  lines: Array<{ description: string; amount: number }>;
}
interface ExtractResponse {
  job: { id: string };
  extracted: ExtractedReceipt;
  warnings: string[];
}

function tokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.session");
  if (!raw) return null;
  try { return (JSON.parse(raw) as { token?: string }).token ?? null; } catch { return null; }
}

async function readAsBase64(file: File): Promise<{ base64Data: string; mimeType: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64Data: btoa(binary), mimeType: file.type || "application/octet-stream" };
}

export function ScanReceiptButton({
  employees,
  claimTypes,
  onCreated,
}: {
  employees: Array<{ id: string; employeeName: string }>;
  claimTypes: Array<{ id: string; typeName: string }>;
  onCreated: () => void;
}) {
  const [extracting, setExtracting] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extract, setExtract] = useState<ExtractedReceipt | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [claimTypeId, setClaimTypeId] = useState(claimTypes[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    const token = tokenFromStorage();
    if (!token) { showToast("Not authenticated", "error"); return; }
    setExtracting(true);
    try {
      const { base64Data, mimeType } = await readAsBase64(file);
      const r = await fetch(`${ACCOUNTING_URL}/ai/extract-receipt`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachmentBase64: base64Data, attachmentMimeType: mimeType }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        showToast(`Receipt scan failed: ${body.error ?? r.status}`, "error");
        return;
      }
      const data = (await r.json()) as ExtractResponse;
      setExtract(data.extracted);
      setWarnings(data.warnings ?? []);
      setDrawerOpen(true);
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    if (!extract) return;
    if (!employeeId) { showToast("Pick an employee", "error"); return; }
    setSaving(true);
    try {
      await api.post("/expense-claims", {
        employeeId,
        postingDate: extract.receiptDate ?? new Date().toISOString().slice(0, 10),
        remarks: extract.description,
        items: [
          {
            expenseClaimTypeId: claimTypeId || null,
            description: `${extract.merchantName}${extract.category ? ` — ${extract.category}` : ""}`,
            amount: extract.grandTotal,
          },
        ],
      });
      showToast("Draft claim created from receipt", "success");
      setDrawerOpen(false);
      setExtract(null);
      onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof ExtractedReceipt>(k: K, v: ExtractedReceipt[K]) {
    if (!extract) return;
    setExtract({ ...extract, [k]: v });
  }

  return (
    <>
      <label className={`btn-secondary cursor-pointer ${extracting ? "opacity-60 pointer-events-none" : ""}`}>
        {extracting ? "Scanning…" : "📷 Scan receipt"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.currentTarget.value = ""; // allow re-picking the same file
          }}
        />
      </label>

      {extract && (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Review receipt extraction"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDrawerOpen(false)}>Cancel</Button>
              <Button variant="brand" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save as draft claim"}
              </Button>
            </>
          }
        >
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs mb-4">
              <div className="font-semibold mb-1">Check these before saving:</div>
              <ul className="list-disc ps-4 space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Merchant">
              <input className="input" value={extract.merchantName} onChange={(e) => patch("merchantName", e.target.value)} />
            </FormField>
            <FormField label="Category">
              <select className="input" value={extract.category} onChange={(e) => patch("category", e.target.value as ExtractedReceipt["category"])}>
                {["Travel","Meals","Lodging","Transportation","Office","Software","Equipment","Phone","Internet","Other"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Receipt date">
              <input className="input" type="date" value={extract.receiptDate ?? ""} onChange={(e) => patch("receiptDate", e.target.value || null)} />
            </FormField>
            <FormField label="Currency">
              <input className="input" value={extract.currency} onChange={(e) => patch("currency", e.target.value)} />
            </FormField>
            <FormField label="Subtotal">
              <input className="input" type="number" step="0.01" value={extract.subtotal} onChange={(e) => patch("subtotal", Number(e.target.value))} />
            </FormField>
            <FormField label="Tax">
              <input className="input" type="number" step="0.01" value={extract.taxAmount} onChange={(e) => patch("taxAmount", Number(e.target.value))} />
            </FormField>
            <FormField label="Tip">
              <input className="input" type="number" step="0.01" value={extract.tipAmount} onChange={(e) => patch("tipAmount", Number(e.target.value))} />
            </FormField>
            <FormField label="Total">
              <input className="input font-semibold" type="number" step="0.01" value={extract.grandTotal} onChange={(e) => patch("grandTotal", Number(e.target.value))} />
            </FormField>
          </div>
          <div className="mt-3">
            <FormField label="Description (goes to claim remarks)">
              <textarea className="input" rows={2} value={extract.description} onChange={(e) => patch("description", e.target.value)} />
            </FormField>
          </div>
          <div className="mt-4 pt-4 border-t border-ink/5">
            <div className="text-[11px] uppercase tracking-widest text-ink-muted font-semibold mb-2">Attach to</div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Employee">
                <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.employeeName}</option>)}
                </select>
              </FormField>
              <FormField label="Claim type">
                <select className="input" value={claimTypeId} onChange={(e) => setClaimTypeId(e.target.value)}>
                  <option value="">—</option>
                  {claimTypes.map((t) => <option key={t.id} value={t.id}>{t.typeName}</option>)}
                </select>
              </FormField>
            </div>
          </div>
        </Drawer>
      )}
    </>
  );
}
