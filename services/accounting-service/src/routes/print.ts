import { Router } from "express";
import React from "react";
import {
  amountInIndianWords,
  prisma,
  resolveLetterhead,
  resolvePrintFormat,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import {
  SalesInvoiceDocument,
  SalesInvoiceBulkDocument,
  PurchaseInvoiceDocument,
  PaymentEntryDocument,
  ChequeDocument,
  JournalEntryDocument,
  POSReceiptDocument,
  renderPdf,
} from "@lumaara/print";

export const printRouter = Router();

// Each printable doctype gets its own route so the loader stays type-safe.
// Serves application/pdf inline so browsers render in-tab; add
// `?download=1` to force a download.

printRouter.get(
  "/sales-invoices/:id",
  perms("SalesInvoice").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const queryLocale =
        typeof req.query.locale === "string" ? req.query.locale : null;
      const [tenant, invoice, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, defaultLocale: true },
        }),
        prisma.salesInvoice.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            customer: true,
            items: { include: { item: true } },
            taxes: true,
          },
        }),
        resolveLetterhead(prisma, tenantId, "SalesInvoice", letterheadId),
        resolvePrintFormat(prisma, tenantId, "SalesInvoice", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!invoice) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(SalesInvoiceDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        locale: queryLocale ?? tenant.defaultLocale ?? "en",
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
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename="${invoice.name}.pdf"`,
      );
      res.setHeader("Content-Length", buf.length.toString());
      res.end(buf);
    } catch (e) {
      next(e);
    }
  },
);

// POS receipt — narrow 80mm layout, always inline (thermal printers). Loads
// tenders from the SI's linked PaymentEntries so split-tender receipts show
// each mode + amount. `cashier` and `sessionName` are looked up via the SI's
// posOpeningId → POSOpeningEntry → user.
printRouter.get(
  "/pos-invoices/:id",
  perms("SalesInvoice").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const [tenant, invoice] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.salesInvoice.findFirst({
          where: { id: req.params.id, tenantId, isPos: true },
          include: {
            customer: true,
            items: { include: { item: true } },
            taxes: true,
            posOpening: {
              include: { user: { select: { fullName: true, email: true } } },
            },
          },
        }),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!invoice) return res.status(404).json({ error: "Not found" });

      const peRefs = await prisma.paymentEntryReference.findMany({
        where: {
          referenceDoctype: "SalesInvoice",
          referenceId: invoice.id,
          paymentEntry: { tenantId, status: "Submitted" },
        },
        include: {
          paymentEntry: { select: { modeOfPayment: true, remarks: true } },
        },
      });
      const tenders = peRefs.map((r) => ({
        mode: r.paymentEntry.modeOfPayment,
        amount: Number(r.allocatedAmount),
        reference: r.paymentEntry.remarks,
      }));

      const doc = React.createElement(POSReceiptDocument, {
        tenantName: tenant.name,
        addressText: null,
        footerText: null,
        invoice: {
          name: invoice.name,
          postingDate: invoice.postingDate,
          currency: invoice.currency,
          netTotal: Number(invoice.netTotal),
          totalTaxes: Number(invoice.totalTaxes),
          grandTotal: Number(invoice.grandTotal),
          roundedTotal: Number(invoice.roundedTotal),
          customer: { customerName: invoice.customer.customerName },
          items: invoice.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            qty: Number(it.qty),
            rate: Number(it.rate),
            amount: Number(it.amount),
          })),
          taxes: invoice.taxes.map((t) => ({
            description: t.description,
            taxAmount: Number(t.taxAmount),
          })),
        },
        tenders,
        cashier: invoice.posOpening?.user.fullName ?? null,
        sessionName: invoice.posOpening?.name ?? null,
      });

      const buf = await renderPdf(doc);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${invoice.name}.pdf"`);
      res.setHeader("Content-Length", buf.length.toString());
      res.end(buf);
    } catch (e) {
      next(e);
    }
  },
);

// Shared response helper — all print routes emit application/pdf with the
// same inline/attachment disposition logic.
function servePdf(
  req: import("express").Request,
  res: import("express").Response,
  buf: Buffer,
  filename: string,
) {
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}.pdf"`);
  res.setHeader("Content-Length", buf.length.toString());
  res.end(buf);
}

printRouter.get(
  "/purchase-invoices/:id",
  perms("PurchaseInvoice").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const [tenant, invoice] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.purchaseInvoice.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            supplier: true,
            items: { include: { item: true } },
            taxes: true,
          },
        }),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!invoice) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(PurchaseInvoiceDocument, {
        tenantName: tenant.name,
        invoice: {
          name: invoice.name,
          supplierInvoiceNo: invoice.supplierInvoiceNo,
          postingDate: invoice.postingDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          netTotal: Number(invoice.netTotal),
          totalTaxes: Number(invoice.totalTaxes),
          grandTotal: Number(invoice.grandTotal),
          outstandingAmt: Number(invoice.outstandingAmt),
          status: invoice.status,
          remarks: invoice.remarks,
          supplier: {
            supplierName: invoice.supplier.supplierName,
            email: invoice.supplier.email,
            mobile: invoice.supplier.mobile,
            gstin: invoice.supplier.gstin,
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

      servePdf(req, res, await renderPdf(doc), invoice.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/payment-entries/:id",
  perms("PaymentEntry").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const [tenant, entry] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.paymentEntry.findFirst({
          where: { id: req.params.id, tenantId },
          include: { references: true },
        }),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!entry) return res.status(404).json({ error: "Not found" });

      // Resolve partyName from the party table by type + id. PEs don't include
      // the party by default because it's polymorphic.
      let partyName = entry.partyId;
      if (entry.partyType === "Customer") {
        const c = await prisma.customer.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { customerName: true },
        });
        if (c) partyName = c.customerName;
      } else if (entry.partyType === "Supplier") {
        const s = await prisma.supplier.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { supplierName: true },
        });
        if (s) partyName = s.supplierName;
      } else if (entry.partyType === "Employee") {
        const e = await prisma.employee.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { employeeName: true, employeeCode: true },
        });
        if (e) partyName = `${e.employeeName} (${e.employeeCode})`;
      }

      // Look up voucher names for reference display.
      const refs = await Promise.all(
        entry.references.map(async (r) => {
          let voucherName = r.referenceId;
          if (r.referenceDoctype === "SalesInvoice") {
            const si = await prisma.salesInvoice.findFirst({
              where: { id: r.referenceId, tenantId },
              select: { name: true },
            });
            if (si) voucherName = si.name;
          } else if (r.referenceDoctype === "PurchaseInvoice") {
            const pi = await prisma.purchaseInvoice.findFirst({
              where: { id: r.referenceId, tenantId },
              select: { name: true },
            });
            if (pi) voucherName = pi.name;
          }
          return {
            voucherType: r.referenceDoctype,
            voucherName,
            allocatedAmount: Number(r.allocatedAmount),
          };
        }),
      );

      const doc = React.createElement(PaymentEntryDocument, {
        tenantName: tenant.name,
        entry: {
          name: entry.name,
          paymentType: entry.paymentType as "Receive" | "Pay",
          postingDate: entry.postingDate,
          modeOfPayment: entry.modeOfPayment,
          partyType: entry.partyType,
          partyName,
          paidAmount: Number(entry.paidAmount),
          currency: entry.currency,
          status: entry.status,
          remarks: entry.remarks,
          references: refs,
        },
      });

      servePdf(req, res, await renderPdf(doc), entry.name);
    } catch (e) {
      next(e);
    }
  },
);

// Cheque print — renders only the FILL-IN fields (date, payee, amount)
// at Indian standard cheque dimensions (203mm × 89mm). Refuses when:
//  - PE isn't Submitted (a Draft cheque would be a footgun)
//  - modeOfPayment isn't Bank (cash/UPI/card don't cheque)
//  - chequeNumber isn't set on the PE (staff enters this before printing)
// After a successful render, stamps `chequePrinted=true` + `chequeDate`
// (falls back to postingDate) so the operator can't accidentally waste a
// physical cheque by re-printing. `?force=true` overrides.
printRouter.get(
  "/payment-entries/:id/cheque",
  perms("PaymentEntry").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const force = req.query.force === "true";
      const entry = await prisma.paymentEntry.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!entry) return res.status(404).json({ error: "Not found" });
      if (entry.status !== "Submitted")
        return res.status(400).json({
          error: `Cheque can only be printed for Submitted payments (currently ${entry.status})`,
        });
      if (entry.modeOfPayment !== "Bank")
        return res.status(400).json({
          error: `Cheque print requires modeOfPayment=Bank (currently ${entry.modeOfPayment})`,
        });
      if (!entry.chequeNumber)
        return res.status(400).json({
          error: "chequeNumber must be set on the payment before printing",
        });
      if (entry.chequePrinted && !force)
        return res.status(400).json({
          error:
            "Cheque already printed. Pass ?force=true to reprint (only when the previous print failed physically).",
        });

      let partyName = entry.partyId;
      if (entry.partyType === "Supplier") {
        const s = await prisma.supplier.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { supplierName: true },
        });
        if (s) partyName = s.supplierName;
      } else if (entry.partyType === "Employee") {
        const e = await prisma.employee.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { employeeName: true },
        });
        if (e) partyName = e.employeeName;
      } else if (entry.partyType === "Customer") {
        // Rare (issuing a cheque TO a customer — refund) but supported.
        const c = await prisma.customer.findFirst({
          where: { id: entry.partyId, tenantId },
          select: { customerName: true },
        });
        if (c) partyName = c.customerName;
      }

      const doc = React.createElement(ChequeDocument, {
        entry: {
          name: entry.name,
          partyName,
          paidAmount: Number(entry.paidAmount),
          currency: entry.currency,
          chequeDate: entry.chequeDate ?? entry.postingDate,
          amountWords: amountInIndianWords(Number(entry.paidAmount)),
        },
      });

      const pdf = await renderPdf(doc);
      // Stamp AFTER successful render — a render throw shouldn't lock
      // the cheque as printed.
      await prisma.paymentEntry.update({
        where: { id: entry.id },
        data: {
          chequePrinted: true,
          chequeDate: entry.chequeDate ?? entry.postingDate,
        },
      });
      servePdf(req, res, pdf, `${entry.name}-cheque`);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/journal-entries/:id",
  perms("JournalEntry").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const [tenant, je] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.journalEntry.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            accounts: { include: { account: { select: { accountName: true } } } },
          },
        }),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!je) return res.status(404).json({ error: "Not found" });

      // Resolve any party names on JE lines for display.
      const lines = await Promise.all(
        je.accounts.map(async (a) => {
          let partyName: string | null = null;
          if (a.partyType && a.partyId) {
            if (a.partyType === "Customer") {
              const c = await prisma.customer.findFirst({
                where: { id: a.partyId, tenantId },
                select: { customerName: true },
              });
              partyName = c?.customerName ?? a.partyId;
            } else if (a.partyType === "Supplier") {
              const s = await prisma.supplier.findFirst({
                where: { id: a.partyId, tenantId },
                select: { supplierName: true },
              });
              partyName = s?.supplierName ?? a.partyId;
            } else if (a.partyType === "Employee") {
              const e = await prisma.employee.findFirst({
                where: { id: a.partyId, tenantId },
                select: { employeeName: true },
              });
              partyName = e?.employeeName ?? a.partyId;
            }
          }
          return {
            accountName: a.account.accountName,
            debit: Number(a.debit),
            credit: Number(a.credit),
            partyType: a.partyType,
            partyName,
          };
        }),
      );

      const doc = React.createElement(JournalEntryDocument, {
        tenantName: tenant.name,
        entry: {
          name: je.name,
          postingDate: je.postingDate,
          status: je.status,
          remarks: je.remarks,
          lines,
        },
      });

      servePdf(req, res, await renderPdf(doc), je.name);
    } catch (e) {
      next(e);
    }
  },
);

// H3: Bulk print for sales invoices. POST body: { ids: string[] } → one PDF
// with N pages, one invoice per page. Uses the tenant's default letterhead +
// format (override via ?letterheadId / ?formatId). Capped at 50 to keep
// memory footprint sane.
printRouter.post(
  "/sales-invoices/bulk",
  perms("SalesInvoice").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
      if (ids.length === 0)
        return res.status(400).json({ error: "ids[] required" });
      if (ids.length > 50)
        return res.status(400).json({ error: "Max 50 invoices per bulk print" });

      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;

      const [tenant, invoices, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.salesInvoice.findMany({
          where: { id: { in: ids }, tenantId },
          include: {
            customer: true,
            items: { include: { item: true } },
            taxes: true,
          },
        }),
        resolveLetterhead(prisma, tenantId, "SalesInvoice", letterheadId),
        resolvePrintFormat(prisma, tenantId, "SalesInvoice", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (invoices.length === 0)
        return res.status(404).json({ error: "No invoices matched" });

      const doc = React.createElement(SalesInvoiceBulkDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        invoices: invoices.map((inv) => ({
          name: inv.name,
          postingDate: inv.postingDate,
          dueDate: inv.dueDate,
          currency: inv.currency,
          netTotal: Number(inv.netTotal),
          totalTaxes: Number(inv.totalTaxes),
          grandTotal: Number(inv.grandTotal),
          outstandingAmt: Number(inv.outstandingAmt),
          status: inv.status,
          remarks: inv.remarks,
          customer: {
            customerName: inv.customer.customerName,
            email: inv.customer.email,
            mobile: inv.customer.mobile,
            gstin: inv.customer.gstin,
          },
          items: inv.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            description: it.description,
            qty: Number(it.qty),
            rate: Number(it.rate),
            amount: Number(it.amount),
          })),
          taxes: inv.taxes.map((t) => ({
            description: t.description,
            rate: Number(t.rate),
            taxAmount: Number(t.taxAmount),
          })),
        })),
      });

      servePdf(
        req,
        res,
        await renderPdf(doc),
        `sales-invoices-${new Date().toISOString().slice(0, 10)}`,
      );
    } catch (e) {
      next(e);
    }
  },
);

// H4: Print options — resolves + returns the letterhead / format that would
// be applied to a given (doctype, docId, ?letterheadId/?formatId) request,
// so the UI can show the user what's about to print before hitting PDF.
printRouter.get(
  "/options/:doctype",
  perms("Report").read,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const doctype = req.params.doctype;
    const letterheadId =
      typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
    const formatId =
      typeof req.query.formatId === "string" ? req.query.formatId : null;
    const [availableLetterheads, availableFormats, resolvedLh, resolvedFmt] =
      await Promise.all([
        prisma.letterhead.findMany({
          where: { tenantId },
          select: { id: true, name: true, isDefault: true, appliesToDoctypes: true },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        }),
        prisma.printFormat.findMany({
          where: { tenantId, doctype },
          select: { id: true, name: true, isDefault: true },
          orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        }),
        resolveLetterhead(prisma, tenantId, doctype, letterheadId),
        resolvePrintFormat(prisma, tenantId, doctype, formatId),
      ]);
    res.json({
      doctype,
      resolvedLetterhead: resolvedLh,
      resolvedFormat: resolvedFmt,
      availableLetterheads,
      availableFormats,
    });
  },
);
