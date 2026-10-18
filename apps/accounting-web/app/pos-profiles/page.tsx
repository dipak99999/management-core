"use client";

// Manager list of POS profiles. Each row → detail/edit; header button →
// create a new one.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { PageHeader, Card, Button } from "../../components/ui";

type Row = {
  id: string;
  name: string;
  title: string;
  disabled: boolean;
  warehouse?: { warehouseName: string } | null;
  priceList?: { name: string; currency: string } | null;
  defaultCustomer?: { customerName: string } | null;
  paymentMethods: { mode: string }[];
};

export default function POSProfilesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Row[]>("/pos-profiles")
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="p-6">
      <PageHeader
        title="POS Profiles"
        subtitle="Cashier-terminal configuration: warehouse, price list, walk-in customer, accepted payment methods."
        actions={
          <Link href="/accounting/pos-profiles/new">
            <Button>New profile</Button>
          </Link>
        }
      />
      {error && <div className="mt-3 text-danger">{error}</div>}
      <Card className="mt-4">
        <table className="w-full text-sm">
          <thead className="text-start text-xs text-ink-muted uppercase">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Warehouse</th>
              <th className="p-3">Price list</th>
              <th className="p-3">Default customer</th>
              <th className="p-3">Payment methods</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-ink-muted">
                  No POS profiles configured yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-surface-2">
                <td className="p-3">
                  <Link href={`/accounting/pos-profiles/${r.id}`} className="text-brand-600">
                    {r.title}
                  </Link>
                  <div className="text-xs text-ink-muted">{r.name}</div>
                </td>
                <td className="p-3">{r.warehouse?.warehouseName ?? "—"}</td>
                <td className="p-3">{r.priceList?.name ?? "—"}</td>
                <td className="p-3">{r.defaultCustomer?.customerName ?? "—"}</td>
                <td className="p-3">
                  {r.paymentMethods.map((m) => m.mode).join(", ")}
                </td>
                <td className="p-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${r.disabled ? "bg-surface-2 text-ink-muted" : "bg-brand-50 text-brand-600"}`}
                  >
                    {r.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
