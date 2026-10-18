// Desk SLA breach detection — walks Open/InProgress tickets whose SLA due
// date has passed and flips the breached flags. UI reads those flags to
// highlight overdue tickets in red. Notifications + auto-escalation
// (bumping priority, reassigning to a manager) can layer on top later.

import { prisma } from "@lumaara/db";

export interface DeskSlaResult {
  checked: number;
  firstResponseBreached: number;
  resolutionBreached: number;
}

export async function runDeskSlaCheck(): Promise<DeskSlaResult> {
  const now = new Date();
  const openStatuses = ["New", "Open", "InProgress"];

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
