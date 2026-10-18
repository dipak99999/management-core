"use client";

// Session-close screen. Server pre-computes expected-by-mode from the
// invoices posted in the session; cashier enters counted-by-mode; on Draft
// creation the difference is calculated. Submit posts the reconciliation
// JE (Cash Short/Over) and flips both docs to Closed/Submitted.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../lib/api";
import { PageHeader, Card, Button } from "../../../../components/ui";

type ExpectedRow = {
  mode: string;
  opening: number;
  sales: number;
  expected: number;
};

type ExpectedResponse = {
  opening: { id: string; name: string; posProfileId: string; status: string };
  expected: {
    rows: ExpectedRow[];
    totalSales: number;
    invoiceCount: number;
  };
};

type DraftClosing = {
  id: string;
  name: string;
  status: string;
  expectedByMode: ExpectedRow[];
  countedByMode: { mode: string; counted: number }[];
  differenceByMode: { mode: string; difference: number }[];
  totalDifference: string | number;
  totalSales: string | number;
  invoiceCount: number;
};

export default function ClosingPage() {
  const params = useParams<{ openingId: string }>();
  const router = useRouter();
  const [data, setData] = useState<ExpectedResponse | null>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<DraftClosing | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<ExpectedResponse>(`/pos-closings/expected/${params.openingId}`)
      .then((res) => {
        setData(res);
        setCounted(
          Object.fromEntries(res.expected.rows.map((r) => [r.mode, r.expected.toFixed(2)])),
        );
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.openingId]);

  async function draftClosing() {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        openingEntryId: params.openingId,
        counted: data.expected.rows.map((r) => ({
          mode: r.mode,
          counted: Number(counted[r.mode] ?? "0") || 0,
        })),
        notes: notes || null,
      };
      const created = await api.post<DraftClosing>("/pos-closings", payload);
      setDraft(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitClosing() {
    if (!draft) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/pos-closings/${draft.id}/submit`, {});
      router.push("/pos-closings");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-ink-muted">Loading…</div>;
  if (error) return <div className="p-6 text-danger">{error}</div>;
  if (!data) return null;

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader
        title={draft ? `Confirm ${draft.name}` : `Close ${data.opening.name}`}
        subtitle={
          draft
            ? `${draft.invoiceCount} invoices · ${Number(draft.totalSales).toFixed(2)} sales · ${Number(draft.totalDifference).toFixed(2)} total difference`
            : `${data.expected.invoiceCount} invoices · ${data.expected.totalSales.toFixed(2)} sales this session`
        }
      />

      <Card className="mt-4 p-4 space-y-3">
        <div className="grid grid-cols-5 gap-2 text-xs text-ink-muted font-medium">
          <div>Mode</div>
          <div className="text-end">Opening</div>
          <div className="text-end">Sales</div>
          <div className="text-end">Expected</div>
          <div className="text-end">Counted</div>
        </div>
        {(draft ? draft.expectedByMode : data.expected.rows).map((r) => {
          const countedVal = draft
            ? draft.countedByMode.find((c) => c.mode === r.mode)?.counted ?? 0
            : undefined;
          const diff = draft
            ? draft.differenceByMode.find((d) => d.mode === r.mode)?.difference ?? 0
            : Number(counted[r.mode] ?? "0") - r.expected;
          return (
            <div key={r.mode} className="grid grid-cols-5 gap-2 items-center text-sm">
              <div className="font-medium">{r.mode}</div>
              <div className="text-end">{Number(r.opening).toFixed(2)}</div>
              <div className="text-end">{Number(r.sales).toFixed(2)}</div>
              <div className="text-end">{Number(r.expected).toFixed(2)}</div>
              {draft ? (
                <div className="text-end">
                  {Number(countedVal ?? 0).toFixed(2)}
                  <div
                    className={`text-xs ${diff === 0 ? "text-ink-muted" : diff > 0 ? "text-brand-600" : "text-danger"}`}
                  >
                    {diff > 0 ? "+" : ""}
                    {diff.toFixed(2)}
                  </div>
                </div>
              ) : (
                <input
                  type="number"
                  step="0.01"
                  className="input w-full text-end"
                  value={counted[r.mode] ?? ""}
                  onChange={(e) =>
                    setCounted((prev) => ({ ...prev, [r.mode]: e.target.value }))
                  }
                />
              )}
            </div>
          );
        })}

        {!draft && (
          <div className="pt-2">
            <label className="block text-xs text-ink-muted mb-1">Notes (optional)</label>
            <input
              className="input w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        )}
      </Card>

      {error && <div className="text-danger mt-3">{error}</div>}

      <div className="flex gap-2 mt-4">
        {!draft ? (
          <Button onClick={draftClosing} disabled={submitting}>
            {submitting ? "Drafting…" : "Draft closing"}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={submitting}>
              Edit counts
            </Button>
            <Button onClick={submitClosing} disabled={submitting}>
              {submitting ? "Posting…" : "Submit & close session"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
