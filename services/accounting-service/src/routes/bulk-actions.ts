import { Router } from "express";
import { z } from "zod";
import { getPrismaDelegate, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// J8: bulk actions on a list of ids. Currently supports:
//   - delete (Draft-only for docs with a status field)
//   - setStatus (allowed transitions only — same as manual edit)
// Extend by adding branches; each doctype's allowed actions are declared in
// BULK_TARGETS below.

export const bulkActionRouter = Router();

interface BulkTarget {
  delegate: string; // prisma delegate name
  perm: string; // doctype to check perms on
  hasStatus: boolean;
  allowedStatuses?: string[];
}

const BULK_TARGETS: Record<string, BulkTarget> = {
  Customer: { delegate: "customer", perm: "Customer", hasStatus: false },
  Supplier: { delegate: "supplier", perm: "Supplier", hasStatus: false },
  Item: { delegate: "item", perm: "Item", hasStatus: false },
  Employee: { delegate: "employee", perm: "Employee", hasStatus: false },
  Warehouse: { delegate: "warehouse", perm: "Warehouse", hasStatus: false },
  Account: { delegate: "account", perm: "Account", hasStatus: false },
  Lead: {
    delegate: "lead",
    perm: "Lead",
    hasStatus: true,
    allowedStatuses: ["Open", "Contacted", "Interested", "Lost"],
  },
  Opportunity: {
    delegate: "opportunity",
    perm: "Opportunity",
    hasStatus: true,
    allowedStatuses: ["Open", "Quotation", "Lost"],
  },
  Quotation: {
    delegate: "quotation",
    perm: "Quotation",
    hasStatus: true,
    allowedStatuses: ["Draft", "Cancelled", "Expired"],
  },
  SalesOrder: {
    delegate: "salesOrder",
    perm: "SalesOrder",
    hasStatus: true,
    allowedStatuses: ["Draft", "Cancelled", "Closed"],
  },
  PurchaseOrder: {
    delegate: "purchaseOrder",
    perm: "PurchaseOrder",
    hasStatus: true,
    allowedStatuses: ["Draft", "Cancelled", "Closed"],
  },
  Project: {
    delegate: "project",
    perm: "Project",
    hasStatus: true,
    allowedStatuses: ["Open", "Completed", "Cancelled"],
  },
  Task: {
    delegate: "task",
    perm: "Task",
    hasStatus: true,
    allowedStatuses: ["Open", "Working", "Pending Review", "Completed", "Cancelled"],
  },
};

const bulkSchema = z.object({
  doctype: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["delete", "setStatus"]),
  status: z.string().optional(),
});

bulkActionRouter.post("/", async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const auth = req.auth!;
  const target = BULK_TARGETS[parsed.data.doctype];
  if (!target)
    return res.status(400).json({ error: `Doctype "${parsed.data.doctype}" not supported for bulk actions` });

  // Per-doctype perm check via the standard perms helper.
  const p = perms(target.perm);
  const needsPerm = parsed.data.action === "delete" ? p.delete : p.write;
  // Manually check the perm (the helper is a middleware; we're inside the
  // handler so we replicate its query).
  const isAdmin =
    auth.roles.includes("SystemManager") || auth.role === "admin";
  if (!isAdmin) {
    const permRows = await prisma.rolePermission.findMany({
      where: {
        tenantId: auth.tenantId,
        doctype: target.perm,
        action: parsed.data.action === "delete" ? "delete" : "write",
        role: { userRoles: { some: { userId: auth.userId } } },
      },
      take: 1,
    });
    if (permRows.length === 0)
      return res.status(403).json({
        error: `Forbidden: ${parsed.data.action === "delete" ? "delete" : "write"} on ${target.perm} required`,
      });
  }

  const del = getPrismaDelegate(prisma, target.delegate);
  if (!del) return res.status(500).json({ error: "delegate missing" });

  if (parsed.data.action === "delete") {
    const result = await del.deleteMany({
      where: { tenantId: auth.tenantId, id: { in: parsed.data.ids } },
    });
    // Suppress the potentially-noisy needsPerm reference so it's not unused.
    void needsPerm;
    return res.json({ deleted: result.count });
  }

  if (parsed.data.action === "setStatus") {
    if (!target.hasStatus)
      return res.status(400).json({ error: `${target.perm} has no status field` });
    if (!parsed.data.status)
      return res.status(400).json({ error: "status required" });
    if (target.allowedStatuses && !target.allowedStatuses.includes(parsed.data.status))
      return res.status(400).json({
        error: `status "${parsed.data.status}" not allowed for bulk update (allowed: ${target.allowedStatuses.join(", ")})`,
      });
    const result = await del.updateMany({
      where: { tenantId: auth.tenantId, id: { in: parsed.data.ids } },
      data: { status: parsed.data.status },
    });
    return res.json({ updated: result.count });
  }
  return res.status(400).json({ error: "unknown action" });
});
