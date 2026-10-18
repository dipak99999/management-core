import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

// F9: CommunicationLog. Read-only unified feed of outbound comms —
// EmailMessage + SmsMessage + Notification + Comment — filtered by a doc
// (linkedDoctype+linkedId) or by a party contact. Not a materialized model;
// composed at read-time from source tables.

export const communicationLogRouter = Router();
communicationLogRouter.use(requireAuth);

const p = perms("EmailMessage");

interface LogEntry {
  ts: string;
  channel: "email" | "sms" | "notification" | "comment";
  subject: string;
  body: string | null;
  status: string | null;
  to: string | null;
  id: string;
}

communicationLogRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const docId = typeof req.query.docId === "string" ? req.query.docId : undefined;
  const email = typeof req.query.email === "string" ? req.query.email : undefined;
  const mobile = typeof req.query.mobile === "string" ? req.query.mobile : undefined;

  const emailWhere =
    doctype && docId
      ? { tenantId, linkedDoctype: doctype, linkedId: docId }
      : email
        ? { tenantId, toEmail: email }
        : { tenantId };
  const smsWhere =
    doctype && docId
      ? { tenantId, linkedDoctype: doctype, linkedId: docId }
      : mobile
        ? { tenantId, toMobile: mobile }
        : { tenantId };

  const [emails, smses, notifications, comments] = await Promise.all([
    prisma.emailMessage.findMany({
      where: emailWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.smsMessage.findMany({
      where: smsWhere,
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    doctype && docId
      ? prisma.notification.findMany({
          where: { tenantId, doctype, docId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
    doctype && docId
      ? prisma.comment.findMany({
          where: { tenantId, doctype, docId },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  const entries: LogEntry[] = [
    ...emails.map((e) => ({
      ts: e.createdAt.toISOString(),
      channel: "email" as const,
      subject: e.subject,
      body: e.body,
      status: e.status,
      to: e.toEmail,
      id: e.id,
    })),
    ...smses.map((s) => ({
      ts: s.createdAt.toISOString(),
      channel: "sms" as const,
      subject: s.body.slice(0, 60),
      body: s.body,
      status: s.status,
      to: s.toMobile,
      id: s.id,
    })),
    ...notifications.map((n) => ({
      ts: n.createdAt.toISOString(),
      channel: "notification" as const,
      subject: n.subject,
      body: n.body,
      status: n.isRead ? "Read" : "Unread",
      to: n.userId,
      id: n.id,
    })),
    ...comments.map((c) => ({
      ts: c.createdAt.toISOString(),
      channel: "comment" as const,
      subject: `Comment by ${c.authorUserId}`,
      body: c.body,
      status: null,
      to: null,
      id: c.id,
    })),
  ];
  entries.sort((a, b) => b.ts.localeCompare(a.ts));
  res.json(entries.slice(0, 100));
});
