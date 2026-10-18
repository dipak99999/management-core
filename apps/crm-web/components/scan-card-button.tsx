"use client";

// Scan a business card photo → draft CRM Lead.
//
// Mirrors ScanReceiptButton. The extract endpoint lives on accounting-service
// (cross-service via the shell's /api/accounting proxy); the lead-create
// POST goes to crm-service via the normal api client.

import { useState } from "react";
import { api } from "../lib/api";
import { showToast } from "../lib/toast";
import { Button, Drawer, FormField } from "./ui";

const ACCOUNTING_URL =
  process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";

interface ExtractedCard {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyWebsite: string | null;
  companyIndustry: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  linkedinUrl: string | null;
  notes: string;
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

export function ScanCardButton({ onCreated }: { onCreated: () => void }) {
  const [extracting, setExtracting] = useState(false);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<ExtractedCard | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File) {
    const token = tokenFromStorage();
    if (!token) { showToast("Not authenticated", "error"); return; }
    setExtracting(true);
    try {
      const { base64Data, mimeType } = await readAsBase64(file);
      const r = await fetch(`${ACCOUNTING_URL}/ai/extract-business-card`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ attachmentBase64: base64Data, attachmentMimeType: mimeType }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        showToast(`Card scan failed: ${body.error ?? r.status}`, "error");
        return;
      }
      const data = await r.json() as { extracted: ExtractedCard; warnings: string[] };
      setCard(data.extracted);
      setWarnings(data.warnings ?? []);
      setOpen(true);
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    if (!card) return;
    const name = [card.firstName, card.lastName].filter(Boolean).join(" ").trim();
    if (!name && !card.email) {
      showToast("Need at least a name or email to create a lead", "error");
      return;
    }
    setSaving(true);
    try {
      // Build a Lead payload that matches crm-service's expected shape.
      // Notes field accumulates the fields we don't have columns for
      // (company website/industry, LinkedIn URL, address, phone).
      const extras: string[] = [];
      if (card.jobTitle)        extras.push(`Title: ${card.jobTitle}`);
      if (card.companyWebsite)  extras.push(`Website: ${card.companyWebsite}`);
      if (card.companyIndustry) extras.push(`Industry: ${card.companyIndustry}`);
      if (card.linkedinUrl)     extras.push(`LinkedIn: ${card.linkedinUrl}`);
      if (card.phone)           extras.push(`Phone: ${card.phone}`);
      if (card.address)         extras.push(`Address: ${card.address}`);
      if (card.notes)           extras.push(`Notes: ${card.notes}`);

      await api.post("/leads", {
        leadName: name || card.email || "Unknown",
        companyName: card.companyName ?? null,
        email: card.email ?? null,
        mobile: card.mobile ?? null,
        source: "Business Card Scan",
        status: "Open",
        remarks: extras.join("\n"),
      });
      showToast("Lead created from business card", "success");
      setOpen(false);
      setCard(null);
      onCreated();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof ExtractedCard>(k: K, v: ExtractedCard[K]) {
    if (!card) return;
    setCard({ ...card, [k]: v });
  }

  return (
    <>
      <label className={`btn-secondary cursor-pointer ${extracting ? "opacity-60 pointer-events-none" : ""}`}>
        {extracting ? "Scanning…" : "📇 Scan business card"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {card && (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title="Review business card"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="brand" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Create lead"}
              </Button>
            </>
          }
        >
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-xs mb-4">
              <ul className="list-disc ps-4 space-y-0.5">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First name">
              <input className="input" value={card.firstName ?? ""} onChange={(e) => patch("firstName", e.target.value || null)} />
            </FormField>
            <FormField label="Last name">
              <input className="input" value={card.lastName ?? ""} onChange={(e) => patch("lastName", e.target.value || null)} />
            </FormField>
            <FormField label="Job title">
              <input className="input" value={card.jobTitle ?? ""} onChange={(e) => patch("jobTitle", e.target.value || null)} />
            </FormField>
            <FormField label="Company">
              <input className="input" value={card.companyName ?? ""} onChange={(e) => patch("companyName", e.target.value || null)} />
            </FormField>
            <FormField label="Email">
              <input className="input" type="email" value={card.email ?? ""} onChange={(e) => patch("email", e.target.value || null)} />
            </FormField>
            <FormField label="Mobile">
              <input className="input" value={card.mobile ?? ""} onChange={(e) => patch("mobile", e.target.value || null)} />
            </FormField>
            <FormField label="Phone (landline)">
              <input className="input" value={card.phone ?? ""} onChange={(e) => patch("phone", e.target.value || null)} />
            </FormField>
            <FormField label="LinkedIn">
              <input className="input" value={card.linkedinUrl ?? ""} onChange={(e) => patch("linkedinUrl", e.target.value || null)} />
            </FormField>
            <FormField label="Company website">
              <input className="input" value={card.companyWebsite ?? ""} onChange={(e) => patch("companyWebsite", e.target.value || null)} />
            </FormField>
            <FormField label="Industry">
              <input className="input" value={card.companyIndustry ?? ""} onChange={(e) => patch("companyIndustry", e.target.value || null)} />
            </FormField>
          </div>
          <div className="mt-3">
            <FormField label="Address">
              <textarea className="input" rows={2} value={card.address ?? ""} onChange={(e) => patch("address", e.target.value || null)} />
            </FormField>
            <FormField label="Notes (appended to remarks)">
              <textarea className="input" rows={2} value={card.notes} onChange={(e) => patch("notes", e.target.value)} />
            </FormField>
          </div>
        </Drawer>
      )}
    </>
  );
}
