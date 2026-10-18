"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useListPageCommands, SavedViewsControls } from "@lumaara/web-ui";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import {
  Button,
  DataTable,
  Drawer,
  FilterBar,
  FormField,
  PageHeader,
  Toast,
  dateShort,
  money,
  type Column,
} from "../../components/ui";
import { Icon } from "../../components/app-shell";

interface TdsCategory {
  id: string;
  name: string;
  sectionCode: string;
  rate: string;
  disabled: boolean;
}

interface TdsChallan {
  id: string;
  categoryId: string;
  bsrCode: string;
  challanSerialNo: string;
  paidDate: string;
  amountPaid: string | number;
  fyLabel: string;
  quarter: number;
  notes: string | null;
  createdAt: string;
  category?: { name: string; sectionCode: string };
}

const emptyForm = {
  categoryId: "",
  bsrCode: "",
  challanSerialNo: "",
  paidDate: "",
  amountPaid: 0,
  fyLabel: "",
  quarter: 0,
  notes: "",
};

function InnerTdsChallansPage() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");

  const [rows, setRows] = useState<TdsChallan[]>([]);
  const [categories, setCategories] = useState<TdsCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [c, cats] = await Promise.all([
        api.get<TdsChallan[]>("/tds-challans"),
        categories.length === 0
          ? api.get<TdsCategory[]>("/tax-withholding-categories")
          : Promise.resolve(categories),
      ]);
      setRows(c);
      if (categories.length === 0) setCategories(cats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // one-shot mount load — adding `load` as a dep would re-run on every
    // state change inside it (categories.length check).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useListPageCommands({
    singular: "Tds Challan",
    plural: "Tds Challans",
    refresh: load,
  });
  useEffect(() => {
    if (!editId) return;
    api
      .get<TdsChallan>(`/tds-challans/${editId}`)
      .then((c) => {
        setForm({
          categoryId: c.categoryId,
          bsrCode: c.bsrCode,
          challanSerialNo: c.challanSerialNo,
          paidDate: c.paidDate ? c.paidDate.slice(0, 10) : "",
          amountPaid: Number(c.amountPaid),
          fyLabel: c.fyLabel ?? "",
          quarter: c.quarter ?? 0,
          notes: c.notes ?? "",
        });
        setEditingId(c.id);
        setShowForm(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [editId]);

  function openNew() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.categoryId) {
      setError("Pick a TDS category");
      return;
    }
    if (!/^[0-9]{7}$/.test(form.bsrCode)) {
      setError("BSR code must be 7 digits");
      return;
    }
    try {
      const payload = {
        categoryId: form.categoryId,
        bsrCode: form.bsrCode,
        challanSerialNo: form.challanSerialNo,
        paidDate: form.paidDate ? new Date(form.paidDate).toISOString() : "",
        amountPaid: Number(form.amountPaid),
        fyLabel: form.fyLabel || undefined,
        quarter: form.quarter || undefined,
        notes: form.notes || null,
      };
      if (editingId) {
        await api.put(`/tds-challans/${editingId}`, payload);
        setMsg("Challan updated");
      } else {
        await api.post("/tds-challans", payload);
        setMsg("Challan recorded");
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function del(id: string) {
    if (deletingId) return;
    if (!confirm("Delete this challan? If it was linked to a 26Q return, re-generate the return.")) return;
    setDeletingId(id);
    try {
      await api.del(`/tds-challans/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) =>
      [c.bsrCode, c.challanSerialNo, c.fyLabel, c.category?.name, c.category?.sectionCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: Column<TdsChallan>[] = [
    {
      header: "Paid date",
      cell: (c) => <span className="font-medium">{dateShort(c.paidDate)}</span>,
    },
    {
      header: "Section",
      cell: (c) => (
        <span className="font-mono text-xs">
          {c.category?.sectionCode ?? "—"}
        </span>
      ),
    },
    {
      header: "Category",
      cell: (c) => <span className="text-ink-soft">{c.category?.name ?? "—"}</span>,
    },
    { header: "BSR", cell: (c) => <span className="font-mono text-xs">{c.bsrCode}</span> },
    {
      header: "Serial",
      cell: (c) => <span className="font-mono text-xs">{c.challanSerialNo}</span>,
    },
    {
      header: "FY / Q",
      cell: (c) => (
        <span className="text-ink-soft">
          {c.fyLabel} · Q{c.quarter}
        </span>
      ),
    },
    {
      header: "Amount",
      cell: (c) => <span className="font-mono">{money(Number(c.amountPaid))}</span>,
    },
    {
      header: "",
      cell: (c) => (
        <div className="flex items-center gap-2 justify-end">
          <button
            className="text-xs text-brand-700 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setForm({
                categoryId: c.categoryId,
                bsrCode: c.bsrCode,
                challanSerialNo: c.challanSerialNo,
                paidDate: c.paidDate ? c.paidDate.slice(0, 10) : "",
                amountPaid: Number(c.amountPaid),
                fyLabel: c.fyLabel ?? "",
                quarter: c.quarter ?? 0,
                notes: c.notes ?? "",
              });
              setEditingId(c.id);
              setShowForm(true);
            }}
          >
            Edit
          </button>
          <button
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={deletingId === c.id}
            onClick={(e) => {
              e.stopPropagation();
              void del(c.id);
            }}
          >
            {deletingId === c.id ? "Deleting…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  const activeCategories = categories.filter((c) => !c.disabled);

  return (
    <>
      <PageHeader
        icon={Icon.cash}
        title="TDS challans"
        subtitle="Bank challans for TDS deposited to the govt (Section 200). Each challan rolls up into the 26Q return + Form 16A for the quarter."
        actions={
          <Button variant="brand" onClick={openNew}>
            + Record challan
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <Toast kind="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {msg && (
        <div className="mb-4">
          <Toast kind="success" message={msg} onDismiss={() => setMsg(null)} />
        </div>
      )}

      <div className="space-y-4">
        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search by BSR, serial, FY, or category…",
          }}
          actions={<SavedViewsControls listKey="accounting-web:tds-challans" current={{ search }} onApply={(fv) => setSearch(fv.search)} />}
        />
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(c) => c.id}
          loading={loading}
          empty={{
            icon: Icon.cash,
            title: search ? "No matches" : "No challans yet",
            description: search
              ? "Try a different search term."
              : "After depositing deducted TDS to the bank, record the challan here so it links into your 26Q + Form 16A.",
            action: !search && (
              <Button variant="brand" onClick={openNew}>
                + Record first challan
              </Button>
            ),
          }}
        />
      </div>

      <Drawer
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
          setForm(emptyForm);
        }}
        title={editingId ? "Edit TDS challan" : "Record TDS challan"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancel
            </Button>
            <Button variant="brand" onClick={(e) => save(e as unknown as React.FormEvent)}>
              {editingId ? "Save changes" : "Record challan"}
            </Button>
          </>
        }
      >
        <form onSubmit={save} className="space-y-4">
          <FormField label="TDS category / section" required>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              required
            >
              <option value="">— Pick a category —</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.sectionCode} — {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="BSR code (7 digits)" required>
            <input
              className="input font-mono"
              placeholder="0510308"
              value={form.bsrCode}
              onChange={(e) => setForm({ ...form, bsrCode: e.target.value })}
              required
              maxLength={7}
              pattern="[0-9]{7}"
            />
          </FormField>
          <FormField label="Challan serial no" required>
            <input
              className="input font-mono"
              placeholder="00001"
              value={form.challanSerialNo}
              onChange={(e) => setForm({ ...form, challanSerialNo: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Paid date" required>
            <input
              className="input"
              type="date"
              value={form.paidDate}
              onChange={(e) => setForm({ ...form, paidDate: e.target.value })}
              required
            />
          </FormField>
          <FormField label="Amount paid (₹)" required>
            <input
              className="input"
              type="number"
              min={0}
              step="0.01"
              value={form.amountPaid}
              onChange={(e) => setForm({ ...form, amountPaid: Number(e.target.value) || 0 })}
              required
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="FY label (optional override)" hint="Auto-derived from paid date if blank.">
              <input
                className="input"
                placeholder="2024-25"
                value={form.fyLabel}
                onChange={(e) => setForm({ ...form, fyLabel: e.target.value })}
              />
            </FormField>
            <FormField label="Quarter (optional override)">
              <select
                className="input"
                value={form.quarter}
                onChange={(e) => setForm({ ...form, quarter: Number(e.target.value) })}
              >
                <option value={0}>Auto</option>
                <option value={1}>Q1 (Apr–Jun)</option>
                <option value={2}>Q2 (Jul–Sep)</option>
                <option value={3}>Q3 (Oct–Dec)</option>
                <option value={4}>Q4 (Jan–Mar)</option>
              </select>
            </FormField>
          </div>
          <FormField label="Notes">
            <textarea
              className="input min-h-[60px]"
              placeholder="Optional notes — e.g. 'includes July + August deductions'"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </FormField>
          <button type="submit" className="hidden" />
        </form>
      </Drawer>
    </>
  );
}

export default function TdsChallansPage() {
  return (
    <Suspense fallback={null}>
      <InnerTdsChallansPage />
    </Suspense>
  );
}
