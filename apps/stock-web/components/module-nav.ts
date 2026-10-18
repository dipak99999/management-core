import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "Stock";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/stock",                          label: "Overview",           icon: Icon.home },
    ],
  },
  {
    label: "Warehouses",
    links: [
      { href: "/stock/warehouses",               label: "Warehouses",         icon: Icon.box },
      { href: "/stock/workstations",             label: "Workstations",       icon: Icon.settings },
      { href: "/stock/batches",                  label: "Batches",            icon: Icon.layers },
      { href: "/stock/serial-numbers",           label: "Serial Numbers",     icon: Icon.tag },
    ],
  },
  {
    label: "Movements",
    links: [
      { href: "/stock/stock-entries",            label: "Stock Entries",      icon: Icon.send },
      { href: "/stock/delivery-notes",           label: "Delivery Notes",     icon: Icon.cart },
      { href: "/stock/pick-lists",               label: "Pick Lists",         icon: Icon.clipboard },
      { href: "/stock/delivery-trips",           label: "Delivery Trips",     icon: Icon.send },
      { href: "/stock/purchase-receipts",        label: "Purchase Receipts",  icon: Icon.box },
      { href: "/stock/material-requests",        label: "Material Requests",  icon: Icon.clipboard },
      { href: "/stock/stock-reconciliations",    label: "Stock Recon.",       icon: Icon.layers },
      { href: "/stock/reorder-rules",            label: "Reorder Rules",      icon: Icon.settings },
    ],
  },
  {
    label: "Manufacturing",
    links: [
      { href: "/stock/boms",                     label: "BOMs",               icon: Icon.book },
      { href: "/stock/bom-tools",                label: "BOM Tools",          icon: Icon.settings },
      { href: "/stock/work-orders",              label: "Work Orders",        icon: Icon.briefcase },
      { href: "/stock/job-cards",                label: "Job Cards",          icon: Icon.clipboard },
      { href: "/stock/production-plans",         label: "Production Plans",   icon: Icon.calendar },
      { href: "/stock/routing-masters",          label: "Routing Masters",    icon: Icon.layers },
    ],
  },
  {
    label: "Materials",
    links: [
      { href: "/stock/material-issues",          label: "Material Issues",    icon: Icon.send },
      { href: "/stock/material-transfers",       label: "Material Transfers", icon: Icon.send },
      { href: "/stock/material-returns",         label: "Material Returns",   icon: Icon.box },
      { href: "/stock/weighments",               label: "Weighments",         icon: Icon.bar },
      { href: "/stock/inward-outward-notes",     label: "IO Notes",           icon: Icon.clipboard },
    ],
  },
  {
    label: "Planning",
    links: [
      { href: "/stock/mrp-runs",                 label: "MRP Runs",           icon: Icon.settings },
      { href: "/stock/item-site-plannings",      label: "Item-Site Plan",     icon: Icon.layers },
      { href: "/stock/sales-enquiries",          label: "Sales Enquiries",    icon: Icon.target },
    ],
  },
  {
    label: "Plant Maintenance",
    links: [
      { href: "/stock/maintenance-requests",     label: "Requests",           icon: Icon.clipboard },
      { href: "/stock/maintenance-schedules",    label: "Schedules",          icon: Icon.calendar },
      { href: "/stock/maintenance-actions",      label: "Actions",            icon: Icon.settings },
      { href: "/stock/machine-loggers",          label: "Machine Log",        icon: Icon.clock },
    ],
  },
  {
    label: "Quality",
    links: [
      { href: "/stock/quality-inspections",      label: "Inspections",        icon: Icon.shield },
      { href: "/stock/quality-inspection-templates", label: "Templates",      icon: Icon.clipboard },
    ],
  },
  {
    label: "Analytics",
    links: [
      { href: "/stock/mfg-analytics",            label: "Mfg Dashboards",     icon: Icon.bar },
    ],
  },
  {
    label: "Reports",
    links: [
      { href: "/stock/reports/stock-balance",    label: "Stock Balance",      icon: Icon.bar },
      { href: "/stock/reports/stock-aging",      label: "Stock Aging",        icon: Icon.clock },
      { href: "/stock/reports/abc-analysis",     label: "ABC Analysis",       icon: Icon.bar },
    ],
  },
];
