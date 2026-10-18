import { Prisma } from "@lumaara/db";

// Stock ledger posting primitives.
//
// Valuation: moving average per (item, warehouse). For inflows we combine
// existing value + incoming value and recompute the average rate. For outflows
// we consume at the current average rate.
//
// Cancellation policy: SLEs are immutable. On voucher cancel we mark
// isCancelled=true, then REBUILD the affected Bin(s) from all remaining
// active SLEs. That keeps the moving average correct even after out-of-order
// cancellations.

export interface StockPostLine {
  itemId: string;
  warehouseId: string;
  actualQty: number;      // +inflow, -outflow
  incomingRate?: number;  // required for inflows; ignored for outflows
}

export interface PostStockParams {
  tenantId: string;
  postingDate: Date;
  voucherType:
    | "StockEntry"
    | "PurchaseReceipt"
    | "DeliveryNote"
    | "WorkOrder"
    | "StockReconciliation";
  voucherId: string;
  voucherName?: string | null;
  lines: StockPostLine[];
}

export async function postStockEntries(
  tx: Prisma.TransactionClient,
  params: PostStockParams,
): Promise<void> {
  const { tenantId, postingDate, voucherType, voucherId, voucherName, lines } = params;

  for (const line of lines) {
    if (line.actualQty === 0) continue;

    // Validate item + warehouse belong to tenant.
    const [item, warehouse] = await Promise.all([
      tx.item.findFirst({
        where: { id: line.itemId, tenantId },
        select: { id: true, isStockItem: true, itemCode: true },
      }),
      tx.warehouse.findFirst({
        where: { id: line.warehouseId, tenantId, disabled: false },
        select: { id: true, isGroup: true, warehouseName: true },
      }),
    ]);
    if (!item) throw new Error(`Item ${line.itemId} not found`);
    if (!warehouse) throw new Error(`Warehouse ${line.warehouseId} not found or disabled`);
    if (warehouse.isGroup)
      throw new Error(`Cannot post to group warehouse ${warehouse.warehouseName}`);
    if (!item.isStockItem)
      throw new Error(`Item ${item.itemCode} is not a stock item`);

    // Get current bin or default zero-state.
    const bin = await tx.bin.findUnique({
      where: {
        tenantId_itemId_warehouseId: {
          tenantId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
        },
      },
    });
    const oldQty = bin ? Number(bin.actualQty) : 0;
    const oldValue = bin ? Number(bin.stockValue) : 0;
    const oldRate = bin ? Number(bin.valuationRate) : 0;

    let newQty: number;
    let newValue: number;
    let newRate: number;
    let sleRate: number;

    if (line.actualQty > 0) {
      // Inflow — moving average.
      const incomingRate = line.incomingRate ?? 0;
      newQty = oldQty + line.actualQty;
      newValue = oldValue + line.actualQty * incomingRate;
      newRate = newQty > 0 ? newValue / newQty : 0;
      sleRate = newRate;
    } else {
      // Outflow — consume at existing rate.
      const qtyOut = -line.actualQty;
      if (qtyOut > oldQty + 0.0001) {
        throw new Error(
          `Insufficient stock: ${item.itemCode} in ${warehouse.warehouseName} has ${oldQty}, need ${qtyOut}`,
        );
      }
      newQty = oldQty - qtyOut;
      newValue = oldValue - qtyOut * oldRate;
      if (newQty < 0.0001) {
        newQty = 0;
        newValue = 0;
      }
      newRate = newQty > 0 ? newValue / newQty : 0;
      sleRate = oldRate;
    }

    await tx.stockLedgerEntry.create({
      data: {
        tenantId,
        postingDate,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        actualQty: new Prisma.Decimal(line.actualQty),
        qtyAfterTransaction: new Prisma.Decimal(newQty),
        incomingRate: new Prisma.Decimal(line.actualQty > 0 ? line.incomingRate ?? 0 : 0),
        valuationRate: new Prisma.Decimal(sleRate),
        stockValue: new Prisma.Decimal(newValue),
        voucherType,
        voucherId,
        voucherName: voucherName ?? null,
        isCancelled: false,
      },
    });

    await tx.bin.upsert({
      where: {
        tenantId_itemId_warehouseId: {
          tenantId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
        },
      },
      create: {
        tenantId,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        actualQty: new Prisma.Decimal(newQty),
        valuationRate: new Prisma.Decimal(newRate),
        stockValue: new Prisma.Decimal(newValue),
      },
      update: {
        actualQty: new Prisma.Decimal(newQty),
        valuationRate: new Prisma.Decimal(newRate),
        stockValue: new Prisma.Decimal(newValue),
      },
    });
  }
}

// Cancel a voucher's SLEs and rebuild affected Bins from remaining active SLEs.
// Guarantees the moving-average stays correct even if cancels are out of order.
export async function cancelStockEntries(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; voucherType: string; voucherId: string },
): Promise<void> {
  const { tenantId, voucherType, voucherId } = params;

  const affected = await tx.stockLedgerEntry.findMany({
    where: { tenantId, voucherType, voucherId, isCancelled: false },
    select: { itemId: true, warehouseId: true },
  });
  if (affected.length === 0) return;

  await tx.stockLedgerEntry.updateMany({
    where: { tenantId, voucherType, voucherId, isCancelled: false },
    data: { isCancelled: true },
  });

  const uniquePairs = new Set(affected.map((a) => `${a.itemId}::${a.warehouseId}`));
  for (const pair of uniquePairs) {
    const [itemId, warehouseId] = pair.split("::");
    await rebuildBin(tx, tenantId, itemId, warehouseId);
  }
}

async function rebuildBin(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemId: string,
  warehouseId: string,
): Promise<void> {
  const sles = await tx.stockLedgerEntry.findMany({
    where: { tenantId, itemId, warehouseId, isCancelled: false },
    orderBy: { postingDate: "asc" },
  });

  let qty = 0;
  let value = 0;
  let rate = 0;
  for (const sle of sles) {
    const actualQty = Number(sle.actualQty);
    if (actualQty > 0) {
      const incomingRate = Number(sle.incomingRate);
      qty += actualQty;
      value += actualQty * incomingRate;
      rate = qty > 0 ? value / qty : 0;
    } else {
      const qtyOut = -actualQty;
      qty -= qtyOut;
      value -= qtyOut * rate;
      if (qty < 0.0001) {
        qty = 0;
        value = 0;
      }
      rate = qty > 0 ? value / qty : 0;
    }
  }

  await tx.bin.upsert({
    where: {
      tenantId_itemId_warehouseId: { tenantId, itemId, warehouseId },
    },
    create: {
      tenantId,
      itemId,
      warehouseId,
      actualQty: new Prisma.Decimal(qty),
      valuationRate: new Prisma.Decimal(rate),
      stockValue: new Prisma.Decimal(value),
    },
    update: {
      actualQty: new Prisma.Decimal(qty),
      valuationRate: new Prisma.Decimal(rate),
      stockValue: new Prisma.Decimal(value),
    },
  });
}

// Manufacturing posting: two-phase.
//   Phase 1: consume raw materials at their current avg rates. Sum consumed value.
//   Phase 2: produce finished goods at incomingRate = totalConsumed / totalProduced.
// This makes FG valuation = actual RM cost (no operating cost yet — later).
//
// Both phases write SLEs against the same voucher, so cancel via cancelStockEntries
// reverses both correctly.
export async function postManufactureEntry(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    postingDate: Date;
    voucherType: "StockEntry" | "WorkOrder";
    voucherId: string;
    voucherName?: string | null;
    consumeLines: Array<{ itemId: string; warehouseId: string; qty: number }>;
    produceLines: Array<{ itemId: string; warehouseId: string; qty: number }>;
  },
): Promise<{ totalConsumed: number; totalProduced: number; producedRate: number }> {
  const { tenantId, postingDate, voucherType, voucherId, voucherName } = params;

  // Read current rates for all consume lines BEFORE posting (outflow at avg
  // doesn't change the rate, so reading up-front is fine even if a single item
  // appears in multiple lines).
  let totalConsumed = 0;
  for (const line of params.consumeLines) {
    const bin = await tx.bin.findUnique({
      where: {
        tenantId_itemId_warehouseId: {
          tenantId,
          itemId: line.itemId,
          warehouseId: line.warehouseId,
        },
      },
      select: { valuationRate: true },
    });
    const rate = Number(bin?.valuationRate ?? 0);
    totalConsumed += line.qty * rate;
  }

  // Phase 1: outflows.
  await postStockEntries(tx, {
    tenantId,
    postingDate,
    voucherType,
    voucherId,
    voucherName,
    lines: params.consumeLines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      actualQty: -l.qty,
    })),
  });

  // Phase 2: inflows at computed rate.
  const totalProduced = params.produceLines.reduce((s, l) => s + l.qty, 0);
  const producedRate = totalProduced > 0 ? totalConsumed / totalProduced : 0;
  await postStockEntries(tx, {
    tenantId,
    postingDate,
    voucherType,
    voucherId,
    voucherName,
    lines: params.produceLines.map((l) => ({
      itemId: l.itemId,
      warehouseId: l.warehouseId,
      actualQty: l.qty,
      incomingRate: producedRate,
    })),
  });

  return { totalConsumed, totalProduced, producedRate };
}
