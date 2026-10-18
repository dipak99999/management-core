import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// C15: Item reorder rules. Per (item, warehouse) minimum stock; the
// generate endpoint scans all rules, checks live bin qty, and creates
// Draft Material Requests to cover the shortfall.

export const itemReorderRuleRouter = Router();

const p = perms("ItemReorderRule");

const upsertSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  reorderLevel: z.coerce.number().nonnegative(),
  reorderQty: z.coerce.number().positive(),
  materialRequestType: z
    .enum(["Purchase", "Material Transfer", "Manufacture"])
    .default("Purchase"),
  enabled: z.boolean().default(true),
});

itemReorderRuleRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : undefined;
  const rows = await prisma.itemReorderRule.findMany({
    where: { tenantId, ...(itemId ? { itemId } : {}) },
    include: {
      item: { select: { itemCode: true, itemName: true, stockUom: true } },
      warehouse: { select: { warehouseName: true } },
    },
    orderBy: [{ item: { itemCode: "asc" } }, { warehouse: { warehouseName: "asc" } }],
  });
  res.json(rows);
});

itemReorderRuleRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const [item, wh] = await Promise.all([
    prisma.item.findFirst({ where: { id: parsed.data.itemId, tenantId } }),
    prisma.warehouse.findFirst({
      where: { id: parsed.data.warehouseId, tenantId, isGroup: false, disabled: false },
    }),
  ]);
  if (!item) return res.status(400).json({ error: "Invalid item" });
  if (!wh)
    return res.status(400).json({ error: "Invalid warehouse (must be leaf + enabled)" });
  try {
    const row = await prisma.itemReorderRule.create({
      data: {
        tenantId,
        itemId: parsed.data.itemId,
        warehouseId: parsed.data.warehouseId,
        reorderLevel: new Prisma.Decimal(parsed.data.reorderLevel),
        reorderQty: new Prisma.Decimal(parsed.data.reorderQty),
        materialRequestType: parsed.data.materialRequestType,
        enabled: parsed.data.enabled,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res
        .status(409)
        .json({ error: "Rule already exists for this item + warehouse" });
    throw e;
  }
});

itemReorderRuleRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.itemReorderRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.itemReorderRule.update({
    where: { id: existing.id },
    data: {
      itemId: parsed.data.itemId,
      warehouseId: parsed.data.warehouseId,
      reorderLevel: new Prisma.Decimal(parsed.data.reorderLevel),
      reorderQty: new Prisma.Decimal(parsed.data.reorderQty),
      materialRequestType: parsed.data.materialRequestType,
      enabled: parsed.data.enabled,
    },
  });
  res.json(row);
});

itemReorderRuleRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.itemReorderRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.itemReorderRule.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// C15: scan all enabled rules, compare against live Bin.actualQty, and
// create one Draft MaterialRequest per (materialRequestType, warehouse)
// covering all triggered rules. `qtyToOrder = max(reorderQty, shortfall)`
// where `shortfall = reorderLevel − actualQty + reorderQty` — Wilson-lite:
// bring the balance back to reorderLevel + one lot.
itemReorderRuleRouter.post(
  "/generate-material-requests",
  p.create,
  async (req, res) => {
    const tenantId = req.auth!.tenantId;
    const rules = await prisma.itemReorderRule.findMany({
      where: { tenantId, enabled: true },
      include: {
        item: { select: { itemCode: true } },
        warehouse: { select: { warehouseName: true } },
      },
    });
    if (rules.length === 0)
      return res.json({ created: 0, mrs: [], skipped: 0, triggered: 0 });

    const bins = await prisma.bin.findMany({
      where: {
        tenantId,
        OR: rules.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId })),
      },
    });
    const key = (i: string, w: string) => `${i}::${w}`;
    const binMap = new Map(bins.map((b) => [key(b.itemId, b.warehouseId), b]));

    // Group triggered rules by (materialRequestType, warehouseId) so each
    // group becomes one MR (multi-line).
    const groups = new Map<
      string,
      { mrType: string; warehouseId: string; lines: { itemId: string; qty: number }[] }
    >();
    let triggered = 0;
    let skipped = 0;
    for (const r of rules) {
      const b = binMap.get(key(r.itemId, r.warehouseId));
      const onHand = b ? Number(b.actualQty) : 0;
      if (onHand >= Number(r.reorderLevel)) {
        skipped++;
        continue;
      }
      triggered++;
      const shortfall = Number(r.reorderLevel) - onHand;
      const qty = Math.max(Number(r.reorderQty), shortfall);
      const gKey = `${r.materialRequestType}::${r.warehouseId}`;
      const g =
        groups.get(gKey) ??
        {
          mrType: r.materialRequestType,
          warehouseId: r.warehouseId,
          lines: [] as { itemId: string; qty: number }[],
        };
      g.lines.push({ itemId: r.itemId, qty });
      groups.set(gKey, g);
    }

    const mrs: { id: string; name: string; lineCount: number }[] = [];
    for (const g of groups.values()) {
      const name = await nextName(prisma, tenantId, "MR-");
      const mr = await prisma.materialRequest.create({
        data: {
          tenantId,
          name,
          materialRequestType: g.mrType,
          transactionDate: new Date(),
          status: "Draft",
          remarks: "Auto-generated from reorder rules",
          items: {
            create: g.lines.map((l) => ({
              itemId: l.itemId,
              qty: new Prisma.Decimal(l.qty),
              warehouseId: g.warehouseId,
            })),
          },
        },
        select: { id: true, name: true, items: { select: { id: true } } },
      });
      mrs.push({ id: mr.id, name: mr.name, lineCount: mr.items.length });
    }
    res.json({ triggered, skipped, created: mrs.length, mrs });
  },
);
