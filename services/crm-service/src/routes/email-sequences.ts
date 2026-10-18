import { Router } from "express";
import { z } from "zod";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Email sequences — linear drip campaigns. A sequence has N ordered steps;
// each enrollment tracks its `currentStep` + `nextSendAt`. The scheduler
// (see services/scheduler/src/jobs/email-sequences.ts) walks due enrollments
// hourly, fires the current step, advances the pointer, and completes the
// enrollment when the pointer overruns the last step.
//
// Enrollment sources:
//   Manual        — POST /:id/enroll { contactType, contactId }
//   OnListAdd     — auto-enroll when a Lead/Customer is added to triggerList
//   OnLeadCreated — auto-enroll every new Lead
// (Only Manual is wired here — auto-enrol hooks are TODO.)

export const emailSequenceRouter = Router();
const p = perms("Campaign");

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  triggerType: z.enum(["Manual", "OnListAdd", "OnLeadCreated"]).default("Manual"),
  triggerListId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        stepOrder: z.number().int().nonnegative(),
        delayDays: z.number().int().nonnegative(),
        subject: z.string().min(1),
        bodyHtml: z.string().min(1),
      }),
    )
    .optional(),
});

emailSequenceRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.emailSequence.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { _count: { select: { steps: true, enrollments: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

emailSequenceRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.emailSequence.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      steps: { orderBy: { stepOrder: "asc" } },
      triggerList: { select: { id: true, name: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

emailSequenceRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  try {
    const row = await prisma.emailSequence.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: data.name,
        description: data.description ?? null,
        triggerType: data.triggerType,
        triggerListId: data.triggerListId ?? null,
        isActive: data.isActive ?? false,
        steps: data.steps
          ? {
              create: data.steps.map((s) => ({
                stepOrder: s.stepOrder,
                delayDays: s.delayDays,
                subject: s.subject,
                bodyHtml: s.bodyHtml,
              })),
            }
          : undefined,
      },
      include: { steps: true },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Sequence name already exists" });
    throw e;
  }
});

emailSequenceRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.emailSequence.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const data = parsed.data;

  const row = await prisma.$transaction(async (tx) => {
    // If steps are provided, replace them wholesale. Simpler than diffing.
    if (data.steps) {
      await tx.emailSequenceStep.deleteMany({ where: { sequenceId: existing.id } });
    }
    return tx.emailSequence.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        description: data.description ?? null,
        triggerType: data.triggerType,
        triggerListId: data.triggerListId ?? null,
        isActive: data.isActive ?? existing.isActive,
        ...(data.steps && {
          steps: {
            create: data.steps.map((s) => ({
              stepOrder: s.stepOrder,
              delayDays: s.delayDays,
              subject: s.subject,
              bodyHtml: s.bodyHtml,
            })),
          },
        }),
      },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
  });
  res.json(row);
});

emailSequenceRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.emailSequence.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.emailSequence.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ─── Enrollment ────────────────────────────────────────────────────────

emailSequenceRouter.post("/:id/enroll", p.write, async (req, res) => {
  const parsed = z
    .object({
      contactType: z.enum(["Customer", "Lead"]),
      contactId: z.string().min(1),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const seq = await prisma.emailSequence.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { steps: { orderBy: { stepOrder: "asc" }, take: 1 } },
  });
  if (!seq) return res.status(404).json({ error: "Sequence not found" });
  if (!seq.isActive) return res.status(400).json({ error: "Sequence is not Active" });
  if (seq.steps.length === 0) return res.status(400).json({ error: "Sequence has no steps" });

  // Resolve email address for the contact.
  let email: string | null = null;
  if (parsed.data.contactType === "Customer") {
    const c = await prisma.customer.findFirst({
      where: { id: parsed.data.contactId, tenantId: req.auth!.tenantId },
      select: { email: true },
    });
    email = c?.email ?? null;
  } else {
    const l = await prisma.lead.findFirst({
      where: { id: parsed.data.contactId, tenantId: req.auth!.tenantId },
      select: { email: true },
    });
    email = l?.email ?? null;
  }
  if (!email) return res.status(400).json({ error: "Contact has no email address" });

  const nextSendAt = new Date();
  nextSendAt.setUTCDate(nextSendAt.getUTCDate() + seq.steps[0]!.delayDays);

  try {
    const enrollment = await prisma.sequenceEnrollment.create({
      data: {
        tenantId: req.auth!.tenantId,
        sequenceId: seq.id,
        contactType: parsed.data.contactType,
        contactId: parsed.data.contactId,
        emailTo: email,
        currentStep: 0,
        status: "Active",
        nextSendAt,
      },
    });
    await prisma.emailSequence.update({
      where: { id: seq.id },
      data: { totalEnrolled: { increment: 1 } },
    });
    res.status(201).json(enrollment);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Contact already enrolled in this sequence" });
    throw e;
  }
});

emailSequenceRouter.get("/:id/enrollments", p.read, async (req, res) => {
  const rows = await prisma.sequenceEnrollment.findMany({
    where: {
      sequenceId: req.params.id,
      tenantId: req.auth!.tenantId,
    },
    orderBy: { enrolledAt: "desc" },
    take: 500,
  });
  res.json(rows);
});

emailSequenceRouter.post("/:id/pause", p.write, async (req, res) => {
  const r = await prisma.emailSequence.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    data: { isActive: false },
  });
  res.json({ ok: true, updated: r.count });
});
emailSequenceRouter.post("/:id/activate", p.write, async (req, res) => {
  const r = await prisma.emailSequence.updateMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    data: { isActive: true },
  });
  res.json({ ok: true, updated: r.count });
});

// Sequence-level scheduler tick — called from the scheduler service. Walks
// every Active enrollment whose nextSendAt is on-or-before now, "sends" the
// current step (marks-as-sent for now), advances the pointer, and completes
// the enrollment when it overruns.
export async function runEmailSequenceTick(): Promise<{
  processed: number;
  advanced: number;
  completed: number;
  errors: number;
}> {
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
      const steps = e.sequence.steps;
      if (!e.sequence.isActive) continue;
      const currentIdx = e.currentStep;
      if (currentIdx >= steps.length) {
        // Nothing more to send — mark complete.
        await prisma.sequenceEnrollment.update({
          where: { id: e.id },
          data: { status: "Completed" },
        });
        completed++;
        continue;
      }
      // "Send" the current step. In MVP we just log it as a CrmActivity so
      // the timeline reflects the touch. Real SMTP goes here later.
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
          ownerUserId: "system", // sequence engine is the sender
        },
      });

      const nextIdx = currentIdx + 1;
      if (nextIdx >= steps.length) {
        await prisma.sequenceEnrollment.update({
          where: { id: e.id },
          data: {
            currentStep: nextIdx,
            status: "Completed",
          },
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
