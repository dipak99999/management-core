"use client";

import { useEffect, useState } from "react";
import { showToast } from "../../../lib/toast";
import { useParams } from "next/navigation";
import { api, downloadPdf } from "../../../lib/api";
import { WorkflowActions } from "../../../lib/workflow-actions";
import { AttachmentsPanel } from "../../../lib/attachments";
import { CommentsPanel } from "../../../lib/comments";
import { currentUserId } from "../../../lib/collab-api";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  Skeleton,
  StatusBadge,
  dateShort,
  money,
} from "../../../components/ui";

interface JELine {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  partyType: string | null;
  partyId: string | null;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface JournalEntry {
  id: string;
  name: string;
  postingDate: string;
  currency: string;
  status: string;
  remarks: string | null;
  accounts: JELine[];
}
interface GLEntry {
  id: string;
  accountId: string;
  debit: string;
  credit: string;
  remarks: string | null;
  account: { accountName: string; rootType: string };
}
interface Payload {
  journalEntry: JournalEntry;
  glEntries: GLEntry[];
}

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await api.get<Payload>(`/journal-entries/${params.id}/full`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/journal-entries/${params.id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!confirm("Cancel this journal entry? GL will be reversed.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/journal-entries/${params.id}/cancel`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Journal Entries", href: "/accounting/journal-entries" }]}
          title="Journal Entry"
          actions={
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
          }
        />
        <Card className="p-4 text-red-700 border-red-200 bg-red-50">{error}</Card>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="p-8 space-y-6">
        <PageHeader
          breadcrumb={[{ label: "Journal Entries", href: "/accounting/journal-entries" }]}
          title="Loading…"
        />
        <Skeleton className="h-32" rounded="rounded-lg" />
      </main>
    );
  }

  const je = data.journalEntry;
  const totalDr = je.accounts.reduce((s, l) => s + Number(l.debit), 0);
  const totalCr = je.accounts.reduce((s, l) => s + Number(l.credit), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  return (
    <main className="p-8 space-y-6 print:p-0">
      <PageHeader
        breadcrumb={[
          { label: "Journal Entries", href: "/accounting/journal-entries" },
          { label: je.name },
        ]}
        title={je.name}
        subtitle={
          <span className="flex items-center gap-2">
            <StatusBadge status={je.status} />
            <span>{dateShort(je.postingDate)}</span>
            <span>· {je.currency}</span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => history.back()} type="button">
              ← Back
            </Button>
            {je.status === "Draft" && (
              <>
                <a href={`/accounting/journal-entries/new?editId=${je.id}`}>
                  <Button variant="secondary" type="button">Edit</Button>
                </a>
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={busy || !balanced}
                  type="button"
                  title={!balanced ? "Entry is unbalanced" : ""}
                >
                  Submit
                </Button>
              </>
            )}
            {je.status !== "Cancelled" && (
              <Button variant="danger" onClick={cancel} disabled={busy} type="button">
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadPdf(`/print/journal-entries/${je.id}`, `${je.name}.pdf`).catch(
                  (e) => showToast(e instanceof Error ? e.message : "PDF failed", "error"),
                )
              }
            >
              PDF
            </Button>
            <Button variant="secondary" type="button" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      <WorkflowActions doctype="JournalEntry" docId={je.id} onChange={load} />

      <section>
        <SectionHeader title="Lines" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Party</th>
                <th>Remarks</th>
                <th className="text-end">Debit</th>
                <th className="text-end">Credit</th>
              </tr>
            </thead>
            <tbody>
              {je.accounts.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${l.accountId}`}
                      className="text-brand-600 hover:underline"
                    >
                      {l.account.accountName}
                    </a>
                    <span className="text-xs text-ink-muted ms-1">
                      ({l.account.rootType})
                    </span>
                  </td>
                  <td className="text-xs text-ink-soft">
                    {l.partyType && l.partyId
                      ? `${l.partyType}: ${l.partyId.slice(0, 8)}`
                      : "—"}
                  </td>
                  <td className="text-xs text-ink-soft">{l.remarks ?? "—"}</td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(l.debit) > 0 ? money(Number(l.debit), je.currency) : ""}
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(l.credit) > 0 ? money(Number(l.credit), je.currency) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-surface-sunken font-semibold">
              <tr>
                <td colSpan={3}>Total</td>
                <td className="text-end font-mono tabular-nums">
                  {money(totalDr, je.currency)}
                </td>
                <td className="text-end font-mono tabular-nums">
                  {money(totalCr, je.currency)}
                </td>
              </tr>
              <tr className={balanced ? "text-green-700" : "text-red-700"}>
                <td className="text-xs" colSpan={5}>
                  {balanced
                    ? "✓ Balanced"
                    : `Off by ${(totalDr - totalCr).toFixed(2)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
          {je.accounts.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <a
                    href={`/accounting/reports/general-ledger?accountId=${l.accountId}`}
                    className="font-medium text-brand-600 hover:underline truncate block"
                  >
                    {l.account.accountName}
                  </a>
                  <div className="text-xs text-ink-muted">{l.account.rootType}</div>
                </div>
                <div className="text-end font-mono tabular-nums">
                  {Number(l.debit) > 0 ? (
                    <span className="text-ink">Dr {money(Number(l.debit), je.currency)}</span>
                  ) : (
                    <span className="text-ink">Cr {money(Number(l.credit), je.currency)}</span>
                  )}
                </div>
              </div>
              {(l.partyType || l.remarks) && (
                <div className="mt-1 text-xs text-ink-muted">
                  {l.partyType && l.partyId && `${l.partyType}: ${l.partyId.slice(0, 8)}`}
                  {l.partyType && l.remarks && " · "}
                  {l.remarks}
                </div>
              )}
            </li>
          ))}
          <li className={`px-4 py-3 bg-surface-sunken font-semibold text-sm ${balanced ? "text-green-700" : "text-red-700"}`}>
            {balanced ? "✓ Balanced" : `Off by ${(totalDr - totalCr).toFixed(2)}`} · Dr {money(totalDr, je.currency)} / Cr {money(totalCr, je.currency)}
          </li>
        </ul>
      </section>

      <section className="print:hidden">
        <SectionHeader title="GL entries (posted by this entry)" />
        <div className="hidden md:block table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Remarks</th>
                <th className="text-end">Debit</th>
                <th className="text-end">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.glEntries.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-ink-muted">
                    Not posted yet
                  </td>
                </tr>
              )}
              {data.glEntries.map((g) => (
                <tr key={g.id}>
                  <td>
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
                      className="text-brand-600 hover:underline"
                    >
                      {g.account.accountName}
                    </a>
                    <span className="text-xs text-ink-muted ms-1">
                      ({g.account.rootType})
                    </span>
                  </td>
                  <td className="text-xs text-ink-soft">{g.remarks ?? "—"}</td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(g.debit) > 0 ? money(Number(g.debit), je.currency) : ""}
                  </td>
                  <td className="text-end font-mono tabular-nums">
                    {Number(g.credit) > 0 ? money(Number(g.credit), je.currency) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.glEntries.length === 0 ? (
          <div className="md:hidden rounded-xl border border-ink/10 bg-canvas px-4 py-6 text-center text-sm text-ink-muted">
            Not posted yet
          </div>
        ) : (
          <ul className="md:hidden divide-y divide-line rounded-xl border border-ink/10 bg-canvas overflow-hidden">
            {data.glEntries.map((g) => (
              <li key={g.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/accounting/reports/general-ledger?accountId=${g.accountId}`}
                      className="font-medium text-brand-600 hover:underline truncate block"
                    >
                      {g.account.accountName}
                    </a>
                    <div className="text-xs text-ink-muted">{g.account.rootType}</div>
                  </div>
                  <div className="text-end font-mono tabular-nums">
                    {Number(g.debit) > 0 ? (
                      <span className="text-ink">Dr {money(Number(g.debit), je.currency)}</span>
                    ) : (
                      <span className="text-ink">Cr {money(Number(g.credit), je.currency)}</span>
                    )}
                  </div>
                </div>
                {g.remarks && (
                  <div className="mt-1 text-xs text-ink-muted">{g.remarks}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {je.remarks && (
        <Card className="p-4">
          <SectionHeader title="Remarks" />
          <div className="whitespace-pre-wrap text-sm text-ink">{je.remarks}</div>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-4">
        <AttachmentsPanel doctype="JournalEntry" docId={je.id} />
        <CommentsPanel
          doctype="JournalEntry"
          docId={je.id}
          currentUserId={currentUserId()}
        />
      </section>
    </main>
  );
}
