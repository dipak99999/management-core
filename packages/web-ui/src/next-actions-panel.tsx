"use client";

import { useEffect, useState } from "react";
import { AISuggestionChips, type AISuggestion } from "./ai";

interface Chip {
  id: string;
  label: string;
  description?: string;
  danger?: boolean;
  href?: string;
  endpoint?: { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
}

/**
 * Drop-in `<NextActionsPanel doctype docId />` for any doc detail page.
 * Fetches contextual action chips from auth-service /ai/next-actions,
 * executes them against the appropriate downstream service when the
 * user clicks.
 *
 * The `callService(method, path, body)` prop is the escape hatch — pass
 * the app's existing API client so chips can hit module endpoints
 * (sales-invoices, pick-lists, etc.) directly.
 */
export function NextActionsPanel({
  doctype,
  docId,
  fetchChips,
  callService,
  heading,
  onDone,
}: {
  doctype: string;
  docId: string;
  /** Must POST to /ai/next-actions and return Chip[]. */
  fetchChips: () => Promise<Chip[]>;
  /** Executes a chip's `endpoint` against the right service. Return value is ignored. */
  callService: (method: string, path: string, body: unknown) => Promise<unknown>;
  heading?: string;
  /** Called after any endpoint-chip succeeds, so the caller can refetch. */
  onDone?: () => void;
}) {
  const [chips, setChips] = useState<Chip[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setChips(await fetchChips());
    } catch {
      setChips([]);
    }
  };

  useEffect(() => {
    void refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, docId]);

  const suggestions: AISuggestion[] = chips.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    danger: c.danger,
    run: async () => {
      if (c.href) {
        if (typeof window !== "undefined") window.location.href = c.href;
        return;
      }
      if (!c.endpoint) return;
      setBusy(true);
      try {
        await callService(c.endpoint.method, c.endpoint.path, c.endpoint.body);
        await refresh();
        onDone?.();
      } finally {
        setBusy(false);
      }
    },
  }));

  if (suggestions.length === 0) return null;
  return <AISuggestionChips suggestions={suggestions} busy={busy} heading={heading} />;
}
