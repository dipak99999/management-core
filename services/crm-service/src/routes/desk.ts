import { Router } from "express";
import { z } from "zod";
import { prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Zoho-Desk-style helpdesk. One router serves the whole surface:
//
//   Tickets:
//     GET  /desk/tickets                       list (filter by status/priority/assignee/mine)
//     GET  /desk/tickets/:id                   detail + replies + time entries
//     POST /desk/tickets                       create (auto-assigns via rules)
//     PUT  /desk/tickets/:id                   patch fields
//     POST /desk/tickets/:id/reply             body: { body, direction: Public|Private, cannedResponseId? }
//     POST /desk/tickets/:id/assign            body: { assigneeUserId }
//     POST /desk/tickets/:id/set-status        body: { status }
//     POST /desk/tickets/:id/log-time          body: { minutes, notes?, billable? }
//     POST /desk/tickets/:id/rate              (public) body: { score, comment? }
//     GET  /desk/tickets/stats                 counts for kanban badges
//
//   SLA policies:
//     GET  /desk/sla-policies                  list
//     POST /desk/sla-policies                  create
//     PUT  /desk/sla-policies/:id              update
//     DELETE /desk/sla-policies/:id
//
//   Assignment rules:
//     GET  /desk/assignment-rules
//     POST /desk/assignment-rules
//     PUT  /desk/assignment-rules/:id
//     DELETE /desk/assignment-rules/:id
//
//   Canned responses:
//     GET  /desk/canned-responses
//     POST /desk/canned-responses
//     PUT  /desk/canned-responses/:id
//     DELETE /desk/canned-responses/:id

export const deskRouter = Router();
const p = perms("DeskTicket");
const pSla = perms("DeskSlaPolicy");
const pRule = perms("DeskAssignmentRule");
const pCanned = perms("DeskCannedResponse");

// ─── SLA helpers ──────────────────────────────────────────────────────

interface SlaRule {
  priority: "Low" | "Medium" | "High" | "Urgent";
  firstResponseMins: number;
  resolutionMins: number;
}

async function pickSlaPolicy(tenantId: string): Promise<{
  id: string;
  rulesJson: SlaRule[];
} | null> {
  const p = await prisma.deskSlaPolicy.findFirst({
    where: { tenantId, isDefault: true },
  });
  if (!p) return null;
  return { id: p.id, rulesJson: p.rulesJson as unknown as SlaRule[] };
}

function computeSlaDates(
  rules: SlaRule[],
  priority: string,
  createdAt: Date,
): { firstResponseDueAt: Date | null; resolutionDueAt: Date | null } {
  const r = rules.find((x) => x.priority === priority);
  if (!r) return { firstResponseDueAt: null, resolutionDueAt: null };
  const first = new Date(createdAt);
  first.setMinutes(first.getMinutes() + r.firstResponseMins);
  const resolve = new Date(createdAt);
  resolve.setMinutes(resolve.getMinutes() + r.resolutionMins);
  return { firstResponseDueAt: first, resolutionDueAt: resolve };
}

// ─── Assignment ───────────────────────────────────────────────────────

async function pickAssignee(
  tenantId: string,
  ticket: { channel: string; priority: string; type: string },
): Promise<string | null> {
  const rules = await prisma.deskAssignmentRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  for (const rule of rules) {
    const cond = (rule.matchConditions ?? {}) as {
      channel?: string[];
      priority?: string[];
      type?: string[];
    };
    if (cond.channel  && cond.channel.length  && !cond.channel.includes(ticket.channel))  continue;
    if (cond.priority && cond.priority.length && !cond.priority.includes(ticket.priority)) continue;
    if (cond.type     && cond.type.length     && !cond.type.includes(ticket.type))         continue;
    if (rule.agentUserIds.length === 0) continue;

    if (rule.ruleType === "LoadBalanced") {
      const openCounts = await Promise.all(
        rule.agentUserIds.map(async (uid) => ({
          uid,
          n: await prisma.deskTicket.count({
            where: {
              tenantId,
              assigneeUserId: uid,
              status: { in: ["New", "Open", "InProgress"] },
            },
          }),
        })),
      );
      openCounts.sort((a, b) => a.n - b.n);
      return openCounts[0]!.uid;
    }
    // Round-robin
    const next = rule.rrCursor % rule.agentUserIds.length;
    await prisma.deskAssignmentRule.update({
      where: { id: rule.id },
      data: { rrCursor: (next + 1) % rule.agentUserIds.length },
    });
    return rule.agentUserIds[next]!;
  }
  return null;
}

// ─── Ticket routes ────────────────────────────────────────────────────

const ticketCreate = z.object({
  subject: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).default("Medium"),
  type: z.enum(["Question", "Problem", "FeatureRequest", "Incident", "Task"]).default("Question"),
  channel: z.enum(["Email", "Portal", "Chat", "Phone", "Manual", "API"]).default("Manual"),
  requesterEmail: z.string().email().nullable().optional(),
  requesterName: z.string().nullable().optional(),
  requesterPhone: z.string().nullable().optional(),
  linkedCustomerId: z.string().nullable().optional(),
  linkedLeadId: z.string().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

const ticketUpdate = ticketCreate.partial().extend({
  status: z.enum(["New", "Open", "InProgress", "OnHold", "Resolved", "Closed"]).optional(),
});

deskRouter.get("/tickets", p.read, async (req, res) => {
  const {
    status, priority, assigneeUserId, mine, search, limit,
  } = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = { tenantId: req.auth!.tenantId };
  if (status)          where.status = status;
  if (priority)        where.priority = priority;
  if (assigneeUserId)  where.assigneeUserId = assigneeUserId;
  if (mine === "1")    where.assigneeUserId = req.auth!.userId;
  if (search) {
    where.OR = [
      { subject: { contains: search, mode: "insensitive" } },
      { requesterName: { contains: search, mode: "insensitive" } },
      { requesterEmail: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.deskTicket.findMany({
    where,
    include: { _count: { select: { replies: true } } },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: Math.min(Number(limit) || 100, 500),
  });
  res.json(rows);
});

deskRouter.get("/tickets/stats", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [newCount, open, inProgress, onHold, resolved, closed, mine, breachedResp, breachedRes] = await Promise.all([
    prisma.deskTicket.count({ where: { tenantId, status: "New" } }),
    prisma.deskTicket.count({ where: { tenantId, status: "Open" } }),
    prisma.deskTicket.count({ where: { tenantId, status: "InProgress" } }),
    prisma.deskTicket.count({ where: { tenantId, status: "OnHold" } }),
    prisma.deskTicket.count({ where: { tenantId, status: "Resolved" } }),
    prisma.deskTicket.count({ where: { tenantId, status: "Closed" } }),
    prisma.deskTicket.count({
      where: { tenantId, assigneeUserId: req.auth!.userId, status: { in: ["New", "Open", "InProgress"] } },
    }),
    prisma.deskTicket.count({ where: { tenantId, slaFirstResponseBreached: true, status: { not: "Closed" } } }),
    prisma.deskTicket.count({ where: { tenantId, slaResolutionBreached: true, status: { not: "Closed" } } }),
  ]);
  res.json({
    new: newCount, open, inProgress, onHold, resolved, closed,
    mine, breachedFirstResponse: breachedResp, breachedResolution: breachedRes,
  });
});

deskRouter.get("/tickets/:id", p.read, async (req, res) => {
  const t = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      slaPolicy: { select: { id: true, name: true } },
      replies: { orderBy: { createdAt: "asc" } },
      timeEntries: { orderBy: { startedAt: "desc" } },
      csatRating: true,
    },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  res.json(t);
});

deskRouter.post("/tickets", p.create, async (req, res) => {
  const parsed = ticketCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;

  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "TKT-");
  const now = new Date();
  const sla = await pickSlaPolicy(tenantId);
  const dates = sla
    ? computeSlaDates(sla.rulesJson, data.priority, now)
    : { firstResponseDueAt: null, resolutionDueAt: null };
  const assignee = data.assigneeUserId
    ?? (await pickAssignee(tenantId, {
      channel: data.channel,
      priority: data.priority,
      type: data.type,
    }));

  const ticket = await prisma.deskTicket.create({
    data: {
      tenantId,
      name,
      subject: data.subject,
      description: data.description ?? null,
      priority: data.priority,
      type: data.type,
      channel: data.channel,
      status: assignee ? "Open" : "New",
      requesterEmail: data.requesterEmail ?? null,
      requesterName: data.requesterName ?? null,
      requesterPhone: data.requesterPhone ?? null,
      linkedCustomerId: data.linkedCustomerId ?? null,
      linkedLeadId: data.linkedLeadId ?? null,
      assigneeUserId: assignee,
      slaPolicyId: sla?.id ?? null,
      firstResponseDueAt: dates.firstResponseDueAt,
      resolutionDueAt: dates.resolutionDueAt,
      tags: data.tags ?? [],
    },
  });

  // Module 54 — fire AI triage in the background. Non-blocking so
  // ticket creation stays fast; suggestion appears when the ticket
  // is opened. Swallows errors so a broken LLM provider never
  // fails ticket creation.
  void triageTicketBackground(tenantId, ticket.id).catch(() => {});

  res.status(201).json(ticket);
});

async function triageTicketBackground(tenantId: string, ticketId: string): Promise<void> {
  const { pickProvider, stubProvider, triageTicketFromLLM, shouldAutoApply } = await import("@lumaara/db");

  const ticket = await prisma.deskTicket.findFirst({
    where: { id: ticketId, tenantId },
    select: { id: true, subject: true, description: true, priority: true, status: true },
  });
  if (!ticket) return;

  // Pull tenant's category list from distinct existing ticket types
  // (simple v1 — no separate Category doctype for desk yet).
  const categoryRows = await prisma.deskTicket.findMany({
    where: { tenantId },
    distinct: ["type"],
    select: { type: true },
    take: 20,
  });
  const categories = categoryRows.map((c) => c.type).filter(Boolean);

  // Grab up to 5 published KB articles as candidates. In a future
  // pass this would do a full-text pre-search on subject; for now
  // pass the top-viewed.
  const articles = await prisma.kBArticle.findMany({
    where: { tenantId, status: "Published" },
    orderBy: { viewCount: "desc" },
    take: 5,
    select: { slug: true, title: true, tags: true },
  });

  // v1: stub provider only. Real providers wire in through
  // TenantIntegration (see ai-extract.ts for the pattern).
  const provider = pickProvider({ stub: stubProvider });

  const started = Date.now();
  try {
    const r = await triageTicketFromLLM({
      provider,
      subject: ticket.subject,
      body: ticket.description ?? "",
      categories,
      candidateArticles: articles,
    });

    // Map article slugs → ids for the suggestion row.
    const matchingIds =
      r.parsed.matchingArticleSlugs.length > 0
        ? (
            await prisma.kBArticle.findMany({
              where: { tenantId, slug: { in: r.parsed.matchingArticleSlugs } },
              select: { id: true },
            })
          ).map((a) => a.id)
        : [];

    const autoApply = shouldAutoApply(r.parsed);

    await prisma.$transaction(async (tx) => {
      await tx.aITicketSuggestion.upsert({
        where: { ticketId },
        create: {
          tenantId,
          ticketId,
          suggestedPriority: r.parsed.priority,
          suggestedCategory: r.parsed.category,
          matchingArticleIds: matchingIds,
          suggestedResponse: r.parsed.suggestedResponse,
          confidence: Math.round(r.parsed.confidence),
          autoApplied: autoApply,
          provider: r.provider,
          model: r.model,
          inputTokens: Math.round(r.inputTokens),
          outputTokens: Math.round(r.outputTokens),
          latencyMs: Date.now() - started,
        },
        update: {
          suggestedPriority: r.parsed.priority,
          suggestedCategory: r.parsed.category,
          matchingArticleIds: matchingIds,
          suggestedResponse: r.parsed.suggestedResponse,
          confidence: Math.round(r.parsed.confidence),
          autoApplied: autoApply,
        },
      });
      if (autoApply) {
        await tx.deskTicket.update({
          where: { id: ticketId },
          data: {
            priority: r.parsed.priority,
            ...(r.parsed.category ? { type: r.parsed.category } : {}),
          },
        });
      }
    });
  } catch {
    // Swallow — background job. Persist a placeholder so the UI
    // can render "triage attempted but no suggestion available".
    await prisma.aITicketSuggestion.upsert({
      where: { ticketId },
      create: {
        tenantId,
        ticketId,
        confidence: 0,
        autoApplied: false,
        provider: provider.name,
      },
      update: { confidence: 0 },
    });
  }
}

deskRouter.put("/tickets/:id", p.write, async (req, res) => {
  const parsed = ticketUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data = parsed.data;

  const updated = await prisma.deskTicket.update({
    where: { id: existing.id },
    data: {
      subject: data.subject ?? existing.subject,
      description: data.description === undefined ? existing.description : data.description,
      priority: data.priority ?? existing.priority,
      type: data.type ?? existing.type,
      channel: data.channel ?? existing.channel,
      status: data.status ?? existing.status,
      assigneeUserId: data.assigneeUserId === undefined ? existing.assigneeUserId : data.assigneeUserId,
      requesterEmail: data.requesterEmail === undefined ? existing.requesterEmail : data.requesterEmail,
      requesterName:  data.requesterName === undefined  ? existing.requesterName  : data.requesterName,
      requesterPhone: data.requesterPhone === undefined ? existing.requesterPhone : data.requesterPhone,
      tags: data.tags ?? existing.tags,
      ...(data.status === "Resolved" && !existing.resolvedAt && { resolvedAt: new Date() }),
      ...(data.status === "Closed"   && !existing.closedAt   && { closedAt:   new Date() }),
      ...(data.status === "OnHold"   && !existing.onHoldAt   && { onHoldAt:   new Date() }),
    },
  });
  res.json(updated);
});

deskRouter.post("/tickets/:id/reply", p.write, async (req, res) => {
  const parsed = z
    .object({
      body: z.string().min(1),
      direction: z.enum(["Public", "Private"]).default("Public"),
      cannedResponseId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const t = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!t) return res.status(404).json({ error: "Not found" });

  const reply = await prisma.deskTicketReply.create({
    data: {
      ticketId: t.id,
      direction: parsed.data.direction,
      authorType: "Agent",
      authorUserId: req.auth!.userId,
      authorName: req.auth!.email,
      body: parsed.data.body,
    },
  });
  // First public reply → stamp firstResponseAt.
  if (parsed.data.direction === "Public" && !t.firstResponseAt) {
    await prisma.deskTicket.update({
      where: { id: t.id },
      data: { firstResponseAt: new Date(), status: t.status === "New" ? "Open" : t.status },
    });
  }
  if (parsed.data.cannedResponseId) {
    await prisma.deskCannedResponse.updateMany({
      where: { id: parsed.data.cannedResponseId, tenantId: req.auth!.tenantId },
      data: { usageCount: { increment: 1 } },
    });
  }
  res.status(201).json(reply);
});

deskRouter.post("/tickets/:id/assign", p.write, async (req, res) => {
  const parsed = z.object({ assigneeUserId: z.string().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "assigneeUserId required" });
  const t = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.deskTicket.update({
    where: { id: t.id },
    data: {
      assigneeUserId: parsed.data.assigneeUserId,
      status: parsed.data.assigneeUserId && t.status === "New" ? "Open" : t.status,
    },
  });
  res.json(updated);
});

deskRouter.post("/tickets/:id/set-status", p.write, async (req, res) => {
  const parsed = z.object({
    status: z.enum(["New", "Open", "InProgress", "OnHold", "Resolved", "Closed"]),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "status required" });
  const t = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  const now = new Date();
  const updated = await prisma.deskTicket.update({
    where: { id: t.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "Resolved" && !t.resolvedAt && { resolvedAt: now }),
      ...(parsed.data.status === "Closed"   && !t.closedAt   && { closedAt: now }),
      ...(parsed.data.status === "OnHold"   && !t.onHoldAt   && { onHoldAt: now }),
    },
  });
  res.json(updated);
});

deskRouter.post("/tickets/:id/log-time", p.write, async (req, res) => {
  const parsed = z
    .object({
      minutes: z.number().int().positive(),
      notes: z.string().nullable().optional(),
      billable: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const t = await prisma.deskTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  const entry = await prisma.deskTimeEntry.create({
    data: {
      ticketId: t.id,
      userId: req.auth!.userId,
      minutes: parsed.data.minutes,
      notes: parsed.data.notes ?? null,
      billable: parsed.data.billable ?? false,
    },
  });
  res.status(201).json(entry);
});

deskRouter.post("/tickets/:id/rate", async (req, res) => {
  // Public CSAT endpoint — no auth. Ticket id + score submitted from the
  // one-time link in the resolution email.
  const parsed = z
    .object({
      score: z.number().int().min(1).max(5),
      comment: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const t = await prisma.deskTicket.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!t) return res.status(404).json({ error: "Not found" });
  const rating = await prisma.deskCsatRating.upsert({
    where: { ticketId: t.id },
    create: { ticketId: t.id, score: parsed.data.score, comment: parsed.data.comment ?? null },
    update: { score: parsed.data.score, comment: parsed.data.comment ?? null },
  });
  res.json(rating);
});

// ─── SLA policies ────────────────────────────────────────────────────

const slaSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  businessHoursOnly: z.boolean().optional(),
  rulesJson: z
    .array(
      z.object({
        priority: z.enum(["Low", "Medium", "High", "Urgent"]),
        firstResponseMins: z.number().int().positive(),
        resolutionMins: z.number().int().positive(),
      }),
    )
    .min(1),
});

deskRouter.get("/sla-policies", pSla.read, async (req, res) => {
  const rows = await prisma.deskSlaPolicy.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  res.json(rows);
});

deskRouter.post("/sla-policies", pSla.create, async (req, res) => {
  const parsed = slaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // If setting isDefault, clear the flag on all others.
  if (parsed.data.isDefault) {
    await prisma.deskSlaPolicy.updateMany({
      where: { tenantId: req.auth!.tenantId },
      data: { isDefault: false },
    });
  }
  const row = await prisma.deskSlaPolicy.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isDefault: parsed.data.isDefault ?? false,
      businessHoursOnly: parsed.data.businessHoursOnly ?? false,
      rulesJson: parsed.data.rulesJson,
    },
  });
  res.status(201).json(row);
});

deskRouter.put("/sla-policies/:id", pSla.write, async (req, res) => {
  const parsed = slaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.deskSlaPolicy.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.isDefault) {
    await prisma.deskSlaPolicy.updateMany({
      where: { tenantId: req.auth!.tenantId, NOT: { id: existing.id } },
      data: { isDefault: false },
    });
  }
  const row = await prisma.deskSlaPolicy.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isDefault: parsed.data.isDefault ?? existing.isDefault,
      businessHoursOnly: parsed.data.businessHoursOnly ?? existing.businessHoursOnly,
      rulesJson: parsed.data.rulesJson,
    },
  });
  res.json(row);
});

deskRouter.delete("/sla-policies/:id", pSla.delete, async (req, res) => {
  await prisma.deskSlaPolicy.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ─── Assignment rules ────────────────────────────────────────────────

const ruleSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional(),
  ruleType: z.enum(["RoundRobin", "LoadBalanced"]).default("RoundRobin"),
  agentUserIds: z.array(z.string()).min(1),
  matchConditions: z
    .object({
      channel: z.array(z.string()).optional(),
      priority: z.array(z.string()).optional(),
      type: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  priority: z.number().int().nonnegative().optional(),
});

deskRouter.get("/assignment-rules", pRule.read, async (req, res) => {
  const rows = await prisma.deskAssignmentRule.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
  });
  res.json(rows);
});

deskRouter.post("/assignment-rules", pRule.create, async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.deskAssignmentRule.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: parsed.data.name,
      isActive: parsed.data.isActive ?? true,
      ruleType: parsed.data.ruleType,
      agentUserIds: parsed.data.agentUserIds,
      matchConditions: parsed.data.matchConditions ?? undefined,
      priority: parsed.data.priority ?? 0,
    },
  });
  res.status(201).json(row);
});

deskRouter.put("/assignment-rules/:id", pRule.write, async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.deskAssignmentRule.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.deskAssignmentRule.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      isActive: parsed.data.isActive ?? existing.isActive,
      ruleType: parsed.data.ruleType,
      agentUserIds: parsed.data.agentUserIds,
      matchConditions: parsed.data.matchConditions ?? undefined,
      priority: parsed.data.priority ?? existing.priority,
    },
  });
  res.json(row);
});

deskRouter.delete("/assignment-rules/:id", pRule.delete, async (req, res) => {
  await prisma.deskAssignmentRule.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ─── Canned responses ────────────────────────────────────────────────

const cannedSchema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
});

deskRouter.get("/canned-responses", pCanned.read, async (req, res) => {
  const rows = await prisma.deskCannedResponse.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  res.json(rows);
});

deskRouter.post("/canned-responses", pCanned.create, async (req, res) => {
  const parsed = cannedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.deskCannedResponse.create({
    data: {
      tenantId: req.auth!.tenantId,
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
    },
  });
  res.status(201).json(row);
});

deskRouter.put("/canned-responses/:id", pCanned.write, async (req, res) => {
  const parsed = cannedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.deskCannedResponse.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.deskCannedResponse.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
    },
  });
  res.json(row);
});

deskRouter.delete("/canned-responses/:id", pCanned.delete, async (req, res) => {
  await prisma.deskCannedResponse.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

// ─── Scheduler tick — SLA breach detection ───────────────────────────

export async function runDeskSlaCheck(): Promise<{
  checked: number;
  firstResponseBreached: number;
  resolutionBreached: number;
}> {
  const now = new Date();
  // Only open-ish tickets can breach.
  const openStatuses = ["New", "Open", "InProgress"];

  // First-response breaches — no firstResponseAt yet, and due date passed.
  const firstDue = await prisma.deskTicket.findMany({
    where: {
      status: { in: openStatuses },
      firstResponseAt: null,
      firstResponseDueAt: { lte: now },
      slaFirstResponseBreached: false,
    },
    select: { id: true },
  });
  if (firstDue.length > 0) {
    await prisma.deskTicket.updateMany({
      where: { id: { in: firstDue.map((t) => t.id) } },
      data: { slaFirstResponseBreached: true },
    });
  }

  // Resolution breaches — not resolved and due date passed.
  const resDue = await prisma.deskTicket.findMany({
    where: {
      status: { in: openStatuses },
      resolvedAt: null,
      resolutionDueAt: { lte: now },
      slaResolutionBreached: false,
    },
    select: { id: true },
  });
  if (resDue.length > 0) {
    await prisma.deskTicket.updateMany({
      where: { id: { in: resDue.map((t) => t.id) } },
      data: { slaResolutionBreached: true },
    });
  }

  return {
    checked: firstDue.length + resDue.length,
    firstResponseBreached: firstDue.length,
    resolutionBreached: resDue.length,
  };
}

// ---------- Module 54 — AI ticket triage endpoints ----------

const pAi = perms("DeskTicket");

// Fetch the AI suggestion for a ticket (may be null while the
// background triage is in flight).
deskRouter.get("/tickets/:id/ai-suggestion", pAi.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const suggestion = await prisma.aITicketSuggestion.findFirst({
    where: { ticketId: req.params.id, tenantId },
  });
  res.json(suggestion);
});

// Manually accept: applies the suggested priority/category to the
// ticket. Used when the AI didn't cross the auto-apply threshold but
// the agent still wants to trust it.
deskRouter.post("/tickets/:id/ai-suggestion/accept", pAi.write, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const suggestion = await prisma.aITicketSuggestion.findFirst({
    where: { ticketId: req.params.id, tenantId },
  });
  if (!suggestion) return res.status(404).json({ error: "No suggestion" });
  if (suggestion.autoApplied) return res.status(400).json({ error: "Already applied" });

  await prisma.$transaction(async (tx) => {
    if (suggestion.suggestedPriority || suggestion.suggestedCategory) {
      await tx.deskTicket.update({
        where: { id: req.params.id },
        data: {
          ...(suggestion.suggestedPriority ? { priority: suggestion.suggestedPriority } : {}),
          ...(suggestion.suggestedCategory ? { type: suggestion.suggestedCategory } : {}),
        },
      });
    }
    await tx.aITicketSuggestion.update({
      where: { id: suggestion.id },
      data: { autoApplied: true },
    });
  });
  res.json({ ok: true });
});
