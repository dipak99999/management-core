import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  applyPricingRule,
  assertAllResolved,
  assertSingleTenant,
  computeCartTotals,
  emitEvent,
  nextName,
  normalizeCouponCode,
  prisma,
  validateCoupon,
} from "@lumaara/db";

// Public storefront checkout — anonymous. Client POSTs its localStorage cart
// (WebsiteItem ids + qty) plus the buyer's contact details. Server:
//   1. Validates every item is Published + belongs to the same tenant.
//   2. Finds an existing Customer by (tenantId, email) or creates one.
//   3. Creates a SalesOrder in Draft status with the EC-SO- naming series.
// Draft (not Submitted) so staff review and add taxes / shipping / promo
// codes before committing. Draft SOs already surface in the crm-web
// Sales Orders list — no new admin queue needed.
//
// No tax computation happens here. Staff add the tax template at review
// time (matches ERPNext's default e-commerce → "sales order" flow). Live
// payments (Razorpay checkout) are wired in v2.

export const shopCheckoutRouter = Router();

const cartLineSchema = z.object({
  websiteItemId: z.string().min(1),
  // When the shopped WebsiteItem points at a variant template, the
  // storefront also stamps the specific variant Item id here. Checkout
  // uses variantItemId for the SO row (its own price, its own itemCode,
  // its own stock) — the template Item itself is never sold directly.
  variantItemId: z.string().optional().nullable(),
  qty: z.coerce.number().positive().max(999),
});

const checkoutSchema = z.object({
  items: z.array(cartLineSchema).min(1).max(50),
  customerName: z.string().min(1).max(200),
  email: z.string().email(),
  mobile: z.string().max(32).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  city: z.string().max(96).optional().nullable(),
  postalCode: z.string().max(32).optional().nullable(),
  remarks: z.string().max(2000).optional().nullable(),
  // D4: optional coupon. Validated + discount baked into line rates here.
  // The SI usedCount++ enforcement fires later when staff submits the SI
  // that gets built from this SO (see sales-invoices.ts / module 18).
  couponCode: z.string().max(64).optional().nullable(),
});

shopCheckoutRouter.post("/", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;

  // Resolve every cart line to its WebsiteItem + parent Item + tenantId. We
  // fetch all in one round-trip (`in`) then validate everything before
  // opening a transaction — cleaner rollback on validation errors.
  const websiteItemIds = [...new Set(body.items.map((i) => i.websiteItemId))];
  const websiteItems = await prisma.websiteItem.findMany({
    where: { id: { in: websiteItemIds }, isPublished: true },
    include: {
      item: {
        select: {
          id: true,
          standardRate: true,
          isVariantTemplate: true,
        },
      },
    },
  });
  const resolveErr = assertAllResolved(body.items, websiteItems);
  if (resolveErr) return res.status(400).json({ error: resolveErr });

  // Every item in the cart must belong to the SAME tenant — pure helper
  // covered by cart.test.ts.
  const tenantCheck = assertSingleTenant(websiteItems);
  if ("error" in tenantCheck)
    return res.status(400).json({ error: tenantCheck.error });
  const tenantId = tenantCheck.tenantId;

  // Resolve variant Items in one round-trip. When a cart line references
  // a variant template's WebsiteItem, `variantItemId` MUST be set —
  // otherwise we'd sell the template itself (which has no stock and no
  // meaningful price). Non-variant WebsiteItems ignore variantItemId if
  // sent, to keep the client contract lenient.
  const variantIds = [
    ...new Set(
      body.items
        .map((i) => i.variantItemId)
        .filter((v): v is string => !!v),
    ),
  ];
  const variantItems = variantIds.length
    ? await prisma.item.findMany({
        where: { id: { in: variantIds }, tenantId },
        select: {
          id: true,
          itemName: true,
          itemCode: true,
          standardRate: true,
          variantOfId: true,
        },
      })
    : [];
  const variantById = new Map(variantItems.map((v) => [v.id, v]));
  const wiFullById = new Map(websiteItems.map((wi) => [wi.id, wi]));
  for (const c of body.items) {
    const wi = wiFullById.get(c.websiteItemId)!;
    if (wi.item.isVariantTemplate && !c.variantItemId) {
      return res.status(400).json({
        error: `Product ${wi.webItemName} has variants — pick one before checkout.`,
      });
    }
    if (c.variantItemId) {
      const v = variantById.get(c.variantItemId);
      if (!v || v.variantOfId !== wi.itemId) {
        return res.status(400).json({
          error: `Selected variant is not valid for ${wi.webItemName}.`,
        });
      }
    }
  }

  // D4: resolve + validate coupon (if supplied) BEFORE we compute lines,
  // so the linked PricingRule can be applied per-line via the shared
  // helper. Silent-fail on unknown/expired codes would surprise the
  // shopper — we reject with a 400 so the storefront can show a clear
  // "coupon invalid" message.
  const rawCoupon = (body.couponCode ?? "").trim();
  const normalizedCoupon = rawCoupon ? normalizeCouponCode(rawCoupon) : "";
  const coupon = normalizedCoupon
    ? await prisma.couponCode.findFirst({
        where: { tenantId, code: normalizedCoupon },
        include: { pricingRule: true },
      })
    : null;
  if (normalizedCoupon && !coupon)
    return res.status(400).json({ error: "Coupon not found" });
  if (coupon) {
    const check = validateCoupon(coupon);
    if (!check.ok) return res.status(400).json({ error: check.reason });
  }
  const couponRule = coupon?.pricingRule ?? null;

  // Effective per-unit price + itemId per line. Variants use the variant
  // Item's own standardRate + id; non-variant lines fall through to the
  // WebsiteItem's price (webPrice override or template's standardRate).
  // When a valid coupon is present, each line's rate is passed through
  // applyPricingRule — the exact same math the accounting-side SI form
  // uses (module 15 + module 18).
  const lines = body.items.map((c) => {
    const wi = wiFullById.get(c.websiteItemId)!;
    const variant = c.variantItemId ? variantById.get(c.variantItemId)! : null;
    const baseRate = variant
      ? Number(variant.standardRate)
      : Number(wi.webPrice ?? wi.item.standardRate);
    const rate = couponRule ? applyPricingRule(baseRate, couponRule) : baseRate;
    const amount = rate * c.qty;
    return {
      itemId: variant ? variant.id : wi.item.id,
      qty: new Prisma.Decimal(c.qty),
      rate: new Prisma.Decimal(rate),
      amount: new Prisma.Decimal(amount),
      description: variant ? `${wi.webItemName} — ${variant.itemName}` : wi.webItemName,
    };
  });
  const netTotal = lines.reduce(
    (s, l) => s.add(l.amount),
    new Prisma.Decimal(0),
  );

  // Address gets snapped into the SO remarks as free text — the Address
  // doctype supports creating a normalized row + linking, but that's more
  // ceremony than an anonymous checkout needs. Staff can normalize on
  // review if the order gets accepted.
  const addressText = [
    body.addressLine1,
    body.city,
    body.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
  const remarks = [
    body.remarks?.trim() || null,
    addressText ? `Ship to: ${addressText}` : null,
    body.mobile ? `Phone: ${body.mobile}` : null,
    // D4: surface the coupon on the SO so staff sees it at review and can
    // carry the code onto the SI they build from this order (the SI's
    // couponCode field is what actually consumes a use on submit).
    normalizedCoupon ? `Coupon applied: ${normalizedCoupon}` : null,
    `Placed via storefront (guest checkout, email: ${body.email})`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await prisma.$transaction(async (tx) => {
    // Find-or-create Customer by (tenantId, email). Email is the natural
    // dedupe key for guest checkout; typing it twice from two devices
    // shouldn't spawn two Customer rows.
    let customer = await tx.customer.findFirst({
      where: { tenantId, email: body.email },
      select: { id: true },
    });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          tenantId,
          customerName: body.customerName,
          customerType: "Individual",
          email: body.email,
          mobile: body.mobile ?? null,
        },
        select: { id: true },
      });
    }

    // EC-SO- prefix so staff can distinguish web orders from CRM-authored ones.
    // Same counter table as SO- (namespaced by prefix, per tenant).
    const name = await nextName(tx, tenantId, "EC-SO-");
    const so = await tx.salesOrder.create({
      data: {
        tenantId,
        name,
        customerId: customer.id,
        orderDate: new Date(),
        currency: "INR",
        netTotal,
        totalTaxes: new Prisma.Decimal(0),
        grandTotal: netTotal,
        status: "Draft",
        remarks,
        items: { create: lines },
      },
      include: { items: true },
    });

    return { salesOrderId: so.id, salesOrderName: so.name, customerId: customer.id };
  });

  void emitEvent(prisma, tenantId, "SalesOrder.checkout", {
    id: result.salesOrderId,
    name: result.salesOrderName,
    customerId: result.customerId,
    grandTotal: Number(netTotal),
    channel: "web-storefront",
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({
      level: "warn", kind: "emitEvent.failed", event: "SalesOrder.checkout",
      tenantId, id: result.salesOrderId,
      error: err instanceof Error ? err.message : String(err),
      time: new Date().toISOString(),
    }));
  });

  res.status(201).json({
    orderNumber: result.salesOrderName,
    orderId: result.salesOrderId,
    grandTotal: Number(netTotal),
    currency: "INR",
    couponApplied: normalizedCoupon || null,
    message:
      "Order received. Our team will review and confirm the final invoice with any applicable taxes.",
  });
});

// D4: coupon preview for the storefront. Public — no auth — but we
// require the cart so we can resolve the tenantId from the WebsiteItems
// (same logic as checkout). Returns the discount amount + new totals
// without creating an order. Returns 400 with a reason when the code
// isn't valid so the storefront can render the message inline.
const previewSchema = z.object({
  items: z.array(cartLineSchema).min(1).max(50),
  code: z.string().min(1).max(64),
});

shopCheckoutRouter.post("/preview-coupon", async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;

  const websiteItemIds = [...new Set(body.items.map((i) => i.websiteItemId))];
  const websiteItems = await prisma.websiteItem.findMany({
    where: { id: { in: websiteItemIds }, isPublished: true },
    include: { item: { select: { id: true, standardRate: true } } },
  });
  const resolveErr = assertAllResolved(body.items, websiteItems);
  if (resolveErr) return res.status(400).json({ error: resolveErr });
  const tenantCheck = assertSingleTenant(websiteItems);
  if ("error" in tenantCheck)
    return res.status(400).json({ error: tenantCheck.error });
  const tenantId = tenantCheck.tenantId;

  const normalized = normalizeCouponCode(body.code);
  const coupon = await prisma.couponCode.findFirst({
    where: { tenantId, code: normalized },
    include: { pricingRule: true },
  });
  if (!coupon) return res.status(400).json({ error: "Coupon not found" });
  const check = validateCoupon(coupon);
  if (!check.ok) return res.status(400).json({ error: check.reason });

  // Variant prices for lines that carry variantItemId — parallel to
  // checkout's resolution but read-only.
  const variantIds = [
    ...new Set(
      body.items.map((i) => i.variantItemId).filter((v): v is string => !!v),
    ),
  ];
  const variantItems = variantIds.length
    ? await prisma.item.findMany({
        where: { id: { in: variantIds }, tenantId },
        select: { id: true, standardRate: true },
      })
    : [];
  const variantById = new Map(variantItems.map((v) => [v.id, v]));
  const wiFullById = new Map(websiteItems.map((wi) => [wi.id, wi]));

  let baseTotal = 0;
  let newTotal = 0;
  for (const c of body.items) {
    const wi = wiFullById.get(c.websiteItemId)!;
    const variant = c.variantItemId ? variantById.get(c.variantItemId) : null;
    const baseRate = variant
      ? Number(variant.standardRate)
      : Number(wi.webPrice ?? wi.item.standardRate);
    const appliedRate = applyPricingRule(baseRate, coupon.pricingRule);
    baseTotal += baseRate * c.qty;
    newTotal += appliedRate * c.qty;
  }
  res.json({
    code: normalized,
    ruleTitle: coupon.pricingRule.title,
    baseTotal: Math.round(baseTotal * 100) / 100,
    newTotal: Math.round(newTotal * 100) / 100,
    discountAmount: Math.round((baseTotal - newTotal) * 100) / 100,
  });
});
