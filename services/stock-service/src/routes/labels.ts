import { Router } from "express";
import { z } from "zod";
import { prisma, renderLabelGridHtml, type LabelRow } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Barcode label printing. Emits an HTML page the browser prints as a
// PDF (Ctrl+P / File→Save as PDF). Server-side PDF via @react-pdf
// isn't used here because SVG-in-@react-pdf needs structured JSX and
// bwip-js has canvas/font issues under Node — HTML+SVG is a cleaner
// long-term interop path.
//
// Sources: items | batches | serial-numbers. Caller posts a set of ids
// per source and the route resolves each to a { barcode, title,
// subtitle } row, then hands the whole list to renderLabelGridHtml.

export const labelRouter = Router();
const p = perms("Item"); // labels are per-item scan targets — reuse ACL

const printSchema = z.object({
  itemIds: z.array(z.string()).default([]),
  batchIds: z.array(z.string()).default([]),
  serialIds: z.array(z.string()).default([]),
  columns: z.coerce.number().int().min(1).max(6).default(3),
  copiesPerRow: z.coerce.number().int().min(1).max(20).default(1),
  labelWidthMm: z.coerce.number().positive().default(63.5),
  labelHeightMm: z.coerce.number().positive().default(38.1),
});

labelRouter.post("/print", p.read, async (req, res) => {
  const parsed = printSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (b.itemIds.length + b.batchIds.length + b.serialIds.length === 0) {
    return res.status(400).json({ error: "No labels requested" });
  }

  const [items, batches, serials] = await Promise.all([
    b.itemIds.length
      ? prisma.item.findMany({
          where: { id: { in: b.itemIds }, tenantId },
          select: { itemCode: true, itemName: true },
        })
      : Promise.resolve([]),
    b.batchIds.length
      ? prisma.batch.findMany({
          where: { id: { in: b.batchIds }, tenantId },
          select: { batchNo: true, item: { select: { itemCode: true } }, expiryDate: true },
        })
      : Promise.resolve([]),
    b.serialIds.length
      ? prisma.serialNo.findMany({
          where: { id: { in: b.serialIds }, tenantId },
          select: { serialNo: true, item: { select: { itemCode: true } } },
        })
      : Promise.resolve([]),
  ]);

  const rows: LabelRow[] = [];
  for (const i of items) {
    for (let c = 0; c < b.copiesPerRow; c++) {
      rows.push({ barcode: i.itemCode, title: i.itemName, subtitle: i.itemCode });
    }
  }
  for (const bt of batches) {
    for (let c = 0; c < b.copiesPerRow; c++) {
      rows.push({
        barcode: bt.batchNo,
        title: bt.item.itemCode,
        subtitle: `Batch ${bt.batchNo}${bt.expiryDate ? ` · exp ${bt.expiryDate.toISOString().slice(0, 10)}` : ""}`,
      });
    }
  }
  for (const s of serials) {
    for (let c = 0; c < b.copiesPerRow; c++) {
      rows.push({
        barcode: s.serialNo,
        title: s.item.itemCode,
        subtitle: `Serial ${s.serialNo}`,
      });
    }
  }

  try {
    const html = renderLabelGridHtml(rows, {
      columns: b.columns,
      labelWidthMm: b.labelWidthMm,
      labelHeightMm: b.labelHeightMm,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Label-Count", String(rows.length));
    res.send(html);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Render failed" });
  }
});
