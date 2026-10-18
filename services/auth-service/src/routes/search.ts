import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const searchRouter = Router();
searchRouter.use(requireAuth);

/**
 * Global cross-doctype search for the ⌘K palette. Takes `?q=<term>` and
 * returns at most 10 matches from each of a curated set of high-signal
 * doctypes.
 *
 * Match strategy: case-insensitive `contains` on the human-facing name
 * fields. Keeps the implementation Postgres-portable without pulling in
 * trigram or FTS extensions — fine at this scale.
 *
 * Response shape: flat array of hits keyed by doctype + id so the
 * palette can render results as commands.
 */
searchRouter.get("/", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.json([]);

  type Hit = {
    doctype: string;
    id: string;
    title: string;
    subtitle?: string;
    href: string;
  };
  const take = 5;
  const ic = "insensitive" as const;

  const [customers, suppliers, items, invoices, pos, dns, picks, leads, employees, projects] =
    await Promise.all([
      prisma.customer.findMany({
        where: { tenantId, customerName: { contains: q, mode: ic } },
        select: { id: true, customerName: true, customerGroup: true },
        take,
      }),
      prisma.supplier.findMany({
        where: { tenantId, supplierName: { contains: q, mode: ic } },
        select: { id: true, supplierName: true, supplierGroup: true },
        take,
      }),
      prisma.item.findMany({
        where: {
          tenantId,
          OR: [{ itemName: { contains: q, mode: ic } }, { itemCode: { contains: q, mode: ic } }],
        },
        select: { id: true, itemName: true, itemCode: true },
        take,
      }),
      prisma.salesInvoice.findMany({
        where: {
          tenantId,
          OR: [{ name: { contains: q, mode: ic } }, { customer: { customerName: { contains: q, mode: ic } } }],
        },
        select: { id: true, name: true, status: true, customer: { select: { customerName: true } } },
        take,
      }),
      prisma.purchaseOrder.findMany({
        where: {
          tenantId,
          OR: [{ name: { contains: q, mode: ic } }, { supplier: { supplierName: { contains: q, mode: ic } } }],
        },
        select: { id: true, name: true, status: true, supplier: { select: { supplierName: true } } },
        take,
      }),
      prisma.deliveryNote.findMany({
        where: {
          tenantId,
          OR: [{ name: { contains: q, mode: ic } }, { customer: { customerName: { contains: q, mode: ic } } }],
        },
        select: { id: true, name: true, status: true, customer: { select: { customerName: true } } },
        take,
      }),
      prisma.pickList.findMany({
        where: { tenantId, name: { contains: q, mode: ic } },
        select: { id: true, name: true, status: true },
        take,
      }),
      prisma.lead.findMany({
        where: {
          tenantId,
          OR: [{ leadName: { contains: q, mode: ic } }, { companyName: { contains: q, mode: ic } }],
        },
        select: { id: true, leadName: true, companyName: true, status: true },
        take,
      }),
      prisma.employee.findMany({
        where: {
          tenantId,
          OR: [
            { employeeName: { contains: q, mode: ic } },
            { employeeCode: { contains: q, mode: ic } },
          ],
        },
        select: { id: true, employeeName: true, employeeCode: true },
        take,
      }),
      prisma.project.findMany({
        where: { tenantId, projectName: { contains: q, mode: ic } },
        select: { id: true, projectName: true, name: true, status: true },
        take,
      }),
    ]);

  const hits: Hit[] = [
    ...customers.map((c) => ({
      doctype: "Customer",
      id: c.id,
      title: c.customerName,
      subtitle: c.customerGroup ?? undefined,
      href: `/sales/customers/${c.id}`,
    })),
    ...suppliers.map((s) => ({
      doctype: "Supplier",
      id: s.id,
      title: s.supplierName,
      subtitle: s.supplierGroup ?? undefined,
      href: `/buying/suppliers/${s.id}`,
    })),
    ...items.map((it) => ({
      doctype: "Item",
      id: it.id,
      title: it.itemName,
      subtitle: it.itemCode,
      href: `/stock/items/${it.id}`,
    })),
    ...invoices.map((inv) => ({
      doctype: "SalesInvoice",
      id: inv.id,
      title: inv.name,
      subtitle: `${inv.status} · ${inv.customer?.customerName ?? ""}`,
      href: `/accounting/sales-invoices/${inv.id}`,
    })),
    ...pos.map((po) => ({
      doctype: "PurchaseOrder",
      id: po.id,
      title: po.name,
      subtitle: `${po.status} · ${po.supplier?.supplierName ?? ""}`,
      href: `/buying/purchase-orders/${po.id}`,
    })),
    ...dns.map((dn) => ({
      doctype: "DeliveryNote",
      id: dn.id,
      title: dn.name,
      subtitle: `${dn.status} · ${dn.customer?.customerName ?? ""}`,
      href: `/stock/delivery-notes/${dn.id}`,
    })),
    ...picks.map((pl) => ({
      doctype: "PickList",
      id: pl.id,
      title: pl.name,
      subtitle: pl.status,
      href: `/stock/pick-lists/${pl.id}`,
    })),
    ...leads.map((l) => ({
      doctype: "Lead",
      id: l.id,
      title: l.leadName,
      subtitle: l.companyName ?? l.status,
      href: `/crm/leads/${l.id}`,
    })),
    ...employees.map((e) => ({
      doctype: "Employee",
      id: e.id,
      title: e.employeeName,
      subtitle: e.employeeCode,
      href: `/hr/employees/${e.id}`,
    })),
    ...projects.map((p) => ({
      doctype: "Project",
      id: p.id,
      title: p.projectName,
      subtitle: p.name,
      href: `/projects/projects/${p.id}`,
    })),
  ];
  res.json(hits);
});
