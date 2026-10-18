"use client";

import { useState } from "react";
import {
  AIDiffModal,
  AISlashInput,
  useOptionalUIBackends,
  useSaveAsRule,
  type AIDiff,
  type SlashCommand,
} from "@lumaara/web-ui";
import { authApi } from "../lib/auth-api";

export interface InvoiceDraftApply {
  (patch: {
    customerId?: string;
    customerName?: string;
    postingDate?: string;
    dueDate?: string;
    remarks?: string;
    currency?: string;
    lines?: Array<{ itemCode?: string; itemName?: string; qty?: number; rate?: number }>;
  }): void;
}

/**
 * Mounted at the top of the sales-invoice create form. Accepts natural-
 * language slash commands, calls /ai/draft with the current form state
 * as `before`, previews the proposed diff, applies on approval.
 */
export function AiInvoiceDraft({
  before,
  apply,
  customersByName,
  itemsByCode,
}: {
  before: Record<string, unknown>;
  apply: InvoiceDraftApply;
  /** Map of customerName (lowercased) → customerId to resolve AI-named customers. */
  customersByName: Map<string, string>;
  /** Map of itemCode (uppercased) → itemName so unknown codes don't silently drop. */
  itemsByCode: Map<string, string>;
}) {
  const [diff, setDiff] = useState<AIDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backends = useOptionalUIBackends();
  const { saveRule } = useSaveAsRule<AIDiff>("sales-invoice-draft", backends?.rules);

  const commands: SlashCommand[] = [
    {
      prefix: "/ai",
      description: "Draft the invoice from a natural-language description",
      run: async (prompt: string) => {
        setError(null);
        setBusy(true);
        try {
          const result = await authApi.post<AIDiff & { costUsd?: number; model?: string }>(
            "/ai/draft",
            {
              prompt,
              scope: "sales-invoice-draft",
              before,
              fields: [
                "customerName",
                "customerId",
                "postingDate",
                "dueDate",
                "currency",
                "remarks",
                "lines",
              ],
              doctypeHint:
                "Sales invoice: a bill issued to a customer. `lines` is an array of { itemCode, itemName, qty, rate }. Dates are YYYY-MM-DD. Pick a sensible dueDate (default net 15 days from postingDate).",
            },
          );
          setDiff(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : "AI draft failed");
        } finally {
          setBusy(false);
        }
      },
    },
  ];

  function doApply(edited: AIDiff) {
    const next: Parameters<InvoiceDraftApply>[0] = {};
    for (const r of edited.rows) {
      const v = r.after ?? "";
      switch (r.field) {
        case "customerName": {
          next.customerName = v;
          // Resolve to id if we have an exact match.
          const id = customersByName.get(v.toLowerCase());
          if (id) next.customerId = id;
          break;
        }
        case "customerId":
          next.customerId = v;
          break;
        case "postingDate":
          next.postingDate = v;
          break;
        case "dueDate":
          next.dueDate = v;
          break;
        case "currency":
          next.currency = v;
          break;
        case "remarks":
          next.remarks = v;
          break;
        case "lines": {
          try {
            const parsed = typeof v === "string" ? JSON.parse(v) : v;
            if (Array.isArray(parsed)) {
              next.lines = parsed.map((l: { itemCode?: string; itemName?: string; qty?: number; rate?: number }) => {
                const copy = { ...l };
                if (copy.itemCode) {
                  const name = itemsByCode.get(copy.itemCode.toUpperCase());
                  if (name) copy.itemName = copy.itemName ?? name;
                }
                return copy;
              });
            }
          } catch { /* malformed JSON — skip */ }
          break;
        }
      }
    }
    apply(next);
    setDiff(null);
  }

  return (
    <div className="mb-4 space-y-2">
      <AISlashInput commands={commands} placeholder="/ai 3× SKU-WIDGET for Acme Industries, due in 15 days" />
      {busy && <p className="text-xs text-ink-muted">Drafting with AI…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <AIDiffModal
        open={!!diff}
        onClose={() => setDiff(null)}
        diff={diff}
        onApprove={(edited) => doApply(edited)}
        onReject={() => setDiff(null)}
        onSaveAsRule={async (name, b, a) => {
          await saveRule(name, b, a);
        }}
      />
    </div>
  );
}
