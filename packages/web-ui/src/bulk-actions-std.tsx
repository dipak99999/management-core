"use client";

import type { BulkAction } from "./bulk-select";

/**
 * Standard ERP mutation shape: submit (Draft → Submitted), cancel
 * (* → Cancelled). Most list pages wire one or both of these; writing
 * them out longhand per page is noise.
 *
 *   const actions = standardBulkActions<Invoice>({
 *     base: "/sales-invoices",
 *     api,
 *     onDone: load,
 *     clear: bulk.clear,
 *   });
 */
export function standardBulkActions<T extends { id: string; status?: string }>({
  base,
  api,
  onDone,
  clear,
  canSubmit = (r) => r.status === "Draft",
  canCancel = (r) => r.status === "Draft" || r.status === "Submitted",
  cancelConfirm = (n) => `Cancel ${n} record${n === 1 ? "" : "s"}?`,
  include = ["submit", "cancel"],
}: {
  base: string;
  api: { post: (path: string, body?: unknown) => Promise<unknown> };
  onDone: () => void | Promise<void>;
  clear: () => void;
  canSubmit?: (r: T) => boolean;
  canCancel?: (r: T) => boolean;
  cancelConfirm?: (n: number) => string;
  include?: Array<"submit" | "cancel" | "delete">;
}): BulkAction<T>[] {
  const actions: BulkAction<T>[] = [];
  if (include.includes("submit")) {
    actions.push({
      id: "submit",
      label: "Submit",
      disabled: (sel) => !sel.every((r) => canSubmit(r)),
      run: async (sel) => {
        for (const r of sel) {
          try { await api.post(`${base}/${r.id}/submit`, {}); } catch { /* best effort */ }
        }
        clear();
        await onDone();
      },
    });
  }
  if (include.includes("cancel")) {
    actions.push({
      id: "cancel",
      label: "Cancel",
      destructive: true,
      disabled: (sel) => !sel.every((r) => canCancel(r)),
      run: async (sel) => {
        if (typeof window !== "undefined" && !window.confirm(cancelConfirm(sel.length))) return;
        for (const r of sel) {
          try { await api.post(`${base}/${r.id}/cancel`, {}); } catch { /* best effort */ }
        }
        clear();
        await onDone();
      },
    });
  }
  return actions;
}
