import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  allocateLandedCost,
  applyBumpToBin,
  nextName,
  prisma,
} from "@lumaara/db";
import {
  cancelGLEntries,
  postGLEntries,
  requireTenantDefaults,
} from "../lib/gl-posting";
import { idempotency, perms } from "@lumaara/service-auth";

// Landed Cost Voucher — capitalize freight/duty/customs paid separately onto
// the items in one or more Purchase Receipts. See schema for the flow.

export const landedCostVoucherRouter = Router();

const p = perms("Account"); // treated as account admin

const taxSchema = z.object({
  description: z.string().min(1),
  expenseAccountId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

const upsertSchema = z.object({
  postingDate: z.string().datetime().optional(),
  remarks: z.string().optional().nullable(),
  purchaseReceiptIds: z.array(z.string().min(1)).min(1),
  taxes: z.array(taxSchema).min(1),
});

// ---------- Read ----------

landedCostVoucherRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.landedCostVoucher.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { purchaseReceipts: true, taxes: true } },
      taxes: { select: { amount: true } },
    },
    orderBy: { postingDate: "desc" },
  });
  const shaped = rows.map((r) => ({
    id: r.id,
    name: r.name,
    postingDate: r.postingDate,
    status: r.status,
    remarks: r.remarks,
    receiptCount: r._count.purchaseReceipts,
    totalAmount: r.taxes.reduce((s, t) => s + Number(t.amount), 0),
  }));
  res.json(shaped);
});

landedCostVoucherRouter.get("/:id/full", p.read, async (req, res) => {
  const row = await prisma.landedCostVoucher.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      taxes: { include: { expenseAccount: { select: { accountName: true } } } },
      purchaseReceipts: {
        include: {
          purchaseReceipt: {
            include: {
              supplier: { select: { supplierName: true } },
              items: {
                include: {
                  item: { select: { itemCode: true, itemName: true } },
                  warehouse: { select: { warehouseName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ---------- Create ----------

async function validatePayload(
  tenantId: string,
  data: z.infer<typeof upsertSchema>,
): Promise<string | null> {
  const prs = await prisma.purchaseReceipt.findMany({
    where: { id: { in: data.purchaseReceiptIds }, tenantId },
    select: { id: true, status: true, name: true },
  });
  if (prs.length !== new Set(data.purchaseReceiptIds).size)
    return "One or more purchase receipts are invalid";
  const notSubmitted = prs.filter((r) => r.status !== "Submitted");
  if (notSubmitted.length > 0)
    return `Purchase Receipts must be Submitted: ${notSubmitted.map((r) => r.name).join(", ")}`;

  const accountIds = [...new Set(data.taxes.map((t) => t.expenseAccountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, isGroup: false, disabled: false },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length)
    return "One or more tax accounts are invalid (must be leaf, non-disabled)";
  return null;
}

landedCostVoucherRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const err = await validatePayload(tenantId, parsed.data);
  if (err) return res.status(400).json({ error: err });

  const name = await nextName(prisma, tenantId, "LCV-");
  const row = await prisma.landedCostVoucher.create({
    data: {
      tenantId,
      name,
      postingDate: parsed.data.postingDate ? new Date(parsed.data.postingDate) : new Date(),
      remarks: parsed.data.remarks ?? null,
      status: "Draft",
      purchaseReceipts: {
        create: parsed.data.purchaseReceiptIds.map((prId) => ({
          purchaseReceiptId: prId,
        })),
      },
      taxes: {
        create: parsed.data.taxes.map((t) => ({
          description: t.description,
          expenseAccountId: t.expenseAccountId,
          amount: new Prisma.Decimal(t.amount),
        })),
      },
    },
    include: { taxes: true, purchaseReceipts: true },
  });
  res.status(201).json(row);
});

landedCostVoucherRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.landedCostVoucher.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit in status ${existing.status}` });

  const err = await validatePayload(tenantId, parsed.data);
  if (err) return res.status(400).json({ error: err });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.landedCostVoucherReceipt.deleteMany({
      where: { landedCostVoucherId: existing.id },
    });
    await tx.landedCostVoucherTax.deleteMany({
      where: { landedCostVoucherId: existing.id },
    });
    return tx.landedCostVoucher.update({
      where: { id: existing.id },
      data: {
        postingDate: parsed.data.postingDate ? new Date(parsed.data.postingDate) : existing.postingDate,
        remarks: parsed.data.remarks ?? null,
        purchaseReceipts: {
          create: parsed.data.purchaseReceiptIds.map((prId) => ({
            purchaseReceiptId: prId,
          })),
        },
        taxes: {
          create: parsed.data.taxes.map((t) => ({
            description: t.description,
            expenseAccountId: t.expenseAccountId,
            amount: new Prisma.Decimal(t.amount),
          })),
        },
      },
      include: { taxes: true, purchaseReceipts: true },
    });
  });
  res.json(updated);
});

// ---------- Submit ----------
//
// 1. Load PRs + their items with valuation basis (qty * rate).
// 2. Distribute total cost across items pro-rata by base amount (qty*rate).
// 3. For each item: bump Bin.stockValue by share, recompute valuationRate.
// 4. Write one valuation-only SLE per bumped bin (actualQty=0, updated rate).
// 5. Post GL: DR Stock-in-Hand (total) / CR each tax's expenseAccount (amount).

landedCostVoucherRouter.post("/:id/submit", p.submit, idempotency("POST /landed-cost-vouchers/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const lcv = await tx.landedCostVoucher.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          taxes: true,
          purchaseReceipts: {
            include: {
              purchaseReceipt: {
                include: {
                  items: true,
                },
              },
            },
          },
        },
      });
      if (!lcv) throw new Error("Not found");
      if (lcv.status !== "Draft")
        throw new Error(`Cannot submit in status ${lcv.status}`);

      // Allocation math lives in the pure helper — tested for pro-rata
      // rounding invariants (sum-of-bumps = totalCost to the cent) and
      // duplicate (item, warehouse) aggregation. See packages/db/src/landed-cost.ts.
      const allocation = allocateLandedCost(
        lcv.taxes.map((t) => ({ amount: Number(t.amount) })),
        lcv.purchaseReceipts.flatMap((r) =>
          r.purchaseReceipt.items.map((it) => ({
            prName: r.purchaseReceipt.name,
            itemId: it.itemId,
            warehouseId: it.warehouseId,
            qty: Number(it.qty),
            rate: Number(it.rate),
          })),
        ),
      );

      // Apply per-bin bumps.
      for (const bump of allocation.bumps) {
        const bin = await tx.bin.findUnique({
          where: {
            tenantId_itemId_warehouseId: {
              tenantId,
              itemId: bump.itemId,
              warehouseId: bump.warehouseId,
            },
          },
        });
        if (!bin)
          throw new Error(
            `Bin missing for item+warehouse — the PR must be submitted first (item ${bump.itemId})`,
          );
        const applied = applyBumpToBin(
          {
            stockValue: Number(bin.stockValue),
            actualQty: Number(bin.actualQty),
          },
          { addValue: bump.addValue },
        );

        await tx.bin.update({
          where: { id: bin.id },
          data: {
            stockValue: new Prisma.Decimal(applied.stockValue),
            valuationRate: new Prisma.Decimal(applied.valuationRate),
          },
        });

        // Valuation-only SLE row (actualQty = 0). Keeps the ledger sequenced.
        await tx.stockLedgerEntry.create({
          data: {
            tenantId,
            postingDate: lcv.postingDate,
            itemId: bump.itemId,
            warehouseId: bump.warehouseId,
            actualQty: new Prisma.Decimal(0),
            qtyAfterTransaction: bin.actualQty,
            incomingRate: new Prisma.Decimal(0),
            valuationRate: new Prisma.Decimal(applied.valuationRate),
            stockValue: new Prisma.Decimal(applied.stockValue),
            voucherType: "LandedCostVoucher",
            voucherId: lcv.id,
            voucherName: lcv.name,
          },
        });
      }

      const totalCost = new Prisma.Decimal(allocation.totalCost);

      // GL: DR Stock-in-Hand (aggregate) / CR each tax's expense account.
      const defaults = await requireTenantDefaults(tx, tenantId, [
        "defaultStockInHandAccountId",
      ]);
      const totalCostNum = Number(totalCost);
      const glLines = [
        {
          accountId: defaults.defaultStockInHandAccountId!,
          debit: totalCostNum,
          credit: 0,
        },
        ...lcv.taxes.map((t) => ({
          accountId: t.expenseAccountId,
          debit: 0,
          credit: Number(t.amount),
          remarks: t.description,
        })),
      ];
      await postGLEntries(tx, {
        tenantId,
        postingDate: lcv.postingDate,
        voucherType: "LandedCostVoucher",
        voucherId: lcv.id,
        voucherName: lcv.name,
        lines: glLines,
      });

      return tx.landedCostVoucher.update({
        where: { id: lcv.id },
        data: { status: "Submitted" },
        include: { taxes: true, purchaseReceipts: true },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// ---------- Cancel ----------
//
// Reverse the Bin bumps + write reversal SLE + cancel GL.

landedCostVoucherRouter.post("/:id/cancel", p.cancel, idempotency("POST /landed-cost-vouchers/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const lcv = await tx.landedCostVoucher.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          taxes: true,
          purchaseReceipts: {
            include: {
              purchaseReceipt: { include: { items: true } },
            },
          },
        },
      });
      if (!lcv) throw new Error("Not found");
      if (lcv.status === "Cancelled") throw new Error("Already cancelled");

      if (lcv.status === "Submitted") {
        // Recompute the same allocation and subtract instead of add.
        const totalCost = lcv.taxes.reduce(
          (s, t) => s.add(t.amount),
          new Prisma.Decimal(0),
        );
        const allItems = lcv.purchaseReceipts.flatMap((r) =>
          r.purchaseReceipt.items.map((it) => ({
            itemId: it.itemId,
            warehouseId: it.warehouseId,
            baseAmount: new Prisma.Decimal(it.qty).mul(it.rate),
          })),
        );
        const totalBase = allItems.reduce(
          (s, l) => s.add(l.baseAmount),
          new Prisma.Decimal(0),
        );

        const bumpMap = new Map<
          string,
          { itemId: string; warehouseId: string; subValue: Prisma.Decimal }
        >();
        for (const l of allItems) {
          if (totalBase.lte(0)) continue;
          const share = l.baseAmount.div(totalBase).mul(totalCost);
          const key = `${l.itemId}::${l.warehouseId}`;
          const prev = bumpMap.get(key);
          if (prev) prev.subValue = prev.subValue.add(share);
          else bumpMap.set(key, { itemId: l.itemId, warehouseId: l.warehouseId, subValue: share });
        }

        for (const bump of bumpMap.values()) {
          const bin = await tx.bin.findUnique({
            where: {
              tenantId_itemId_warehouseId: {
                tenantId,
                itemId: bump.itemId,
                warehouseId: bump.warehouseId,
              },
            },
          });
          if (!bin) continue;
          const newStockValue = new Prisma.Decimal(bin.stockValue).sub(bump.subValue);
          const newValuationRate = bin.actualQty.gt(0)
            ? newStockValue.div(bin.actualQty)
            : new Prisma.Decimal(0);
          await tx.bin.update({
            where: { id: bin.id },
            data: {
              stockValue: newStockValue.lt(0) ? new Prisma.Decimal(0) : newStockValue,
              valuationRate: newValuationRate.lt(0)
                ? new Prisma.Decimal(0)
                : newValuationRate,
            },
          });
        }

        // Cancel the SLE rows we wrote at submit.
        await tx.stockLedgerEntry.updateMany({
          where: {
            tenantId,
            voucherType: "LandedCostVoucher",
            voucherId: lcv.id,
            isCancelled: false,
          },
          data: { isCancelled: true },
        });

        // Reverse GL.
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "LandedCostVoucher",
          voucherId: lcv.id,
        });
      }

      return tx.landedCostVoucher.update({
        where: { id: lcv.id },
        data: { status: "Cancelled" },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

landedCostVoucherRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.landedCostVoucher.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status === "Submitted")
    return res.status(400).json({ error: "Cancel before deleting" });
  await prisma.landedCostVoucher.delete({ where: { id: existing.id } });
  res.status(204).send();
});
