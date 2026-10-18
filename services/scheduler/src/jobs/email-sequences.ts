// Email-sequence tick — walks Active enrollments whose nextSendAt is due,
// "sends" the current step, advances the pointer. Direct-DB path so the
// scheduler doesn't need HTTP auth wiring to reach crm-service.
//
// MVP send is "log as CrmActivity" — real SMTP hooks in when MailService is
// wired for outbound.

import { prisma } from "@lumaara/db";

export interface SequenceTickResult {
  processed: number;
  advanced: number;
  completed: number;
  errors: number;
}

export async function runEmailSequenceTick(): Promise<SequenceTickResult> {
  const now = new Date();
  const due = await prisma.sequenceEnrollment.findMany({
    where: { status: "Active", nextSendAt: { lte: now } },
    include: {
      sequence: {
        include: { steps: { orderBy: { stepOrder: "asc" } } },
      },
    },
    take: 500,
  });

  let advanced = 0;
  let completed = 0;
  let errors = 0;
  for (const e of due) {
    try {
      if (!e.sequence.isActive) continue;
      const steps = e.sequence.steps;
      const currentIdx = e.currentStep;
      if (currentIdx >= steps.length) {
        await prisma.sequenceEnrollment.update({
          where: { id: e.id },
          data: { status: "Completed" },
        });
        completed++;
        continue;
      }
      const step = steps[currentIdx]!;
      await prisma.crmActivity.create({
        data: {
          tenantId: e.tenantId,
          type: "Email",
          subject: `[Sequence: ${e.sequence.name}] ${step.subject}`,
          description: step.bodyHtml,
          parentType: e.contactType,
          parentId: e.contactId,
          status: "Completed",
          completedAt: now,
          emailTo: e.emailTo,
          ownerUserId: "system",
        },
      });
      const nextIdx = currentIdx + 1;
      if (nextIdx >= steps.length) {
        await prisma.sequenceEnrollment.update({
          where: { id: e.id },
          data: { currentStep: nextIdx, status: "Completed" },
        });
        await prisma.emailSequence.update({
          where: { id: e.sequenceId },
          data: { totalCompleted: { increment: 1 } },
        });
        completed++;
      } else {
        const nextStep = steps[nextIdx]!;
        const nextSendAt = new Date(now);
        nextSendAt.setUTCDate(nextSendAt.getUTCDate() + nextStep.delayDays);
        await prisma.sequenceEnrollment.update({
          where: { id: e.id },
          data: { currentStep: nextIdx, nextSendAt },
        });
        advanced++;
      }
    } catch {
      errors++;
    }
  }
  return { processed: due.length, advanced, completed, errors };
}
