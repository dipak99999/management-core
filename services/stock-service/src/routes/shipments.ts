import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  decryptSecrets,
  nextName,
  prisma,
  shippingProviderFromSecrets,
  type ShippingAddress,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const shipmentRouter = Router();
const p = perms("Shipment");

const addressSchema = z.object({
  name: z.string().min(1),
  company: z.string().optional(),
  street1: z.string().min(1),
  street2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().length(2),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

const rateSchema = z.object({
  fromAddress: addressSchema,
  toAddress: addressSchema,
  weightGrams: z.coerce.number().int().positive(),
  lengthCm: z.coerce.number().positive().default(30),
  widthCm: z.coerce.number().positive().default(20),
  heightCm: z.coerce.number().positive().default(10),
});

shipmentRouter.post("/rate", p.create, async (req, res) => {
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId: req.auth!.tenantId, provider: "EasyPost", isActive: true },
  });
  const secrets = integration ? (decryptSecrets(integration.secrets) as Record<string, unknown>) : { provider: "Stub" };
  const provider = shippingProviderFromSecrets({ ...secrets, provider: integration ? "EasyPost" : "Stub" });
  try {
    const rates = await provider.rate(b.fromAddress as ShippingAddress, b.toAddress as ShippingAddress, {
      weightGrams: b.weightGrams,
      lengthCm: b.lengthCm,
      widthCm: b.widthCm,
      heightCm: b.heightCm,
    });
    res.json({ rates });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Rate failed" });
  }
});

const buySchema = z.object({
  deliveryNoteId: z.string().optional().nullable(),
  purchaseReceiptId: z.string().optional().nullable(),
  externalRateId: z.string().min(1),
  fromAddress: addressSchema,
  toAddress: addressSchema,
  carrier: z.string().min(1),
  service: z.string().optional().nullable(),
  weightGrams: z.coerce.number().int().positive(),
  dimensionsCm: z.string().optional().nullable(),
});

shipmentRouter.post("/", p.create, async (req, res) => {
  const parsed = buySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "EasyPost", isActive: true },
  });
  const secrets = integration ? (decryptSecrets(integration.secrets) as Record<string, unknown>) : { provider: "Stub" };
  const provider = shippingProviderFromSecrets({ ...secrets, provider: integration ? "EasyPost" : "Stub" });

  let label;
  try {
    label = await provider.buyLabel(b.externalRateId);
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : "buyLabel failed" });
  }

  const name = await nextName(prisma, tenantId, "SHIP-");
  const row = await prisma.shipment.create({
    data: {
      tenantId,
      name,
      deliveryNoteId: b.deliveryNoteId ?? null,
      purchaseReceiptId: b.purchaseReceiptId ?? null,
      carrier: b.carrier,
      service: b.service ?? null,
      trackingNumber: label.trackingNumber,
      labelUrl: label.labelUrl,
      costAmount: new Prisma.Decimal(label.amount),
      costCurrency: label.currency,
      weightGrams: b.weightGrams,
      dimensionsCm: b.dimensionsCm ?? null,
      fromAddress: b.fromAddress as unknown as Prisma.InputJsonValue,
      toAddress: b.toAddress as unknown as Prisma.InputJsonValue,
      status: "LabelPurchased",
      externalId: label.externalId,
      providerRateId: b.externalRateId,
      provider: integration ? "EasyPost" : "Stub",
      purchasedAt: new Date(),
    },
  });
  res.status(201).json(row);
});

shipmentRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.shipment.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

shipmentRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.shipment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { events: { orderBy: { ts: "desc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

shipmentRouter.post("/:id/refresh-tracking", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const shp = await prisma.shipment.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!shp) return res.status(404).json({ error: "Not found" });
  if (!shp.trackingNumber) return res.status(400).json({ error: "No tracking number yet" });

  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "EasyPost", isActive: true },
  });
  const secrets = integration ? (decryptSecrets(integration.secrets) as Record<string, unknown>) : { provider: "Stub" };
  const provider = shippingProviderFromSecrets({ ...secrets, provider: integration ? "EasyPost" : "Stub" });

  const events = await provider.track(shp.trackingNumber, shp.carrier);
  await prisma.$transaction(async (tx) => {
    for (const e of events) {
      await tx.shipmentEvent.create({
        data: {
          tenantId,
          shipmentId: shp.id,
          ts: e.ts,
          status: e.status,
          location: e.location ?? null,
          description: e.description ?? null,
        },
      });
    }
    // Update shipment status from latest event.
    const latest = events[events.length - 1];
    if (latest) {
      const statusMap: Record<string, string> = {
        pre_transit: "LabelPurchased",
        in_transit: "InTransit",
        out_for_delivery: "InTransit",
        delivered: "Delivered",
        return_to_sender: "Failed",
        failure: "Failed",
        unknown: shp.status,
      };
      await tx.shipment.update({
        where: { id: shp.id },
        data: {
          status: statusMap[latest.status] ?? shp.status,
          deliveredAt: latest.status === "delivered" ? latest.ts : shp.deliveredAt,
        },
      });
    }
  });
  const refreshed = await prisma.shipment.findFirst({
    where: { id: shp.id },
    include: { events: { orderBy: { ts: "desc" } } },
  });
  res.json(refreshed);
});
