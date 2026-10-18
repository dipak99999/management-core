import { Router } from "express";
import React from "react";
import { prisma, resolveLetterhead, resolvePrintFormat } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import { QuotationDocument, SalesOrderDocument, renderPdf } from "@lumaara/print";

export const printRouter = Router();

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
  "/quotations/:id",
  perms("Quotation").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, q, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.quotation.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            customer: true,
            lead: true,
            items: { include: { item: true } },
          },
        }),
        resolveLetterhead(prisma, tenantId, "Quotation", letterheadId),
        resolvePrintFormat(prisma, tenantId, "Quotation", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!q) return res.status(404).json({ error: "Not found" });

      const party =
        q.partyType === "Customer" && q.customer
          ? {
              name: q.customer.customerName,
              email: q.customer.email,
              mobile: q.customer.mobile,
              kind: "Customer" as const,
            }
          : {
              name: q.lead?.leadName ?? "Lead",
              email: q.lead?.email ?? null,
              mobile: q.lead?.mobile ?? null,
              kind: "Lead" as const,
            };

      const doc = React.createElement(QuotationDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        quotation: {
          name: q.name,
          postingDate: q.quotationDate,
          validTill: q.validTill,
          status: q.status,
          remarks: q.remarks,
          currency: q.currency,
          netTotal: Number(q.netTotal),
          party,
          items: q.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            description: it.description,
            qty: Number(it.qty),
            rate: Number(it.rate),
            amount: Number(it.amount),
          })),
        },
      });

      servePdf(req, res, await renderPdf(doc), q.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/sales-orders/:id",
  perms("SalesOrder").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, so, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.salesOrder.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            customer: true,
            items: { include: { item: true } },
          },
        }),
        resolveLetterhead(prisma, tenantId, "SalesOrder", letterheadId),
        resolvePrintFormat(prisma, tenantId, "SalesOrder", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!so) return res.status(404).json({ error: "Not found" });

      const doc = React.createElement(SalesOrderDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        order: {
          name: so.name,
          postingDate: so.orderDate,
          deliveryDate: so.deliveryDate,
          status: so.status,
          remarks: so.remarks,
          currency: so.currency,
          netTotal: Number(so.netTotal),
          customer: {
            customerName: so.customer.customerName,
            email: so.customer.email,
            mobile: so.customer.mobile,
            gstin: so.customer.gstin,
          },
          items: so.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            description: it.description,
            qty: Number(it.qty),
            rate: Number(it.rate),
            amount: Number(it.amount),
            billedQty: Number(it.billedQty),
            deliveredQty: Number(it.deliveredQty),
          })),
        },
      });

      servePdf(req, res, await renderPdf(doc), so.name);
    } catch (e) {
      next(e);
    }
  },
);
