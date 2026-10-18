import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Marketing P3 (Agent D): MarketingApproval workflow.
//
// A tenant with `Tenant.requireMarketingApproval=true` gates every marketing
// send (Campaign / SocialPost / Broadcast) behind a MarketingApproval row
// with status=Approved. When the flag is false (default), send-time gates
// short-circuit and existing behaviour is preserved — this router is still
// mounted so requesters can voluntarily submit for review even without the
// hard gate.
//
// Routes below are perms("MarketingApproval") gated. Requesters need
// (create/write/delete) — granted to SalesManager + SystemManager by
// seed-roles.ts. Reviewers additionally need (submit) to move rows to
// Approved/Rejected — granted to the dedicated MarketingApprover role.

export const approvalsRouter = Router();

const p = perms("MarketingApproval");

// Polymorphic doctype enum — the Marketing surfaces we gate. Extend here when
// adding a new sendable marketing artifact (e.g. WhatsApp campaigns).
const APPROVABLE_DOCTYPES = ["Campaign", "SocialPost", "Broadcast"] as const;
type ApprovableDoctype = (typeof APPROVABLE_DOCTYPES)[number];

const STATUSES = ["Pending", "Approved", "Rejected", "Withdrawn"] as const;
type ApprovalStatus = (typeof STATUSES)[number];

// Approvals expire after 30 days — after that any send needs a fresh review.
// Keeps stale sign-offs from lasting forever when copy has drifted from the
// version the reviewer originally saw.
export const APPROVAL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────

// Loads a lightweight summary of the underlying marketing doc, tenant-scoped.
// Returns null when the doc doesn't exist (or belongs to another tenant),
// which the callers turn into a 404.
async function loadDocSummary(
  tenantId: string,
  doctype: ApprovableDoctype,
  docId: string,
): Promise<
  | { id: string; name: string; subject: string | null; status: string }
  | null
> {
  if (doctype === "Campaign") {
    const c = await prisma.campaign.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, name: true, subject: true, status: true },
    });
    return c ? { id: c.id, name: c.name, subject: c.subject, status: c.status } : null;
  }
  if (doctype === "Broadcast") {
    const b = await prisma.broadcast.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, name: true, subject: true, status: true },
    });
    return b ? { id: b.id, name: b.name, subject: b.subject, status: b.status } : null;
  }
  if (doctype === "SocialPost") {
    const s = await prisma.socialPost.findFirst({
      where: { id: docId, tenantId },
      select: { id: true, content: true, status: true },
    });
    if (!s) return null;
    // Social posts don't have a Name; use the truncated content as a label.
    const label = s.content.length > 60 ? `${s.content.slice(0, 57)}…` : s.content;
    return { id: s.id, name: label, subject: null, status: s.status };
  }
  return null;
}

// Returns the userIds of everyone in this tenant carrying the MarketingApprover
// role (or SystemManager — they act as super-approvers). Used to fan-out
// notifications on POST /approvals/request and rejection.
async function loadApproverUserIds(tenantId: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: {
      role: {
        tenantId,
        roleName: { in: ["MarketingApprover", "SystemManager"] },
      },
    },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

// Does the authenticated user carry an approver role? (MarketingApprover or
// SystemManager both count; legacy `role: "admin"` on the User model too.)
function isApprover(req: import("express").Request): boolean {
  const auth = req.auth;
  if (!auth) return false;
  if (auth.role === "admin") return true;
  const roles = auth.roles ?? [];
  return (
    roles.includes("MarketingApprover") || roles.includes("SystemManager")
  );
}

// Best-effort notification fan-out — never throws (a notification write
// failure must not block the approval workflow). Creates one Notification per
// recipient + optionally one EmailMessage per recipient (skipped when the
// EmailMessage table isn't reachable, e.g. in unit tests with a partial mock).
async function notifyUsers(params: {
  tenantId: string;
  userIds: string[];
  senderUserId: string;
  subject: string;
  body: string;
  doctype: string;
  docId: string;
  category?: string;
}): Promise<void> {
  const { tenantId, userIds, senderUserId, subject, body, doctype, docId } = params;
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((uid) => ({
        tenantId,
        userId: uid,
        subject,
        body,
        doctype,
        docId,
        category: params.category ?? "workflow",
      })),
    });
  } catch {
    // silent — notifications are best-effort
  }
  // Email fan-out: look up user emails, enqueue an EmailMessage per user.
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, tenantId },
      select: { id: true, email: true },
    });
    for (const u of users) {
      if (!u.email) continue;
      try {
        await prisma.emailMessage.create({
          data: {
            tenantId,
            senderUserId,
            toEmail: u.email,
            subject,
            body,
            linkedDoctype: doctype,
            linkedId: docId,
          },
        });
      } catch {
        // per-recipient failure → skip
      }
    }
  } catch {
    // silent — email fan-out is best-effort
  }
}

// ─── Approval-required check ───────────────────────────────────────────
//
// Exported so campaigns.ts / broadcasts.ts / social.ts can share the exact
// same gate. Returns {ok:true} when the tenant setting is false OR when the
// latest approval for (doctype, docId) is Approved AND ≤30 days old.
//
// Deliberately does NOT require an approval to be linked to a specific
// version of the doc — small teams edit copy after approval frequently and
// re-triggering full re-review on every whitespace change is friction-heavy.
// The 30-day TTL is the compromise that catches truly stale sign-offs.
export async function checkApprovalRequired(
  db: typeof prisma,
  tenantId: string,
  doctype: ApprovableDoctype,
  docId: string,
): Promise<{ ok: boolean; reason?: string; approval?: unknown }> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { requireMarketingApproval: true },
  });
  if (!tenant?.requireMarketingApproval) return { ok: true };

  const latest = await db.marketingApproval.findFirst({
    where: { tenantId, doctype, docId },
    orderBy: { requestedAt: "desc" },
  });
  if (!latest) {
    return { ok: false, reason: "Requires approval: no approval on file" };
  }
  if (latest.status !== "Approved") {
    return {
      ok: false,
      reason: `Requires approval: latest is ${latest.status}`,
      approval: latest,
    };
  }
  // Must have an approvedAt for the freshness check to be meaningful.
  if (!latest.approvedAt) {
    return { ok: false, reason: "Requires approval: missing approvedAt", approval: latest };
  }
  const ageMs = Date.now() - new Date(latest.approvedAt).getTime();
  if (ageMs > APPROVAL_EXPIRY_MS) {
    return {
      ok: false,
      reason: `Requires approval: last approval is ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d old (>30d)`,
      approval: latest,
    };
  }
  return { ok: true, approval: latest };
}

// ─── Routes ─────────────────────────────────────────────────────────────

approvalsRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "approvals" });
});

// GET /approvals?status=Pending|Approved|Rejected|Withdrawn&doctype=&limit=
// Tenant-scoped list + lightweight doc summary per row so the inbox can
// render without a per-row round-trip.
approvalsRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const status = String(req.query.status ?? "").trim();
  const doctype = String(req.query.doctype ?? "").trim();
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);

  const where: Record<string, unknown> = { tenantId };
  if (status && (STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if (doctype && (APPROVABLE_DOCTYPES as readonly string[]).includes(doctype)) {
    where.doctype = doctype;
  }

  const rows = await prisma.marketingApproval.findMany({
    where,
    orderBy: { requestedAt: "desc" },
    take: limit,
  });

  // Hydrate a summary per row. Batched per-doctype to keep this cheap.
  const enriched = await Promise.all(
    rows.map(async (r) => {
      const summary = await loadDocSummary(
        tenantId,
        r.doctype as ApprovableDoctype,
        r.docId,
      );
      return { ...r, doc: summary };
    }),
  );

  res.json(enriched);
});

// GET /approvals/:id — single row + full doc snapshot for the reviewer's
// detail drawer.
approvalsRouter.get("/:id", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const row = await prisma.marketingApproval.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const doc = await loadDocSummary(
    tenantId,
    row.doctype as ApprovableDoctype,
    row.docId,
  );
  res.json({ ...row, doc });
});

// POST /approvals/request — creator submits an artifact for review.
// Rejects cross-tenant docs (404) and refuses to open a second Pending row
// when one already exists (409). Notifies every MarketingApprover in the
// tenant on success.
const requestSchema = z.object({
  doctype: z.enum(APPROVABLE_DOCTYPES),
  docId: z.string().min(1),
  notes: z.string().max(2000).optional().nullable(),
});
approvalsRouter.post("/request", p.create, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const { doctype, docId, notes } = parsed.data;

  const summary = await loadDocSummary(tenantId, doctype, docId);
  if (!summary) return res.status(404).json({ error: `${doctype} not found` });

  // Guard against duplicate open reviews on the same doc.
  const openRow = await prisma.marketingApproval.findFirst({
    where: { tenantId, doctype, docId, status: "Pending" },
  });
  if (openRow) {
    return res.status(409).json({
      error: "There is already a pending approval for this document",
      approval: openRow,
    });
  }

  const row = await prisma.marketingApproval.create({
    data: {
      tenantId,
      doctype,
      docId,
      status: "Pending",
      requestedBy: req.auth!.userId,
      notes: notes ?? null,
    },
  });

  const approverIds = await loadApproverUserIds(tenantId);
  await notifyUsers({
    tenantId,
    userIds: approverIds.filter((uid) => uid !== req.auth!.userId),
    senderUserId: req.auth!.userId,
    subject: `Approval requested: ${doctype} "${summary.name}"`,
    body:
      `A ${doctype} has been submitted for approval.\n\n` +
      `${summary.name}${summary.subject ? ` — ${summary.subject}` : ""}\n\n` +
      (notes ? `Requester notes:\n${notes}\n\n` : "") +
      `Open the approvals inbox to review.`,
    doctype: "MarketingApproval",
    docId: row.id,
    category: "workflow",
  });

  res.status(201).json({ ...row, doc: summary });
});

// POST /approvals/:id/approve — reviewer approves. Requires an approver role
// (MarketingApprover, SystemManager, or legacy admin). Only Pending rows may
// transition — re-approving an Approved row is a no-op 409 (the caller can
// submit a fresh request instead).
const approveSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});
approvalsRouter.post("/:id/approve", p.submit, async (req, res) => {
  if (!isApprover(req)) {
    return res.status(403).json({
      error: "Only users with the MarketingApprover role may approve",
    });
  }
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tenantId = req.auth!.tenantId;
  const existing = await prisma.marketingApproval.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Pending") {
    return res.status(409).json({
      error: `Cannot approve an approval in status ${existing.status}`,
    });
  }

  const now = new Date();
  const row = await prisma.marketingApproval.update({
    where: { id: existing.id },
    data: {
      status: "Approved",
      approvedBy: req.auth!.userId,
      approvedAt: now,
      // Append reviewer notes without stomping the requester's original notes.
      notes: parsed.data.notes
        ? existing.notes
          ? `${existing.notes}\n\n--- Reviewer (${req.auth!.email ?? req.auth!.userId}) ---\n${parsed.data.notes}`
          : `--- Reviewer (${req.auth!.email ?? req.auth!.userId}) ---\n${parsed.data.notes}`
        : existing.notes,
    },
  });

  // Notify the requester so they know they can proceed.
  const summary = await loadDocSummary(
    tenantId,
    existing.doctype as ApprovableDoctype,
    existing.docId,
  );
  await notifyUsers({
    tenantId,
    userIds: [existing.requestedBy],
    senderUserId: req.auth!.userId,
    subject: `Approved: ${existing.doctype} "${summary?.name ?? existing.docId}"`,
    body:
      `Your ${existing.doctype} was approved by ${req.auth!.email ?? "a reviewer"}.\n\n` +
      (parsed.data.notes ? `Reviewer notes:\n${parsed.data.notes}\n\n` : "") +
      `You can now start / schedule the send.`,
    doctype: "MarketingApproval",
    docId: row.id,
    category: "workflow",
  });

  res.json({ ...row, doc: summary });
});

// POST /approvals/:id/reject — reviewer rejects with a mandatory reason.
// Requester is notified in-app + by email so they can revise + resubmit.
const rejectSchema = z.object({
  reason: z.string().min(1, "Reason is required").max(500),
  notes: z.string().max(2000).optional().nullable(),
});
approvalsRouter.post("/:id/reject", p.submit, async (req, res) => {
  if (!isApprover(req)) {
    return res.status(403).json({
      error: "Only users with the MarketingApprover role may reject",
    });
  }
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tenantId = req.auth!.tenantId;
  const existing = await prisma.marketingApproval.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Pending") {
    return res.status(409).json({
      error: `Cannot reject an approval in status ${existing.status}`,
    });
  }

  const now = new Date();
  const row = await prisma.marketingApproval.update({
    where: { id: existing.id },
    data: {
      status: "Rejected",
      rejectedBy: req.auth!.userId,
      rejectedAt: now,
      rejectionReason: parsed.data.reason,
      notes: parsed.data.notes
        ? existing.notes
          ? `${existing.notes}\n\n--- Reviewer (${req.auth!.email ?? req.auth!.userId}) ---\n${parsed.data.notes}`
          : `--- Reviewer (${req.auth!.email ?? req.auth!.userId}) ---\n${parsed.data.notes}`
        : existing.notes,
    },
  });

  const summary = await loadDocSummary(
    tenantId,
    existing.doctype as ApprovableDoctype,
    existing.docId,
  );
  await notifyUsers({
    tenantId,
    userIds: [existing.requestedBy],
    senderUserId: req.auth!.userId,
    subject: `Rejected: ${existing.doctype} "${summary?.name ?? existing.docId}"`,
    body:
      `Your ${existing.doctype} was rejected by ${req.auth!.email ?? "a reviewer"}.\n\n` +
      `Reason: ${parsed.data.reason}\n\n` +
      (parsed.data.notes ? `Reviewer notes:\n${parsed.data.notes}\n\n` : "") +
      `Please revise and resubmit.`,
    doctype: "MarketingApproval",
    docId: row.id,
    category: "workflow",
  });

  res.json({ ...row, doc: summary });
});

// POST /approvals/:id/withdraw — original requester (and SystemManager)
// withdraws before a reviewer acts. Anyone else → 403. Terminal state; a
// fresh request is required to reopen.
approvalsRouter.post("/:id/withdraw", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.marketingApproval.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // Ownership check — requester or SystemManager only. MarketingApprover
  // deliberately can't withdraw someone else's request: they should reject
  // it with a reason instead.
  const isOwner = existing.requestedBy === req.auth!.userId;
  const isSuper =
    (req.auth!.roles ?? []).includes("SystemManager") ||
    req.auth!.role === "admin";
  if (!isOwner && !isSuper) {
    return res.status(403).json({
      error: "Only the original requester can withdraw this approval",
    });
  }

  if (existing.status !== "Pending") {
    return res.status(409).json({
      error: `Cannot withdraw an approval in status ${existing.status}`,
    });
  }

  const row = await prisma.marketingApproval.update({
    where: { id: existing.id },
    data: { status: "Withdrawn" },
  });
  res.json(row);
});

// GET /approvals/for/:doctype/:docId — latest approval for a specific doc.
// Powers the "approval status" card on Campaign / SocialPost / Broadcast
// detail pages. Returns 204 (no body) when no approval exists — cheaper than
// a 404 for a hot path that runs on every detail-page load.
approvalsRouter.get("/for/:doctype/:docId", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const { doctype, docId } = req.params;
  if (!(APPROVABLE_DOCTYPES as readonly string[]).includes(doctype)) {
    return res.status(400).json({ error: "Unsupported doctype" });
  }
  const row = await prisma.marketingApproval.findFirst({
    where: { tenantId, doctype, docId },
    orderBy: { requestedAt: "desc" },
  });
  if (!row) return res.status(204).end();
  res.json(row);
});

// GET /approvals/config — the tenant's marketing-approval settings (small
// slice of the Tenant row). Read-only view for detail pages so they can
// decide whether to render the approval gate.
approvalsRouter.get("/config/tenant", p.read, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.auth!.tenantId },
    select: { requireMarketingApproval: true },
  });
  res.json({
    requireMarketingApproval: tenant?.requireMarketingApproval ?? false,
  });
});

// PATCH /approvals/config — flip the per-tenant require-approval switch.
// Gated on `MarketingApproval:write` — same grant as request/withdraw. In
// practice only SystemManager + SalesManager + MarketingApprover carry it, so
// front-line contributors can't quietly disable the gate.
const configSchema = z.object({
  requireMarketingApproval: z.boolean(),
});
approvalsRouter.patch("/config/tenant", p.write, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.tenant.update({
    where: { id: req.auth!.tenantId },
    data: { requireMarketingApproval: parsed.data.requireMarketingApproval },
    select: { requireMarketingApproval: true },
  });
  res.json({ requireMarketingApproval: row.requireMarketingApproval });
});

// GET /approvals/stats — small counts payload for the marketing-hub tile.
approvalsRouter.get("/stats/summary", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [pending, approved, rejected, withdrawn] = await Promise.all([
    prisma.marketingApproval.count({ where: { tenantId, status: "Pending" } }),
    prisma.marketingApproval.count({ where: { tenantId, status: "Approved" } }),
    prisma.marketingApproval.count({ where: { tenantId, status: "Rejected" } }),
    prisma.marketingApproval.count({ where: { tenantId, status: "Withdrawn" } }),
  ]);
  res.json({ pending, approved, rejected, withdrawn });
});

// Convenience re-exports so the send-time gate can call the helper without
// pulling the whole router chain into other route files.
export type { ApprovableDoctype, ApprovalStatus };
