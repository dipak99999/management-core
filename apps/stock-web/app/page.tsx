import { Card, PageHeader } from "../components/ui";

interface Tile {
  label: string;
  href: string;
  description: string;
}

const TILES: Tile[] = [
  { label: "Warehouses",             href: "/stock/warehouses",              description: "Manage locations and stock-holding bins." },
  { label: "Stock Entries",          href: "/stock/stock-entries",           description: "Receipts, issues, transfers, repack." },
  { label: "Delivery Notes",         href: "/stock/delivery-notes",          description: "Ship stock to customers." },
  { label: "Purchase Receipts",      href: "/stock/purchase-receipts",       description: "Receive goods from suppliers." },
  { label: "Material Requests",      href: "/stock/material-requests",       description: "Internal purchase/transfer requests." },
  { label: "Stock Reconciliations",  href: "/stock/stock-reconciliations",   description: "Physical count adjustments." },
  { label: "BOMs",                   href: "/stock/boms",                    description: "Bill-of-materials for finished goods." },
  { label: "Work Orders",            href: "/stock/work-orders",             description: "Manufacture finished goods from a BOM." },
  { label: "Production Plans",       href: "/stock/production-plans",        description: "Roll up demand → work orders." },
  { label: "Job Cards",              href: "/stock/job-cards",               description: "Shop-floor operation tracking." },
  { label: "Workstations",           href: "/stock/workstations",            description: "Production resources and hour rates." },
  { label: "BOM Tools",              href: "/stock/bom-tools",               description: "Cost refresh, bulk item replace." },
  { label: "Batches",                href: "/stock/batches",                 description: "Batch-tracked inventory." },
  { label: "Serial Numbers",         href: "/stock/serial-numbers",          description: "Serial-tracked inventory." },
  { label: "Reorder Rules",          href: "/stock/reorder-rules",           description: "Automatic replenishment triggers." },
  { label: "Quality Inspections",    href: "/stock/quality-inspections",     description: "Incoming/outgoing QA." },
  { label: "QA Templates",           href: "/stock/quality-inspection-templates", description: "Reusable QA checklists." },
  { label: "Stock Balance",          href: "/stock/reports/stock-balance",   description: "On-hand by warehouse." },
  { label: "Stock Aging",            href: "/stock/reports/stock-aging",     description: "FIFO age buckets." },
  { label: "ABC Analysis",           href: "/stock/reports/abc-analysis",    description: "Revenue-ranked items." },
];

export default function StockHome() {
  return (
    <main className="p-8 space-y-6">
      <PageHeader
        breadcrumb={[{ label: "Home", href: "/" }, { label: "Stock" }]}
        title="Stock"
        subtitle="Inventory, manufacturing, and stock-movement operations"
      />
      <section className="grid grid-cols-3 gap-3">
        {TILES.map((t) => (
          <a key={t.href} href={t.href} className="block">
            <Card className="p-4 hover:bg-brand-50 transition-colors h-full">
              <div className="font-semibold text-ink">{t.label}</div>
              <div className="text-sm text-ink-muted mt-1">{t.description}</div>
            </Card>
          </a>
        ))}
      </section>
    </main>
  );
}
