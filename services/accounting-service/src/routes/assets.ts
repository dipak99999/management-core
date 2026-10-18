import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildDepreciationSchedule,
  cancelGLEntries,
  nextName,
  postGLEntries,
  prisma,
  requireTenantDefaults,
} from "@lumaara/db";
import { idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const assetRouter = Router();

const p = perms("Asset");

const createSchema = z.object({
  assetName: z.string().min(1).max(120),
  categoryId: z.string().min(1),
  purchaseDate: z.string().datetime(),
  purchasePrice: z.coerce.number().positive(),
  salvageValue: z.coerce.number().nonnegative().default(0),
  usefulLifeMonths: z.coerce.number().int().positive(),
  depreciationMethod: z.enum(["Straight Line", "WDV"]).default("Straight Line"),
  wdvAnnualRatePct: z.coerce.number().min(0).max(100).optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

assetRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.asset.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
    },
    include: {
      category: { select: { id: true, categoryName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

assetRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.asset.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      category: {
        include: {
          assetAccount: { select: { id: true, accountName: true } },
          accumDepreciationAccount: { select: { id: true, accountName: true } },
          depExpenseAccount: { select: { id: true, accountName: true } },
        },
      },
      schedule: { orderBy: { installmentNo: "asc" } },
      maintenanceLogs: { orderBy: { date: "desc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

assetRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const cat = await prisma.assetCategory.findFirst({
    where: { id: parsed.data.categoryId, tenantId },
  });
  if (!cat) return res.status(400).json({ error: "Invalid category" });

  const assetCode = await nextName(prisma, tenantId, "AST-");
  const row = await prisma.asset.create({
    data: {
      tenantId,
      assetCode,
      assetName: parsed.data.assetName,
      categoryId: parsed.data.categoryId,
      purchaseDate: new Date(parsed.data.purchaseDate),
      purchasePrice: parsed.data.purchasePrice,
      salvageValue: parsed.data.salvageValue,
      usefulLifeMonths: parsed.data.usefulLifeMonths,
      depreciationMethod: parsed.data.depreciationMethod,
      wdvAnnualRatePct:
        parsed.data.depreciationMethod === "WDV"
          ? parsed.data.wdvAnnualRatePct ?? null
          : null,
      currentValue: parsed.data.purchasePrice,
      status: "Draft",
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
    },
    include: {
      category: { select: { id: true, categoryName: true } },
    },
  });
  res.status(201).json(row);
});

// Submit: generates depreciation schedule. Optionally posts an acquisition GL
// entry (DR assetAccount / CR acquisitionAccount) — omit acquisitionAccountId
// if the asset was already recorded via a PI (deferred: PI-to-asset flow).
const submitSchema = z.object({
  acquisitionAccountId: z.string().optional().nullable(),
});

assetRouter.post("/:id/submit", p.submit, idempotency("POST /assets/:id/submit"), async (req, res) => {
  const parsed = submitSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: req.params.id, tenantId },
        include: { category: true },
      });
      if (!asset) throw new Error("Not found");
      if (asset.status !== "Draft")
        throw new Error(`Cannot submit asset in status ${asset.status}`);

      const scheduleRows = buildDepreciationSchedule(
        Number(asset.purchasePrice),
        Number(asset.salvageValue),
        asset.usefulLifeMonths,
        asset.purchaseDate,
        asset.depreciationMethod as "Straight Line" | "WDV",
        asset.wdvAnnualRatePct != null ? Number(asset.wdvAnnualRatePct) : null,
      );

      await tx.assetDepreciationSchedule.createMany({
        data: scheduleRows.map((s) => ({
          assetId: asset.id,
          installmentNo: s.installmentNo,
          dueDate: s.dueDate,
          amount: s.amount,
          balanceAfter: s.balanceAfter,
        })),
      });

      // Optional acquisition posting: DR Asset / CR chosen source.
      if (parsed.data.acquisitionAccountId) {
        const acq = await tx.account.findFirst({
          where: {
            id: parsed.data.acquisitionAccountId,
            tenantId,
            isGroup: false,
          },
        });
        if (!acq) throw new Error("Invalid acquisitionAccountId");
        await postGLEntries(tx, {
          tenantId,
          postingDate: asset.purchaseDate,
          voucherType: "Asset",
          voucherId: asset.id,
          voucherName: asset.assetCode,
          lines: [
            {
              accountId: asset.category.assetAccountId,
              debit: Number(asset.purchasePrice),
              credit: 0,
              remarks: `Acquire ${asset.assetName}`,
            },
            {
              accountId: acq.id,
              debit: 0,
              credit: Number(asset.purchasePrice),
            },
          ],
        });
      }

      return tx.asset.update({
        where: { id: asset.id },
        data: { status: "Depreciating" },
        include: {
          category: { select: { id: true, categoryName: true } },
          schedule: { orderBy: { installmentNo: "asc" } },
        },
      });
    });
    void publishRealtime(req.auth!.tenantId, "asset", { id: result.id, status: "Depreciating" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Book depreciation for one installment: DR Dep Expense / CR Accum Depreciation.
// Reduces asset.currentValue by the amount. Flips status to FullyDepreciated
// on the last booking.
const bookSchema = z.object({
  installmentNo: z.coerce.number().int().positive(),
  postingDate: z.string().datetime().optional(),
});

assetRouter.post("/:id/book-depreciation", p.submit, async (req, res) => {
  const parsed = bookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: req.params.id, tenantId },
        include: { category: true, schedule: { orderBy: { installmentNo: "asc" } } },
      });
      if (!asset) throw new Error("Not found");
      if (asset.status !== "Depreciating")
        throw new Error(`Cannot book depreciation for asset in status ${asset.status}`);

      const inst = asset.schedule.find((s) => s.installmentNo === parsed.data.installmentNo);
      if (!inst) throw new Error(`Installment ${parsed.data.installmentNo} not found`);
      if (inst.isBooked)
        throw new Error(`Installment ${inst.installmentNo} already booked`);

      const postingDate = parsed.data.postingDate
        ? new Date(parsed.data.postingDate)
        : inst.dueDate;

      await postGLEntries(tx, {
        tenantId,
        postingDate,
        voucherType: "AssetDepreciation",
        voucherId: inst.id,
        voucherName: `${asset.assetCode}/${inst.installmentNo}`,
        lines: [
          {
            accountId: asset.category.depExpenseAccountId,
            debit: Number(inst.amount),
            credit: 0,
            remarks: `Depreciation ${asset.assetName} inst ${inst.installmentNo}`,
          },
          {
            accountId: asset.category.accumDepreciationAccountId,
            debit: 0,
            credit: Number(inst.amount),
          },
        ],
      });

      await tx.assetDepreciationSchedule.update({
        where: { id: inst.id },
        data: {
          isBooked: true,
          bookedAt: postingDate,
          bookedBy: req.auth!.userId,
        },
      });

      const newCurrentValue = new Prisma.Decimal(asset.currentValue).sub(inst.amount);
      const allBooked = asset.schedule.every(
        (s) => s.id === inst.id || s.isBooked,
      );
      return tx.asset.update({
        where: { id: asset.id },
        data: {
          currentValue: newCurrentValue.lt(asset.salvageValue) ? asset.salvageValue : newCurrentValue,
          status: allBooked ? "FullyDepreciated" : "Depreciating",
        },
        include: {
          category: { select: { id: true, categoryName: true } },
          schedule: { orderBy: { installmentNo: "asc" } },
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Scrap: writes off the remaining book value. Posts:
//   DR Accumulated Depreciation (total booked so far)
//   DR Loss on Asset Scrap      (remaining currentValue − salvageValue, if positive)
//   DR Cash|Bank                (salvage proceeds, if provided)
//   CR Asset                    (full purchasePrice)
const scrapSchema = z.object({
  postingDate: z.string().datetime(),
  proceedsAccountId: z.string().optional().nullable(), // Cash/Bank if the asset was sold for salvage
  proceedsAmount: z.coerce.number().nonnegative().default(0),
  lossAccountId: z.string().optional().nullable(), // defaults to auto-lookup "Loss on Asset Scrap"
});

assetRouter.post("/:id/scrap", p.cancel, async (req, res) => {
  const parsed = scrapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: req.params.id, tenantId },
        include: { category: true, schedule: true },
      });
      if (!asset) throw new Error("Not found");
      if (asset.status === "Scrapped" || asset.status === "Cancelled")
        throw new Error(`Cannot scrap asset in status ${asset.status}`);
      if (asset.status === "Draft")
        throw new Error("Cannot scrap a Draft asset — cancel it instead");

      const booked = asset.schedule
        .filter((s) => s.isBooked)
        .reduce((s, r) => s + Number(r.amount), 0);
      const purchasePrice = Number(asset.purchasePrice);
      const proceeds = parsed.data.proceedsAmount;
      const remainingBookValue = purchasePrice - booked;
      // Loss = book value − proceeds. If proceeds > book value, that's a gain
      // (rare — MVP treats it as a negative loss = credit).
      const loss = remainingBookValue - proceeds;

      let lossAccountId = parsed.data.lossAccountId ?? null;
      if (Math.abs(loss) > 0.0001 && !lossAccountId) {
        const lossAcc = await tx.account.findFirst({
          where: { tenantId, accountName: "Loss on Asset Scrap", isGroup: false },
        });
        if (!lossAcc)
          throw new Error(
            "No 'Loss on Asset Scrap' account found — pass lossAccountId explicitly",
          );
        lossAccountId = lossAcc.id;
      }

      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        remarks?: string;
      }[] = [];
      if (booked > 0)
        lines.push({
          accountId: asset.category.accumDepreciationAccountId,
          debit: booked,
          credit: 0,
          remarks: "Reverse booked accumulated depreciation on scrap",
        });
      if (proceeds > 0 && parsed.data.proceedsAccountId) {
        const proc = await tx.account.findFirst({
          where: { id: parsed.data.proceedsAccountId, tenantId, isGroup: false },
        });
        if (!proc) throw new Error("Invalid proceedsAccountId");
        lines.push({
          accountId: proc.id,
          debit: proceeds,
          credit: 0,
          remarks: "Scrap proceeds",
        });
      }
      if (Math.abs(loss) > 0.0001) {
        if (loss > 0)
          lines.push({
            accountId: lossAccountId!,
            debit: loss,
            credit: 0,
            remarks: "Loss on scrap",
          });
        else
          lines.push({
            accountId: lossAccountId!,
            debit: 0,
            credit: -loss,
            remarks: "Gain on scrap",
          });
      }
      lines.push({
        accountId: asset.category.assetAccountId,
        debit: 0,
        credit: purchasePrice,
        remarks: `Retire ${asset.assetName}`,
      });

      await postGLEntries(tx, {
        tenantId,
        postingDate: new Date(parsed.data.postingDate),
        voucherType: "AssetScrap",
        voucherId: asset.id,
        voucherName: asset.assetCode,
        lines,
      });

      return tx.asset.update({
        where: { id: asset.id },
        data: {
          status: "Scrapped",
          currentValue: new Prisma.Decimal(0),
        },
      });
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Cancel: Draft only (no GL to reverse). For non-draft see scrap.
assetRouter.post("/:id/cancel", p.cancel, idempotency("POST /assets/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const asset = await prisma.asset.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!asset) return res.status(404).json({ error: "Not found" });
  if (asset.status !== "Draft")
    return res.status(400).json({
      error: "Non-draft assets must be scrapped (see /scrap) — cancel reversal is not supported",
    });
  // Nothing posted yet; also drop the schedule if any (defensively).
  await prisma.$transaction(async (tx) => {
    await tx.assetDepreciationSchedule.deleteMany({ where: { assetId: asset.id } });
    await tx.asset.update({ where: { id: asset.id }, data: { status: "Cancelled" } });
    // Cancel any acquisition GL that got posted somehow (defensive).
    await cancelGLEntries(tx, {
      tenantId,
      voucherType: "Asset",
      voucherId: asset.id,
    });
  });
  void publishRealtime(tenantId, "asset", { id: asset.id, status: "Cancelled" });
  res.json({ ok: true });
});
