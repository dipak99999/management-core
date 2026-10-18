"use client";

import { PageHeader, Card } from "../components/ui";

export default function BuyingHome() {
  const tiles: { href: string; title: string; description: string }[] = [
    {
      href: "/buying/suppliers",
      title: "Suppliers",
      description: "Vendors you purchase from — contact info, GSTIN, bills, payments.",
    },
    {
      href: "/buying/purchase-orders",
      title: "Purchase Orders",
      description: "Orders raised on suppliers, receipt progress, subcontracting.",
    },
    {
      href: "/buying/purchase-invoices",
      title: "Purchase Invoices",
      description: "Supplier bills, tax, outstanding, applied payments.",
    },
  ];

  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Buying" }]}
        title="Buying"
        subtitle="Suppliers, orders, and bills"
      />
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <a key={t.href} href={t.href} className="block group">
            <Card className="p-5 h-full transition group-hover:border-brand-200 group-hover:shadow-brand-sm">
              <h3 className="font-semibold text-ink group-hover:text-brand-700">
                {t.title}
              </h3>
              <p className="text-sm text-ink-muted mt-1">{t.description}</p>
            </Card>
          </a>
        ))}
      </section>
    </main>
  );
}
