import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  companyPrefix,
  computeInvoiceTaxLines,
  latestScheduleDueDate,
  materializeSchedule,
  nextName,
  prisma,
  resolveCompanyForVoucher,
  resolveTaxTemplate,
  validateCustomData,
} from "@lumaara/db";
import { cancelGLEntries, postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { getAllowedCompanyIds, idempotency, perms, publishRealtime } from "@lumaara/service-auth";

export const purchaseInvoiceRouter = Router();

const p = perms("PurchaseInvoice");

// B12: round grandTotal to whole units. Mirrors sales-invoices.ts helper.
function roundGrandTotal(grand: Prisma.Decimal, hasRoundOffAccount: boolean) {
  if (!hasRoundOffAccount) {
    return { roundedTotal: grand, roundingAdjustment: new Prisma.Decimal(0) };
  }
  const roundedNum = Math.round(Number(grand));
  const rounded = new Prisma.Decimal(roundedNum);
  const adjustment = rounded.sub(grand);
  return { roundedTotal: rounded, roundingAdjustment: adjustment };
}

const itemLineSchema = z.object({
  itemId: z.string().min(1),
  // B15: qty can be negative on Debit Notes.
  qty: z.coerce.number().refine((v) => v !== 0, "qty cannot be zero"),
  rate: z.coerce.number().nonnegative(),
  description: z.string().optional().nullable(),
  // B11: per-line tax override (falls back to invoice-level template).
  taxTemplateId: z.string().optional().nullable(),
});

const createSchema = z.object({
  supplierId: z.string().min(1),
  supplierInvoiceNo: z.string().optional().nullable(),
  postingDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  currency: z.string().default("INR"),
  conversionRate: z.coerce.number().positive().default(1),
  taxTemplateId: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  // B15: Debit Note. See sales-invoices.ts for semantics.
  isReturn: z.boolean().default(false),
  returnAgainstId: z.string().optional().nullable(),
  items: z.array(itemLineSchema).min(1),
  customData: z.record(z.unknown()).optional().nullable(),
  // D10: staggered payment schedule. Mirrors SI — submit materializes an
  // InvoicePaymentSchedule and overwrites dueDate to the latest installment.
  paymentTermsTemplateId: z.string().optional().nullable(),
  // Multi-company Phase 2: doctype-level companyId. Falls back to tenant
  // default when omitted; stamps every GLEntry posted from this invoice.
  companyId: z.string().optional().nullable(),
});


function validateReturnSign(items: { qty: number }[], isReturn: boolean): string | null {
  if (isReturn && items.some((i) => i.qty > 0))
    return "Debit Note lines must all have qty ≤ 0";
  if (!isReturn && items.some((i) => i.qty < 0))
    return "Set isReturn=true to create a Debit Note (negative qty)";
  return null;
}

purchaseInvoiceRouter.get("/", p.read, async (req, res) => {
  // Multi-company Phase 7: same scope rules as SI list.
  const requested =
    typeof req.query.companyId === "string" && req.query.companyId.length > 0
      ? req.query.companyId
      : null;
  const allowed = await getAllowedCompanyIds(req.auth!);
  if (requested && allowed !== null && !allowed.includes(requested)) {
    return res.status(403).json({ error: "You don't have access to that company" });
  }
  const companyWhere = requested
    ? { companyId: requested }
    : allowed !== null
      ? { companyId: { in: allowed } }
      : {};
  const rows = await prisma.purchaseInvoice.findMany({
    where: { tenantId: req.auth!.tenantId, ...companyWhere },
    include: {
      supplier: { select: { supplierName: true } },
      items: true,
      taxes: true,
    },
    orderBy: { postingDate: "desc" },
  });
  res.json(rows);
});

purchaseInvoiceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.purchaseInvoice.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      supplier: true,
      items: { include: { item: true } },
      taxes: true,
      taxTemplate: true,
      paymentTermsTemplate: { select: { id: true, name: true } },
      paymentSchedule: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail — mirrors sales-invoices/:id/full for the purchase side.
purchaseInvoiceRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const inv = await prisma.purchaseInvoice.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      supplier: true,
      items: { include: { item: true } },
      taxes: { include: { account: { select: { accountName: true } } } },
      taxTemplate: true,
      paymentTermsTemplate: { select: { id: true, name: true } },
      paymentSchedule: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!inv) return res.status(404).json({ error: "Not found" });

  const [paymentRefs, glEntries] = await Promise.all([
    prisma.paymentEntryReference.findMany({
      where: {
        referenceDoctype: "PurchaseInvoice",
        referenceId: inv.id,
        paymentEntry: { tenantId },
      },
      include: {
        paymentEntry: {
          select: {
            id: true,
            name: true,
            paymentType: true,
            postingDate: true,
            modeOfPayment: true,
            status: true,
            paidAmount: true,
          },
        },
      },
      orderBy: { paymentEntry: { postingDate: "desc" } },
    }),
    prisma.gLEntry.findMany({
      where: {
        tenantId,
        voucherType: "PurchaseInvoice",
        voucherId: inv.id,
        isCancelled: false,
      },
      include: { account: { select: { accountName: true, rootType: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  res.json({ invoice: inv, paymentRefs, glEntries });
});

// Update a Draft purchase invoice. Same semantics as sales-invoices PUT.
purchaseInvoiceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.purchaseInvoice.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot edit invoice in status ${existing.status}` });

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "PurchaseInvoice",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
      { docId: existing.id },
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: p.supplierId, tenantId },
  });
  if (!supplier) return res.status(400).json({ error: "Invalid supplier" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size)
    return res.status(400).json({ error: "One or more items are invalid for this tenant" });

  const signErr = validateReturnSign(p.items, p.isReturn);
  if (signErr) return res.status(400).json({ error: signErr });
  if (p.returnAgainstId) {
    const orig = await prisma.purchaseInvoice.findFirst({
      where: { id: p.returnAgainstId, tenantId, supplierId: p.supplierId },
      select: { id: true, status: true },
    });
    if (!orig) return res.status(400).json({ error: "Invalid returnAgainstId" });
    if (orig.status === "Draft" || orig.status === "Cancelled")
      return res.status(400).json({ error: `Cannot return against ${orig.status} invoice` });
  }

  // B11: resolve invoice-level + any per-line template overrides. Pre-load
  // every referenced templateId in one round trip so `computeInvoiceTaxLines`
  // can stay synchronous.
  const templateIds = Array.from(
    new Set(
      [
        p.taxTemplateId ?? null,
        ...p.items.map((i) => i.taxTemplateId ?? null),
      ].filter((v): v is string => !!v),
    ),
  );
  const templateMap = new Map<string, Awaited<ReturnType<typeof resolveTaxTemplate>>>();
  try {
    for (const id of templateIds) {
      templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Purchase"));
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const invoiceLevelTemplate = p.taxTemplateId
    ? templateMap.get(p.taxTemplateId) ?? null
    : null;

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
  }));
  const netTotal = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    p.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const taxAmount = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(taxAmount);

  // B12: rounding.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultRoundOffAccountId: true },
  });
  const { roundedTotal, roundingAdjustment } = roundGrandTotal(
    grandTotal,
    !!tenant?.defaultRoundOffAccountId,
  );

  const updated = await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoiceItem.deleteMany({ where: { purchaseInvoiceId: existing.id } });
    await tx.purchaseInvoiceTax.deleteMany({ where: { purchaseInvoiceId: existing.id } });
    return tx.purchaseInvoice.update({
      where: { id: existing.id },
      data: {
        supplierId: p.supplierId,
        supplierInvoiceNo: p.supplierInvoiceNo ?? null,
        postingDate: p.postingDate ? new Date(p.postingDate) : existing.postingDate,
        dueDate: p.dueDate ? new Date(p.dueDate) : null,
        currency: p.currency,
        conversionRate: new Prisma.Decimal(p.conversionRate),
        taxTemplateId: invoiceLevelTemplate?.id ?? null,
        remarks: p.remarks ?? null,
        netTotal,
        totalTaxes: taxAmount,
        grandTotal,
        roundedTotal,
        roundingAdjustment,
        isReturn: p.isReturn,
        returnAgainstId: p.returnAgainstId ?? null,
        customData: customData ?? undefined,
        outstandingAmt: roundedTotal,
        paymentTermsTemplateId: p.paymentTermsTemplateId ?? null,
        ...(p.companyId !== undefined ? { companyId: p.companyId } : {}),
        items: { create: lines },
        taxes: taxLines.length
          ? {
              create: taxLines.map((r) => ({
                description: r.description,
                rate: r.rate,
                taxAmount: r.taxAmount,
                accountId: r.accountId,
                chargeType: r.chargeType,
                taxTemplateId: r.taxTemplateId ?? invoiceLevelTemplate?.id ?? null,
              })),
            }
          : undefined,
      },
      include: { items: true, taxes: true },
    });
  });

  res.json(updated);
});

purchaseInvoiceRouter.post("/", p.create, idempotency("POST /purchase-invoices"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "PurchaseInvoice",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: p.supplierId, tenantId },
  });
  if (!supplier) return res.status(400).json({ error: "Invalid supplier" });

  const itemIds = p.items.map((i) => i.itemId);
  const validItems = await prisma.item.findMany({
    where: { id: { in: itemIds }, tenantId },
    select: { id: true },
  });
  if (validItems.length !== new Set(itemIds).size) {
    return res.status(400).json({ error: "One or more items are invalid for this tenant" });
  }

  const signErr = validateReturnSign(p.items, p.isReturn);
  if (signErr) return res.status(400).json({ error: signErr });
  if (p.returnAgainstId) {
    const orig = await prisma.purchaseInvoice.findFirst({
      where: { id: p.returnAgainstId, tenantId, supplierId: p.supplierId },
      select: { id: true, status: true },
    });
    if (!orig) return res.status(400).json({ error: "Invalid returnAgainstId" });
    if (orig.status === "Draft" || orig.status === "Cancelled")
      return res.status(400).json({ error: `Cannot return against ${orig.status} invoice` });
  }

  // B11: resolve invoice-level + any per-line template overrides. Pre-load
  // every referenced templateId so `computeInvoiceTaxLines` stays sync.
  const templateIds = Array.from(
    new Set(
      [
        p.taxTemplateId ?? null,
        ...p.items.map((i) => i.taxTemplateId ?? null),
      ].filter((v): v is string => !!v),
    ),
  );
  const templateMap = new Map<string, Awaited<ReturnType<typeof resolveTaxTemplate>>>();
  try {
    for (const id of templateIds) {
      templateMap.set(id, await resolveTaxTemplate(prisma, tenantId, id, "Purchase"));
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const invoiceLevelTemplate = p.taxTemplateId
    ? templateMap.get(p.taxTemplateId) ?? null
    : null;

  const lines = p.items.map((i) => ({
    itemId: i.itemId,
    qty: new Prisma.Decimal(i.qty),
    rate: new Prisma.Decimal(i.rate),
    amount: new Prisma.Decimal(i.qty).mul(new Prisma.Decimal(i.rate)),
    description: i.description ?? null,
    taxTemplateId: i.taxTemplateId ?? null,
  }));

  const netTotal = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
  const taxLines = computeInvoiceTaxLines(
    lines.map((l) => ({ amount: l.amount, taxTemplateId: l.taxTemplateId })),
    p.taxTemplateId ?? null,
    (id) => templateMap.get(id ?? "")?.rows ?? null,
  );
  const totalTaxes = taxLines.reduce(
    (s, l) => s.add(l.taxAmount),
    new Prisma.Decimal(0),
  );
  const grandTotal = netTotal.add(totalTaxes);

  // B12: rounding.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultRoundOffAccountId: true },
  });
  const { roundedTotal, roundingAdjustment } = roundGrandTotal(
    grandTotal,
    !!tenant?.defaultRoundOffAccountId,
  );

  let company;
  try {
    company = await resolveCompanyForVoucher(prisma, tenantId, p.companyId);
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  // B15: Debit Notes use the DN- series to distinguish from regular PINV-.
  // Multi-company Phase 3: per-company numbering when a Company is set.
  const basePrefix = p.isReturn ? "DN-" : "PINV-";
  const name = await nextName(prisma, tenantId, companyPrefix(basePrefix, company?.code));

  const row = await prisma.purchaseInvoice.create({
    data: {
      tenantId,
      name,
      companyId: company?.id ?? null,
      supplierId: p.supplierId,
      supplierInvoiceNo: p.supplierInvoiceNo ?? null,
      postingDate: p.postingDate ? new Date(p.postingDate) : new Date(),
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
      currency: p.currency,
      conversionRate: new Prisma.Decimal(p.conversionRate),
      taxTemplateId: invoiceLevelTemplate?.id ?? null,
      remarks: p.remarks ?? null,
      netTotal,
      totalTaxes,
      grandTotal,
      roundedTotal,
      roundingAdjustment,
      isReturn: p.isReturn,
      returnAgainstId: p.returnAgainstId ?? null,
      customData: customData ?? undefined,
      outstandingAmt: roundedTotal,
      status: "Draft",
      paymentTermsTemplateId: p.paymentTermsTemplateId ?? null,
      items: { create: lines },
      taxes: taxLines.length
        ? {
            create: taxLines.map((r) => ({
              description: r.description,
              rate: r.rate,
              taxAmount: r.taxAmount,
              accountId: r.accountId,
              chargeType: r.chargeType,
              taxTemplateId: r.taxTemplateId ?? invoiceLevelTemplate?.id ?? null,
            })),
          }
        : undefined,
    },
    include: {
      items: true,
      taxes: true,
      supplier: { select: { supplierName: true } },
    },
  });

  res.status(201).json(row);
});

// Submit: posts GL entries. Amounts × conversionRate for base-currency ledger.
//   Debit  Purchases    (netTotal × fx)
//   Debit  Tax accounts (per-tax taxAmount × fx)   [input tax → asset/receivable]
//   Credit Creditors    (grandTotal × fx)  [party = supplier]
purchaseInvoiceRouter.post("/:id/submit", p.submit, idempotency("POST /purchase-invoices/:id/submit"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.purchaseInvoice.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          taxes: true,
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  itemName: true,
                  isAsset: true,
                  defaultAssetCategoryId: true,
                },
              },
            },
          },
        },
      });
      if (!inv) throw new Error("Not found");
      if (inv.status !== "Draft")
        throw new Error(`Cannot submit invoice in status ${inv.status}`);

      // B15: Debit Note = return to supplier. Refuse if any PR-linked or
      // asset lines are on this PI — stock returns and asset scrap have
      // their own SLE/asset-lifecycle handling and shouldn't be shoehorned
      // through the DN flow. A DN as implemented here is a pure accounting
      // credit against Creditors (e.g. price adjustment, rebate).
      if (inv.isReturn) {
        if (inv.items.some((i) => i.purchaseReceiptItemId))
          throw new Error(
            "Debit Note against a PR-linked purchase is not supported — reverse via Stock Entry",
          );
        if (inv.items.some((i) => i.item.isAsset))
          throw new Error(
            "Debit Note against an asset line is not supported — scrap the asset instead",
          );
      }

      // 3-way split: SRBNB flip (PR-linked lines), asset lines (item.isAsset),
      // and Purchases (rest). Asset lines debit the AssetCategory's asset
      // account instead of Purchases + spawn draft Asset rows.
      const defaultsKeys: Parameters<typeof requireTenantDefaults>[2] = [
        "defaultPayableAccountId",
        "defaultExpenseAccountId",
      ];
      const hasSrbnbFlip = inv.items.some((i) => i.purchaseReceiptItemId);
      if (hasSrbnbFlip)
        defaultsKeys.push("defaultStockReceivedButNotBilledAccountId");
      const roundAdj = Number(inv.roundingAdjustment);
      const needsRoundOff = roundAdj !== 0;
      if (needsRoundOff) defaultsKeys.push("defaultRoundOffAccountId");
      // Multi-company Phase 4: Company-scoped default overrides.
      const defaults = await requireTenantDefaults(tx, tenantId, defaultsKeys, inv.companyId);

      const fx = Number(inv.conversionRate);
      let purchasesValue = 0;
      let srbnbValue = 0;
      // Sum per asset category so we post one GL line per category.
      const assetValueByCategory = new Map<string, number>();
      const assetLines: {
        pIItemId: string;
        itemName: string;
        categoryId: string;
        qty: number;
        rate: number;
      }[] = [];
      for (const it of inv.items) {
        const v = Number(it.amount);
        if (it.purchaseReceiptItemId) {
          srbnbValue += v;
        } else if (it.item.isAsset) {
          if (!it.item.defaultAssetCategoryId)
            throw new Error(
              `Item ${it.item.itemName} is flagged isAsset but has no defaultAssetCategoryId — set it in Items master`,
            );
          assetValueByCategory.set(
            it.item.defaultAssetCategoryId,
            (assetValueByCategory.get(it.item.defaultAssetCategoryId) ?? 0) + v,
          );
          assetLines.push({
            pIItemId: it.id,
            itemName: it.item.itemName,
            categoryId: it.item.defaultAssetCategoryId,
            qty: Number(it.qty),
            rate: Number(it.rate),
          });
        } else {
          purchasesValue += v;
        }
      }

      const lines: {
        accountId: string;
        debit: number;
        credit: number;
        remarks?: string;
        partyType?: string;
        partyId?: string;
      }[] = [];
      // B15: Purchases leg — on a Debit Note the amount is negative in the
      // ledger (purchasesValue < 0); we abs + push to the credit side.
      if (Math.abs(purchasesValue) > 0.0001) {
        const purchasesAbs = Math.abs(purchasesValue) * fx;
        lines.push({
          accountId: defaults.defaultExpenseAccountId!,
          debit: inv.isReturn ? 0 : purchasesAbs,
          credit: inv.isReturn ? purchasesAbs : 0,
        });
      }
      if (srbnbValue > 0)
        lines.push({
          accountId: defaults.defaultStockReceivedButNotBilledAccountId!,
          debit: srbnbValue * fx,
          credit: 0,
          remarks: "SRBNB → Creditors flip on invoicing",
        });
      // Debit each asset category's assetAccount for its aggregate value.
      if (assetValueByCategory.size > 0) {
        const categories = await tx.assetCategory.findMany({
          where: { id: { in: [...assetValueByCategory.keys()] }, tenantId },
          select: {
            id: true,
            categoryName: true,
            assetAccountId: true,
            defaultUsefulLifeMonths: true,
          },
        });
        const catMap = new Map(categories.map((c) => [c.id, c]));
        for (const [catId, value] of assetValueByCategory) {
          const cat = catMap.get(catId);
          if (!cat)
            throw new Error(`Asset category ${catId} not found for tenant`);
          lines.push({
            accountId: cat.assetAccountId,
            debit: value * fx,
            credit: 0,
            remarks: `Asset acquisition: ${cat.categoryName}`,
          });
        }

        // Auto-create draft Asset rows — one per unit (Math.floor(qty)).
        for (const a of assetLines) {
          const cat = catMap.get(a.categoryId)!;
          const units = Math.max(1, Math.floor(a.qty));
          for (let i = 0; i < units; i++) {
            const assetCode = await nextName(tx, tenantId, "AST-");
            await tx.asset.create({
              data: {
                tenantId,
                assetCode,
                assetName: units > 1 ? `${a.itemName} #${i + 1}` : a.itemName,
                categoryId: a.categoryId,
                purchaseDate: inv.postingDate,
                purchasePrice: new Prisma.Decimal(a.rate),
                salvageValue: new Prisma.Decimal(0),
                usefulLifeMonths: cat.defaultUsefulLifeMonths,
                currentValue: new Prisma.Decimal(a.rate),
                status: "Draft",
                sourcePurchaseInvoiceItemId: a.pIItemId,
              },
            });
          }
        }
      }
      // B15: on Debit Notes, all sign-carrying magnitudes have to be
      // absolute-valued in the ledger and the direction of each leg flipped.
      // On a normal PI: tax = Debit, Creditors = Credit.
      // On a Debit Note:      tax = Credit, Creditors = Debit.
      // (Purchases/SRBNB/Asset paths are not reachable on isReturn — guarded
      // earlier — so this only rewrites the tax + creditors + round-off legs
      // and the caller's lines[] built from purchasesValue is already zero.)
      const isReturn = inv.isReturn;
      const swap = (dr: number, cr: number) => (isReturn ? [cr, dr] : [dr, cr]);
      for (const t of inv.taxes) {
        const [dr, cr] = swap(Math.abs(Number(t.taxAmount)) * fx, 0);
        lines.push({
          accountId: t.accountId,
          debit: dr,
          credit: cr,
          remarks: t.description,
        });
      }
      // B12: creditors credit uses roundedTotal (what we owe the supplier);
      // the delta between grand and rounded is booked to Round Off with sign
      // that keeps the entry balanced. On a Debit Note the leg flips to a
      // debit against Creditors (i.e. reducing what we owe).
      const apValue = Number(inv.roundedTotal) || Number(inv.grandTotal);
      {
        const [dr, cr] = swap(0, Math.abs(apValue) * fx);
        lines.push({
          accountId: defaults.defaultPayableAccountId!,
          debit: dr,
          credit: cr,
          partyType: "Supplier",
          partyId: inv.supplierId,
        });
      }
      if (needsRoundOff) {
        const adjBase = Math.abs(roundAdj) * fx;
        const adjSign = roundAdj > 0 ? 1 : -1;
        // On a normal PI: rounded up → Debit Round Off, rounded down → Credit.
        // On a Debit Note the same swap applies.
        const [dr, cr] = swap(
          adjSign > 0 ? adjBase : 0,
          adjSign < 0 ? adjBase : 0,
        );
        lines.push({
          accountId: defaults.defaultRoundOffAccountId!,
          debit: dr,
          credit: cr,
          remarks: "Rounding adjustment",
        });
      }

      await postGLEntries(tx, {
        tenantId,
        postingDate: inv.postingDate,
        voucherType: "PurchaseInvoice",
        voucherId: inv.id,
        voucherName: inv.name,
        companyId: inv.companyId,
        lines,
      });

      // B15: apply Debit Note against source invoice.
      if (isReturn && inv.returnAgainstId) {
        const orig = await tx.purchaseInvoice.findFirst({
          where: { id: inv.returnAgainstId, tenantId },
        });
        if (!orig) throw new Error("Return source invoice missing");
        const reduce = new Prisma.Decimal(Math.abs(apValue));
        const newOutstanding = new Prisma.Decimal(orig.outstandingAmt).sub(reduce);
        await tx.purchaseInvoice.update({
          where: { id: orig.id },
          data: {
            outstandingAmt: newOutstanding.lt(0) ? new Prisma.Decimal(0) : newOutstanding,
            status: newOutstanding.lte(0.0001) ? "Paid" : orig.status,
          },
        });
        await tx.purchaseInvoice.update({
          where: { id: inv.id },
          data: { outstandingAmt: new Prisma.Decimal(0) },
        });
      }

      // D10: staggered payment schedule. Mirrors the SI submit tx from
      // module 17. When the PI carries a paymentTermsTemplateId and
      // isn't a Debit Note, load the template, materialize rows using
      // apValue (post-tax, post-rounding absolute value), insert them,
      // and overwrite `dueDate` to the latest installment so:
      //   (a) reminders / dunning key off the fully-lapsed date
      //   (b) the classic single-dueDate UI still shows something meaningful.
      let scheduleDueOverride: Date | null = null;
      if (!isReturn && inv.paymentTermsTemplateId) {
        const template = await tx.paymentTermsTemplate.findFirst({
          where: { id: inv.paymentTermsTemplateId, tenantId, enabled: true },
          include: { terms: { orderBy: { sortOrder: "asc" } } },
        });
        if (template && template.terms.length > 0) {
          const rows = materializeSchedule(
            template.terms.map((t) => ({
              description: t.description,
              invoicePortion: t.invoicePortion,
              dueDays: t.dueDays,
              sortOrder: t.sortOrder,
            })),
            inv.postingDate,
            Math.abs(apValue),
          );
          await tx.invoicePaymentSchedule.createMany({
            data: rows.map((r) => ({
              tenantId,
              purchaseInvoiceId: inv.id,
              sortOrder: r.sortOrder,
              description: r.description,
              invoicePortion: new Prisma.Decimal(r.invoicePortion),
              dueDate: r.dueDate,
              amount: new Prisma.Decimal(r.amount),
            })),
          });
          scheduleDueOverride = latestScheduleDueDate(rows);
        }
      }

      return tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: {
          status: "Submitted",
          ...(scheduleDueOverride ? { dueDate: scheduleDueOverride } : {}),
        },
      });
    });
    void publishRealtime(tenantId, "purchase-invoice", { id: result.id, status: "Submitted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

purchaseInvoiceRouter.post("/:id/cancel", p.cancel, idempotency("POST /purchase-invoices/:id/cancel"), async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.purchaseInvoice.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!inv) throw new Error("Not found");
      if (inv.status === "Cancelled") throw new Error("Already cancelled");

      if (inv.status === "Submitted" || inv.status === "Paid") {
        await cancelGLEntries(tx, {
          tenantId,
          voucherType: "PurchaseInvoice",
          voucherId: inv.id,
        });
        // Cancel any auto-created Draft assets sourced from this PI.
        // Assets that were manually submitted (schedule generated) are left
        // alone — user must scrap them explicitly.
        const piItemIds = await tx.purchaseInvoiceItem.findMany({
          where: { purchaseInvoiceId: inv.id },
          select: { id: true },
        });
        await tx.asset.updateMany({
          where: {
            tenantId,
            sourcePurchaseInvoiceItemId: { in: piItemIds.map((i) => i.id) },
            status: "Draft",
          },
          data: { status: "Cancelled" },
        });
        // B15: if this was a Debit Note that had been applied against a
        // source PI, add its magnitude back to that PI's outstanding.
        if (inv.isReturn && inv.returnAgainstId) {
          const orig = await tx.purchaseInvoice.findFirst({
            where: { id: inv.returnAgainstId, tenantId },
          });
          if (orig) {
            const apValue = Number(inv.roundedTotal) || Number(inv.grandTotal);
            const restore = new Prisma.Decimal(Math.abs(apValue));
            await tx.purchaseInvoice.update({
              where: { id: orig.id },
              data: {
                outstandingAmt: new Prisma.Decimal(orig.outstandingAmt).add(restore),
                status: orig.status === "Paid" ? "Submitted" : orig.status,
              },
            });
          }
        }
      }

      return tx.purchaseInvoice.update({
        where: { id: inv.id },
        data: { status: "Cancelled" },
      });
    });
    void publishRealtime(tenantId, "purchase-invoice", { id: result.id, status: "Cancelled" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
