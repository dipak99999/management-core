"use client";

import { useEffect, useState } from "react";
import { useListPageCommands } from "@lumaara/web-ui";
import { api } from "../../lib/api";
import {
  Button,
  Card,
  DataTable,
  FormField,
  PageHeader,
  SectionHeader,
  StatusBadge,
  dateShort,
  money,
  type Column,
} from "../../components/ui";

interface BG {
  id: string;
  bgNumber: string;
  bankName: string;
  bgType: string;
  beneficiaryName: string | null;
  issueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  status: string;
  commissionAmount: string | null;
  supplier: { id: string; supplierName: string } | null;
  customer: { id: string; customerName: string } | null;
}

export default function BankGuaranteesPage() {
  const [rows, setRows] = useState<BG[]>([]);
  const [form, setForm] = useState({
    bgNumber: "",
    bankName: "",
    bgType: "Performance" as "Performance" | "Financial" | "Bid" | "Advance",
    beneficiaryName: "",
    issueDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    amount: "",
    currency: "INR",
    commissionAmount: "",
    purpose: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<BG[]>("/bank-guarantees"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Bank Guarantee",
    plural: "Bank Guarantees",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/bank-guarantees", {
        bgNumber: form.bgNumber,
        bankName: form.bankName,
        bgType: form.bgType,
        beneficiaryName: form.beneficiaryName || null,
        issueDate: new Date(form.issueDate).toISOString(),
        expiryDate: new Date(form.expiryDate).toISOString(),
        amount: Number(form.amount),
        currency: form.currency,
        commissionAmount: form.commissionAmount ? Number(form.commissionAmount) : null,
        purpose: form.purpose || null,
      });
      setForm({ ...form, bgNumber: "", amount: "", commissionAmount: "", purpose: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this BG?")) return;
    try {
      await api.del(`/bank-guarantees/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<BG>[] = [
    { header: "BG#", cell: (r) => r.bgNumber },
    { header: "Bank", cell: (r) => r.bankName },
    { header: "Type", cell: (r) => r.bgType },
    { header: "Beneficiary", cell: (r) => r.beneficiaryName ?? r.supplier?.supplierName ?? r.customer?.customerName ?? "—" },
    { header: "Issued", cell: (r) => dateShort(r.issueDate) },
    { header: "Expires", cell: (r) => dateShort(r.expiryDate) },
    { header: "Amount", align: "right", cell: (r) => money(Number(r.amount), r.currency) },
    { header: "Commission", align: "right", cell: (r) => (r.commissionAmount ? money(Number(r.commissionAmount)) : "—") },
    {
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="sm" onClick={() => remove(r.id)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Accounting", href: "/" }, { label: "Bank Guarantees" }]}
        title="Bank Guarantees"
        subtitle="Track BG issuance, expiry, and commission"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="Register new BG" />
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FormField label="BG#" required>
            <input className="input" required value={form.bgNumber} onChange={(e) => setForm({ ...form, bgNumber: e.target.value })} />
          </FormField>
          <FormField label="Bank" required>
            <input className="input" required value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </FormField>
          <FormField label="Type" required>
            <select
              className="input"
              value={form.bgType}
              onChange={(e) => setForm({ ...form, bgType: e.target.value as typeof form.bgType })}
            >
              <option value="Performance">Performance</option>
              <option value="Financial">Financial</option>
              <option value="Bid">Bid</option>
              <option value="Advance">Advance</option>
            </select>
          </FormField>
          <FormField label="Beneficiary">
            <input className="input" value={form.beneficiaryName} onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })} />
          </FormField>
          <FormField label="Issue Date" required>
            <input type="date" className="input" required value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} />
          </FormField>
          <FormField label="Expiry Date" required>
            <input type="date" className="input" required value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          </FormField>
          <FormField label="Amount" required>
            <input type="number" step="0.01" className="input" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </FormField>
          <FormField label="Commission">
            <input type="number" step="0.01" className="input" value={form.commissionAmount} onChange={(e) => setForm({ ...form, commissionAmount: e.target.value })} />
          </FormField>
          <FormField label="Purpose">
            <input className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
          </FormField>
          <div className="flex items-end">
            <Button variant="brand" type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Register"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-0 overflow-hidden">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No BGs on file." }} />
      </Card>
    </>
  );
}
