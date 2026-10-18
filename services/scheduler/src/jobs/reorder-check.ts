import { Prisma, prisma, nextName } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

// Reorder-check scheduler job. Periodic sweep of every tenant's enabled
// ItemReorderRule rows. For each rule, compare live Bin.actualQty against
// the configured reorderLevel; if we're short, create a Draft
// MaterialRequest for the shortfall. Buyers can then submit → PO from the
// existing MR flow.
//
// Idempotency: before creating an MR for (itemId, warehouseId), we look
// for any existing Draft MR of the same materialRequestType that already
// includes a line for that (item, warehouse). If present, we skip so a
// second run in the same window doesn't double up.
//
// This mirrors the shape of the on-demand endpoint at
// stock-service/src/routes/item-reorder-rules.ts::/generate-material-requests
// but runs inline against the shared prisma client (no HTTP hop) and
// walks every tenant. Kept in-process for simplicity — the reorder-rule
// row count per tenant is expected to be small (dozens to low thousands).

const log = getLogger("scheduler:reorder-check");

export interface ReorderCheckResult {
  tenantsScanned: number;
  rulesChecked: number;
  triggered: number;
  skippedAlreadyOnDraftMr: number;
  mrsCreated: number;
  errors: number;
}

// Category constant matches other in-app notifications (see
// auth-service/src/routes/notifications.ts).
const NOTIFICATION_CATEGORY = "workflow";

// Buyer roles that should hear about auto-generated reorder MRs. Falls
// back to any SystemManager (or the legacy admin user) if none of these
// are assigned in a given tenant. Matches names in packages/db/src/seed-roles.ts.
const BUYER_ROLE_NAMES = ["PurchaseManager", "PurchaseUser", "StockManager"];
const ADMIN_ROLE_NAMES = ["SystemManager"];

async function notifyBuyers(
  tenantId: string,
  mr: { id: string; name: string },
  lineCount: number,
): Promise<void> {
  try {
    // Users with any buyer role, then admins as fallback.
    const buyers = await prisma.user.findMany({
      where: {
        tenantId,
        userRoles: { some: { role: { roleName: { in: BUYER_ROLE_NAMES } } } },
      },
      select: { id: true },
    });
    let recipients = buyers;
    if (recipients.length === 0) {
      recipients = await prisma.user.findMany({
        where: {
          tenantId,
          OR: [
            { userRoles: { some: { role: { roleName: { in: ADMIN_ROLE_NAMES } } } } },
            { role: "admin" },
          ],
        },
        select: { id: true },
      });
    }
    if (recipients.length === 0) return;

    const subject = `Reorder MR ${mr.name} created (${lineCount} item${lineCount === 1 ? "" : "s"} below level)`;
    const body =
      "An auto-generated Material Request was created because one or more items fell below their reorder level. Open the MR to review and submit.";

    // In-app notifications only. Email/SMS fan-out honours per-user
    // NotificationPreference rows and lives on the /notifications endpoint;
    // keeping this job lean avoids re-implementing preference gating here.
    await prisma.notification.createMany({
      data: recipients.map((u) => ({
        tenantId,
        userId: u.id,
        subject,
        body,
        doctype: "MaterialRequest",
        docId: mr.id,
        category: NOTIFICATION_CATEGORY,
      })),
    });
  } catch (e) {
    log.warn("reorder-check: notifyBuyers failed", {
      err: e instanceof Error ? e : new Error(String(e)),
      tenantId,
      mrId: mr.id,
    });
  }
}

async function processTenant(tenantId: string, result: ReorderCheckResult): Promise<void> {
  const rules = await prisma.itemReorderRule.findMany({
    where: { tenantId, enabled: true },
  });
  if (rules.length === 0) return;
  result.rulesChecked += rules.length;

  // One Bin lookup covers all (item, warehouse) pairs for this tenant.
  const bins = await prisma.bin.findMany({
    where: {
      tenantId,
      OR: rules.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId })),
    },
    select: { itemId: true, warehouseId: true, actualQty: true },
  });
  const binKey = (i: string, w: string) => `${i}::${w}`;
  const binMap = new Map(bins.map((b) => [binKey(b.itemId, b.warehouseId), b]));

  // Find existing Draft MR items for these (item, warehouse) pairs so we
  // don't duplicate. Scoped by tenant + status Draft.
  const draftLines = await prisma.materialRequestItem.findMany({
    where: {
      materialRequest: { tenantId, status: "Draft" },
      OR: rules.map((r) => ({ itemId: r.itemId, warehouseId: r.warehouseId })),
    },
    select: { itemId: true, warehouseId: true },
  });
  const draftPairs = new Set(
    draftLines
      .filter((l) => l.warehouseId)
      .map((l) => binKey(l.itemId, l.warehouseId as string)),
  );

  for (const rule of rules) {
    try {
      const bin = binMap.get(binKey(rule.itemId, rule.warehouseId));
      const onHand = bin ? Number(bin.actualQty) : 0;
      if (onHand > Number(rule.reorderLevel)) continue;

      result.triggered += 1;

      if (draftPairs.has(binKey(rule.itemId, rule.warehouseId))) {
        result.skippedAlreadyOnDraftMr += 1;
        continue;
      }

      // qty = configured reorderQty, but never less than the raw shortfall
      // so a single MR brings us back above reorderLevel. Falls back to
      // (reorderLevel − onHand) when reorderQty is 0.
      const shortfall = Number(rule.reorderLevel) - onHand;
      const reorderQty = Number(rule.reorderQty);
      const qty = reorderQty > 0 ? Math.max(reorderQty, shortfall) : Math.max(shortfall, 0);
      if (qty <= 0) continue;

      const name = await nextName(prisma, tenantId, "MR-");
      const mr = await prisma.materialRequest.create({
        data: {
          tenantId,
          name,
          materialRequestType: rule.materialRequestType,
          transactionDate: new Date(),
          status: "Draft",
          remarks: "Auto-generated by scheduler reorder-check",
          items: {
            create: [
              {
                itemId: rule.itemId,
                qty: new Prisma.Decimal(qty),
                warehouseId: rule.warehouseId,
              },
            ],
          },
        },
        select: { id: true, name: true },
      });
      result.mrsCreated += 1;

      // Record the pair so a later rule in this same run doesn't
      // re-trigger against the just-created MR (shouldn't happen given
      // the unique (item,warehouse) constraint on rules, but cheap to be safe).
      draftPairs.add(binKey(rule.itemId, rule.warehouseId));

      await notifyBuyers(tenantId, mr, 1);
    } catch (e) {
      result.errors += 1;
      log.warn("reorder-check: rule failed", {
        err: e instanceof Error ? e : new Error(String(e)),
        tenantId,
        ruleId: rule.id,
        itemId: rule.itemId,
        warehouseId: rule.warehouseId,
      });
    }
  }
}

export async function runReorderCheck(): Promise<ReorderCheckResult> {
  const result: ReorderCheckResult = {
    tenantsScanned: 0,
    rulesChecked: 0,
    triggered: 0,
    skippedAlreadyOnDraftMr: 0,
    mrsCreated: 0,
    errors: 0,
  };

  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  for (const t of tenants) {
    result.tenantsScanned += 1;
    try {
      await processTenant(t.id, result);
    } catch (e) {
      result.errors += 1;
      log.warn("reorder-check: tenant failed", {
        err: e instanceof Error ? e : new Error(String(e)),
        tenantId: t.id,
      });
    }
  }

  log.info("reorder-check complete", {
    tenantsScanned: result.tenantsScanned,
    rulesChecked: result.rulesChecked,
    triggered: result.triggered,
    skippedAlreadyOnDraftMr: result.skippedAlreadyOnDraftMr,
    mrsCreated: result.mrsCreated,
    errors: result.errors,
  });

  return result;
}

export function summarizeReorderResult(r: ReorderCheckResult): string {
  return `tenants=${r.tenantsScanned} rules=${r.rulesChecked} triggered=${r.triggered} skipped=${r.skippedAlreadyOnDraftMr} created=${r.mrsCreated} errors=${r.errors}`;
}
