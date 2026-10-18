import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const auditLogRouter = Router();

auditLogRouter.use(requireAuth);

// SystemManager-only guard — audit access is sensitive.
function requireSystemManager(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
) {
  const roles = req.auth?.roles ?? [];
  const isAdmin = roles.includes("SystemManager") || req.auth?.role === "admin";
  if (!isAdmin)
    return res.status(403).json({ error: "SystemManager role required" });
  next();
}

// List with pagination + filters. Kept lean — audit logs grow fast.
auditLogRouter.get("/", requireSystemManager, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const docId = typeof req.query.docId === "string" ? req.query.docId : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const rows = await prisma.auditLog.findMany({
    where: {
      tenantId,
      ...(doctype ? { doctype } : {}),
      ...(docId ? { docId } : {}),
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const truncated = rows.length > limit;
  const items = truncated ? rows.slice(0, limit) : rows;
  const nextCursor = truncated ? items[items.length - 1].id : null;
  res.json({ items, nextCursor, truncated });
});

// Per-doc audit trail — deep-link from any detail page.
auditLogRouter.get(
  "/for/:doctype/:docId",
  requireSystemManager,
  async (req, res) => {
    const rows = await prisma.auditLog.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        doctype: req.params.doctype,
        docId: req.params.docId,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(rows);
  },
);
