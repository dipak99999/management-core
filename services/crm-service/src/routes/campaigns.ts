import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  Prisma,
  pickVariantForRecipient,
  prisma,
  applyBrandKit,
  renderTemplate,
  twoProportionZTest,
} from "@lumaara/db";
import { idempotency, perms } from "@lumaara/service-auth";
import { checkApprovalRequired } from "./approvals";

// Helper: stable random ID used when we must know the recipient's PK BEFORE
// insert (so it can feed the deterministic variant hash). Prisma's default
// cuid gets assigned inside the create call, which is too late for us.
function cryptoRandomId(): string {
  return randomUUID();
}

// D8: Campaign master + attribution report.
// P1: state machine upgrade + action endpoints (schedule/start/pause/resume/
// cancel/archive-publish/archive-unpublish) + test-send + preview.

export const campaignRouter = Router();

const p = perms("Campaign");

// ─── State machine ────────────────────────────────────────────────────
//
// Legacy values (Planned|Active|Completed) still accepted at the persistence
// layer; the transition matrix normalises them to their new equivalents
// (Draft|Sending|Sent) before any check runs. Anything can move to Cancelled.
// Sent → Archived / Archived → Sent is the archive-publish toggle.

export type CampaignStatus =
  | "Draft"
  | "Scheduled"
  | "Sending"
  | "Paused"
  | "Sent"
  | "Cancelled"
  | "Archived";

// Normalise legacy status strings so the state machine only ever reasons over
// the new vocabulary. Anything unknown falls through as-is (safest default:
// caller will see it as "not-a-valid-source" from every canTransition call).
export function normalizeStatus(s: string | null | undefined): CampaignStatus {
  switch (s) {
    case "Planned":   return "Draft";
    case "Active":    return "Sending";
    case "Completed": return "Sent";
    case null:
    case undefined:
    case "":
      return "Draft";
    default:
      return s as CampaignStatus;
  }
}

// Transition matrix — encodes the P1 plan. Anything (except a terminal
// Cancelled) can move to Cancelled per the spec ("Any → Cancelled acceptable").
const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  Draft:     ["Scheduled", "Sending", "Cancelled"],
  Scheduled: ["Sending", "Draft", "Cancelled"],
  Sending:   ["Paused", "Sent", "Cancelled"],
  Paused:    ["Sending", "Cancelled"],
  Sent:      ["Archived", "Cancelled"],
  Cancelled: [],
  Archived:  ["Sent", "Cancelled"],
};

export function canTransition(
  from: string | null | undefined,
  to: CampaignStatus,
): boolean {
  const src = normalizeStatus(from);
  const dst = normalizeStatus(to);
  if (src === dst) return false;
  const allowed = TRANSITIONS[src];
  if (!allowed) return false;
  return allowed.includes(dst);
}

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  budget: z.coerce.number().nonnegative().default(0),
  expectedRevenue: z.coerce.number().nonnegative().default(0),
  // Accept BOTH legacy vocabulary (Planned|Active|Completed|Cancelled) and
  // new P1 vocabulary (Draft|Scheduled|Sending|Paused|Sent|Cancelled|Archived).
  // New rows default to "Draft"; existing rows migrate lazily via UI actions.
  status: z
    .enum([
      "Planned", "Active", "Completed",           // legacy
      "Draft", "Scheduled", "Sending",
      "Paused", "Sent", "Cancelled", "Archived",  // new
    ])
    .default("Draft"),
  // Marketing-Plus email fields — all nullable so existing pure-attribution
  // campaigns without an email body still validate.
  channel:      z.enum(["Email", "SMS", "Multi"]).optional(),
  subject:      z.string().nullable().optional(),
  bodyHtml:     z.string().nullable().optional(),
  fromEmail:    z.string().email().nullable().optional(),
  fromName:     z.string().nullable().optional(),
  replyTo:      z.string().email().nullable().optional(),
  trackOpens:   z.boolean().optional(),
  trackClicks:  z.boolean().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
});

campaignRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.campaign.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

campaignRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

campaignRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.campaign.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        budget: new Prisma.Decimal(parsed.data.budget),
        expectedRevenue: new Prisma.Decimal(parsed.data.expectedRevenue),
        status: parsed.data.status,
        channel: parsed.data.channel ?? "Email",
        subject: parsed.data.subject ?? null,
        bodyHtml: parsed.data.bodyHtml ?? null,
        fromEmail: parsed.data.fromEmail ?? null,
        fromName: parsed.data.fromName ?? null,
        replyTo: parsed.data.replyTo ?? null,
        trackOpens: parsed.data.trackOpens ?? true,
        trackClicks: parsed.data.trackClicks ?? true,
        scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Campaign name already exists" });
    throw e;
  }
});

campaignRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.campaign.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      budget: new Prisma.Decimal(parsed.data.budget),
      expectedRevenue: new Prisma.Decimal(parsed.data.expectedRevenue),
      status: parsed.data.status,
      channel: parsed.data.channel ?? existing.channel,
      subject: parsed.data.subject === undefined ? existing.subject : parsed.data.subject,
      bodyHtml: parsed.data.bodyHtml === undefined ? existing.bodyHtml : parsed.data.bodyHtml,
      fromEmail: parsed.data.fromEmail === undefined ? existing.fromEmail : parsed.data.fromEmail,
      fromName: parsed.data.fromName === undefined ? existing.fromName : parsed.data.fromName,
      replyTo: parsed.data.replyTo === undefined ? existing.replyTo : parsed.data.replyTo,
      trackOpens: parsed.data.trackOpens ?? existing.trackOpens,
      trackClicks: parsed.data.trackClicks ?? existing.trackClicks,
      scheduledFor: parsed.data.scheduledFor === undefined
        ? existing.scheduledFor
        : parsed.data.scheduledFor === null ? null : new Date(parsed.data.scheduledFor),
    },
  });
  res.json(row);
});

// ─── Marketing-Plus endpoints ──────────────────────────────────────────

// Link a ContactList to a campaign. Sends will fan out to every member of
// every linked list (deduped by contactType+contactId).
campaignRouter.post("/:id/link-list", p.write, async (req, res) => {
  const parsed = z.object({ listId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "listId required" });
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const list = await prisma.contactList.findFirst({
    where: { id: parsed.data.listId, tenantId: req.auth!.tenantId },
  });
  if (!list) return res.status(404).json({ error: "List not found" });
  await prisma.campaignListLink.upsert({
    where: { campaignId_listId: { campaignId: c.id, listId: list.id } },
    create: { campaignId: c.id, listId: list.id },
    update: {},
  });
  res.json({ ok: true });
});

campaignRouter.post("/:id/unlink-list", p.write, async (req, res) => {
  const parsed = z.object({ listId: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "listId required" });
  await prisma.campaignListLink.deleteMany({
    where: {
      campaignId: req.params.id,
      listId: parsed.data.listId,
    },
  });
  res.status(204).end();
});

campaignRouter.get("/:id/lists", p.read, async (req, res) => {
  const links = await prisma.campaignListLink.findMany({
    where: { campaignId: req.params.id },
    include: {
      list: { select: { id: true, name: true, memberCount: true, isDynamic: true } },
    },
  });
  res.json(links.map((l) => l.list));
});

// Materialize recipients from every linked list — resolves the target
// contacts, dedups, and creates a CampaignRecipient row (Pending) per one.
// Returns the count. Doesn't send — the client calls /send next.
campaignRouter.post("/:id/materialize-recipients", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
    include: { listLinks: { include: { list: true } }, variants: true },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });

  // Gather (contactType, contactId, emailTo) from every linked list.
  const contacts: { contactType: string; contactId: string; emailTo: string }[] = [];
  for (const link of c.listLinks) {
    const list = link.list;
    if (list.isDynamic && list.filterJson) {
      const filter = list.filterJson as { doctype: string; where?: unknown };
      if (filter.doctype === "Customer") {
        const rows = await prisma.customer.findMany({
          where: { tenantId, email: { not: null }, ...(filter.where as object ?? {}) },
          select: { id: true, email: true },
        });
        for (const r of rows) if (r.email) contacts.push({ contactType: "Customer", contactId: r.id, emailTo: r.email });
      } else if (filter.doctype === "Lead") {
        const rows = await prisma.lead.findMany({
          where: { tenantId, email: { not: null }, ...(filter.where as object ?? {}) },
          select: { id: true, email: true },
        });
        for (const r of rows) if (r.email) contacts.push({ contactType: "Lead", contactId: r.id, emailTo: r.email });
      }
    } else {
      const members = await prisma.contactListMember.findMany({
        where: { listId: list.id },
      });
      for (const m of members) {
        let email: string | null = null;
        if (m.contactType === "Customer") {
          const cust = await prisma.customer.findUnique({ where: { id: m.contactId }, select: { email: true } });
          email = cust?.email ?? null;
        } else if (m.contactType === "Lead") {
          const lead = await prisma.lead.findUnique({ where: { id: m.contactId }, select: { email: true } });
          email = lead?.email ?? null;
        }
        if (email) contacts.push({ contactType: m.contactType, contactId: m.contactId, emailTo: email });
      }
    }
  }

  // Dedup by (contactType, contactId).
  const seen = new Set<string>();
  const deduped = contacts.filter((c2) => {
    const k = `${c2.contactType}:${c2.contactId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Upsert recipients (idempotent — same contact = same recipient).
  // P2: when the campaign has A/B variants, pick a variant per recipient via
  // deterministic weighted hash so re-runs stay consistent. If a winner has
  // been promoted, pickVariantForRecipient short-circuits to the winner for
  // every NEW recipient. Existing recipients keep whatever variantId they
  // originally got (their sends have usually already happened).
  const variants = c.variants ?? [];
  let created = 0;
  for (const cc of deduped) {
    const existing = await prisma.campaignRecipient.findUnique({
      where: {
        campaignId_contactType_contactId: {
          campaignId: c.id,
          contactType: cc.contactType,
          contactId: cc.contactId,
        },
      },
    });
    if (!existing) {
      // Assign a stable id first so pickVariantForRecipient sees a real key.
      // We use randomUUID here rather than a Prisma-generated cuid so the
      // hash bucketing is deterministic against the same input across
      // re-runs (though re-materialize is a no-op for existing rows anyway).
      const recipientId = cryptoRandomId();
      const chosen =
        variants.length > 0 ? pickVariantForRecipient(variants, recipientId) : null;
      await prisma.campaignRecipient.create({
        data: {
          id: recipientId,
          tenantId,
          campaignId: c.id,
          contactType: cc.contactType,
          contactId: cc.contactId,
          emailTo: cc.emailTo,
          variantId: chosen?.id ?? null,
        },
      });
      created++;
    }
  }

  await prisma.campaign.update({
    where: { id: c.id },
    data: { totalRecipients: deduped.length },
  });

  res.json({ ok: true, totalContacts: deduped.length, newRecipients: created });
});

// Kick off the send. In this MVP we don't actually deliver over SMTP — we
// mark every Pending recipient as Sent (with sentAt = now) and let the
// tracking pixel do the rest when a recipient "opens" the mail. Wire this to
// the real MailService in a follow-up.
campaignRouter.post("/:id/send", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (c.status === "Cancelled") return res.status(400).json({ error: "Campaign is Cancelled" });
  if (!c.subject || !c.bodyHtml)
    return res.status(400).json({ error: "Campaign requires subject and bodyHtml before send" });

  // P3: honour the tenant-level approval gate. Deliberately AFTER the
  // subject/body existence check — those are cheaper and give a clearer
  // error when the campaign isn't even ready to send.
  const gate = await checkApprovalRequired(prisma, tenantId, "Campaign", c.id);
  if (!gate.ok) {
    return res.status(409).json({ error: gate.reason, needsApproval: true });
  }

  const pending = await prisma.campaignRecipient.count({
    where: { campaignId: c.id, status: "Pending" },
  });
  if (pending === 0)
    return res.status(400).json({ error: "No pending recipients — call /materialize-recipients first" });

  // Bulk-mark as Sent. Real SMTP path would iterate + attempt per recipient.
  const now = new Date();
  await prisma.campaignRecipient.updateMany({
    where: { campaignId: c.id, status: "Pending" },
    data: { status: "Sent", sentAt: now },
  });
  await prisma.campaign.update({
    where: { id: c.id },
    data: {
      status: "Active",
      sentAt: now,
      totalSent: { increment: pending },
    },
  });

  // P2: roll variant.totalSent counters up from per-recipient assignments so
  // /variants/stats + ab-winner have real numbers to work with. groupBy runs
  // once against the batch we just marked Sent.
  const variantCounts = await prisma.campaignRecipient.groupBy({
    by: ["variantId"],
    where: { campaignId: c.id, status: "Sent", variantId: { not: null } },
    _count: { _all: true },
  });
  for (const g of variantCounts) {
    if (!g.variantId) continue;
    await prisma.campaignVariant.update({
      where: { id: g.variantId },
      data: { totalSent: g._count._all },
    });
  }

  res.json({ ok: true, sent: pending });
});

campaignRouter.get("/:id/recipients", p.read, async (req, res) => {
  const rows = await prisma.campaignRecipient.findMany({
    where: {
      campaignId: req.params.id,
      tenantId: req.auth!.tenantId,
    },
    orderBy: { sentAt: "desc" },
    take: 500,
  });
  res.json(rows);
});

// Live analytics roll-up — reads the recipient rows directly rather than the
// cached counters so it's always fresh.
campaignRouter.get("/:id/analytics", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!c) return res.status(404).json({ error: "Not found" });

  const [total, sent, opened, clicked, bounced, unsubs] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId: c.id } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, status: "Sent" } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, openedAt: { not: null } } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, clickedAt: { not: null } } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, status: "Bounced" } }),
    prisma.campaignRecipient.count({ where: { campaignId: c.id, status: "Unsubscribed" } }),
  ]);
  const rate = (n: number) => (sent > 0 ? Math.round((n / sent) * 1000) / 10 : 0);
  res.json({
    campaign: c,
    total,
    sent,
    opened,
    clicked,
    bounced,
    unsubs,
    openRate:    rate(opened),
    clickRate:   rate(clicked),
    bounceRate:  rate(bounced),
    unsubRate:   rate(unsubs),
  });
});

campaignRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { leads: true, opportunities: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.leads > 0 || existing._count.opportunities > 0)
    return res.status(400).json({
      error: `Cannot delete: ${existing._count.leads} leads + ${existing._count.opportunities} opportunities attributed`,
    });
  await prisma.campaign.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// D8: attribution report per campaign — counts + sums traceable revenue
// (via Lead → convertedCustomer → SI + Opportunity → convertedCustomer → SI).
campaignRouter.get("/:id/attribution", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const campaign = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!campaign) return res.status(404).json({ error: "Not found" });

  const [leads, opportunities] = await Promise.all([
    prisma.lead.findMany({
      where: { tenantId, campaignId: campaign.id },
      include: { convertedCustomer: { select: { id: true } } },
    }),
    prisma.opportunity.findMany({
      where: { tenantId, campaignId: campaign.id },
      include: { customer: { select: { id: true } } },
    }),
  ]);
  const customerIds = new Set<string>();
  for (const l of leads) if (l.convertedCustomer?.id) customerIds.add(l.convertedCustomer.id);
  for (const o of opportunities) if (o.customer?.id) customerIds.add(o.customer.id);
  // Sum SI grandTotal for attributed customers (post-campaign-start only).
  const invoices =
    customerIds.size > 0
      ? await prisma.salesInvoice.findMany({
          where: {
            tenantId,
            customerId: { in: [...customerIds] },
            status: { in: ["Submitted", "Paid"] },
            isReturn: false,
            ...(campaign.startDate
              ? { postingDate: { gte: campaign.startDate } }
              : {}),
          },
          select: { grandTotal: true },
        })
      : [];
  const attributedRevenue = invoices.reduce(
    (s, i) => s + Number(i.grandTotal),
    0,
  );
  const roi =
    Number(campaign.budget) > 0
      ? (attributedRevenue - Number(campaign.budget)) / Number(campaign.budget)
      : null;
  res.json({
    campaign,
    leads: leads.length,
    converted: leads.filter((l) => l.status === "Converted").length,
    opportunities: opportunities.length,
    won: opportunities.filter((o) => o.status === "Converted").length,
    invoices: invoices.length,
    attributedRevenue,
    roi, // (revenue − budget) / budget; null when budget=0
  });
});

// ─── P1 state-machine action endpoints ────────────────────────────────
//
// All actions:
//   1. Load the tenant-scoped campaign or 404.
//   2. Call canTransition(current, desired) — 409 with { error, from, to }
//      on invalid, so the UI can surface "you can't do X in status Y".
//   3. Apply persistence side-effects (e.g. sentAt, scheduledFor, archiveSlug).
//   4. Return the updated row.

async function loadCampaign(req: import("express").Request) {
  return prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
}

function refuseTransition(
  res: import("express").Response,
  from: string,
  to: CampaignStatus,
) {
  return res.status(409).json({
    error: `Cannot transition ${from} → ${to}`,
    from,
    to,
  });
}

// POST /:id/schedule — Draft → Scheduled. Requires future scheduledFor.
// P3: also blocks the transition when the tenant has
// requireMarketingApproval=true and no active approval exists.
campaignRouter.post("/:id/schedule", p.write, async (req, res) => {
  const parsed = z.object({ scheduledFor: z.string().datetime() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Scheduled")) return refuseTransition(res, c.status, "Scheduled");
  const gate = await checkApprovalRequired(prisma, req.auth!.tenantId, "Campaign", c.id);
  if (!gate.ok) {
    return res.status(409).json({ error: gate.reason, needsApproval: true });
  }
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Scheduled", scheduledFor: new Date(parsed.data.scheduledFor) },
  });
  res.json(row);
});

// POST /:id/unschedule — Scheduled → Draft. Clears scheduledFor.
campaignRouter.post("/:id/unschedule", p.write, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Draft")) return refuseTransition(res, c.status, "Draft");
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Draft", scheduledFor: null },
  });
  res.json(row);
});

// POST /:id/start — Draft|Scheduled|Paused → Sending. Sets sentAt on first
// send. Actual delivery is handled by the send loop / scheduler; this endpoint
// only flips the flag.
// P3: gated on checkApprovalRequired when the tenant has the approvals flag
// on. Paused → Sending resumes a run already in flight, so the gate is not
// re-applied there (a mid-run approval revocation is deliberately not modeled).
campaignRouter.post("/:id/start", p.write, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Sending")) return refuseTransition(res, c.status, "Sending");
  if (c.status !== "Paused") {
    const gate = await checkApprovalRequired(prisma, req.auth!.tenantId, "Campaign", c.id);
    if (!gate.ok) {
      return res.status(409).json({ error: gate.reason, needsApproval: true });
    }
  }
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: {
      status: "Sending",
      sentAt: c.sentAt ?? new Date(),
    },
  });
  res.json(row);
});

// POST /:id/pause — Sending → Paused.
campaignRouter.post("/:id/pause", p.write, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Paused")) return refuseTransition(res, c.status, "Paused");
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Paused" },
  });
  res.json(row);
});

// POST /:id/resume — Paused → Sending. Doesn't touch sentAt.
campaignRouter.post("/:id/resume", p.write, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Sending")) return refuseTransition(res, c.status, "Sending");
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Sending" },
  });
  res.json(row);
});

// POST /:id/cancel — any except Cancelled → Cancelled. Terminal state.
campaignRouter.post("/:id/cancel", p.write, idempotency("POST /campaigns/:id/cancel"), async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Cancelled")) return refuseTransition(res, c.status, "Cancelled");
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Cancelled" },
  });
  res.json(row);
});

// POST /:id/archive-publish — Sent → Archived. Sets archiveEnabled=true and
// stores the (globally unique) archiveSlug. Returns the public archive URL
// so the UI can offer copy-to-clipboard. If the slug is already used by
// another campaign, returns 409.
campaignRouter.post("/:id/archive-publish", p.write, async (req, res) => {
  const parsed = z
    .object({ slug: z.string().regex(/^[a-z0-9-]+$/, "slug must be [a-z0-9-]+").min(1).max(120) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Archived")) return refuseTransition(res, c.status, "Archived");

  // Uniqueness pre-check — archiveSlug is @unique across all tenants (public
  // URL space), so a collision with another campaign 409s.
  const clash = await prisma.campaign.findFirst({
    where: { archiveSlug: parsed.data.slug, NOT: { id: c.id } },
    select: { id: true },
  });
  if (clash) return res.status(409).json({ error: "archive slug already in use" });

  try {
    const row = await prisma.campaign.update({
      where: { id: c.id },
      data: {
        status: "Archived",
        archiveEnabled: true,
        archiveSlug: parsed.data.slug,
      },
    });
    const base = process.env.CRM_SERVICE_URL ?? `http://localhost:${process.env.PORT ?? 4004}`;
    const archiveUrl = `${base.replace(/\/+$/, "")}/a/${parsed.data.slug}`;
    res.json({ ...row, archiveUrl });
  } catch (e) {
    // Belt-and-braces — race with another writer on the unique slug index.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
    ) {
      return res.status(409).json({ error: "archive slug already in use" });
    }
    throw e;
  }
});

// POST /:id/archive-unpublish — Archived → Sent. Clears archiveEnabled but
// keeps archiveSlug so re-publish is idempotent (same URL comes back).
campaignRouter.post("/:id/archive-unpublish", p.write, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!canTransition(c.status, "Sent")) return refuseTransition(res, c.status, "Sent");
  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { status: "Sent", archiveEnabled: false },
  });
  res.json(row);
});

// POST /:id/test — send a TEST-prefixed rendering of the campaign to up to
// 5 email addresses. Enqueues an EmailMessage per address via the auth-service
// email-messages flow (Pending, picked up by /emails/process). Does NOT change
// campaign status. Marks campaign.testSentAt.
campaignRouter.post("/:id/test", p.write, async (req, res) => {
  const parsed = z
    .object({ emails: z.array(z.string().email()).min(1).max(5) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  if (!c.subject || !c.bodyHtml) {
    return res.status(400).json({ error: "Campaign requires subject and bodyHtml before test send" });
  }

  const sampleVars = {
    first_name:      "Test",
    last_name:       "Recipient",
    email:           "test@example.com",
    unsubscribe_url: "#test",
  };
  const subject = `[TEST] ${renderTemplate(c.subject, sampleVars)}`;
  // Post-render brand-kit pass so `{{brand.*}}` tokens resolve against
  // the per-tenant BrandKit before the test message is queued.
  const body = await applyBrandKit(
    renderTemplate(c.bodyHtml, sampleVars),
    c.tenantId,
  );

  for (const to of parsed.data.emails) {
    await prisma.emailMessage.create({
      data: {
        tenantId: c.tenantId,
        senderUserId: req.auth!.userId,
        toEmail: to,
        subject,
        body,
        linkedDoctype: "Campaign",
        linkedId: c.id,
      },
    });
  }

  const row = await prisma.campaign.update({
    where: { id: c.id },
    data: { testSentAt: new Date() },
  });
  res.json({ ok: true, queued: parsed.data.emails.length, campaign: row });
});

// GET /:id/preview — HTML render of bodyHtml with sample merge variables
// filled in. Read-only, no state change. Returns text/html directly so the
// UI can iframe it verbatim.
campaignRouter.get("/:id/preview", p.read, async (req, res) => {
  const c = await loadCampaign(req);
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const sampleVars = {
    first_name:      "John",
    last_name:       "Doe",
    email:           "sample@example.com",
    unsubscribe_url: "#preview",
  };
  const body = await applyBrandKit(
    renderTemplate(c.bodyHtml ?? "", sampleVars),
    c.tenantId,
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(body);
});

// ─── P2: A/B test variants ─────────────────────────────────────────────
//
// Business rules (enforced here, mirrored client-side):
//   - Max 3 variants per campaign (industry standard — statistical power
//     collapses beyond 3 arms unless you have huge volume).
//   - sum(weightPercent) MUST stay ≤ 100 after any insert/update. Enforced
//     inside a transaction to make the check-then-write atomic (two admins
//     adding a variant concurrently can't both slip through).
//   - variantKey unique per campaign (@@unique enforces at DB level too).
//   - Deleting a variant SetNulls CampaignRecipient.variantId (schema-level
//     onDelete: SetNull), so already-sent recipients don't dangle.

const variantCreateSchema = z.object({
  variantKey: z.string().regex(/^[A-Z]$/, "variantKey must be a single uppercase letter (A/B/C)"),
  weightPercent: z.coerce.number().int().min(1).max(100),
  subject: z.string().nullable().optional(),
  bodyHtml: z.string().nullable().optional(),
  fromEmail: z.string().email().nullable().optional(),
  fromName: z.string().nullable().optional(),
});

const variantPatchSchema = variantCreateSchema.partial();

const MAX_VARIANTS_PER_CAMPAIGN = 3;

// GET /:id/variants — list all variants for a campaign.
campaignRouter.get("/:id/variants", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const variants = await prisma.campaignVariant.findMany({
    where: { tenantId, campaignId: c.id },
    orderBy: { variantKey: "asc" },
  });
  res.json(variants);
});

// POST /:id/variants — create a variant. Body is variantCreateSchema.
// Enforces max=3 + total weight ≤ 100 inside a serializable-ish transaction
// to make the check-then-insert atomic.
campaignRouter.post("/:id/variants", p.write, async (req, res) => {
  const parsed = variantCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });

  try {
    const row = await prisma.$transaction(async (tx) => {
      const existing = await tx.campaignVariant.findMany({
        where: { tenantId, campaignId: c.id },
        select: { variantKey: true, weightPercent: true },
      });
      if (existing.length >= MAX_VARIANTS_PER_CAMPAIGN) {
        throw new HttpError(400, `A campaign may have at most ${MAX_VARIANTS_PER_CAMPAIGN} variants`);
      }
      if (existing.some((v) => v.variantKey === parsed.data.variantKey)) {
        throw new HttpError(409, `Variant ${parsed.data.variantKey} already exists`);
      }
      const total = existing.reduce((s, v) => s + v.weightPercent, 0) + parsed.data.weightPercent;
      if (total > 100) {
        throw new HttpError(
          400,
          `Total weight would be ${total}% (max 100). Reduce existing weights first.`,
        );
      }
      return tx.campaignVariant.create({
        data: {
          tenantId,
          campaignId: c.id,
          variantKey: parsed.data.variantKey,
          weightPercent: parsed.data.weightPercent,
          subject: parsed.data.subject ?? null,
          bodyHtml: parsed.data.bodyHtml ?? null,
          fromEmail: parsed.data.fromEmail ?? null,
          fromName: parsed.data.fromName ?? null,
        },
      });
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    // Prisma P2002 = unique-constraint clash on (campaignId, variantKey). Race.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Variant key already exists" });
    }
    throw e;
  }
});

// PATCH /variants/:variantId — edit an existing variant. Weight changes
// re-validate the sum against the OTHER variants.
campaignRouter.patch("/variants/:variantId", p.write, async (req, res) => {
  const parsed = variantPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.campaignVariant.findFirst({
    where: { id: req.params.variantId, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Variant not found" });

  try {
    const row = await prisma.$transaction(async (tx) => {
      // Only re-validate weight when it's actually changing.
      if (parsed.data.weightPercent !== undefined && parsed.data.weightPercent !== existing.weightPercent) {
        const siblings = await tx.campaignVariant.findMany({
          where: { tenantId, campaignId: existing.campaignId, NOT: { id: existing.id } },
          select: { weightPercent: true },
        });
        const total = siblings.reduce((s, v) => s + v.weightPercent, 0) + parsed.data.weightPercent;
        if (total > 100) {
          throw new HttpError(400, `Total weight would be ${total}% (max 100)`);
        }
      }
      if (parsed.data.variantKey && parsed.data.variantKey !== existing.variantKey) {
        const clash = await tx.campaignVariant.findFirst({
          where: {
            tenantId,
            campaignId: existing.campaignId,
            variantKey: parsed.data.variantKey,
            NOT: { id: existing.id },
          },
          select: { id: true },
        });
        if (clash) throw new HttpError(409, `Variant ${parsed.data.variantKey} already exists`);
      }
      return tx.campaignVariant.update({
        where: { id: existing.id },
        data: {
          variantKey: parsed.data.variantKey ?? existing.variantKey,
          weightPercent: parsed.data.weightPercent ?? existing.weightPercent,
          subject: parsed.data.subject === undefined ? existing.subject : parsed.data.subject,
          bodyHtml: parsed.data.bodyHtml === undefined ? existing.bodyHtml : parsed.data.bodyHtml,
          fromEmail: parsed.data.fromEmail === undefined ? existing.fromEmail : parsed.data.fromEmail,
          fromName: parsed.data.fromName === undefined ? existing.fromName : parsed.data.fromName,
        },
      });
    });
    res.json(row);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({ error: "Variant key already exists" });
    }
    throw e;
  }
});

// DELETE /variants/:variantId — remove a variant. CampaignRecipient.variantId
// is @relation(onDelete: SetNull) so existing recipient rows are preserved.
campaignRouter.delete("/variants/:variantId", p.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.campaignVariant.findFirst({
    where: { id: req.params.variantId, tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Variant not found" });
  await prisma.campaignVariant.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// GET /:id/variants/stats — per-variant totals + rates + significance flag.
// The stats are read straight off CampaignVariant.totalSent/Opened/Clicked
// counters (updated by the send loop + tracking pipeline). If there are ≥2
// variants we run a two-proportion z-test between the top-two variants on
// the requested metric (open|click) and surface the resulting p-value.
campaignRouter.get("/:id/variants/stats", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const metric = req.query.metric === "click" ? "click" : "open";
  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });
  const variants = await prisma.campaignVariant.findMany({
    where: { tenantId, campaignId: c.id },
    orderBy: { variantKey: "asc" },
  });
  const rows = variants.map((v) => {
    const successes =
      metric === "click" ? v.totalClicked : v.totalOpened;
    const rate = v.totalSent > 0 ? successes / v.totalSent : 0;
    return {
      id: v.id,
      variantKey: v.variantKey,
      weightPercent: v.weightPercent,
      isWinner: v.isWinner,
      totalSent: v.totalSent,
      totalOpened: v.totalOpened,
      totalClicked: v.totalClicked,
      totalBounced: v.totalBounced,
      openRate: v.totalSent > 0 ? v.totalOpened / v.totalSent : 0,
      clickRate: v.totalSent > 0 ? v.totalClicked / v.totalSent : 0,
      // The metric-specific rate the significance test uses.
      metricRate: rate,
    };
  });

  // Significance between the top-two by metricRate. Only meaningful with 2+
  // variants and non-zero sends.
  let significance: {
    metric: string;
    leaderKey: string;
    runnerUpKey: string;
    z: number;
    pValue: number;
    isSignificant: boolean;
  } | null = null;
  if (rows.length >= 2) {
    const sorted = [...rows].sort((a, b) => b.metricRate - a.metricRate);
    const leader = sorted[0]!;
    const runnerUp = sorted[1]!;
    if (leader.totalSent > 0 && runnerUp.totalSent > 0) {
      const leaderX =
        metric === "click" ? leader.totalClicked : leader.totalOpened;
      const runnerUpX =
        metric === "click" ? runnerUp.totalClicked : runnerUp.totalOpened;
      const result = twoProportionZTest(
        leaderX,
        leader.totalSent,
        runnerUpX,
        runnerUp.totalSent,
      );
      significance = {
        metric,
        leaderKey: leader.variantKey,
        runnerUpKey: runnerUp.variantKey,
        z: Math.round(result.z * 1000) / 1000,
        pValue: Math.round(result.pValue * 10000) / 10000,
        isSignificant: result.isSignificant,
      };
    }
  }

  res.json({ variants: rows, significance });
});

// POST /:id/variants/pick-winner — manually promote a winner. Default policy
// picks the variant with the highest open-rate (or click-rate when
// ?metric=click). Body may pass {variantId} to force a specific variant
// (used by the UI's "Force winner" affordance and by the scheduler job).
campaignRouter.post("/:id/variants/pick-winner", p.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const metric = req.query.metric === "click" ? "click" : "open";
  const bodyParsed = z
    .object({ variantId: z.string().min(1).optional() })
    .safeParse(req.body ?? {});
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.flatten() });

  const c = await prisma.campaign.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!c) return res.status(404).json({ error: "Campaign not found" });

  const variants = await prisma.campaignVariant.findMany({
    where: { tenantId, campaignId: c.id },
  });
  if (variants.length < 2) {
    return res.status(400).json({ error: "Need at least 2 variants to pick a winner" });
  }

  let winner = null as (typeof variants)[number] | null;
  if (bodyParsed.data.variantId) {
    winner = variants.find((v) => v.id === bodyParsed.data.variantId) ?? null;
    if (!winner) return res.status(400).json({ error: "variantId does not belong to this campaign" });
  } else {
    // Highest metric-rate wins. Ties broken by higher totalSent (more data),
    // then by variantKey (stable).
    winner = [...variants]
      .filter((v) => v.totalSent > 0)
      .sort((a, b) => {
        const aRate =
          metric === "click" ? a.totalClicked / a.totalSent : a.totalOpened / a.totalSent;
        const bRate =
          metric === "click" ? b.totalClicked / b.totalSent : b.totalOpened / b.totalSent;
        if (bRate !== aRate) return bRate - aRate;
        if (b.totalSent !== a.totalSent) return b.totalSent - a.totalSent;
        return a.variantKey.localeCompare(b.variantKey);
      })[0] ?? null;
    if (!winner) return res.status(400).json({ error: "No variant has any sends yet" });
  }

  await prisma.$transaction([
    prisma.campaignVariant.updateMany({
      where: { tenantId, campaignId: c.id, isWinner: true, NOT: { id: winner.id } },
      data: { isWinner: false },
    }),
    prisma.campaignVariant.update({
      where: { id: winner.id },
      data: { isWinner: true },
    }),
  ]);

  const refreshed = await prisma.campaignVariant.findMany({
    where: { tenantId, campaignId: c.id },
    orderBy: { variantKey: "asc" },
  });
  res.json({ winnerId: winner.id, winnerKey: winner.variantKey, metric, variants: refreshed });
});

// Small inline helper for the transaction-side validation errors so the
// caller sees a clean 400/409/etc. rather than a raw stack trace.
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
