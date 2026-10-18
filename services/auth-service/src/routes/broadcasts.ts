import { Router } from "express";
import { z } from "zod";
import { Prisma, applyBrandKit, nextName, prisma, renderTemplate } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// Marketing P3 (approvals): mirrors the checkApprovalRequired helper in
// crm-service/src/routes/approvals.ts. Duplicated here (rather than shared
// via a package) because auth-service must not depend on crm-service — the
// service graph has to stay a DAG. Any change to the 30-day expiry or the
// tenant flag semantics MUST be reflected in both copies.
const APPROVAL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
async function checkApprovalRequired(
  tenantId: string,
  doctype: "Broadcast",
  docId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { requireMarketingApproval: true },
  });
  if (!tenant?.requireMarketingApproval) return { ok: true };
  const latest = await prisma.marketingApproval.findFirst({
    where: { tenantId, doctype, docId },
    orderBy: { requestedAt: "desc" },
  });
  if (!latest) return { ok: false, reason: "Requires approval: no approval on file" };
  if (latest.status !== "Approved" || !latest.approvedAt) {
    return { ok: false, reason: `Requires approval: latest is ${latest.status}` };
  }
  const ageMs = Date.now() - new Date(latest.approvedAt).getTime();
  if (ageMs > APPROVAL_EXPIRY_MS) {
    return {
      ok: false,
      reason: `Requires approval: last approval is ${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d old (>30d)`,
    };
  }
  return { ok: true };
}

// F8: Broadcast. One-shot email blast to a filtered audience (Customers,
// Suppliers, Employees, Leads). Materializes N EmailMessage rows; the
// broadcast row tracks the launch.

export const broadcastRouter = Router();
broadcastRouter.use(requireAuth);

const p = perms("Broadcast");

const AUDIENCES = ["Customers", "Suppliers", "Employees", "Leads"] as const;

const createSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  templateId: z.string().optional().nullable(),
  audience: z.enum(AUDIENCES),
  filter: z.record(z.unknown()).optional(),
  scheduledFor: z.string().datetime().optional().nullable(),
});

broadcastRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.broadcast.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

broadcastRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.broadcast.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

broadcastRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "BR-");
  const row = await prisma.broadcast.create({
    data: {
      tenantId,
      name,
      subject: parsed.data.subject,
      body: parsed.data.body,
      templateId: parsed.data.templateId ?? null,
      audience: parsed.data.audience,
      filter: (parsed.data.filter ?? {}) as Prisma.InputJsonValue,
      scheduledFor: parsed.data.scheduledFor
        ? new Date(parsed.data.scheduledFor)
        : null,
    },
  });
  res.status(201).json(row);
});

// Preview: return the list of resolved recipients (email + label) for the
// broadcast's audience+filter — does NOT enqueue.
broadcastRouter.get("/:id/recipients", p.read, async (req, res) => {
  const b = await prisma.broadcast.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!b) return res.status(404).json({ error: "Not found" });
  const recipients = await resolveRecipients(b.tenantId, b.audience, b.filter as Record<string, unknown> | null);
  res.json({ count: recipients.length, recipients: recipients.slice(0, 100) });
});

// Launch: enqueues one EmailMessage per resolved recipient, flips status to
// Queued. Rendering: use template if templateId present, else raw
// subject/body. `{{name}}` and `{{email}}` are always available.
broadcastRouter.post("/:id/launch", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const b = await tx.broadcast.findFirst({
          where: { id: req.params.id, tenantId },
        });
        if (!b) throw new Error("Not found");
        if (b.status !== "Draft")
          throw new Error(`Cannot launch broadcast in status ${b.status}`);

        // P3: refuse to leave Draft when the tenant requires an approved
        // MarketingApproval for this broadcast. Uses the outer `prisma` (not
        // `tx`) — the approval check is a read against a separate table and
        // running it inside the transaction only lengthens the row lock.
        const gate = await checkApprovalRequired(tenantId, "Broadcast", b.id);
        if (!gate.ok) {
          throw new Error(gate.reason ?? "Requires approval");
        }

        let tplSubject = b.subject;
        let tplBody = b.body;
        if (b.templateId) {
          const tpl = await tx.emailTemplate.findFirst({
            where: { id: b.templateId, tenantId, enabled: true },
          });
          if (!tpl) throw new Error("Broadcast template missing or disabled");
          tplSubject = tpl.subject;
          tplBody = tpl.body;
        }

        const recipients = await resolveRecipients(
          tenantId,
          b.audience,
          b.filter as Record<string, unknown> | null,
        );
        if (recipients.length === 0) throw new Error("No recipients matched");

        for (const r of recipients) {
          const subject = renderTemplate(tplSubject, { name: r.name, email: r.email });
          const primary = renderTemplate(tplBody, { name: r.name, email: r.email });
          // Post-render brand-kit pass so `{{brand.*}}` tokens in the template
          // (or its layout wrapper) resolve against the per-tenant BrandKit.
          const body = await applyBrandKit(primary, tenantId);
          await tx.emailMessage.create({
            data: {
              tenantId,
              senderUserId: req.auth!.userId,
              toEmail: r.email,
              subject,
              body,
              templateId: b.templateId,
              linkedDoctype: "Broadcast",
              linkedId: b.id,
              scheduledFor: b.scheduledFor,
            },
          });
        }

        return tx.broadcast.update({
          where: { id: b.id },
          data: {
            status: "Queued",
            recipientCount: recipients.length,
            sentAt: new Date(),
          },
        });
      },
      { timeout: 60_000 },
    );
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    // 409 when the approval gate blocked the launch — matches the campaign
    // route so front-ends can share a single "needs approval" branch.
    const status =
      msg === "Not found"
        ? 404
        : msg.startsWith("Requires approval")
          ? 409
          : 400;
    res.status(status).json({ error: msg });
  }
});

broadcastRouter.post("/:id/cancel", p.cancel, async (req, res) => {
  const existing = await prisma.broadcast.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.status !== "Draft")
    return res.status(400).json({ error: `Cannot cancel in status ${existing.status}` });
  const row = await prisma.broadcast.update({
    where: { id: existing.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});

async function resolveRecipients(
  tenantId: string,
  audience: string,
  filter: Record<string, unknown> | null,
): Promise<{ email: string; name: string }[]> {
  const f = filter ?? {};
  if (audience === "Customers") {
    const rows = await prisma.customer.findMany({
      where: {
        tenantId,
        email: { not: null },
        ...(typeof f.customerGroupId === "string"
          ? { customerGroupId: f.customerGroupId }
          : {}),
        ...(typeof f.territoryId === "string" ? { territoryId: f.territoryId } : {}),
      },
      select: { customerName: true, email: true },
    });
    return rows.filter((r) => r.email).map((r) => ({ email: r.email!, name: r.customerName }));
  }
  if (audience === "Suppliers") {
    const rows = await prisma.supplier.findMany({
      where: { tenantId, email: { not: null } },
      select: { supplierName: true, email: true },
    });
    return rows.filter((r) => r.email).map((r) => ({ email: r.email!, name: r.supplierName }));
  }
  if (audience === "Employees") {
    const rows = await prisma.employee.findMany({
      where: {
        tenantId,
        email: { not: null },
        status: "Active",
        ...(typeof f.department === "string" ? { department: f.department } : {}),
        ...(typeof f.branchId === "string" ? { branchId: f.branchId } : {}),
      },
      select: { employeeName: true, email: true },
    });
    return rows.filter((r) => r.email).map((r) => ({ email: r.email!, name: r.employeeName }));
  }
  if (audience === "Leads") {
    const rows = await prisma.lead.findMany({
      where: {
        tenantId,
        email: { not: null },
        status: { notIn: ["Lost", "Converted"] },
      },
      select: { leadName: true, email: true },
    });
    return rows.filter((r) => r.email).map((r) => ({ email: r.email!, name: r.leadName }));
  }
  return [];
}
