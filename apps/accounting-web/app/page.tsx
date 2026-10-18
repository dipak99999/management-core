import { PageHeader } from "../components/ui";

export default function AccountingHome() {
  return (
    <main className="p-8 space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Accounting" }]}
        title="Accounting"
        subtitle="Customers, sales invoices, payments, and financial reports."
      />
      <p className="text-ink-soft">
        Choose <a className="text-brand-600 hover:underline" href="/accounting/customers">Customers</a> or{" "}
        <a className="text-brand-600 hover:underline" href="/accounting/sales-invoices">Sales Invoices</a>.
      </p>
    </main>
  );
}
