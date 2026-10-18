import { Icon, type NavGroup } from "./app-shell";

export const MODULE_NAME = "CRM";
export const MODULE_NAV: NavGroup[] = [
  {
    links: [
      { href: "/crm",                    label: "Overview",       icon: Icon.home },
    ],
  },
  {
    label: "Team",
    links: [
      { href: "/crm/cliq",               label: "Team Chat",      icon: Icon.megaphone },
    ],
  },
  {
    label: "SalesIQ",
    links: [
      { href: "/crm/salesiq/inbox",      label: "Chat Inbox",     icon: Icon.megaphone },
      { href: "/crm/salesiq/visitors",   label: "Live Visitors",  icon: Icon.users },
      { href: "/crm/salesiq/settings",   label: "Widget Setup",   icon: Icon.settings },
    ],
  },
  {
    label: "Desk",
    links: [
      { href: "/crm/desk/inbox",  label: "Ticket Inbox",      icon: Icon.clipboard },
      { href: "/crm/desk/sla",    label: "SLA Policies",      icon: Icon.shield },
      { href: "/crm/desk/rules",  label: "Assignment Rules",  icon: Icon.layers },
      { href: "/crm/desk/canned", label: "Canned Responses",  icon: Icon.book },
      { href: "/crm/kb-articles", label: "Knowledge Base",    icon: Icon.book },
      { href: "/crm/service-contracts", label: "Service Contracts", icon: Icon.shield },
    ],
  },
  {
    label: "Pipeline",
    links: [
      { href: "/crm/leads",              label: "Leads",          icon: Icon.target },
      { href: "/crm/opportunities",      label: "Opportunities",  icon: Icon.target },
      { href: "/crm/quotations",         label: "Quotations",     icon: Icon.invoice },
      { href: "/crm/sales-orders",       label: "Sales Orders",   icon: Icon.cart },
    ],
  },
  {
    label: "Engagement",
    links: [
      { href: "/crm/activities",         label: "Activities",     icon: Icon.clipboard },
      { href: "/crm/contact-lists",      label: "Contact Lists",  icon: Icon.users },
      { href: "/crm/surveys",            label: "Surveys",        icon: Icon.clipboard },
      { href: "/crm/sequences",          label: "Email Sequences", icon: Icon.send },
      { href: "/crm/meetings",           label: "Meetings",       icon: Icon.calendar },
      { href: "/crm/meetings/bookings",  label: "Booked Meetings", icon: Icon.calendar },
    ],
  },
  {
    label: "Marketing",
    links: [
      { href: "/crm/campaigns",          label: "Campaigns",      icon: Icon.megaphone },
      { href: "/crm/journeys",           label: "Journeys",       icon: Icon.layers },
      { href: "/crm/web-forms",          label: "Web Forms",      icon: Icon.clipboard },
      { href: "/crm/landing-pages",      label: "Landing Pages",  icon: Icon.book },
      { href: "/crm/webinars",           label: "Webinars",       icon: Icon.calendar },
    ],
  },
  {
    label: "Website",
    links: [
      { href: "/crm/web-pages",          label: "Pages",          icon: Icon.book },
      { href: "/crm/blog-posts",         label: "Blog",           icon: Icon.book },
      { href: "/crm/shop-items",         label: "Shop Items",     icon: Icon.cart },
    ],
  },
  {
    label: "Messaging",
    links: [
      { href: "/crm/sms",                label: "SMS",            icon: Icon.send },
      { href: "/crm/sms/templates",      label: "SMS Templates",  icon: Icon.book },
      { href: "/crm/whatsapp",           label: "WhatsApp",       icon: Icon.megaphone },
      { href: "/crm/whatsapp/inbox",     label: "WA Inbox",       icon: Icon.clipboard },
      { href: "/crm/whatsapp/templates", label: "WA Templates",   icon: Icon.book },
    ],
  },
  {
    label: "Social",
    links: [
      { href: "/crm/social/composer", label: "Compose",           icon: Icon.send },
      { href: "/crm/social/calendar", label: "Calendar",          icon: Icon.calendar },
      { href: "/crm/social/inbox",    label: "Engagement Inbox",  icon: Icon.megaphone },
      { href: "/crm/social/accounts", label: "Channels",          icon: Icon.users },
      { href: "/crm/social/monitors", label: "Monitors",          icon: Icon.target },
    ],
  },
  {
    label: "Tools",
    links: [
      { href: "/crm/party-search",       label: "Party Search",   icon: Icon.users },
    ],
  },
  {
    label: "Warranty & Service",
    links: [
      { href: "/crm/warranties",         label: "Warranties",     icon: Icon.shield },
      { href: "/crm/purchase-warranties",label: "Purchase Warranty", icon: Icon.shield },
    ],
  },
  {
    label: "Field & Targets",
    links: [
      { href: "/crm/auto-dealers",       label: "Auto Dealers",   icon: Icon.users },
      { href: "/crm/crm-targets",        label: "Targets",        icon: Icon.target },
      { href: "/crm/daily-worksheets",   label: "Daily Worksheet",icon: Icon.clipboard },
      { href: "/crm/work-plans",         label: "Work Plans",     icon: Icon.calendar },
      { href: "/crm/location-captures",  label: "Location Log",   icon: Icon.target },
      { href: "/crm/crm-processes",      label: "Processes",      icon: Icon.layers },
      { href: "/crm/project-plannings",  label: "Project Planning",icon: Icon.book },
    ],
  },
  {
    label: "Analytics",
    links: [
      { href: "/crm/crm-analytics",       label: "CRM Dashboards", icon: Icon.bar },
    ],
  },
  {
    label: "Reports",
    links: [
      { href: "/crm/reports/sales-analytics", label: "Sales Analytics", icon: Icon.bar },
      { href: "/crm/reports/so-fulfillment",  label: "SO Fulfillment",  icon: Icon.bar },
    ],
  },
];
