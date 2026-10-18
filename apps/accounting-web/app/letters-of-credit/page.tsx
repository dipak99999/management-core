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

interface LC {
  id: string;
  lcNumber: string;
  lcType: string;
  issuingBank: string;
  advisingBank: string | null;
  beneficiaryName: string | null;
  issueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  utilizationPct: string;
  status: string;
}

export default function LettersOfCreditPage() {
  const [rows, setRows] = useState<LC[]>([]);
  const [form, setForm] = useState({
    lcNumber: "",
    lcType: "Import" as "Import" | "Export" | "Sight" | "Usance" | "Revolving",
    issuingBank: "",
    advisingBank: "",
    beneficiaryName: "",
    applicantName: "",
    issueDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    amount: "",
    currency: "USD",
    goodsDescription: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<LC[]>("/letters-of-credit"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  useEffect(() => {
    load();
  }, []);

  useListPageCommands({
    singular: "Letters Of Credit",
    plural: "Letters Of Credit",
    refresh: load,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post("/letters-of-credit", {
        lcNumber: form.lcNumber,
        lcType: form.lcType,
        issuingBank: form.issuingBank,
        advisingBank: form.advisingBank || null,
        beneficiaryName: form.beneficiaryName || null,
        applicantName: form.applicantName || null,
        issueDate: new Date(form.issueDate).toISOString(),
        expiryDate: new Date(form.expiryDate).toISOString(),
        amount: Number(form.amount),
        currency: form.currency,
        goodsDescription: form.goodsDescription || null,
      });
      setForm({ ...form, lcNumber: "", amount: "", goodsDescription: "" });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this LC?")) return;
    try {
      await api.del(`/letters-of-credit/${id}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }

  const columns: Column<LC>[] = [
    { header: "LC#", cell: (r) => r.lcNumber },
    { header: "Type", cell: (r) => r.lcType },
    { header: "Bank", cell: (r) => r.issuingBank },
    { header: "Beneficiary", cell: (r) => r.beneficiaryName ?? "—" },
    { header: "Issued", cell: (r) => dateShort(r.issueDate) },
    { header: "Expires", cell: (r) => dateShort(r.expiryDate) },
    { header: "Amount", align: "right", cell: (r) => money(Number(r.amount), r.currency) },
    { header: "Utilized %", align: "right", cell: (r) => `${Number(r.utilizationPct).toFixed(1)}%` },
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
        breadcrumb={[{ label: "Accounting", href: "/" }, { label: "Letters of Credit" }]}
        title="Letters of Credit"
        subtitle="Import / export LC issuance and utilization"
      />
      {err && <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
      <Card className="p-4 mb-4">
        <SectionHeader title="Register new LC" />
        <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <FormField label="LC#" required>
            <input className="input" required value={form.lcNumber} onChange={(e) => setForm({ ...form, lcNumber: e.target.value })} />
          </FormField>
          <FormField label="Type" required>
            <select className="input" value={form.lcType} onChange={(e) => setForm({ ...form, lcType: e.target.value as typeof form.lcType })}>
              <option value="Import">Import</option>
              <option value="Export">Export</option>
              <option value="Sight">Sight</option>
              <option value="Usance">Usance</option>
              <option value="Revolving">Revolving</option>
            </select>
          </FormField>
          <FormField label="Issuing Bank" required>
            <input className="input" required value={form.issuingBank} onChange={(e) => setForm({ ...form, issuingBank: e.target.value })} />
          </FormField>
          <FormField label="Advising Bank">
            <input className="input" value={form.advisingBank} onChange={(e) => setForm({ ...form, advisingBank: e.target.value })} />
          </FormField>
          <FormField label="Beneficiary">
            <input className="input" value={form.beneficiaryName} onChange={(e) => setForm({ ...form, beneficiaryName: e.target.value })} />
          </FormField>
          <FormField label="Applicant">
            <input className="input" value={form.applicantName} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} />
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
          <FormField label="Currency">
            <input className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </FormField>
          <FormField label="Goods">
            <input className="input" value={form.goodsDescription} onChange={(e) => setForm({ ...form, goodsDescription: e.target.value })} />
          </FormField>
          <div className="flex items-end">
            <Button variant="brand" type="submit" disabled={busy} className="w-full">
              {busy ? "Saving…" : "Register"}
            </Button>
          </div>
        </form>
      </Card>
      <Card className="p-0 overflow-hidden">
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} empty={{ title: "No LCs on file." }} />
      </Card>
    </>
  );
}
