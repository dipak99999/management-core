import { Router } from "express";
import { prisma } from "@lumaara/db";

// Topbar Cmd+K global search. Runs 12 parallel Prisma lookups against the
// most-searchable columns of every major doctype and returns a grouped
// response the shell renders as a dropdown. Auth is enforced by the parent
// `requireAuth` mount in index.ts; per-doctype perms are intentionally NOT
// checked here — the response only exposes id + display fields (name, code,
// email, description) that any authenticated tenant user can already see via
// autocomplete UIs across the app. Row-level RLS remains via `tenantId`.

export const globalSearchRouter = Router();

interface GroupResult {
  doctype: string;          // "Customer", "Item", ...
  label: string;            // "Customers"
  url: string;              // list page (dropdown group header link)
  results: Array<{
    id: string;
    title: string;          // primary display
    subtitle?: string;      // secondary display (email, code, status)
    url: string;            // canonical detail page
  }>;
}

const PER_DOCTYPE_LIMIT = 5;

globalSearchRouter.post("/", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const body = req.body as { q?: unknown; limit?: unknown };
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const limit = Math.min(
    Math.max(Number(body.limit) || PER_DOCTYPE_LIMIT, 1),
    10,
  );
  if (q.length < 2) return res.json({ groups: [] });

  const ci = { contains: q, mode: "insensitive" as const };
  const bare = { contains: q };

  const [
    customers,
    suppliers,
    items,
    salesInvoices,
    purchaseInvoices,
    salesOrders,
    purchaseOrders,
    leads,
    opportunities,
    quotations,
    employees,
    projects,
  ] = await Promise.all([
    prisma.customer.findMany({
      where: {
        tenantId,
        OR: [
          { customerName: ci },
          { email: ci },
          { mobile: bare },
          { gstin: bare },
        ],
      },
      select: { id: true, customerName: true, email: true, mobile: true },
      take: limit,
    }),
    prisma.supplier.findMany({
      where: {
        tenantId,
        OR: [
          { supplierName: ci },
          { email: ci },
          { mobile: bare },
          { gstin: bare },
        ],
      },
      select: { id: true, supplierName: true, email: true, mobile: true },
      take: limit,
    }),
    prisma.item.findMany({
      where: {
        tenantId,
        OR: [
          { itemCode: ci },
          { itemName: ci },
          { description: ci },
          { hsnCode: bare },
        ],
      },
      select: {
        id: true,
        itemCode: true,
        itemName: true,
        itemGroup: true,
      },
      take: limit,
    }),
    prisma.salesInvoice.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { remarks: ci },
          { customer: { customerName: ci } },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        grandTotal: true,
        customer: { select: { customerName: true } },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { supplierInvoiceNo: ci },
          { remarks: ci },
          { supplier: { supplierName: ci } },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        grandTotal: true,
        supplier: { select: { supplierName: true } },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesOrder.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { remarks: ci },
          { customer: { customerName: ci } },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        grandTotal: true,
        customer: { select: { customerName: true } },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { remarks: ci },
          { supplier: { supplierName: ci } },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        grandTotal: true,
        supplier: { select: { supplierName: true } },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.lead.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { leadName: ci },
          { companyName: ci },
          { email: ci },
          { mobile: bare },
        ],
      },
      select: {
        id: true,
        name: true,
        leadName: true,
        companyName: true,
        status: true,
      },
      take: limit,
    }),
    prisma.opportunity.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { remarks: ci },
          { source: ci },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        expectedAmount: true,
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.quotation.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { remarks: ci },
          { customer: { customerName: ci } },
          { lead: { leadName: ci } },
        ],
      },
      select: {
        id: true,
        name: true,
        status: true,
        grandTotal: true,
        customer: { select: { customerName: true } },
        lead: { select: { leadName: true } },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.employee.findMany({
      where: {
        tenantId,
        OR: [
          { employeeCode: ci },
          { employeeName: ci },
          { email: ci },
          { mobile: bare },
          { designation: ci },
          { department: ci },
        ],
      },
      select: {
        id: true,
        employeeCode: true,
        employeeName: true,
        designation: true,
        department: true,
      },
      take: limit,
    }),
    prisma.project.findMany({
      where: {
        tenantId,
        OR: [
          { name: ci },
          { projectName: ci },
          { notes: ci },
        ],
      },
      select: {
        id: true,
        name: true,
        projectName: true,
        status: true,
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const money = (v: unknown): string => {
    // Prisma Decimal → number; fine for display.
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";
  };

  const groups: GroupResult[] = [
    {
      doctype: "Customer",
      label: "Customers",
      url: "/accounting/customers",
      results: customers.map((c) => ({
        id: c.id,
        title: c.customerName,
        subtitle: c.email ?? c.mobile ?? undefined,
        url: `/accounting/customers/${c.id}`,
      })),
    },
    {
      doctype: "Supplier",
      label: "Suppliers",
      url: "/buying/suppliers",
      results: suppliers.map((s) => ({
        id: s.id,
        title: s.supplierName,
        subtitle: s.email ?? s.mobile ?? undefined,
        url: `/buying/suppliers/${s.id}`,
      })),
    },
    {
      doctype: "Item",
      label: "Items",
      url: "/accounting/items",
      results: items.map((i) => ({
        id: i.id,
        title: `${i.itemCode} — ${i.itemName}`,
        subtitle: i.itemGroup ?? undefined,
        url: `/accounting/items/${i.id}`,
      })),
    },
    {
      doctype: "SalesInvoice",
      label: "Sales Invoices",
      url: "/accounting/sales-invoices",
      results: salesInvoices.map((si) => ({
        id: si.id,
        title: si.name,
        subtitle: [si.customer?.customerName, si.status, money(si.grandTotal)]
          .filter(Boolean)
          .join(" · "),
        url: `/accounting/sales-invoices/${si.id}`,
      })),
    },
    {
      doctype: "PurchaseInvoice",
      label: "Purchase Invoices",
      url: "/buying/purchase-invoices",
      results: purchaseInvoices.map((pi) => ({
        id: pi.id,
        title: pi.name,
        subtitle: [pi.supplier?.supplierName, pi.status, money(pi.grandTotal)]
          .filter(Boolean)
          .join(" · "),
        url: `/buying/purchase-invoices/${pi.id}`,
      })),
    },
    {
      doctype: "SalesOrder",
      label: "Sales Orders",
      url: "/crm/sales-orders",
      results: salesOrders.map((so) => ({
        id: so.id,
        title: so.name,
        subtitle: [so.customer?.customerName, so.status, money(so.grandTotal)]
          .filter(Boolean)
          .join(" · "),
        url: `/crm/sales-orders/${so.id}`,
      })),
    },
    {
      doctype: "PurchaseOrder",
      label: "Purchase Orders",
      url: "/buying/purchase-orders",
      results: purchaseOrders.map((po) => ({
        id: po.id,
        title: po.name,
        subtitle: [po.supplier?.supplierName, po.status, money(po.grandTotal)]
          .filter(Boolean)
          .join(" · "),
        url: `/buying/purchase-orders/${po.id}`,
      })),
    },
    {
      doctype: "Lead",
      label: "Leads",
      url: "/crm/leads",
      results: leads.map((l) => ({
        id: l.id,
        title: l.companyName ? `${l.leadName} (${l.companyName})` : l.leadName,
        subtitle: [l.name, l.status].filter(Boolean).join(" · "),
        url: `/crm/leads/${l.id}`,
      })),
    },
    {
      doctype: "Opportunity",
      label: "Opportunities",
      url: "/crm/opportunities",
      results: opportunities.map((o) => ({
        id: o.id,
        title: o.name,
        subtitle: [o.status, money(o.expectedAmount)].filter(Boolean).join(" · "),
        url: `/crm/opportunities/${o.id}`,
      })),
    },
    {
      doctype: "Quotation",
      label: "Quotations",
      url: "/crm/quotations",
      results: quotations.map((q2) => ({
        id: q2.id,
        title: q2.name,
        subtitle: [
          q2.customer?.customerName ?? q2.lead?.leadName,
          q2.status,
          money(q2.grandTotal),
        ]
          .filter(Boolean)
          .join(" · "),
        url: `/crm/quotations/${q2.id}`,
      })),
    },
    {
      doctype: "Employee",
      label: "Employees",
      url: "/hr/employees",
      results: employees.map((e) => ({
        id: e.id,
        title: `${e.employeeCode} — ${e.employeeName}`,
        subtitle: [e.designation, e.department].filter(Boolean).join(" · ") || undefined,
        url: `/hr/employees/${e.id}`,
      })),
    },
    {
      doctype: "Project",
      label: "Projects",
      url: "/projects/projects",
      results: projects.map((p) => ({
        id: p.id,
        title: p.projectName,
        subtitle: [p.name, p.status].filter(Boolean).join(" · "),
        url: `/projects/projects/${p.id}`,
      })),
    },
  ].filter((g) => g.results.length > 0);

  res.json({ groups });
});
