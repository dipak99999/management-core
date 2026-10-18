import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  prisma,
  nextName,
  resolveTaxTemplate,
  computeTaxLines,
  validateCustomData,
  missingSupplierError,
  partitionDropshipLines,
  expandBundleLine,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const salesOrderRouter = Router();

const p = perms("SalesOrder");

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  qty: z.coerce.number().positive(),
  rate: z.coerce.number().nonnegative(),
  description: z.string().optional().nullable(),
  // Dropshipping: on SO submit, dropship lines are batched by their
  // Item.defaultSupplier and one Purchase Order Draft is minted per
  // supplier. Missing supplier at submit time = clear operator error.
  isDropship: z.boolean().optional().default(false),
});

const createSchema = z.object({
  customerId: z.string().min(1),
  orderDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional().nullable(),
  currency: z.string().default("INR"),
  taxTemplateId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
  customData: z.record(z.unknown()).optional().nullable(),
});


salesOrderRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.salesOrder.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      customer: { select: { customerName: true } },
      quotation: { select: { name: true } },
      items: true,
    },
    orderBy: { orderDate: "desc" },
  });
  res.json(rows);
});

salesOrderRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      quotation: true,
      items: { include: { item: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: wraps the SO payload so the crm-web detail page gets a
// stable { salesOrder } envelope matching the other CRM "full" endpoints.
salesOrderRouter.get("/:id/full", p.read, async (req, res) => {
  const row = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      customer: true,
      quotation: true,
      items: { include: { item: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ salesOrder: row });
});

// Update a Draft SO. Wipes items and recreates. Post-submit edits blocked
// (would break any DN/SI created from this SO).
salesOrderRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit SO in status ${existing.status}` });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "SalesOrder",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
      { docId: existing.id },
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid" });

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    isDropship: i.isDropship ?? false,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

  let tax: Awaited<ReturnType<typeof resolveTaxTemplate>> = null;
  try {
    tax = await resolveTaxTemplate(prisma, tenantId, p.taxTemplateId, "Sales");
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const taxLines = computeTaxLines(netTotal, tax?.rows ?? []);
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.salesOrderItem.deleteMany({ where: { salesOrderId: existing.id } });
    await tx.salesOrderTax.deleteMany({ where: { salesOrderId: existing.id } });
    return tx.salesOrder.update({
      where: { id: existing.id },
      data: {
        customerId: p.customerId,
        orderDate: p.orderDate ? new Date(p.orderDate) : existing.orderDate,
        deliveryDate: p.deliveryDate ? new Date(p.deliveryDate) : null,
        currency: p.currency,
        taxTemplateId: tax?.id ?? null,
        remarks: p.remarks ?? null,
        netTotal,
        totalTaxes,
        grandTotal,
        customData: customData ?? undefined,
        items: { create: lines },
        taxes: taxLines.length
          ? {
              create: taxLines.map((r) => ({
                description: r.description,
                rate: r.rate,
                taxAmount: r.taxAmount,
                accountId: r.accountId,
                chargeType: r.chargeType,
                taxTemplateId: tax!.id,
              })),
            }
          : undefined,
      },
      include: { items: true, taxes: true },
    });
  });
  res.json(updated);
});

salesOrderRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "SalesOrder",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const customer = await prisma.customer.findFirst({
    where: { id: p.customerId, tenantId },
  });
  if (!customer) return res.status(400).json({ error: "Invalid customer" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid" });

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    isDropship: i.isDropship ?? false,
  }));
  const netTotal = lines.reduce((s, l) => s.add(l.amount), new Prisma.Decimal(0));

  let tax: Awaited<ReturnType<typeof resolveTaxTemplate>> = null;
  try {
    tax = await resolveTaxTemplate(prisma, tenantId, p.taxTemplateId, "Sales");
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const taxLines = computeTaxLines(netTotal, tax?.rows ?? []);
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  const name = await nextName(prisma, tenantId, "SO-");
  const row = await prisma.salesOrder.create({
    data: {
      tenantId,
      name,
      customerId: p.customerId,
      orderDate: p.orderDate ? new Date(p.orderDate) : new Date(),
      deliveryDate: p.deliveryDate ? new Date(p.deliveryDate) : null,
      currency: p.currency,
      taxTemplateId: tax?.id ?? null,
      remarks: p.remarks ?? null,
      netTotal,
      totalTaxes,
      grandTotal,
      status: "Draft",
      customData: customData ?? undefined,
      items: { create: lines },
      taxes: taxLines.length
        ? {
            create: taxLines.map((r) => ({
              description: r.description,
              rate: r.rate,
              taxAmount: r.taxAmount,
              accountId: r.accountId,
              chargeType: r.chargeType,
              taxTemplateId: tax!.id,
            })),
          }
        : undefined,
    },
    include: { items: true, taxes: true },
  });
  res.status(201).json(row);
});

// SO submit — flips status to "To Deliver" AND, for any line flagged
// isDropship, auto-creates a Purchase Order Draft to the item's default
// supplier. Dropship lines are grouped by supplier so a cart with two
// items from the same supplier spawns ONE PO with two lines, not two.
//
// Everything happens in one transaction. On any error (missing supplier,
// invalid state), the SO stays Draft — no half-created POs. The PO lines
// carry sourceSalesOrderLineId back to the SO line for traceability.
salesOrderRouter.post("/:id/submit", p.submit, idempotency("POST /sales-orders/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  itemName: true,
                  defaultSupplierId: true,
                },
              },
            },
          },
        },
      });
      if (!so) throw new Error("Not found");
      if (so.status !== "Draft")
        throw new Error(`Cannot submit SO in status ${so.status}`);

      // Partition dropship vs normal via the pure helper; any dropship
      // line without a default supplier is caught here rather than mid-
      // transaction so the error message is comprehensive (lists every
      // offending item at once).
      const partitioned = partitionDropshipLines(
        so.items.map((line) => ({
          row: line,
          isDropship: line.isDropship,
          defaultSupplierId: line.item.defaultSupplierId,
          itemName: line.item.itemName,
        })),
      );
      if (partitioned.missingSupplier.length > 0) {
        throw new Error(
          missingSupplierError(
            partitioned.missingSupplier.map((row) => ({
              row,
              isDropship: true,
              defaultSupplierId: null,
              itemName: (row as { item?: { itemName?: string } }).item?.itemName ?? null,
            })),
          ),
        );
      }

      // One PO per supplier group. PO prefix `DROP-PO-` distinguishes
      // auto-generated dropship POs from staff-created ones in lists.
      const createdPoIds: string[] = [];
      for (const group of partitioned.groups) {
        const poName = await nextName(tx, tenantId, "DROP-PO-");
        const groupLines = group.lines as (typeof so.items)[number][];
        const netTotal = groupLines.reduce(
          (s, l) => s.add(l.amount),
          new Prisma.Decimal(0),
        );
        const po = await tx.purchaseOrder.create({
          data: {
            tenantId,
            name: poName,
            supplierId: group.supplierId,
            transactionDate: new Date(),
            currency: so.currency,
            conversionRate: new Prisma.Decimal(1),
            netTotal,
            totalTaxes: new Prisma.Decimal(0),
            grandTotal: netTotal,
            status: "Draft",
            remarks: `Dropship auto-created from ${so.name}`,
            items: {
              create: groupLines.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                rate: l.rate,
                amount: l.amount,
                description: l.description,
                sourceSalesOrderLineId: l.id,
              })),
            },
          },
        });
        createdPoIds.push(po.id);
      }

      const updated = await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: "To Deliver" },
      });
      return {
        so: updated,
        dropshipPurchaseOrderIds: createdPoIds,
      };
    });
    res.json({
      ...result.so,
      dropshipPurchaseOrderIds: result.dropshipPurchaseOrderIds,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

salesOrderRouter.post("/:id/cancel", p.cancel, idempotency("POST /sales-orders/:id/cancel"), async (req, res) => {
  const so = await prisma.salesOrder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!so) return res.status(404).json({ error: "Not found" });
  if (so.status === "Cancelled") return res.status(400).json({ error: "Already cancelled" });
  const row = await prisma.salesOrder.update({
    where: { id: so.id },
    data: { status: "Cancelled" },
  });
  void publishRealtime(req.auth!.tenantId, "sales-order", { id: row.id, status: "Cancelled" });
  res.json(row);
});

// Convert Sales Order → Sales Invoice (Draft). This writes directly into the
// shared DB — the SalesInvoice is owned by accounting-service and must be
// SUBMITTED there to post GL entries. Pragmatic shortcut given shared DB.
// Partial invoicing: caller may specify per-line qty to invoice. Each line
// must not exceed (SO.qty − SO.billedQty). If body is omitted, defaults to
// invoicing the full remaining qty for every line. Each SI line back-links to
// its SO line via salesOrderItemId. On success, SO.status flips to "Partly
// Billed" or "Fully Billed" depending on cumulative billedQty across lines.
const convertToInvoiceSchema = z.object({
  lines: z
    .array(
      z.object({
        soItemId: z.string().min(1),
        qty: z.coerce.number().positive(),
      }),
    )
    .optional(),
});

salesOrderRouter.post("/:id/convert-to-invoice", p.submit, perms("SalesInvoice").create, async (req, res) => {
  const parsed = convertToInvoiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: { items: true, taxes: true },
      });
      if (!so) throw new Error("Not found");
      if (so.status === "Draft" || so.status === "Cancelled")
        throw new Error(`Cannot invoice SO in status ${so.status} — submit it first`);
      if (so.status === "Fully Billed")
        throw new Error("SO is already fully invoiced");

      // Compute per-line invoice qty. Default = remaining (qty − billedQty).
      const perLineQty = new Map<string, number>();
      if (parsed.data.lines && parsed.data.lines.length > 0) {
        for (const l of parsed.data.lines) perLineQty.set(l.soItemId, l.qty);
      } else {
        for (const soi of so.items) {
          const remaining = Number(soi.qty) - Number(soi.billedQty);
          if (remaining > 0) perLineQty.set(soi.id, remaining);
        }
      }
      if (perLineQty.size === 0) throw new Error("Nothing to invoice");

      // Validate qty ≤ remaining and build SI line data with back-link.
      const siLineData: {
        itemId: string;
        qty: Prisma.Decimal;
        rate: Prisma.Decimal;
        amount: Prisma.Decimal;
        description: string | null;
        salesOrderItemId: string;
      }[] = [];
      let siTotal = new Prisma.Decimal(0);
      for (const [soItemId, qty] of perLineQty) {
        const soi = so.items.find((i) => i.id === soItemId);
        if (!soi) throw new Error(`SO line ${soItemId} not found`);
        const remaining = Number(soi.qty) - Number(soi.billedQty);
        if (qty > remaining + 1e-6)
          throw new Error(
            `Line ${soi.id}: cannot invoice ${qty}, only ${remaining} remaining`,
          );
        const amount = new Prisma.Decimal(qty).mul(soi.rate);
        siTotal = siTotal.add(amount);
        siLineData.push({
          itemId: soi.itemId,
          qty: new Prisma.Decimal(qty),
          rate: soi.rate,
          amount,
          description: soi.description,
          salesOrderItemId: soi.id,
        });
      }

      const siName = await nextName(tx, tenantId, "SINV-");

      // Re-run tax computation with siTotal + the SO's tax rows so chargeType
      // rules (On Net Total / On Previous Row Total / Actual) apply the same
      // way they did on the SO. SI becomes a complete standalone document.
      const siResolvedRows = so.taxes.map((t) => ({
        description: t.description,
        rate: Number(t.rate),
        accountId: t.accountId,
        chargeType: (t.chargeType as "On Net Total" | "On Previous Row Total" | "Actual") ?? "On Net Total",
        amount: Number(t.taxAmount),
      }));
      const siTaxLines = computeTaxLines(siTotal, siResolvedRows).map((r) => ({
        ...r,
        taxTemplateId: so.taxTemplateId,
      }));
      const siTotalTaxes = siTaxLines.reduce(
        (s, l) => s.add(l.taxAmount),
        new Prisma.Decimal(0),
      );
      const siGrandTotal = siTotal.add(siTotalTaxes);

      const si = await tx.salesInvoice.create({
        data: {
          tenantId,
          name: siName,
          customerId: so.customerId,
          postingDate: new Date(),
          currency: so.currency,
          taxTemplateId: so.taxTemplateId,
          netTotal: siTotal,
          totalTaxes: siTotalTaxes,
          grandTotal: siGrandTotal,
          outstandingAmt: siGrandTotal,
          status: "Draft",
          items: { create: siLineData },
          taxes: siTaxLines.length
            ? {
                create: siTaxLines.map((r) => ({
                  description: r.description,
                  rate: r.rate,
                  taxAmount: r.taxAmount,
                  accountId: r.accountId,
                  chargeType: r.chargeType,
                  taxTemplateId: r.taxTemplateId,
                })),
              }
            : undefined,
        },
        include: { items: true, taxes: true },
      });

      // Update per-line billedQty then re-evaluate SO status.
      for (const [soItemId, qty] of perLineQty) {
        await tx.salesOrderItem.update({
          where: { id: soItemId },
          data: { billedQty: { increment: new Prisma.Decimal(qty) } },
        });
      }
      const refreshed = await tx.salesOrderItem.findMany({
        where: { salesOrderId: so.id },
      });
      const fullyBilled = refreshed.every(
        (l) => Number(l.billedQty) >= Number(l.qty) - 1e-6,
      );
      const totalInvoiced = refreshed.reduce(
        (s, l) => s.add(new Prisma.Decimal(l.billedQty).mul(l.rate)),
        new Prisma.Decimal(0),
      );
      await tx.salesOrder.update({
        where: { id: so.id },
        data: {
          status: fullyBilled ? "Fully Billed" : "Partly Billed",
          invoicedAmount: totalInvoiced,
        },
      });

      return { salesInvoice: si };
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Convert Sales Order → Delivery Note (Draft). Ships all SO items from the
// user-supplied source warehouse. User then submits the DN in stock-web,
// which decrements Bin + posts GL (Debit COGS / Credit Stock-in-Hand).
// Also a pragmatic cross-service DB write (same rationale as convert-to-invoice).
// Convert Sales Order → Delivery Note. Partial delivery supported via same
// per-line qty semantics as convert-to-invoice. Each DN line back-links to its
// SO line via salesOrderItemId. Updates deliveredQty and flags SO as "Fully
// Delivered" when every line's deliveredQty >= qty.
const convertToDNSchema = z.object({
  warehouseId: z.string().min(1),
  postingDate: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        soItemId: z.string().min(1),
        qty: z.coerce.number().positive(),
      }),
    )
    .optional(),
});

salesOrderRouter.post("/:id/convert-to-delivery-note", p.submit, perms("DeliveryNote").create, async (req, res) => {
  const parsed = convertToDNSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          items: {
            include: {
              item: {
                select: { id: true, isProductBundle: true },
              },
            },
          },
        },
      });
      if (!so) throw new Error("Not found");
      if (so.status === "Draft" || so.status === "Cancelled")
        throw new Error(`Cannot deliver SO in status ${so.status} — submit it first`);

      const warehouse = await tx.warehouse.findFirst({
        where: {
          id: parsed.data.warehouseId,
          tenantId,
          isGroup: false,
          disabled: false,
        },
      });
      if (!warehouse) throw new Error("Invalid source warehouse");

      const perLineQty = new Map<string, number>();
      if (parsed.data.lines && parsed.data.lines.length > 0) {
        for (const l of parsed.data.lines) perLineQty.set(l.soItemId, l.qty);
      } else {
        for (const soi of so.items) {
          const remaining = Number(soi.qty) - Number(soi.deliveredQty);
          if (remaining > 0) perLineQty.set(soi.id, remaining);
        }
      }
      if (perLineQty.size === 0) throw new Error("Nothing to deliver");

      // Pre-fetch bundle definitions for any SO line whose item is a
      // Product Bundle — one query for the whole SO instead of per-line.
      const bundleParentIds = so.items
        .filter((i) => i.item.isProductBundle)
        .map((i) => i.itemId);
      const bundleDefsById = new Map<
        string,
        { componentItemId: string; qty: number; sortOrder: number | null }[]
      >();
      if (bundleParentIds.length > 0) {
        const rows = await tx.bundleComponent.findMany({
          where: { tenantId, parentItemId: { in: bundleParentIds } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        });
        for (const r of rows) {
          const cur = bundleDefsById.get(r.parentItemId) ?? [];
          cur.push({
            componentItemId: r.componentItemId,
            qty: Number(r.qty),
            sortOrder: r.sortOrder,
          });
          bundleDefsById.set(r.parentItemId, cur);
        }
      }

      const dnLineData: {
        itemId: string;
        warehouseId: string;
        qty: Prisma.Decimal;
        rate: Prisma.Decimal;
        salesOrderItemId: string;
      }[] = [];
      for (const [soItemId, qty] of perLineQty) {
        const soi = so.items.find((i) => i.id === soItemId);
        if (!soi) throw new Error(`SO line ${soItemId} not found`);
        const remaining = Number(soi.qty) - Number(soi.deliveredQty);
        if (qty > remaining + 1e-6)
          throw new Error(
            `Line ${soi.id}: cannot deliver ${qty}, only ${remaining} remaining`,
          );

        // Bundle expansion. If this SO line is a bundle parent, split it
        // into per-component DN lines (qty × component qty), each still
        // pointing back to the SO line for audit + deliveredQty tally.
        // The bundle itself does NOT get a DN line — only the components
        // move as stock.
        const bundle = bundleDefsById.get(soi.itemId);
        if (bundle && bundle.length > 0) {
          // Refuse to fulfill an empty-bundle line — usually means the
          // bundle was flagged isProductBundle but nobody defined its
          // components yet. Surface as an actionable operator error.
          const expanded = expandBundleLine(
            { id: soi.id, itemId: soi.itemId, qty },
            { parentItemId: soi.itemId, components: bundle },
          );
          for (const e of expanded) {
            dnLineData.push({
              itemId: e.itemId,
              warehouseId: warehouse.id,
              qty: new Prisma.Decimal(e.qty),
              // Component rate is informational only on a DN — leave at 0
              // (matches how the rest of the codebase treats DN rate as a
              // billing hint, not a stock-valuation input).
              rate: new Prisma.Decimal(0),
              salesOrderItemId: e.salesOrderItemId,
            });
          }
          continue;
        }
        if (soi.item.isProductBundle) {
          throw new Error(
            `Bundle ${soi.itemId} has no components defined — set them on the Item first.`,
          );
        }

        dnLineData.push({
          itemId: soi.itemId,
          warehouseId: warehouse.id,
          qty: new Prisma.Decimal(qty),
          rate: soi.rate,
          salesOrderItemId: soi.id,
        });
      }

      const dnName = await nextName(tx, tenantId, "DN-");

      const dn = await tx.deliveryNote.create({
        data: {
          tenantId,
          name: dnName,
          customerId: so.customerId,
          postingDate: parsed.data.postingDate
            ? new Date(parsed.data.postingDate)
            : new Date(),
          status: "Draft",
          remarks: `From ${so.name}`,
          items: { create: dnLineData },
        },
        include: { items: true },
      });

      for (const [soItemId, qty] of perLineQty) {
        await tx.salesOrderItem.update({
          where: { id: soItemId },
          data: { deliveredQty: { increment: new Prisma.Decimal(qty) } },
        });
      }
      const refreshed = await tx.salesOrderItem.findMany({
        where: { salesOrderId: so.id },
      });
      const fullyDelivered = refreshed.every(
        (l) => Number(l.deliveredQty) >= Number(l.qty) - 1e-6,
      );
      if (fullyDelivered) {
        await tx.salesOrder.update({
          where: { id: so.id },
          data: { status: so.status === "Fully Billed" ? "Completed" : "Fully Delivered" },
        });
      }

      return { deliveryNote: dn };
    });
    res.status(201).json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
