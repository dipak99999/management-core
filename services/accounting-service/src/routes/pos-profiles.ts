import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const posProfileRouter = Router();

const p = perms("POSProfile");

// A payment method row on a POS Profile. `mode` is the customer-facing label
// AND the key referenced by POSOpeningEntry.openingBalances and PE.modeOfPayment,
// so keeping it to the canonical four keeps the reconciliation math simple.
// The `accountId` is where money for this method lands — cash-in-hand for Cash,
// a card-clearing account for Card/Razorpay, a UPI-clearing account for UPI.
const paymentMethodSchema = z.object({
  mode: z.enum(["Cash", "Card", "UPI", "Razorpay"]),
  accountId: z.string().min(1),
  isDefault: z.boolean().optional(),
  integrationId: z.string().optional().nullable(),
});

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Use lowercase, digits, and dashes only"),
  title: z.string().min(1).max(128),
  warehouseId: z.string().optional().nullable(),
  priceListId: z.string().optional().nullable(),
  defaultCustomerId: z.string().optional().nullable(),
  incomeAccountId: z.string().optional().nullable(),
  letterheadId: z.string().optional().nullable(),
  paymentMethods: z.array(paymentMethodSchema).min(1),
  disabled: z.boolean().default(false),
});

// FK belongs-to-tenant check. Every optional FK on POSProfile can point at
// a row from a different tenant if we don't check — same defensive practice
// as the rest of the codebase (tenant-guard).
async function validateReferences(
  tenantId: string,
  input: z.infer<typeof createSchema>,
): Promise<string | null> {
  if (input.warehouseId) {
    const w = await prisma.warehouse.findFirst({
      where: { id: input.warehouseId, tenantId },
      select: { id: true },
    });
    if (!w) return "Invalid warehouseId";
  }
  if (input.priceListId) {
    const pl = await prisma.priceList.findFirst({
      where: { id: input.priceListId, tenantId, buyingOrSelling: "Selling" },
      select: { id: true },
    });
    if (!pl) return "Invalid priceListId (must be Selling)";
  }
  if (input.defaultCustomerId) {
    const c = await prisma.customer.findFirst({
      where: { id: input.defaultCustomerId, tenantId },
      select: { id: true },
    });
    if (!c) return "Invalid defaultCustomerId";
  }
  if (input.incomeAccountId) {
    const a = await prisma.account.findFirst({
      where: { id: input.incomeAccountId, tenantId, rootType: "Income", isGroup: false },
      select: { id: true },
    });
    if (!a) return "Invalid incomeAccountId (must be an Income leaf)";
  }
  if (input.letterheadId) {
    const l = await prisma.letterhead.findFirst({
      where: { id: input.letterheadId, tenantId },
      select: { id: true },
    });
    if (!l) return "Invalid letterheadId";
  }

  // Every paymentMethod.accountId must belong to this tenant and be a leaf.
  // Cash/UPI/Card/Razorpay accounts are usually rootType=Asset/accountType=Cash
  // or Bank — we don't over-constrain here; managers pick what fits their CoA.
  const accountIds = [...new Set(input.paymentMethods.map((m) => m.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, tenantId, isGroup: false },
    select: { id: true },
  });
  if (accounts.length !== accountIds.length) {
    return "One or more payment-method accounts are invalid for this tenant (must be leaf accounts)";
  }

  // Every Razorpay method needs an integrationId so the checkout order-create
  // route knows which credentials to use.
  const badRazorpay = input.paymentMethods.find(
    (m) => m.mode === "Razorpay" && !m.integrationId,
  );
  if (badRazorpay) {
    return "Razorpay payment method requires integrationId (a TenantIntegration id)";
  }
  if (input.paymentMethods.some((m) => m.integrationId)) {
    const integrationIds = [
      ...new Set(
        input.paymentMethods
          .map((m) => m.integrationId)
          .filter((v): v is string => !!v),
      ),
    ];
    const integrations = await prisma.tenantIntegration.findMany({
      where: { id: { in: integrationIds }, tenantId, isActive: true },
      select: { id: true, provider: true },
    });
    if (integrations.length !== integrationIds.length) {
      return "One or more payment integrations are invalid or inactive";
    }
    const badProvider = input.paymentMethods.find((m) => {
      if (m.mode !== "Razorpay" || !m.integrationId) return false;
      const found = integrations.find((i) => i.id === m.integrationId);
      return !found || found.provider.toLowerCase() !== "razorpay";
    });
    if (badProvider) {
      return `Payment method ${badProvider.mode} references an integration that isn't provider=razorpay`;
    }
  }

  const defaults = input.paymentMethods.filter((m) => m.isDefault).length;
  if (defaults > 1) return "Only one payment method can be isDefault=true";

  return null;
}

posProfileRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.pOSProfile.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ disabled: "asc" }, { title: "asc" }],
    include: {
      warehouse: { select: { warehouseName: true } },
      priceList: { select: { name: true, currency: true } },
      defaultCustomer: { select: { customerName: true } },
    },
  });
  res.json(rows);
});

posProfileRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pOSProfile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      warehouse: { select: { warehouseName: true } },
      priceList: { select: { name: true, currency: true } },
      defaultCustomer: { select: { customerName: true } },
      incomeAccount: { select: { accountName: true } },
      letterhead: { select: { name: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

posProfileRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const err = await validateReferences(tenantId, parsed.data);
  if (err) return res.status(400).json({ error: err });

  try {
    const row = await prisma.pOSProfile.create({
      data: {
        tenantId,
        name: parsed.data.name,
        title: parsed.data.title,
        warehouseId: parsed.data.warehouseId ?? null,
        priceListId: parsed.data.priceListId ?? null,
        defaultCustomerId: parsed.data.defaultCustomerId ?? null,
        incomeAccountId: parsed.data.incomeAccountId ?? null,
        letterheadId: parsed.data.letterheadId ?? null,
        paymentMethods: parsed.data.paymentMethods as unknown as Prisma.InputJsonValue,
        disabled: parsed.data.disabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res
        .status(400)
        .json({ error: `POSProfile with name "${parsed.data.name}" already exists` });
    }
    throw e;
  }
});

posProfileRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.pOSProfile.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const err = await validateReferences(tenantId, parsed.data);
  if (err) return res.status(400).json({ error: err });

  const row = await prisma.pOSProfile.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      title: parsed.data.title,
      warehouseId: parsed.data.warehouseId ?? null,
      priceListId: parsed.data.priceListId ?? null,
      defaultCustomerId: parsed.data.defaultCustomerId ?? null,
      incomeAccountId: parsed.data.incomeAccountId ?? null,
      letterheadId: parsed.data.letterheadId ?? null,
      paymentMethods: parsed.data.paymentMethods as unknown as Prisma.InputJsonValue,
      disabled: parsed.data.disabled,
    },
  });
  res.json(row);
});

posProfileRouter.delete("/:id", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const inUse = await prisma.pOSOpeningEntry.count({
    where: { tenantId, posProfileId: req.params.id },
  });
  if (inUse > 0) {
    return res
      .status(400)
      .json({ error: "Cannot delete: profile has existing sessions. Disable it instead." });
  }
  const existing = await prisma.pOSProfile.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.pOSProfile.delete({ where: { id: existing.id } });
  res.status(204).end();
});
