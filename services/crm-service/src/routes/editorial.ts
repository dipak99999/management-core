import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Marketing P3: EditorialNote CRUD + unified content calendar feed.
//
// EditorialNote is a lightweight "planned content" pin on the calendar — a
// title + notes + plannedFor + channel(s). When it's ready to become a real
// campaign / broadcast / social post, /convert seeds the underlying doc and
// stamps the note with convertedToDoctype+DocId so the UI can jump to it.
//
// `GET /editorial/calendar` merges EditorialNote rows with everything else
// that's date-scheduled: Campaign.scheduledFor, Broadcast.scheduledFor,
// SocialPost.scheduledFor, WhatsappMessage.scheduledFor (marketing-linked
// only), WebinarEvent.startAt. Returns a normalized shape sorted by date.

export const editorialRouter = Router();
const p = perms("EditorialNote");

// ── Health ────────────────────────────────────────────────────────────
editorialRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "editorial" });
});

// ── Channel + status vocabularies ──────────────────────────────────────
const CHANNELS = ["Email", "SocialPost", "WhatsApp", "SMS"] as const;
const STATUSES = [
  "Idea",
  "Planned",
  "InProgress",
  "Ready",
  "Done",
  "Cancelled",
] as const;

const upsertSchema = z.object({
  title: z.string().min(1).max(240),
  notes: z.string().max(20_000).nullable().optional(),
  plannedFor: z.string().datetime(),
  channels: z.array(z.enum(CHANNELS)).default([]),
  status: z.enum(STATUSES).default("Idea"),
  ownerUserId: z.string().min(1).nullable().optional(),
  colorTag: z.string().max(32).nullable().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  notes: z.string().max(20_000).nullable().optional(),
  plannedFor: z.string().datetime().optional(),
  channels: z.array(z.enum(CHANNELS)).optional(),
  status: z.enum(STATUSES).optional(),
  ownerUserId: z.string().min(1).nullable().optional(),
  colorTag: z.string().max(32).nullable().optional(),
});

// ── List with filters ─────────────────────────────────────────────────
editorialRouter.get("/notes", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const channel = typeof req.query.channel === "string" ? req.query.channel : null;
  const owner = typeof req.query.owner === "string" ? req.query.owner : null;

  const where: Record<string, unknown> = { tenantId };
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from && !isNaN(from.valueOf())) range.gte = from;
    if (to && !isNaN(to.valueOf())) range.lte = to;
    if (Object.keys(range).length > 0) where.plannedFor = range;
  }
  if (status) where.status = status;
  if (owner) where.ownerUserId = owner;
  // channels: String[] — Postgres array-has via Prisma `has`.
  if (channel) where.channels = { has: channel };

  const rows = await prisma.editorialNote.findMany({
    where,
    orderBy: { plannedFor: "asc" },
    take: 500,
  });
  res.json(rows);
});

editorialRouter.get("/notes/:id", p.read, async (req, res) => {
  const row = await prisma.editorialNote.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// ── Create ────────────────────────────────────────────────────────────
editorialRouter.post("/notes", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.editorialNote.create({
    data: {
      tenantId: req.auth!.tenantId,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      plannedFor: new Date(parsed.data.plannedFor),
      channels: parsed.data.channels,
      status: parsed.data.status,
      ownerUserId: parsed.data.ownerUserId ?? req.auth!.userId ?? null,
      colorTag: parsed.data.colorTag ?? null,
    },
  });
  res.status(201).json(row);
});

// ── Patch ─────────────────────────────────────────────────────────────
editorialRouter.patch("/notes/:id", p.write, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.editorialNote.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.editorialNote.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.plannedFor !== undefined
        ? { plannedFor: new Date(parsed.data.plannedFor) }
        : {}),
      ...(parsed.data.channels !== undefined ? { channels: parsed.data.channels } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.ownerUserId !== undefined
        ? { ownerUserId: parsed.data.ownerUserId }
        : {}),
      ...(parsed.data.colorTag !== undefined ? { colorTag: parsed.data.colorTag } : {}),
    },
  });
  res.json(row);
});

// ── Delete ────────────────────────────────────────────────────────────
editorialRouter.delete("/notes/:id", p.delete, async (req, res) => {
  const existing = await prisma.editorialNote.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.editorialNote.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ── Convert to Campaign/Broadcast/SocialPost ──────────────────────────
//
// Seeds the underlying doc with the note's title + notes body (best-effort),
// stamps the note with convertedToDoctype/DocId + status="Done", and returns
// { note, doc } so the UI can offer a jump-to link.
const convertSchema = z.object({
  doctype: z.enum(["Campaign", "Broadcast", "SocialPost"]),
  // Free-form seed overrides — merged into the create payload per doctype.
  seed: z.record(z.unknown()).optional(),
});

editorialRouter.post("/notes/:id/convert", p.write, async (req, res) => {
  const parsed = convertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const note = await prisma.editorialNote.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!note) return res.status(404).json({ error: "Not found" });
  if (note.convertedToDoctype && note.convertedToDocId) {
    return res.status(409).json({
      error: `Already converted to ${note.convertedToDoctype}`,
      doctype: note.convertedToDoctype,
      docId: note.convertedToDocId,
    });
  }

  const seed = parsed.data.seed ?? {};
  let docId: string;
  let doc: unknown;

  try {
    if (parsed.data.doctype === "Campaign") {
      const created = await prisma.campaign.create({
        data: {
          tenantId,
          name: (seed.name as string) ?? note.title,
          description: (seed.description as string | undefined) ?? note.notes ?? null,
          status: "Draft",
          channel: "Email",
          subject: (seed.subject as string | undefined) ?? note.title,
          bodyHtml: (seed.bodyHtml as string | undefined) ?? note.notes ?? "",
          scheduledFor: note.plannedFor,
        },
      });
      docId = created.id;
      doc = created;
    } else if (parsed.data.doctype === "Broadcast") {
      const created = await prisma.broadcast.create({
        data: {
          tenantId,
          name: (seed.name as string) ?? note.title,
          subject: (seed.subject as string | undefined) ?? note.title,
          body: (seed.body as string | undefined) ?? note.notes ?? "",
          audience: (seed.audience as string | undefined) ?? "Customers",
          status: "Draft",
          scheduledFor: note.plannedFor,
        },
      });
      docId = created.id;
      doc = created;
    } else {
      // SocialPost
      const created = await prisma.socialPost.create({
        data: {
          tenantId,
          authorUserId: req.auth!.userId ?? "system",
          content: (seed.content as string | undefined) ?? note.notes ?? note.title,
          mediaUrls: (seed.mediaUrls as string[] | undefined) ?? [],
          linkUrl: (seed.linkUrl as string | undefined) ?? null,
          channelIds: (seed.channelIds as string[] | undefined) ?? [],
          status: "Draft",
          scheduledFor: note.plannedFor,
        },
      });
      docId = created.id;
      doc = created;
    }
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to create underlying document",
    });
  }

  const updatedNote = await prisma.editorialNote.update({
    where: { id: note.id },
    data: {
      convertedToDoctype: parsed.data.doctype,
      convertedToDocId: docId,
      status: "Done",
    },
  });
  res.json({ note: updatedNote, doc });
});

// ── Unified content calendar feed ─────────────────────────────────────
//
// Merges rows from every date-scheduled marketing model into one shape:
//   { id, kind, title, plannedFor, status, channels, colorTag?, href }
// sorted ASC by plannedFor. Each source is queried independently and failures
// on individual queries degrade to an empty list (so a schema drift in one
// place doesn't nuke the whole calendar view).

type CalendarKind =
  | "note"
  | "campaign"
  | "broadcast"
  | "social"
  | "whatsapp"
  | "webinar";

interface CalendarItem {
  id: string;
  kind: CalendarKind;
  title: string;
  plannedFor: string; // ISO
  status: string;
  channels: string[];
  colorTag?: string;
  href: string;
}

editorialRouter.get("/calendar", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const start = typeof req.query.start === "string" ? new Date(req.query.start) : null;
  const end = typeof req.query.end === "string" ? new Date(req.query.end) : null;
  if (!start || isNaN(start.valueOf()) || !end || isNaN(end.valueOf())) {
    return res
      .status(400)
      .json({ error: "start and end query params (ISO datetimes) are required" });
  }

  // Each source guarded — one broken source doesn't break the whole feed.
  const safe = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch {
      return [];
    }
  };

  const [notes, campaigns, broadcasts, socialPosts, whatsapps, webinars] =
    await Promise.all([
      safe(() =>
        prisma.editorialNote.findMany({
          where: {
            tenantId,
            plannedFor: { gte: start, lte: end },
          },
          orderBy: { plannedFor: "asc" },
          take: 500,
        }),
      ),
      safe(() =>
        prisma.campaign.findMany({
          where: {
            tenantId,
            scheduledFor: { gte: start, lte: end },
          },
          select: {
            id: true,
            name: true,
            status: true,
            channel: true,
            scheduledFor: true,
          },
          orderBy: { scheduledFor: "asc" },
          take: 500,
        }),
      ),
      safe(() =>
        prisma.broadcast.findMany({
          where: {
            tenantId,
            scheduledFor: { gte: start, lte: end },
          },
          select: {
            id: true,
            name: true,
            subject: true,
            status: true,
            scheduledFor: true,
          },
          orderBy: { scheduledFor: "asc" },
          take: 500,
        }),
      ),
      safe(() =>
        prisma.socialPost.findMany({
          where: {
            tenantId,
            scheduledFor: { gte: start, lte: end },
          },
          select: {
            id: true,
            content: true,
            status: true,
            scheduledFor: true,
          },
          orderBy: { scheduledFor: "asc" },
          take: 500,
        }),
      ),
      safe(() =>
        prisma.whatsappMessage.findMany({
          where: {
            tenantId,
            scheduledFor: { gte: start, lte: end },
            // Only marketing-linked WA messages show up on the calendar; the
            // one-off transactional ones would drown the view.
            linkedDoctype: { not: null },
          },
          select: {
            id: true,
            body: true,
            status: true,
            scheduledFor: true,
            linkedDoctype: true,
            linkedId: true,
          },
          orderBy: { scheduledFor: "asc" },
          take: 500,
        }),
      ),
      safe(() =>
        prisma.webinarEvent.findMany({
          where: {
            tenantId,
            startAt: { gte: start, lte: end },
          },
          select: {
            id: true,
            name: true,
            status: true,
            startAt: true,
          },
          orderBy: { startAt: "asc" },
          take: 500,
        }),
      ),
    ]);

  const items: CalendarItem[] = [];

  for (const n of notes) {
    items.push({
      id: `note:${n.id}`,
      kind: "note",
      title: n.title,
      plannedFor: n.plannedFor.toISOString(),
      status: n.status,
      channels: n.channels ?? [],
      colorTag: n.colorTag ?? undefined,
      href: `/admin/marketing/calendar?note=${n.id}`,
    });
  }
  for (const c of campaigns) {
    if (!c.scheduledFor) continue;
    items.push({
      id: `campaign:${c.id}`,
      kind: "campaign",
      title: c.name,
      plannedFor: c.scheduledFor.toISOString(),
      status: c.status,
      channels: [c.channel ?? "Email"],
      href: `/crm/campaigns/${c.id}`,
    });
  }
  for (const b of broadcasts) {
    if (!b.scheduledFor) continue;
    items.push({
      id: `broadcast:${b.id}`,
      kind: "broadcast",
      title: b.name || b.subject,
      plannedFor: b.scheduledFor.toISOString(),
      status: b.status,
      channels: ["Email"],
      href: `/admin/broadcasts/${b.id}`,
    });
  }
  for (const s of socialPosts) {
    if (!s.scheduledFor) continue;
    items.push({
      id: `social:${s.id}`,
      kind: "social",
      title: s.content.slice(0, 80),
      plannedFor: s.scheduledFor.toISOString(),
      status: s.status,
      channels: ["SocialPost"],
      href: `/crm/social/${s.id}`,
    });
  }
  for (const w of whatsapps) {
    if (!w.scheduledFor) continue;
    items.push({
      id: `whatsapp:${w.id}`,
      kind: "whatsapp",
      title: w.body.slice(0, 80),
      plannedFor: w.scheduledFor.toISOString(),
      status: w.status,
      channels: ["WhatsApp"],
      href: w.linkedDoctype && w.linkedId
        ? `/crm/${w.linkedDoctype.toLowerCase()}/${w.linkedId}`
        : `/admin/marketing/calendar`,
    });
  }
  for (const wb of webinars) {
    items.push({
      id: `webinar:${wb.id}`,
      kind: "webinar",
      title: wb.name,
      plannedFor: wb.startAt.toISOString(),
      status: wb.status,
      channels: ["Webinar"],
      href: `/admin/marketing/webinars/${wb.id}`,
    });
  }

  items.sort((a, b) => a.plannedFor.localeCompare(b.plannedFor));
  res.json(items);
});
