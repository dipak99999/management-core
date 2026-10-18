"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  FormField,
  PageHeader,
  Toast,
} from "../../components/ui";

interface ExtractedInvoice {
  supplierName: string;
  supplierInvoiceNo: string | null;
  invoiceDate: string | null;
  currency: string;
  lines: Array<{ description: string; qty: number; rate: number; amount: number }>;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
}

interface ExtractResponse {
  job: { id: string; status: string };
  extracted: ExtractedInvoice;
  warnings: string[];
}

interface Supplier { id: string; supplierName: string; }
interface Item { id: string; itemCode: string; itemName: string; }

// Module 54 — AI invoice extraction UI.
//
// Two-stage flow:
//   1. Upload/paste stage: drop a PDF/image or paste OCR text.
//      Click "Extract" → LLM parses → shows an editable review card.
//   2. Review stage: operator maps the extracted supplier + item lines
//      to real IDs (via existing pickers), tweaks numbers if the LLM
//      drifted, clicks "Create draft PI".
//
// The stub provider returns canned data for prompts starting with
// "STUB_INVOICE:" — handy for demoing without an LLM key configured.
export default function AIExtractPage() {
  const [sourceText, setSourceText] = useState("STUB_INVOICE: sample");
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [fileMime, setFileMime] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // Confirm-stage form: operator's resolved mappings.
  const [supplierId, setSupplierId] = useState("");
  const [lineMap, setLineMap] = useState<Record<number, { itemId: string; qty: number; rate: number }>>({});

  async function loadMasters() {
    const [s, i] = await Promise.all([
      api.get<Supplier[]>("/suppliers"),
      api.get<Item[]>("/items"),
    ]);
    setSuppliers(s);
    setItems(i);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    setFileB64(btoa(binary));
    setFileMime(f.type);
    setSourceText("");
  }

  async function runExtract() {
    setBusy(true);
    setError(null);
    setExtract(null);
    try {
      const payload: Record<string, string> = {};
      if (sourceText) payload.sourceText = sourceText;
      if (fileB64 && fileMime) {
        payload.attachmentBase64 = fileB64;
        payload.attachmentMimeType = fileMime;
      }
      const r = await api.post<ExtractResponse>("/ai/extract-invoice", payload);
      setExtract(r);
      // Seed line-map defaults so the review form has usable qty/rate.
      const seed: Record<number, { itemId: string; qty: number; rate: number }> = {};
      for (const [idx, line] of r.extracted.lines.entries()) {
        seed[idx] = { itemId: "", qty: line.qty, rate: line.rate };
      }
      setLineMap(seed);
      await loadMasters();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreate() {
    if (!extract) return;
    if (!supplierId) {
      setError("Pick a supplier");
      return;
    }
    if (Object.values(lineMap).some((l) => !l.itemId)) {
      setError("Map every line to an item");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ purchaseInvoice: { name: string } }>(
        `/ai/extract-invoice/${extract.job.id}/confirm`,
        {
          supplierId,
          supplierInvoiceNo: extract.extracted.supplierInvoiceNo,
          currency: extract.extracted.currency,
          lines: Object.values(lineMap),
        },
      );
      setInfo(`Draft PurchaseInvoice ${r.purchaseInvoice.name} created.`);
      setExtract(null);
      setSupplierId("");
      setLineMap({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!extract) return;
    await api.post(`/ai/extract-invoice/${extract.job.id}/discard`, {});
    setExtract(null);
  }

  return (
    <>
      <PageHeader
        title="AI Invoice Extraction"
        subtitle="Upload a supplier invoice PDF/image or paste OCR text. AI extracts fields; you review + confirm to create a Draft PI."
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      {!extract && (
        <Card className="p-6 space-y-4">
          <FormField label="Upload PDF/image">
            <input
              type="file"
              accept="application/pdf,image/*"
              onChange={onFile}
              className="text-sm"
            />
            {fileB64 && <div className="text-xs text-ink-muted mt-1">{fileMime} · {Math.round(fileB64.length * 0.75 / 1024)} KB</div>}
          </FormField>
          <div className="text-xs text-ink-muted">— OR —</div>
          <FormField label="Paste OCR text / stub prompt" hint="Start with STUB_INVOICE: for a canned demo response">
            <textarea
              className="input font-mono text-sm"
              rows={8}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </FormField>
          <div>
            <Button variant="brand" onClick={runExtract} disabled={busy}>
              {busy ? "Extracting…" : "Extract"}
            </Button>
          </div>
        </Card>
      )}

      {extract && (
        <div className="space-y-4">
          {extract.warnings.length > 0 && (
            <Card className="p-3 border-amber-200 bg-amber-50">
              <div className="font-medium text-amber-800 text-sm mb-1">Validation warnings — review before confirming:</div>
              <ul className="text-xs text-amber-800 space-y-1 ps-4 list-disc">
                {extract.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Card>
          )}
          <Card className="p-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Extracted supplier">
                <input className="input" value={extract.extracted.supplierName} readOnly />
              </FormField>
              <FormField label="Invoice #">
                <input className="input font-mono" value={extract.extracted.supplierInvoiceNo ?? ""} readOnly />
              </FormField>
              <FormField label="Currency">
                <input className="input" value={extract.extracted.currency} readOnly />
              </FormField>
            </div>

            <FormField label="Map to supplier" required>
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— pick supplier —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplierName}</option>)}
              </select>
            </FormField>

            <div>
              <div className="font-medium text-sm mb-2">Line items</div>
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Description (extracted)</th>
                    <th>Map to item</th>
                    <th className="text-end">Qty</th>
                    <th className="text-end">Rate</th>
                    <th className="text-end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {extract.extracted.lines.map((line, idx) => (
                    <tr key={idx}>
                      <td>{line.description}</td>
                      <td>
                        <select
                          className="input"
                          value={lineMap[idx]?.itemId ?? ""}
                          onChange={(e) => setLineMap({ ...lineMap, [idx]: { ...lineMap[idx], itemId: e.target.value } })}
                        >
                          <option value="">— pick item —</option>
                          {items.map((i) => <option key={i.id} value={i.id}>{i.itemCode} · {i.itemName}</option>)}
                        </select>
                      </td>
                      <td className="text-end">
                        <input
                          type="number"
                          step="0.01"
                          className="input font-mono text-end w-24"
                          value={lineMap[idx]?.qty ?? 0}
                          onChange={(e) => setLineMap({ ...lineMap, [idx]: { ...lineMap[idx], qty: Number(e.target.value) } })}
                        />
                      </td>
                      <td className="text-end">
                        <input
                          type="number"
                          step="0.01"
                          className="input font-mono text-end w-24"
                          value={lineMap[idx]?.rate ?? 0}
                          onChange={(e) => setLineMap({ ...lineMap, [idx]: { ...lineMap[idx], rate: Number(e.target.value) } })}
                        />
                      </td>
                      <td className="text-end font-mono">
                        {((lineMap[idx]?.qty ?? 0) * (lineMap[idx]?.rate ?? 0)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-surface-sunken">
                  <tr>
                    <td colSpan={4} className="text-end">Subtotal (extracted)</td>
                    <td className="text-end font-mono">{extract.extracted.subtotal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="text-end">Tax (extracted)</td>
                    <td className="text-end font-mono">{extract.extracted.taxAmount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="text-end font-semibold">Grand total (extracted)</td>
                    <td className="text-end font-mono font-semibold">{extract.extracted.grandTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="brand" onClick={confirmCreate} disabled={busy}>
                {busy ? "Creating…" : "Create Draft PI"}
              </Button>
              <Button variant="secondary" onClick={discard}>Discard</Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
