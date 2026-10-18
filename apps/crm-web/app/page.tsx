import { Card, PageHeader } from "../components/ui";

const links = [
  { href: "/crm/leads", label: "Leads", desc: "Prospects and sales funnel entries" },
  { href: "/crm/opportunities", label: "Opportunities", desc: "Qualified deals in progress" },
  { href: "/crm/quotations", label: "Quotations", desc: "Price quotes issued to prospects" },
  { href: "/crm/sales-orders", label: "Sales Orders", desc: "Confirmed customer orders" },
  { href: "/crm/campaigns", label: "Campaigns", desc: "Email + multi-channel outreach" },
  { href: "/crm/contact-lists", label: "Contact Lists", desc: "Static + dynamic audience segments" },
  { href: "/crm/sequences", label: "Email Sequences", desc: "Automated drip campaigns" },
  { href: "/crm/landing-pages", label: "Landing Pages", desc: "Public capture pages" },
  { href: "/crm/web-forms", label: "Web Forms", desc: "Embeddable lead capture" },
  { href: "/crm/surveys", label: "Surveys", desc: "Customer feedback + NPS" },
  { href: "/crm/desk/inbox", label: "Desk", desc: "Support ticket inbox" },
  { href: "/crm/salesiq/inbox", label: "SalesIQ", desc: "Live chat + visitor tracking" },
  { href: "/crm/party-search", label: "Party Search", desc: "Find customers, leads, contacts" },
];

export default function CRMHome() {
  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "CRM" }]}
        title="CRM"
        subtitle="Lead → Convert → Customer → Quotation → Sales Order → Sales Invoice"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {links.map((l) => (
          <a key={l.href} href={l.href} className="block">
            <Card className="p-4 hover:shadow-brand-glow transition">
              <div className="font-semibold text-ink">{l.label}</div>
              <div className="text-sm text-ink-muted mt-1">{l.desc}</div>
            </Card>
          </a>
        ))}
      </div>
    </main>
  );
}
