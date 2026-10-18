import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  compileSegment,
  evaluateSegment,
  countSegment,
  fireJourneyTrigger,
  SegmentError,
  type SegmentDoctype,
  type SegmentNode,
} from "@lumaara/db";
import { getLogger, perms } from "@lumaara/service-auth";

// Contact lists — the "segments" that email campaigns + sequences fan out
// to. Two shapes:
//
//   Static:  a manual bag of (contactType, contactId). Add/remove via API.
//            Good for VIPs, do-not-call lists, curated newsletter subs.
//
//   Dynamic: a saved filter resolved fresh at every send / enrollment. Good
//            for "all Enterprise customers", "leads from California", etc.
//
// PREFERRED filterJson shape (safe): `{doctype: "Customer"|"Lead", where:
// <segment-DSL-node>}` where `where` is the JSON grammar from
// `packages/db/src/segment.ts` (and/or/not/{field,op,value}). The DSL
// compiles to a Prisma WHERE with a whitelisted set of columns; no raw SQL,
// no unbounded field access.
//
// LEGACY filterJson shape (unsafe, deprecated): `{doctype, where:
// <PrismaWhereRaw>}` where `where` is a raw Prisma filter object that gets
// spread into `findMany`. Kept working for backwards compatibility with pre-P1
// lists but every hit logs a deprecation warning; migrate to the DSL.
//
// Membership is materialised in ContactListMember only for static lists.
// Dynamic lists are resolved on demand by the campaign send + sequence
// enrollment paths.
const log = getLogger("crm-service");

export const contactListRouter = Router();
const p = perms("Campaign"); // reuse Campaign perms — lists live under marketing

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isDynamic: z.boolean().default(false),
  filterJson: z
    .object({
      doctype: z.enum(["Customer", "Lead"]),
      where: z.record(z.any()).optional(),
    })
    .nullable()
    .optional(),
});

contactListRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.contactList.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

contactListRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

contactListRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  if (data.isDynamic && !data.filterJson)
    return res.status(400).json({ error: "Dynamic lists require filterJson" });
  try {
    const row = await prisma.contactList.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: data.name,
        description: data.description ?? null,
        isDynamic: data.isDynamic,
        filterJson: data.filterJson ?? undefined,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "List name already exists" });
    throw e;
  }
});

contactListRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.contactList.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isDynamic: parsed.data.isDynamic,
      filterJson: parsed.data.filterJson ?? undefined,
    },
  });
  res.json(row);
});

contactListRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.contactList.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ─── Membership (static lists only) ────────────────────────────────────

const memberSchema = z.object({
  contactType: z.enum(["Customer", "Lead"]),
  contactId: z.string().min(1),
});

// A DSL node has exactly one top-level key from {and, or, not, field}. Anything
// else — including a legacy Prisma raw filter like `{email: {contains: "@x"}}`
// — falls back to the deprecated pass-through path.
function isDslNode(where: unknown): where is SegmentNode {
  if (!where || typeof where !== "object" || Array.isArray(where)) return false;
  const keys = Object.keys(where as Record<string, unknown>);
  if (keys.length === 0) return false;
  if (keys.includes("and") || keys.includes("or") || keys.includes("not")) return true;
  // Leaf condition: must have both `field` and `op`.
  if (keys.includes("field") && keys.includes("op")) return true;
  return false;
}

contactListRouter.get("/:id/members", p.read, async (req, res) => {
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!list) return res.status(404).json({ error: "Not found" });

  if (list.isDynamic && list.filterJson) {
    // Resolve on the fly for preview.
    const f = list.filterJson as { doctype: string; where?: unknown };
    const doctype = f.doctype as SegmentDoctype;
    if (doctype !== "Customer" && doctype !== "Lead") return res.json([]);

    // Prefer the safe DSL path. Fall back to legacy raw-Prisma pass-through
    // (with a deprecation warning) when the saved filter predates P1.
    if (isDslNode(f.where)) {
      try {
        const rows = await evaluateSegment(prisma, req.auth!.tenantId, doctype, f.where, {
          limit: 500,
        });
        return res.json(
          rows.map((r) => ({
            contactType: doctype,
            contactId: r.id,
            name: r.name,
            email: r.email,
          })),
        );
      } catch (e) {
        if (e instanceof SegmentError) {
          return res.status(400).json({ error: e.message, code: e.code });
        }
        throw e;
      }
    }

    // Legacy pass-through — Prisma raw WHERE spread directly. Safe because
    // saved-filter authoring is admin-only, but we want it gone. Log per hit.
    log.warn("contact-list legacy raw filterJson resolved (please migrate to segment DSL)", {
      listId: list.id,
      tenantId: req.auth!.tenantId,
      doctype: f.doctype,
    });
    const rawWhere = (f.where ?? {}) as Record<string, unknown>;
    if (doctype === "Customer") {
      const rows = await prisma.customer.findMany({
        where: { tenantId: req.auth!.tenantId, ...rawWhere },
        select: { id: true, customerName: true, email: true },
        take: 500,
      });
      return res.json(
        rows.map((r) => ({
          contactType: "Customer",
          contactId: r.id,
          name: r.customerName,
          email: r.email,
        })),
      );
    }
    const rows = await prisma.lead.findMany({
      where: { tenantId: req.auth!.tenantId, ...rawWhere },
      select: { id: true, leadName: true, email: true },
      take: 500,
    });
    return res.json(
      rows.map((r) => ({
        contactType: "Lead",
        contactId: r.id,
        name: r.leadName,
        email: r.email,
      })),
    );
  }

  const members = await prisma.contactListMember.findMany({
    where: { listId: list.id },
    orderBy: { addedAt: "desc" },
    take: 500,
  });
  // Hydrate name+email so the UI doesn't need a second round-trip per row.
  const hydrated = await Promise.all(
    members.map(async (m) => {
      if (m.contactType === "Customer") {
        const c = await prisma.customer.findUnique({
          where: { id: m.contactId },
          select: { customerName: true, email: true },
        });
        return { ...m, name: c?.customerName ?? "?", email: c?.email ?? null };
      }
      if (m.contactType === "Lead") {
        const l = await prisma.lead.findUnique({
          where: { id: m.contactId },
          select: { leadName: true, email: true },
        });
        return { ...m, name: l?.leadName ?? "?", email: l?.email ?? null };
      }
      return { ...m, name: "?", email: null };
    }),
  );
  res.json(hydrated);
});

contactListRouter.post("/:id/add-member", p.write, async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!list) return res.status(404).json({ error: "Not found" });
  if (list.isDynamic) return res.status(400).json({ error: "Dynamic list — filter drives membership" });

  await prisma.contactListMember.upsert({
    where: {
      listId_contactType_contactId: {
        listId: list.id,
        contactType: parsed.data.contactType,
        contactId: parsed.data.contactId,
      },
    },
    create: { listId: list.id, contactType: parsed.data.contactType, contactId: parsed.data.contactId },
    update: {},
  });
  const memberCount = await prisma.contactListMember.count({ where: { listId: list.id } });
  await prisma.contactList.update({ where: { id: list.id }, data: { memberCount } });

  // Marketing P2 — fire ListAdd trigger. Look up any Active MarketingJourney
  // with triggerType=ListAdd + triggerConfig.listId matching this list and
  // create a JourneyEnrollment. Best-effort: any failure is logged but does
  // not fail the member-add flow.
  try {
    const contactType = parsed.data.contactType;
    let emailTo: string | null = null;
    let mobileTo: string | null = null;
    if (contactType === "Customer") {
      const c = await prisma.customer.findFirst({
        where: { id: parsed.data.contactId, tenantId: req.auth!.tenantId },
        select: { email: true, mobile: true },
      });
      emailTo = c?.email ?? null;
      mobileTo = c?.mobile ?? null;
    } else {
      const l = await prisma.lead.findFirst({
        where: { id: parsed.data.contactId, tenantId: req.auth!.tenantId },
        select: { email: true, mobile: true },
      });
      emailTo = l?.email ?? null;
      mobileTo = l?.mobile ?? null;
    }
    await fireJourneyTrigger(prisma, {
      tenantId: req.auth!.tenantId,
      triggerType: "ListAdd",
      match: { listId: list.id },
      contactType,
      contactId: parsed.data.contactId,
      emailTo,
      mobileTo,
    });
  } catch (e) {
    log.warn("fireJourneyTrigger(ListAdd) failed", {
      listId: list.id,
      err: e instanceof Error ? e : new Error(String(e)),
    });
  }

  res.json({ ok: true, memberCount });
});

contactListRouter.post("/:id/remove-member", p.write, async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.contactListMember.deleteMany({
    where: {
      listId: req.params.id,
      contactType: parsed.data.contactType,
      contactId: parsed.data.contactId,
    },
  });
  const memberCount = await prisma.contactListMember.count({ where: { listId: req.params.id } });
  await prisma.contactList.update({ where: { id: req.params.id }, data: { memberCount } });
  res.json({ ok: true, memberCount });
});

// Bulk add helpers — e.g. "all customers with territory = X". Server-side
// filter runs once and creates memberships in one shot.
contactListRouter.post("/:id/bulk-add", p.write, async (req, res) => {
  const parsed = z
    .object({
      contactType: z.enum(["Customer", "Lead"]),
      where: z.record(z.any()).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const list = await prisma.contactList.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!list) return res.status(404).json({ error: "Not found" });
  if (list.isDynamic) return res.status(400).json({ error: "Dynamic list — use the filter directly" });

  const rows =
    parsed.data.contactType === "Customer"
      ? await prisma.customer.findMany({
          where: { tenantId: req.auth!.tenantId, ...(parsed.data.where ?? {}) },
          select: { id: true },
        })
      : await prisma.lead.findMany({
          where: { tenantId: req.auth!.tenantId, ...(parsed.data.where ?? {}) },
          select: { id: true },
        });

  let added = 0;
  for (const r of rows) {
    const existing = await prisma.contactListMember.findUnique({
      where: {
        listId_contactType_contactId: {
          listId: list.id,
          contactType: parsed.data.contactType,
          contactId: r.id,
        },
      },
    });
    if (!existing) {
      await prisma.contactListMember.create({
        data: { listId: list.id, contactType: parsed.data.contactType, contactId: r.id },
      });
      added++;
    }
  }
  const memberCount = await prisma.contactListMember.count({ where: { listId: list.id } });
  await prisma.contactList.update({ where: { id: list.id }, data: { memberCount } });
  res.json({ ok: true, added, memberCount });
});

// ─── Segment DSL preview ──────────────────────────────────────────────
//
// POST /contact-lists/preview — backs the segment-builder UI. Body:
//   { doctype: "Customer"|"Lead", where: <segment-DSL-node> }
// Returns:
//   { count, sample: SegmentRow[] }  // sample = first 10 matching rows
//
// Nothing is persisted. The DSL compiles to a Prisma WHERE (see
// `packages/db/src/segment.ts`); invalid input → 400 with SegmentError code.

const previewSchema = z.object({
  doctype: z.enum(["Customer", "Lead"]),
  // `where` is a segment-DSL node; validated structurally by compileSegment.
  where: z.unknown(),
});

contactListRouter.post("/preview", p.read, async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const doctype = parsed.data.doctype as SegmentDoctype;
  const node = parsed.data.where as SegmentNode;
  try {
    // Compile once (throws on bad DSL) before hitting the DB twice.
    compileSegment(doctype, node, req.auth!.tenantId);
    const [count, sample] = await Promise.all([
      countSegment(prisma, req.auth!.tenantId, doctype, node),
      evaluateSegment(prisma, req.auth!.tenantId, doctype, node, { limit: 10 }),
    ]);
    res.json({ count, sample });
  } catch (e) {
    if (e instanceof SegmentError) {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    throw e;
  }
});
