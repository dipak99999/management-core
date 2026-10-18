import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "Buying";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/buying",                       label: "Overview",         icon: Icon.home },
    ],
  },
  {
    label: "Vendors",
    links: [
      { href: "/buying/suppliers",             label: "Suppliers",        icon: Icon.users },
    ],
  },
  {
    label: "Procurement",
    links: [
      { href: "/buying/request-for-quotations", label: "RFQ",              icon: Icon.book },
      { href: "/buying/supplier-quotations",    label: "Supplier Quotes",  icon: Icon.tag },
      { href: "/buying/supplier-scorecards",    label: "Scorecards",       icon: Icon.bar },
      { href: "/buying/purchase-orders",       label: "Purchase Orders",  icon: Icon.cart },
      { href: "/buying/purchase-invoices",     label: "Purchase Invoices", icon: Icon.invoice },
      { href: "/buying/ai-extract",            label: "AI Extract",       icon: Icon.megaphone },
    ],
  },
];
