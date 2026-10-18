"use client";

import { use, useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import {
  Button,
  Card,
  PageHeader,
  StatusBadge,
  Toast,
  dateShort,
} from "../../../components/ui";
import {
  ActivityTimeline,
  CommentComposer,
  NextActionsPanel,
  useRealtime,
  useRegisterCommand,
  type ActivityEntry,
} from "@lumaara/web-ui";
import { authApi } from "../../../lib/auth-api";

interface PickListItem {
  id: string;
  qty: string;
  pickedQty: string;
  batchNo: string | null;
  serialNos: string[];
  item: { itemCode: string; itemName: string };
  warehouse: { warehouseName: string };
  deliveryNoteItem: {
    deliveryNote: { name: string; customer: { customerName: string } };
  };
}

interface PickList {
  id: string;
  name: string;
  purpose: string;
  postingDate: string;
  pickedBy: string | null;
  status: string;
  remarks: string | null;
  items: PickListItem[];
}

// Module 47 — Pick List detail.
//
// Rows in warehouse-walk order. Each row shows the item, source
// warehouse, source DN + customer, and a picked/qty input the worker
// updates as they collect items. "Save picks" fires a batch update
// which flips the list → Completed when every row is done.
export default function PickListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<PickList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get<PickList>(`/pick-lists/${id}`);
      setData(d);
      setDrafts(
        Object.fromEntries(d.items.map((i) => [i.id, Number(i.pickedQty)])),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await authApi.get<ActivityEntry[]>(`/activity/PickList/${id}`));
    } catch {
      // Timeline is secondary; swallow and keep the page functional.
    }
  }, [id]);
  useEffect(() => { loadActivity(); }, [loadActivity]);

  // Live-update the timeline when any user comments on this doctype.
  const [activityStreamUrl, setActivityStreamUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("lumaara.session");
    if (!raw) return;
    try {
      const token = (JSON.parse(raw) as { token?: string }).token;
      if (!token) return;
      const base = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
      setActivityStreamUrl(
        `${base}/stream?channel=activity:PickList&token=${encodeURIComponent(token)}`,
      );
    } catch { /* ignore */ }
  }, []);
  useRealtime({
    url: activityStreamUrl ?? "",
    enabled: !!activityStreamUrl,
    events: ["activity:PickList"],
    onMessage: (m) => {
      const d = m.data as { docId?: string } | null;
      if (d?.docId === id) void loadActivity();
    },
  });

  async function postComment(body: string) {
    setPosting(true);
    try {
      await authApi.post("/comments", { doctype: "PickList", docId: id, body });
      await loadActivity();
    } finally {
      setPosting(false);
    }
  }

  async function submitList() {
    setError(null);
    try {
      await api.post(`/pick-lists/${id}/submit`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    }
  }

  async function savePicks() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const picks = Object.entries(drafts).map(([pickListItemId, pickedQty]) => ({
        pickListItemId,
        pickedQty,
      }));
      const r = await api.post<{ status: string } | null>(
        `/pick-lists/${id}/mark-picked`,
        { picks },
      );
      setInfo(
        r?.status === "Completed"
          ? "All rows picked — list marked Completed."
          : "Picks saved.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  // Context-aware ⌘K commands scoped to this document. Hooks must be
  // called unconditionally; the `useRegisterCommand(null)` form no-ops.
  useRegisterCommand(
    data?.status === "Draft"
      ? {
          id: `pick-list:submit:${id}`,
          label: `Submit pick list ${data.name}`,
          group: "This document",
          run: () => void submitList(),
        }
      : null,
  );
  useRegisterCommand(
    data?.status === "Submitted"
      ? {
          id: `pick-list:save-picks:${id}`,
          label: "Save picks",
          group: "This document",
          run: () => void savePicks(),
        }
      : null,
  );

  if (!data) {
    return (
      <main className="p-8 space-y-4">
        <PageHeader title="Loading…" />
        {error && <Toast kind="error" message={error} />}
      </main>
    );
  }

  const groupedByWarehouse = new Map<string, PickListItem[]>();
  for (const i of data.items) {
    const key = i.warehouse.warehouseName;
    const arr = groupedByWarehouse.get(key) ?? [];
    arr.push(i);
    groupedByWarehouse.set(key, arr);
  }

  const totalRows = data.items.length;
  const doneRows = data.items.filter((i) => Number(i.pickedQty) >= Number(i.qty)).length;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Home", href: "/" },
          { label: "Pick Lists", href: "/stock/pick-lists" },
          { label: data.name },
        ]}
        title={data.name}
        subtitle={`${data.purpose} · ${dateShort(data.postingDate)}${data.pickedBy ? ` · Picker: ${data.pickedBy}` : ""} · ${doneRows}/${totalRows} rows picked`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={data.status} />
            {data.status === "Draft" && (
              <Button variant="brand" onClick={submitList}>Submit</Button>
            )}
            {data.status === "Submitted" && (
              <Button variant="brand" onClick={savePicks} disabled={busy}>
                {busy ? "Saving…" : "Save picks"}
              </Button>
            )}
          </div>
        }
      />

      {error && <div className="mb-4"><Toast kind="error" message={error} onDismiss={() => setError(null)} /></div>}
      {info && <div className="mb-4"><Toast kind="success" message={info} onDismiss={() => setInfo(null)} /></div>}

      <NextActionsPanel
        doctype="PickList"
        docId={id}
        heading="What next?"
        fetchChips={() => authApi.post("/ai/next-actions", { doctype: "PickList", docId: id })}
        callService={(method, path, body) => {
          if (method === "POST") return api.post(path, body ?? {});
          if (method === "PUT") return api.put(path, body ?? {});
          if (method === "DELETE") return api.del(path);
          return Promise.resolve();
        }}
        onDone={load}
      />

      {[...groupedByWarehouse.entries()].map(([warehouse, items]) => (
        <Card key={warehouse} className="mb-4 p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-line bg-surface-sunken font-medium">
            {warehouse}
            <span className="ms-2 text-xs text-ink-muted">
              {items.filter((i) => Number(i.pickedQty) >= Number(i.qty)).length}/{items.length} picked
            </span>
          </div>
          {/* Desktop: dense table. Mobile: tap-friendly card list. */}
          <div className="hidden md:block">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>DN / Customer</th>
                <th>Batch / Serial</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Picked</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const target = Number(i.qty);
                const draft = drafts[i.id] ?? 0;
                const done = draft >= target;
                return (
                  <tr key={i.id} className={done ? "bg-green-50" : ""}>
                    <td>
                      <div className="font-medium text-ink">{i.item.itemName}</div>
                      <div className="text-xs text-ink-muted font-mono">{i.item.itemCode}</div>
                    </td>
                    <td>
                      <div className="text-sm text-ink">{i.deliveryNoteItem.deliveryNote.name}</div>
                      <div className="text-xs text-ink-muted">
                        {i.deliveryNoteItem.deliveryNote.customer.customerName}
                      </div>
                    </td>
                    <td className="text-xs">
                      {i.batchNo && <div className="font-mono">B: {i.batchNo}</div>}
                      {i.serialNos.length > 0 && (
                        <div className="font-mono text-ink-muted">SN: {i.serialNos.join(", ")}</div>
                      )}
                    </td>
                    <td className="text-end font-mono">{target}</td>
                    <td className="text-end">
                      {data.status === "Submitted" ? (
                        <input
                          type="number"
                          step="0.01"
                          className="input w-24 text-end font-mono"
                          value={draft}
                          onChange={(e) =>
                            setDrafts({ ...drafts, [i.id]: Number(e.target.value) })
                          }
                        />
                      ) : (
                        <span className="font-mono">{draft}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

          <ul className="md:hidden divide-y divide-line">
            {items.map((i) => {
              const target = Number(i.qty);
              const draft = drafts[i.id] ?? 0;
              const done = draft >= target;
              const pct = target > 0 ? Math.min(100, Math.round((draft / target) * 100)) : 0;
              const bump = (delta: number) =>
                setDrafts({
                  ...drafts,
                  [i.id]: Math.max(0, Math.min(target, draft + delta)),
                });
              return (
                <li
                  key={i.id}
                  className={`px-4 py-3 ${done ? "bg-green-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-ink truncate">{i.item.itemName}</div>
                      <div className="text-xs text-ink-muted font-mono truncate">
                        {i.item.itemCode}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-[11px] uppercase tracking-widest text-ink-muted">
                        {done ? "Done" : "Target"}
                      </div>
                      <div className="font-mono text-ink">
                        {draft}
                        <span className="text-ink-muted">/{target}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-ink-muted truncate">
                    {i.deliveryNoteItem.deliveryNote.name} ·{" "}
                    {i.deliveryNoteItem.deliveryNote.customer.customerName}
                  </div>
                  {(i.batchNo || i.serialNos.length > 0) && (
                    <div className="mt-1 text-[11px] font-mono text-ink-muted truncate">
                      {i.batchNo && <>B: {i.batchNo} </>}
                      {i.serialNos.length > 0 && <>SN: {i.serialNos.join(", ")}</>}
                    </div>
                  )}
                  <div className="mt-2 h-1 w-full rounded-full bg-ink/5 overflow-hidden">
                    <div
                      className={done ? "h-full bg-success" : "h-full bg-brew"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {data.status === "Submitted" && (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary btn-sm h-10 w-10 text-lg"
                        aria-label="Decrease picked"
                        onClick={() => bump(-1)}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        className="input flex-1 h-10 text-center font-mono text-base"
                        value={draft}
                        onChange={(e) =>
                          setDrafts({ ...drafts, [i.id]: Number(e.target.value) })
                        }
                      />
                      <button
                        type="button"
                        className="btn-secondary btn-sm h-10 w-10 text-lg"
                        aria-label="Increase picked"
                        onClick={() => bump(1)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="btn-brand btn-sm h-10 px-3"
                        aria-label="Mark all picked"
                        onClick={() =>
                          setDrafts({ ...drafts, [i.id]: target })
                        }
                      >
                        All
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <Card className="p-4 mt-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Activity</h3>
        <ActivityTimeline
          entries={activity}
          composer={
            <CommentComposer
              busy={posting}
              onSubmit={postComment}
              placeholder="Add a note for the team (⌘↵ to post)"
            />
          }
          empty="No activity yet. Submitting the list and posting comments will show here."
        />
      </Card>
    </>
  );
}
