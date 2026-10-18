import { Router } from "express";
import { z } from "zod";
import React from "react";
import {
  Prisma,
  createRazorpayOrder,
  createStripePaymentIntent,
  decryptSecrets,
  nextName,
  prisma,
  resolveLetterhead,
  resolvePrintFormat,
  verifyPaymentSignature,
} from "@lumaara/db";
import {
  PurchaseInvoiceDocument,
  SalesInvoiceDocument,
  renderPdf,
} from "@lumaara/print";
import { requirePortalAuth } from "@lumaara/service-auth";

// K4 + K5 + K6 + K9: Customer/Supplier self-service endpoints. Every route
// is gated by requirePortalAuth and filters by req.portal.partyId. Different
// partyType surfaces different endpoints (customer sees SIs + quotes;
// supplier sees POs + can submit PIs).

export const portalRouter = Router();
portalRouter.use(requirePortalAuth);

// K4a: Dashboard summary.
portalRouter.get("/summary", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType === "Customer") {
    const [outstandingAgg, openInvoices, overdueInvoices, quotes, openTickets] =
      await Promise.all([
        prisma.salesInvoice.aggregate({
          where: {
            tenantId,
            customerId: partyId,
            status: { in: ["Submitted", "Paid"] },
            outstandingAmt: { gt: 0 },
          },
          _sum: { outstandingAmt: true },
        }),
        prisma.salesInvoice.count({
          where: {
            tenantId,
            customerId: partyId,
            status: { in: ["Submitted", "Paid"] },
            outstandingAmt: { gt: 0 },
          },
        }),
        prisma.salesInvoice.count({
          where: {
            tenantId,
            customerId: partyId,
            status: { in: ["Submitted", "Paid"] },
            outstandingAmt: { gt: 0 },
            dueDate: { lt: new Date() },
          },
        }),
        prisma.quotation.count({
          where: {
            tenantId,
            customerId: partyId,
            status: "Submitted",
          },
        }),
        prisma.portalTicket.count({
          where: { tenantId, partyType, partyId, status: { not: "Closed" } },
        }),
      ]);
    return res.json({
      partyType,
      outstanding: Number(outstandingAgg._sum.outstandingAmt ?? 0),
      openInvoices,
      overdueInvoices,
      pendingQuotations: quotes,
      openTickets,
    });
  }
  // Supplier
  const [payableAgg, openPOs, openBills, openTickets] = await Promise.all([
    prisma.purchaseInvoice.aggregate({
      where: {
        tenantId,
        supplierId: partyId,
        status: { in: ["Submitted", "Paid"] },
        outstandingAmt: { gt: 0 },
      },
      _sum: { outstandingAmt: true },
    }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        supplierId: partyId,
        status: { in: ["Submitted", "To Receive"] },
      },
    }),
    prisma.purchaseInvoice.count({
      where: { tenantId, supplierId: partyId, status: "Draft" },
    }),
    prisma.portalTicket.count({
      where: { tenantId, partyType, partyId, status: { not: "Closed" } },
    }),
  ]);
  res.json({
    partyType,
    outstandingPayable: Number(payableAgg._sum.outstandingAmt ?? 0),
    openPurchaseOrders: openPOs,
    draftBills: openBills,
    openTickets,
  });
});

// ---------- K4b: Customer invoices + statement ----------

portalRouter.get("/invoices", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType === "Customer") {
    const rows = await prisma.salesInvoice.findMany({
      where: {
        tenantId,
        customerId: partyId,
        status: { in: ["Submitted", "Paid"] },
      },
      orderBy: { postingDate: "desc" },
      take: 200,
    });
    return res.json(rows);
  }
  // Supplier sees PIs they've been billed on.
  const rows = await prisma.purchaseInvoice.findMany({
    where: { tenantId, supplierId: partyId },
    orderBy: { postingDate: "desc" },
    take: 200,
  });
  res.json(rows);
});

portalRouter.get("/invoices/:id", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType === "Customer") {
    const row = await prisma.salesInvoice.findFirst({
      where: {
        id: req.params.id,
        tenantId,
        customerId: partyId,
      },
      include: {
        items: { include: { item: { select: { itemCode: true, itemName: true } } } },
        taxes: true,
      },
    });
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(row);
  }
  const row = await prisma.purchaseInvoice.findFirst({
    where: {
      id: req.params.id,
      tenantId,
      supplierId: partyId,
    },
    include: {
      items: { include: { item: true } },
      taxes: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// K4e: PDF download — serves the same rendered document as the staff /print
// route, but party-scoped: customers see their SI, suppliers see their PI.
portalRouter.get("/invoices/:id/pdf", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, defaultLocale: true },
  });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  const queryLocale =
    typeof req.query.locale === "string" ? req.query.locale : null;
  const locale = queryLocale ?? tenant.defaultLocale ?? "en";

  if (partyType === "Customer") {
    const [invoice, letterhead, format] = await Promise.all([
      prisma.salesInvoice.findFirst({
        where: { id: req.params.id, tenantId, customerId: partyId },
        include: {
          customer: true,
          items: { include: { item: true } },
          taxes: true,
        },
      }),
      resolveLetterhead(prisma, tenantId, "SalesInvoice", null),
      resolvePrintFormat(prisma, tenantId, "SalesInvoice", null),
    ]);
    if (!invoice) return res.status(404).json({ error: "Not found" });
    const doc = React.createElement(SalesInvoiceDocument, {
      tenantName: tenant.name,
      letterhead,
      format,
      locale,
      invoice: {
        name: invoice.name,
        postingDate: invoice.postingDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        netTotal: Number(invoice.netTotal),
        totalTaxes: Number(invoice.totalTaxes),
        grandTotal: Number(invoice.grandTotal),
        outstandingAmt: Number(invoice.outstandingAmt),
        status: invoice.status,
        remarks: invoice.remarks,
        customer: {
          customerName: invoice.customer.customerName,
          email: invoice.customer.email,
          mobile: invoice.customer.mobile,
          gstin: invoice.customer.gstin,
        },
        items: invoice.items.map((it) => ({
          itemCode: it.item.itemCode,
          itemName: it.item.itemName,
          description: it.description,
          qty: Number(it.qty),
          rate: Number(it.rate),
          amount: Number(it.amount),
        })),
        taxes: invoice.taxes.map((t) => ({
          description: t.description,
          rate: Number(t.rate),
          taxAmount: Number(t.taxAmount),
        })),
      },
    });
    const buf = await renderPdf(doc);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename="${invoice.name}.pdf"`);
    res.setHeader("Content-Length", buf.length.toString());
    return res.end(buf);
  }

  const [pi, letterhead, format] = await Promise.all([
    prisma.purchaseInvoice.findFirst({
      where: { id: req.params.id, tenantId, supplierId: partyId },
      include: {
        supplier: true,
        items: { include: { item: true } },
        taxes: true,
      },
    }),
    resolveLetterhead(prisma, tenantId, "PurchaseInvoice", null),
    resolvePrintFormat(prisma, tenantId, "PurchaseInvoice", null),
  ]);
  if (!pi) return res.status(404).json({ error: "Not found" });
  const doc = React.createElement(PurchaseInvoiceDocument, {
    tenantName: tenant.name,
    letterhead,
    format,
    invoice: {
      name: pi.name,
      supplierInvoiceNo: pi.supplierInvoiceNo,
      postingDate: pi.postingDate,
      dueDate: pi.dueDate,
      currency: pi.currency,
      netTotal: Number(pi.netTotal),
      totalTaxes: Number(pi.totalTaxes),
      grandTotal: Number(pi.grandTotal),
      outstandingAmt: Number(pi.outstandingAmt),
      status: pi.status,
      remarks: pi.remarks,
      supplier: {
        supplierName: pi.supplier.supplierName,
        email: pi.supplier.email,
        mobile: pi.supplier.mobile,
        gstin: pi.supplier.gstin,
      },
      items: pi.items.map((it) => ({
        itemCode: it.item.itemCode,
        itemName: it.item.itemName,
        description: it.description,
        qty: Number(it.qty),
        rate: Number(it.rate),
        amount: Number(it.amount),
      })),
      taxes: pi.taxes.map((t) => ({
        description: t.description,
        rate: Number(t.rate),
        taxAmount: Number(t.taxAmount),
      })),
    },
  });
  const buf = await renderPdf(doc);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${pi.name}.pdf"`);
  res.setHeader("Content-Length", buf.length.toString());
  res.end(buf);
});

// K4c: Running statement — invoices + payments interleaved.
portalRouter.get("/statement", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : new Date();

  if (partyType === "Customer") {
    const [invoices, payments] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: {
          tenantId,
          customerId: partyId,
          status: { in: ["Submitted", "Paid"] },
          ...(from ? { postingDate: { gte: from, lte: to } } : { postingDate: { lte: to } }),
        },
        select: { id: true, name: true, postingDate: true, grandTotal: true },
        orderBy: { postingDate: "asc" },
      }),
      prisma.paymentEntry.findMany({
        where: {
          tenantId,
          partyType: "Customer",
          partyId,
          status: "Submitted",
          paymentType: "Receive",
          ...(from ? { postingDate: { gte: from, lte: to } } : { postingDate: { lte: to } }),
        },
        select: { id: true, name: true, postingDate: true, paidAmount: true },
        orderBy: { postingDate: "asc" },
      }),
    ]);
    const rows = [
      ...invoices.map((i) => ({
        date: i.postingDate,
        ref: i.name,
        kind: "Invoice",
        debit: Number(i.grandTotal),
        credit: 0,
      })),
      ...payments.map((p) => ({
        date: p.postingDate,
        ref: p.name,
        kind: "Payment",
        debit: 0,
        credit: Number(p.paidAmount),
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    let running = 0;
    const withBalance = rows.map((r) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
    return res.json({ rows: withBalance, closingBalance: running });
  }

  // Supplier statement
  const [bills, payments] = await Promise.all([
    prisma.purchaseInvoice.findMany({
      where: {
        tenantId,
        supplierId: partyId,
        status: { in: ["Submitted", "Paid"] },
        ...(from ? { postingDate: { gte: from, lte: to } } : { postingDate: { lte: to } }),
      },
      select: { id: true, name: true, postingDate: true, grandTotal: true },
      orderBy: { postingDate: "asc" },
    }),
    prisma.paymentEntry.findMany({
      where: {
        tenantId,
        partyType: "Supplier",
        partyId,
        status: "Submitted",
        paymentType: "Pay",
        ...(from ? { postingDate: { gte: from, lte: to } } : { postingDate: { lte: to } }),
      },
      select: { id: true, name: true, postingDate: true, paidAmount: true },
      orderBy: { postingDate: "asc" },
    }),
  ]);
  const rows = [
    ...bills.map((i) => ({
      date: i.postingDate,
      ref: i.name,
      kind: "Bill",
      debit: 0,
      credit: Number(i.grandTotal),
    })),
    ...payments.map((p) => ({
      date: p.postingDate,
      ref: p.name,
      kind: "Payment",
      debit: Number(p.paidAmount),
      credit: 0,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0;
  const withBalance = rows.map((r) => {
    running += r.debit - r.credit;
    return { ...r, balance: running };
  });
  res.json({ rows: withBalance, closingBalance: running });
});

// ---------- K4d: Customer quotations + accept/reject ----------

portalRouter.get("/quotations", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Quotations only for Customer" });
  const rows = await prisma.quotation.findMany({
    where: {
      tenantId,
      customerId: partyId,
      status: { in: ["Submitted", "Ordered", "Lost", "Expired"] },
    },
    include: {
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
    },
    orderBy: { quotationDate: "desc" },
  });
  res.json(rows);
});

portalRouter.post("/quotations/:id/accept", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Quotations only for Customer" });
  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId, customerId: partyId },
  });
  if (!q) return res.status(404).json({ error: "Not found" });
  if (q.status !== "Submitted")
    return res.status(400).json({ error: `Cannot accept quote in status ${q.status}` });
  const row = await prisma.quotation.update({
    where: { id: q.id },
    data: { status: "Ordered" },
  });
  res.json(row);
});

portalRouter.post("/quotations/:id/reject", async (req, res) => {
  const parsed = z.object({ lostReason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Quotations only for Customer" });
  const q = await prisma.quotation.findFirst({
    where: { id: req.params.id, tenantId, customerId: partyId },
  });
  if (!q) return res.status(404).json({ error: "Not found" });
  if (q.status !== "Submitted")
    return res.status(400).json({ error: `Cannot reject in status ${q.status}` });
  const row = await prisma.quotation.update({
    where: { id: q.id },
    data: { status: "Lost", lostReason: parsed.data.lostReason },
  });
  res.json(row);
});

// ---------- K5: Supplier POs ----------

portalRouter.get("/purchase-orders", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Supplier")
    return res.status(400).json({ error: "Purchase orders only for Supplier" });
  const rows = await prisma.purchaseOrder.findMany({
    where: { tenantId, supplierId: partyId },
    include: {
      items: { include: { item: { select: { itemCode: true, itemName: true } } } },
    },
    orderBy: { transactionDate: "desc" },
  });
  res.json(rows);
});

// K5b: Supplier submits a Draft PurchaseInvoice against one of their POs.
// The bill is created in Draft — staff reviews taxes/totals and submits.
// Line items are copied verbatim from the PO; supplier just supplies their
// bill number + posting date. This matches ERPNext's "Get items from PO"
// pattern but scoped to portal.
const supplierBillSchema = z.object({
  purchaseOrderId: z.string().min(1),
  supplierInvoiceNo: z.string().min(1).max(120),
  postingDate: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

portalRouter.post("/supplier/bills", async (req, res) => {
  const parsed = supplierBillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Supplier")
    return res.status(400).json({ error: "Only suppliers can submit bills" });

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: parsed.data.purchaseOrderId, tenantId, supplierId: partyId },
    include: { items: true },
  });
  if (!po) return res.status(404).json({ error: "Purchase order not found" });
  if (po.status === "Cancelled")
    return res.status(400).json({ error: "PO is cancelled" });

  const name = await nextName(prisma, tenantId, "PI-");
  const postingDate = parsed.data.postingDate
    ? new Date(parsed.data.postingDate)
    : new Date();

  const lines = po.items.map((it) => ({
    itemId: it.itemId,
    qty: it.qty,
    rate: it.rate,
    amount: it.amount,
    description: it.description,
  }));
  const netTotal = lines.reduce(
    (sum, l) => sum.add(l.amount),
    new Prisma.Decimal(0),
  );

  const pi = await prisma.purchaseInvoice.create({
    data: {
      tenantId,
      name,
      supplierId: partyId,
      supplierInvoiceNo: parsed.data.supplierInvoiceNo,
      postingDate,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      currency: po.currency,
      conversionRate: po.conversionRate,
      remarks: `[Portal upload]${
        parsed.data.remarks ? " · " + parsed.data.remarks : ""
      }`,
      netTotal,
      totalTaxes: new Prisma.Decimal(0),
      grandTotal: netTotal,
      roundedTotal: netTotal,
      roundingAdjustment: new Prisma.Decimal(0),
      outstandingAmt: netTotal,
      status: "Draft",
      items: { create: lines },
    },
  });
  res.status(201).json({ id: pi.id, name: pi.name, status: pi.status });
});

// ---------- K9: Payment upload (customer submits proof; posts a Draft PE) ----------

const paymentUploadSchema = z.object({
  paidAmount: z.coerce.number().positive(),
  modeOfPayment: z.enum(["Bank", "UPI", "Card", "Cash"]).default("Bank"),
  reference: z.string().min(1),
  remarks: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  // Optional payment-proof file — attached to the created PaymentEntry.
  attachment: z
    .object({
      filename: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(120),
      base64: z.string().min(1),
    })
    .optional()
    .nullable(),
});

portalRouter.post("/payments", async (req, res) => {
  const parsed = paymentUploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Only customers can upload payments" });

  // If invoiceId supplied, verify it belongs to this customer.
  if (parsed.data.invoiceId) {
    const inv = await prisma.salesInvoice.findFirst({
      where: {
        id: parsed.data.invoiceId,
        tenantId,
        customerId: partyId,
      },
    });
    if (!inv) return res.status(400).json({ error: "Invoice not found for this customer" });
  }

  const name = await nextName(prisma, tenantId, "PE-");
  const pe = await prisma.paymentEntry.create({
    data: {
      tenantId,
      name,
      paymentType: "Receive",
      partyType: "Customer",
      partyId,
      paidAmount: new Prisma.Decimal(parsed.data.paidAmount),
      currency: "INR",
      modeOfPayment: parsed.data.modeOfPayment,
      remarks: `[Portal upload] ref=${parsed.data.reference}${
        parsed.data.remarks ? " · " + parsed.data.remarks : ""
      }`,
      status: "Draft", // staff reviews + submits
      ...(parsed.data.invoiceId
        ? {
            references: {
              create: [
                {
                  referenceDoctype: "SalesInvoice",
                  referenceId: parsed.data.invoiceId,
                  allocatedAmount: new Prisma.Decimal(parsed.data.paidAmount),
                },
              ],
            },
          }
        : {}),
    },
  });

  if (parsed.data.attachment) {
    const bytes = Buffer.from(parsed.data.attachment.base64, "base64");
    if (bytes.length > 0) {
      await prisma.attachment.create({
        data: {
          tenantId,
          doctype: "PaymentEntry",
          docId: pe.id,
          filename: parsed.data.attachment.filename,
          mimeType: parsed.data.attachment.mimeType,
          size: bytes.length,
          bytes,
          // Attribute the upload to the portal user for audit — mirrors the
          // scheme the auth-service attachment router uses.
          uploadedBy: `portal:${req.portal!.portalUserId}`,
        },
      });
    }
  }

  res.status(201).json({ id: pe.id, name: pe.name, status: pe.status });
});

// ---------- K6: PortalTicket ----------

const ticketSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
  priority: z.enum(["Low", "Normal", "High", "Urgent"]).default("Normal"),
});

portalRouter.get("/tickets", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const rows = await prisma.portalTicket.findMany({
    where: { tenantId, partyType, partyId },
    include: { _count: { select: { replies: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

portalRouter.get("/tickets/:id", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const row = await prisma.portalTicket.findFirst({
    where: { id: req.params.id, tenantId, partyType, partyId },
    include: { replies: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

portalRouter.post("/tickets", async (req, res) => {
  const parsed = ticketSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, portalUserId, partyType, partyId } = req.portal!;
  const name = await nextName(prisma, tenantId, "TKT-");
  const ticket = await prisma.portalTicket.create({
    data: {
      tenantId,
      name,
      portalUserId,
      partyType,
      partyId,
      subject: parsed.data.subject,
      priority: parsed.data.priority,
      replies: {
        create: [
          {
            body: parsed.data.body,
            authorType: "portal",
            authorId: portalUserId,
          },
        ],
      },
    },
    include: { replies: true },
  });
  res.status(201).json(ticket);
});

portalRouter.post("/tickets/:id/reply", async (req, res) => {
  const parsed = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, portalUserId, partyType, partyId } = req.portal!;
  const ticket = await prisma.portalTicket.findFirst({
    where: { id: req.params.id, tenantId, partyType, partyId },
  });
  if (!ticket) return res.status(404).json({ error: "Not found" });
  if (ticket.status === "Closed")
    return res.status(400).json({ error: "Ticket is closed" });
  const reply = await prisma.portalTicketReply.create({
    data: {
      portalTicketId: ticket.id,
      body: parsed.data.body,
      authorType: "portal",
      authorId: portalUserId,
    },
  });
  await prisma.portalTicket.update({
    where: { id: ticket.id },
    data: { status: "Open" },
  });
  res.status(201).json(reply);
});

// ---------- O2b: Portal-side DSR self-request ----------
//
// Lets a portal user file their own Export or Erasure request. Staff still
// approve+fulfil via /admin/compliance (no self-fulfil to prevent an attacker
// with a stolen portal cookie from mass-erasing party data). The download
// endpoint re-runs the export helper on demand — payload is not persisted, so
// revoking access is just flipping the DSR status back from Completed.

const portalDsrSchema = z.object({
  kind: z.enum(["Export", "Erasure"]),
  notes: z.string().max(2000).optional().nullable(),
});

portalRouter.post("/dsr", async (req, res) => {
  const parsed = portalDsrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, portalUserId, partyType, partyId, email } = req.portal!;
  const name = await nextName(prisma, tenantId, "DSR-");
  const row = await prisma.dataSubjectRequest.create({
    data: {
      tenantId,
      name,
      kind: parsed.data.kind,
      subjectType: partyType,
      subjectId: partyId,
      subjectEmail: email,
      requestedBy: portalUserId,
      notes: parsed.data.notes ?? "[Portal self-request]",
    },
  });
  res.status(201).json({ id: row.id, name: row.name, status: row.status });
});

portalRouter.get("/dsr", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const rows = await prisma.dataSubjectRequest.findMany({
    where: { tenantId, subjectType: partyType, subjectId: partyId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      completedAt: true,
      rejectedReason: true,
      createdAt: true,
    },
  });
  res.json(rows);
});

// Latest consent per portal user. Returns null if none yet — the UI treats
// that as "show the banner".
portalRouter.get("/consent", async (req, res) => {
  const { tenantId, portalUserId } = req.portal!;
  const latest = await prisma.consentRecord.findFirst({
    where: { tenantId, portalUserId },
    orderBy: { createdAt: "desc" },
  });
  res.json(latest);
});

portalRouter.post("/consent", async (req, res) => {
  const parsed = z
    .object({
      analytics: z.boolean().default(false),
      marketing: z.boolean().default(false),
      policyVersion: z.string().max(50).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, portalUserId } = req.portal!;
  const row = await prisma.consentRecord.create({
    data: {
      tenantId,
      portalUserId,
      essential: true,
      analytics: parsed.data.analytics,
      marketing: parsed.data.marketing,
      policyVersion: parsed.data.policyVersion ?? null,
      userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
      ipAddress: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null,
    },
  });
  res.status(201).json(row);
});

portalRouter.get("/dsr/:id/export", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  const dsr = await prisma.dataSubjectRequest.findFirst({
    where: {
      id: req.params.id,
      tenantId,
      subjectType: partyType,
      subjectId: partyId,
      kind: "Export",
      status: "Completed",
    },
  });
  if (!dsr) return res.status(404).json({ error: "Not available" });
  const { exportCustomerData, exportSupplierData } = await import("@lumaara/db");
  let payload: Record<string, unknown>;
  if (partyType === "Customer") payload = await exportCustomerData(prisma, tenantId, partyId);
  else if (partyType === "Supplier")
    payload = await exportSupplierData(prisma, tenantId, partyId);
  else return res.status(400).json({ error: `Export not implemented for ${partyType}` });
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${dsr.name}-${partyType}.json"`,
  );
  res.send(JSON.stringify(payload, null, 2));
});

// ---------- L7: Razorpay checkout ----------

// Creates a Razorpay order for a specific invoice's outstanding amount. The
// portal client uses the returned {keyId, orderId, amount} to open the
// Razorpay checkout modal. On success the client can call /verify OR wait
// for the webhook to auto-create a Draft PE (see webhook-receiver.ts).
portalRouter.post("/checkout/razorpay/order", async (req, res) => {
  const parsed = z
    .object({
      invoiceId: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Only customers can pay via Razorpay" });

  const inv = await prisma.salesInvoice.findFirst({
    where: {
      id: parsed.data.invoiceId,
      tenantId,
      customerId: partyId,
    },
  });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  const outstanding = Number(inv.outstandingAmt);
  if (outstanding <= 0)
    return res.status(400).json({ error: "Invoice has no outstanding" });

  const integration = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      provider: "razorpay",
      isActive: true,
      isDefault: true,
    },
  });
  if (!integration) return res.status(500).json({ error: "No default Razorpay integration configured" });
  const secrets = decryptSecrets(integration.secrets) as Record<string, string>;
  if (!secrets.keyId || !secrets.keySecret)
    return res.status(500).json({ error: "Razorpay keyId/keySecret missing" });

  try {
    const order = await createRazorpayOrder({
      keyId: secrets.keyId,
      keySecret: secrets.keySecret,
      amount: outstanding,
      currency: inv.currency,
      receipt: inv.name,
      notes: {
        invoice_id: inv.id,
        customer_id: partyId,
        tenant_id: tenantId,
      },
    });
    res.json({
      keyId: secrets.keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

// Called by the checkout success callback. Verifies the payment signature +
// creates a Draft PE (kept as Draft — staff submits after any final checks).
// Webhook path (L5) also does this, so this endpoint is idempotent per
// razorpay_payment_id — duplicate calls short-circuit.
const verifySchema = z.object({
  invoiceId: z.string().min(1),
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  amount: z.coerce.number().positive(),
});

portalRouter.post("/checkout/razorpay/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer") return res.status(400).json({ error: "Not a customer" });

  const integration = await prisma.tenantIntegration.findFirst({
    where: {
      tenantId,
      provider: "razorpay",
      isActive: true,
      isDefault: true,
    },
  });
  if (!integration) return res.status(500).json({ error: "Razorpay integration missing" });
  const secrets = decryptSecrets(integration.secrets) as Record<string, string>;

  const ok = verifyPaymentSignature(
    secrets.keySecret,
    parsed.data.razorpay_order_id,
    parsed.data.razorpay_payment_id,
    parsed.data.razorpay_signature,
  );
  if (!ok) return res.status(401).json({ error: "Invalid signature" });

  // Idempotency: if a Draft PE with this razorpay_payment_id already exists,
  // return it as-is.
  const existing = await prisma.paymentEntry.findFirst({
    where: {
      tenantId,
      partyType: "Customer",
      partyId,
      remarks: { contains: parsed.data.razorpay_payment_id },
    },
  });
  if (existing) return res.json({ id: existing.id, name: existing.name, duplicate: true });

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: parsed.data.invoiceId, tenantId, customerId: partyId },
  });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });

  const name = await nextName(prisma, tenantId, "PE-");
  const pe = await prisma.paymentEntry.create({
    data: {
      tenantId,
      name,
      paymentType: "Receive",
      partyType: "Customer",
      partyId,
      paidAmount: new Prisma.Decimal(parsed.data.amount),
      currency: inv.currency,
      modeOfPayment: "Bank",
      remarks: `[Razorpay ${parsed.data.razorpay_payment_id}] order=${parsed.data.razorpay_order_id}`,
      status: "Draft",
      references: {
        create: [
          {
            referenceDoctype: "SalesInvoice",
            referenceId: inv.id,
            allocatedAmount: new Prisma.Decimal(parsed.data.amount),
          },
        ],
      },
    },
  });
  res.json({ id: pe.id, name: pe.name });
});

// ---------- K11: Daily Sales Report (portal, customer-scoped) ----------

// Portal-side DSR. Same shape as /reports/dsr but auto-scoped to the current
// customer's slice. Suppliers aren't shown (they don't have sales activity).
portalRouter.get("/reports/dsr", async (req, res) => {
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "DSR is customer-only" });
  const dateStr = typeof req.query.date === "string" ? req.query.date : "";
  const day = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(day.getTime()))
    return res.status(400).json({ error: "invalid date" });
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [invoices, payments] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        tenantId,
        customerId: partyId,
        status: { in: ["Submitted", "Paid"] },
        postingDate: { gte: dayStart, lt: dayEnd },
      },
      include: {
        items: { include: { item: { select: { itemCode: true, itemName: true } } } },
      },
    }),
    prisma.paymentEntry.findMany({
      where: {
        tenantId,
        status: "Submitted",
        paymentType: "Receive",
        partyType: "Customer",
        partyId,
        postingDate: { gte: dayStart, lt: dayEnd },
      },
    }),
  ]);

  const byMode = new Map<string, number>();
  for (const pe of payments) {
    const mode = pe.modeOfPayment ?? "Unspecified";
    byMode.set(mode, (byMode.get(mode) ?? 0) + Number(pe.paidAmount));
  }
  const totalBilled = invoices.reduce(
    (s, i) => s + Number(i.grandTotal),
    0,
  );
  const totalCollected = payments.reduce(
    (s, p) => s + Number(p.paidAmount),
    0,
  );
  const itemAgg = new Map<
    string,
    { itemCode: string; itemName: string; qty: number; amount: number }
  >();
  for (const inv of invoices) {
    for (const line of inv.items) {
      const cur =
        itemAgg.get(line.itemId) ??
        {
          itemCode: line.item.itemCode,
          itemName: line.item.itemName,
          qty: 0,
          amount: 0,
        };
      cur.qty += Number(line.qty);
      cur.amount += Number(line.amount);
      itemAgg.set(line.itemId, cur);
    }
  }
  res.json({
    date: dayStart.toISOString().slice(0, 10),
    totalBilled,
    totalCollected,
    invoiceCount: invoices.length,
    paymentCount: payments.length,
    collections: [...byMode.entries()]
      .map(([modeOfPayment, amount]) => ({ modeOfPayment, amount }))
      .sort((a, b) => b.amount - a.amount),
    topItems: [...itemAgg.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10),
    invoices: invoices.map((i) => ({
      id: i.id,
      name: i.name,
      grandTotal: Number(i.grandTotal),
      currency: i.currency,
      status: i.status,
    })),
  });
});

// ---------- L7b: Stripe checkout ----------

// Creates a Stripe PaymentIntent for a specific invoice's outstanding amount.
// The portal client uses the returned client_secret to confirm the payment
// via Stripe.js. On payment_intent.succeeded the webhook receiver auto-creates
// a Draft PE (see webhook-receiver.ts).
portalRouter.post("/checkout/stripe/intent", async (req, res) => {
  const parsed = z
    .object({ invoiceId: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tenantId, partyType, partyId } = req.portal!;
  if (partyType !== "Customer")
    return res.status(400).json({ error: "Only customers can pay via Stripe" });

  const inv = await prisma.salesInvoice.findFirst({
    where: { id: parsed.data.invoiceId, tenantId, customerId: partyId },
    include: { customer: { select: { email: true } } },
  });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  const outstanding = Number(inv.outstandingAmt);
  if (outstanding <= 0)
    return res.status(400).json({ error: "Invoice has no outstanding" });

  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "stripe", isActive: true, isDefault: true },
  });
  if (!integration)
    return res.status(500).json({ error: "No default Stripe integration configured" });
  const secrets = decryptSecrets(integration.secrets) as Record<string, string>;
  if (!secrets.secretKey)
    return res.status(500).json({ error: "Stripe secretKey missing" });

  try {
    const intent = await createStripePaymentIntent({
      secretKey: secrets.secretKey,
      amount: outstanding,
      currency: inv.currency,
      description: `Invoice ${inv.name}`,
      receiptEmail: inv.customer.email ?? undefined,
      idempotencyKey: `si-${inv.id}-${Math.round(outstanding * 100)}`,
      metadata: {
        invoice_id: inv.id,
        customer_id: partyId,
        tenant_id: tenantId,
        invoice_name: inv.name,
      },
    });
    res.json({
      publishableKey: secrets.publishableKey ?? null,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount: intent.amount,
      currency: intent.currency,
    });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});
