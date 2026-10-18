import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const reportsRouter = Router();

// Dashboard summary for the shell home page.
reportsRouter.get("/dashboard-summary", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const [
    openLeads,
    openOpportunities,
    openQuotations,
    openSalesOrders,
    quotedValue,
  ] = await Promise.all([
    prisma.lead.count({
      where: {
        tenantId,
        status: { in: ["Open", "Contacted", "Interested"] },
      },
    }),
    prisma.opportunity.aggregate({
      where: {
        tenantId,
        status: { in: ["Open", "Quotation"] },
      },
      _sum: { expectedAmount: true },
      _count: true,
    }),
    prisma.quotation.count({
      where: { tenantId, status: "Submitted" },
    }),
    prisma.salesOrder.aggregate({
      where: {
        tenantId,
        status: { in: ["Submitted", "To Deliver", "To Bill"] },
      },
      _sum: { grandTotal: true },
      _count: true,
    }),
    prisma.quotation.aggregate({
      where: { tenantId, status: "Submitted" },
      _sum: { grandTotal: true },
    }),
  ]);

  res.json({
    openLeads,
    openOpportunities: openOpportunities._count,
    pipelineValue: Number(openOpportunities._sum.expectedAmount ?? 0),
    openQuotations,
    quotedValue: Number(quotedValue._sum.grandTotal ?? 0),
    openSalesOrders: openSalesOrders._count,
    salesOrderValue: Number(openSalesOrders._sum.grandTotal ?? 0),
  });
});

// D14: SO fulfillment — every SO line with pending qty (either
// undelivered or unbilled). Sort by oldest transaction date so operators
// see stalest orders first.
reportsRouter.get("/so-fulfillment", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const soItems = await prisma.salesOrderItem.findMany({
    where: {
      salesOrder: {
        tenantId,
        status: { notIn: ["Draft", "Cancelled", "Completed"] },
      },
    },
    include: {
      salesOrder: {
        select: {
          id: true,
          name: true,
          orderDate: true,
          deliveryDate: true,
          status: true,
          customer: { select: { customerName: true } },
        },
      },
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
    },
    orderBy: { salesOrder: { orderDate: "asc" } },
  });
  const rows = soItems
    .map((i) => {
      const pendingDelivery = Number(i.qty) - Number(i.deliveredQty);
      const pendingBilling = Number(i.qty) - Number(i.billedQty);
      return {
        soId: i.salesOrder.id,
        soName: i.salesOrder.name,
        orderDate: i.salesOrder.orderDate,
        deliveryDate: i.salesOrder.deliveryDate,
        soStatus: i.salesOrder.status,
        customerName: i.salesOrder.customer.customerName,
        itemCode: i.item.itemCode,
        itemName: i.item.itemName,
        stockUom: i.item.stockUom,
        qty: Number(i.qty),
        deliveredQty: Number(i.deliveredQty),
        billedQty: Number(i.billedQty),
        pendingDelivery: Math.max(0, pendingDelivery),
        pendingBilling: Math.max(0, pendingBilling),
      };
    })
    .filter((r) => r.pendingDelivery > 0 || r.pendingBilling > 0);
  res.json({ rows, asOf: new Date().toISOString() });
});

// D13: Sales funnel. Counts + values at each stage across a date range,
// plus conversion rates between stages.
reportsRouter.get("/sales-funnel", perms("Report").read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const from =
    typeof req.query.from === "string"
      ? new Date(req.query.from)
      : new Date(new Date().setMonth(new Date().getMonth() - 3));
  const to =
    typeof req.query.to === "string" ? new Date(req.query.to) : new Date();
  const dateFilter = { createdAt: { gte: from, lte: to } };

  const [
    leadsCreated,
    leadsConverted,
    oppsCreated,
    oppsWon,
    oppsLost,
    quotesCreated,
    quotesLost,
    quotesValue,
    sosCreated,
    sosValue,
    sisCreated,
    sisValue,
  ] = await Promise.all([
    prisma.lead.count({ where: { tenantId, ...dateFilter } }),
    prisma.lead.count({ where: { tenantId, status: "Converted", ...dateFilter } }),
    prisma.opportunity.count({ where: { tenantId, ...dateFilter } }),
    prisma.opportunity.count({
      where: { tenantId, status: "Converted", ...dateFilter },
    }),
    prisma.opportunity.count({
      where: { tenantId, status: "Lost", ...dateFilter },
    }),
    prisma.quotation.count({ where: { tenantId, ...dateFilter } }),
    prisma.quotation.count({
      where: { tenantId, status: "Lost", ...dateFilter },
    }),
    prisma.quotation.aggregate({
      where: { tenantId, ...dateFilter },
      _sum: { grandTotal: true },
    }),
    prisma.salesOrder.count({
      where: { tenantId, status: { not: "Cancelled" }, ...dateFilter },
    }),
    prisma.salesOrder.aggregate({
      where: { tenantId, status: { not: "Cancelled" }, ...dateFilter },
      _sum: { grandTotal: true },
    }),
    prisma.salesInvoice.count({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        isReturn: false,
        postingDate: { gte: from, lte: to },
      },
    }),
    prisma.salesInvoice.aggregate({
      where: {
        tenantId,
        status: { in: ["Submitted", "Paid"] },
        isReturn: false,
        postingDate: { gte: from, lte: to },
      },
      _sum: { grandTotal: true },
    }),
  ]);

  const pct = (num: number, den: number) =>
    den > 0 ? Math.round((num / den) * 1000) / 10 : null;

  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    stages: [
      { name: "Leads", count: leadsCreated, value: null },
      { name: "Opportunities", count: oppsCreated, value: null },
      {
        name: "Quotations",
        count: quotesCreated,
        value: Number(quotesValue._sum.grandTotal ?? 0),
      },
      {
        name: "Sales Orders",
        count: sosCreated,
        value: Number(sosValue._sum.grandTotal ?? 0),
      },
      {
        name: "Sales Invoices",
        count: sisCreated,
        value: Number(sisValue._sum.grandTotal ?? 0),
      },
    ],
    conversions: {
      leadToOpp: pct(oppsCreated, leadsCreated),
      oppToQuote: pct(quotesCreated, oppsCreated),
      quoteToSO: pct(sosCreated, quotesCreated),
      soToSI: pct(sisCreated, sosCreated),
      leadToSI: pct(sisCreated, leadsCreated),
    },
    lossReasons: {
      leadsLost: leadsCreated - leadsConverted - quotesCreated,
      oppsLost,
      quotesLost,
    },
  });
});
