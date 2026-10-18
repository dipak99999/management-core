import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// K7: Staff-side viewer for PortalTicket. Mirrors the portal endpoints from
// portal.ts K6 but scopes by tenantId only — support agents see every party's
// tickets. Replies go in with authorType="staff".

export const staffTicketRouter = Router();

const p = perms("PortalTicket");

staffTicketRouter.get("/", p.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const priority =
    typeof req.query.priority === "string" ? req.query.priority : undefined;
  const partyType =
    typeof req.query.partyType === "string" ? req.query.partyType : undefined;
  const rows = await prisma.portalTicket.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(partyType ? { partyType } : {}),
    },
    include: {
      _count: { select: { replies: true } },
      portalUser: { select: { email: true, displayName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

staffTicketRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.portalTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      replies: { orderBy: { createdAt: "asc" } },
      portalUser: { select: { email: true, displayName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

const replySchema = z.object({
  body: z.string().min(1).max(10_000),
  setStatus: z.enum(["Open", "Answered", "Closed"]).optional(),
});

staffTicketRouter.post("/:id/reply", p.write, async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ticket = await prisma.portalTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!ticket) return res.status(404).json({ error: "Not found" });
  const reply = await prisma.portalTicketReply.create({
    data: {
      portalTicketId: ticket.id,
      body: parsed.data.body,
      authorType: "staff",
      authorId: req.auth!.userId,
    },
  });
  await prisma.portalTicket.update({
    where: { id: ticket.id },
    // Default: staff reply → "Answered" (waiting on customer). Explicit
    // override via setStatus wins.
    data: { status: parsed.data.setStatus ?? "Answered" },
  });
  res.status(201).json(reply);
});

const statusSchema = z.object({
  status: z.enum(["Open", "Answered", "Closed"]),
});

staffTicketRouter.post("/:id/status", p.write, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ticket = await prisma.portalTicket.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!ticket) return res.status(404).json({ error: "Not found" });
  const row = await prisma.portalTicket.update({
    where: { id: ticket.id },
    data: { status: parsed.data.status },
  });
  res.json(row);
});
