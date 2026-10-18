import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const activityRouter = Router();

activityRouter.use(requireAuth);

/**
 * General-user activity timeline for a doc. Merges AuditLog rows (field
 * changes, submits, cancels — via HTTP method) with Comment rows into a
 * single reverse-chronological feed shaped for <ActivityTimeline>.
 *
 * Unlike /audit-logs, this is viewable by any authed user. It strips raw
 * IP + system fields; richer admin views remain in /audit-logs.
 */
activityRouter.get("/:doctype/:docId", async (req, res) => {
  const { doctype, docId } = req.params;
  const tenantId = req.auth!.tenantId;

  const [audits, comments] = await Promise.all([
    prisma.auditLog.findMany({
      where: { tenantId, doctype, docId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.comment.findMany({
      where: { tenantId, doctype, docId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const authorIds = new Set<string>();
  for (const a of audits) if (a.userId) authorIds.add(a.userId);
  for (const c of comments) authorIds.add(c.authorUserId);

  const users = await prisma.user.findMany({
    where: { id: { in: [...authorIds] } },
    select: { id: true, fullName: true, email: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  interface Entry {
    id: string;
    at: string;
    actor: { name: string };
    verb: string;
    summary?: string;
    kind: "system" | "comment" | "status";
    diff?: Array<{ field: string; from?: string | null; to?: string | null }>;
  }

  const verbFor = (method: string): { verb: string; kind: Entry["kind"] } => {
    const m = method.toUpperCase();
    if (m === "POST-SUBMIT" || m.endsWith("-SUBMIT")) return { verb: "submitted", kind: "status" };
    if (m === "POST-CANCEL" || m.endsWith("-CANCEL")) return { verb: "cancelled", kind: "status" };
    if (m === "POST-APPROVE" || m.endsWith("-APPROVE")) return { verb: "approved", kind: "status" };
    if (m === "POST-REJECT" || m.endsWith("-REJECT")) return { verb: "rejected", kind: "status" };
    if (m === "POST") return { verb: "created", kind: "system" };
    if (m === "PUT" || m === "PATCH") return { verb: "updated", kind: "system" };
    if (m === "DELETE") return { verb: "deleted", kind: "system" };
    return { verb: method.toLowerCase(), kind: "system" };
  };

  const diffFromPayload = (payload: unknown): Entry["diff"] => {
    if (!payload || typeof payload !== "object") return undefined;
    const p = payload as { before?: Record<string, unknown>; after?: Record<string, unknown> };
    if (!p.before && !p.after) return undefined;
    const fields = new Set([
      ...Object.keys(p.before ?? {}),
      ...Object.keys(p.after ?? {}),
    ]);
    const diff: NonNullable<Entry["diff"]> = [];
    for (const field of fields) {
      const from = p.before?.[field];
      const to = p.after?.[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      diff.push({
        field,
        from: from == null ? null : String(from),
        to: to == null ? null : String(to),
      });
      if (diff.length >= 8) break;
    }
    return diff.length ? diff : undefined;
  };

  const entries: Entry[] = [];

  for (const a of audits) {
    const user = a.userId ? byId.get(a.userId) : null;
    const name = user?.fullName ?? user?.email ?? a.userEmail ?? "System";
    const { verb, kind } = verbFor(a.method);
    entries.push({
      id: `audit:${a.id}`,
      at: a.createdAt.toISOString(),
      actor: { name },
      verb,
      kind,
      diff: diffFromPayload(a.payload),
    });
  }

  for (const c of comments) {
    const user = byId.get(c.authorUserId);
    const name = user?.fullName ?? user?.email ?? "User";
    entries.push({
      id: `comment:${c.id}`,
      at: c.createdAt.toISOString(),
      actor: { name },
      verb: "commented",
      summary: c.body,
      kind: "comment",
    });
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : -1));
  res.json(entries);
});
