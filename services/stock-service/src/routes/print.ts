import { Router } from "express";
import React from "react";
import { prisma, resolveLetterhead, resolvePrintFormat } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";
import {
  DeliveryNoteDocument,
  PurchaseReceiptDocument,
  StockEntryDocument,
  renderPdf,
} from "@lumaara/print";

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
  "/delivery-notes/:id",
  perms("DeliveryNote").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, dn, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.deliveryNote.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            customer: true,
            items: {
              include: {
                item: true,
                warehouse: { select: { warehouseName: true } },
              },
            },
          },
        }),
        resolveLetterhead(prisma, tenantId, "DeliveryNote", letterheadId),
        resolvePrintFormat(prisma, tenantId, "DeliveryNote", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!dn) return res.status(404).json({ error: "Not found" });

      const fromWarehouse = dn.items[0]?.warehouse?.warehouseName ?? "";

      const doc = React.createElement(DeliveryNoteDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        note: {
          name: dn.name,
          postingDate: dn.postingDate,
          status: dn.status,
          remarks: dn.remarks,
          customer: {
            customerName: dn.customer.customerName,
            email: dn.customer.email,
            mobile: dn.customer.mobile,
          },
          fromWarehouse,
          items: dn.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            qty: Number(it.qty),
            uom: it.item.stockUom,
          })),
        },
      });

      servePdf(req, res, await renderPdf(doc), dn.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/purchase-receipts/:id",
  perms("PurchaseReceipt").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, pr, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.purchaseReceipt.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            supplier: true,
            items: {
              include: {
                item: true,
                warehouse: { select: { warehouseName: true } },
              },
            },
          },
        }),
        resolveLetterhead(prisma, tenantId, "PurchaseReceipt", letterheadId),
        resolvePrintFormat(prisma, tenantId, "PurchaseReceipt", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!pr) return res.status(404).json({ error: "Not found" });

      const toWarehouse = pr.items[0]?.warehouse?.warehouseName ?? "";
      const grandTotal = pr.items.reduce(
        (s, it) => s + Number(it.qty) * Number(it.rate),
        0,
      );

      const doc = React.createElement(PurchaseReceiptDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        receipt: {
          name: pr.name,
          postingDate: pr.postingDate,
          status: pr.status,
          remarks: pr.remarks,
          supplier: {
            supplierName: pr.supplier.supplierName,
            email: pr.supplier.email,
            mobile: pr.supplier.mobile,
          },
          toWarehouse,
          items: pr.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            qty: Number(it.qty),
            uom: it.item.stockUom,
            rate: Number(it.rate),
            amount: Number(it.qty) * Number(it.rate),
          })),
          grandTotal,
          currency: "INR",
        },
      });

      servePdf(req, res, await renderPdf(doc), pr.name);
    } catch (e) {
      next(e);
    }
  },
);

printRouter.get(
  "/stock-entries/:id",
  perms("StockEntry").read,
  async (req, res, next) => {
    try {
      const tenantId = req.auth!.tenantId;
      const letterheadId =
        typeof req.query.letterheadId === "string" ? req.query.letterheadId : null;
      const formatId =
        typeof req.query.formatId === "string" ? req.query.formatId : null;
      const [tenant, se, letterhead, format] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
        prisma.stockEntry.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            items: {
              include: {
                item: true,
                sourceWarehouse: { select: { warehouseName: true } },
                targetWarehouse: { select: { warehouseName: true } },
              },
            },
          },
        }),
        resolveLetterhead(prisma, tenantId, "StockEntry", letterheadId),
        resolvePrintFormat(prisma, tenantId, "StockEntry", formatId),
      ]);
      if (!tenant) return res.status(404).json({ error: "Tenant not found" });
      if (!se) return res.status(404).json({ error: "Not found" });

      const totalAmount = se.items.reduce(
        (s, it) => s + Number(it.qty) * Number(it.basicRate),
        0,
      );

      const doc = React.createElement(StockEntryDocument, {
        tenantName: tenant.name,
        letterhead,
        format,
        entry: {
          name: se.name,
          postingDate: se.postingDate,
          entryType: se.entryType,
          status: se.status,
          remarks: se.remarks,
          items: se.items.map((it) => ({
            itemCode: it.item.itemCode,
            itemName: it.item.itemName,
            qty: Number(it.qty),
            uom: it.item.stockUom,
            rate: Number(it.basicRate) || null,
            amount: Number(it.basicRate) ? Number(it.qty) * Number(it.basicRate) : null,
            fromWarehouse: it.sourceWarehouse?.warehouseName ?? null,
            toWarehouse: it.targetWarehouse?.warehouseName ?? null,
          })),
          totalAmount: totalAmount > 0 ? totalAmount : null,
        },
      });

      servePdf(req, res, await renderPdf(doc), se.name);
    } catch (e) {
      next(e);
    }
  },
);
