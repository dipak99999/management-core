import { Router } from "express";
import { z } from "zod";
import { prisma, nextName, scoreLead, validateCustomData, fireJourneyTrigger, type LeadScoreRule } from "@lumaara/db";

// Recompute a single lead's score against the tenant's enabled rules.
// Best-effort — never throws (a score of 0 is fine).
async function rescoreLead(tenantId: string, leadId: string): Promise<void> {
  try {
    const [rules, lead] = await Promise.all([
      prisma.leadScoreRule.findMany({
        where: { tenantId, enabled: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.lead.findFirst({
        where: { id: leadId, tenantId },
        select: {
          id: true, leadName: true, companyName: true, email: true,
          mobile: true, status: true, source: true, customData: true,
        },
      }),
    ]);
    if (!lead) return;
    const shape: LeadScoreRule[] = rules.map((r) => ({
      fieldPath: r.fieldPath,
      operator: r.operator as LeadScoreRule["operator"],
      value: r.value,
      points: r.points,
      applyMode: r.applyMode as LeadScoreRule["applyMode"],
      enabled: r.enabled,
    }));
    const { score } = scoreLead(shape, lead as unknown as Record<string, unknown>);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score, scoredAt: new Date() },
    });
  } catch {
    // swallow — scoring is advisory
  }
}
import { getLogger, perms, publishRealtime } from "@lumaara/service-auth";

const log = getLogger("crm-service");

export const leadRouter = Router();

const p = perms("Lead");

const upsertSchema = z.object({
  leadName: z.string().min(1),
  companyName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  mobile: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  status: z
    .enum(["Open", "Contacted", "Interested", "Converted", "Lost"])
    .default("Open"),
  remarks: z.string().optional().nullable(),
  // D8: campaign attribution.
  campaignId: z.string().optional().nullable(),
  // I5: custom fields
  customData: z.record(z.unknown()).optional().nullable(),
});

leadRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.lead.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

leadRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.lead.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { convertedCustomer: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: lead + converted customer link + all opportunities and
// quotations tied to this lead.
leadRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, tenantId },
    include: { convertedCustomer: true },
  });
  if (!lead) return res.status(404).json({ error: "Not found" });

  const [opportunities, quotations] = await Promise.all([
    prisma.opportunity.findMany({
      where: { tenantId, leadId: lead.id },
      select: {
        id: true,
        name: true,
        status: true,
        expectedAmount: true,
        expectedCloseDate: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.quotation.findMany({
      where: { tenantId, leadId: lead.id },
      select: {
        id: true,
        name: true,
        status: true,
        quotationDate: true,
        grandTotal: true,
      },
      orderBy: { quotationDate: "desc" },
    }),
  ]);

  res.json({ lead, opportunities, quotations });
});

leadRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Lead",
      (parsed.data.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
  const name = await nextName(prisma, tenantId, "LEAD-");
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.lead.create({
    data: { ...rest, tenantId, name, customData: customData ?? undefined },
  });

  // Score the new lead against active rules (best-effort).
  void rescoreLead(tenantId, row.id);

  // Marketing P2 — fire LeadCreated trigger. Any active MarketingJourney
  // with triggerType=LeadCreated (no per-config match required) gets a new
  // enrollment for this lead. Best-effort — never fail the create call.
  try {
    await fireJourneyTrigger(prisma, {
      tenantId,
      triggerType: "LeadCreated",
      contactType: "Lead",
      contactId: row.id,
      emailTo: row.email,
      mobileTo: row.mobile,
    });
  } catch (e) {
    log.warn("fireJourneyTrigger(LeadCreated) failed", {
      leadId: row.id,
      err: e instanceof Error ? e : new Error(String(e)),
    });
  }

  res.status(201).json(row);
});

leadRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.lead.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Lead",
        parsed.data.customData as Record<string, unknown> | null,
        { docId: existing.id },
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }
  const { customData: _drop, ...rest } = parsed.data;
  const row = await prisma.lead.update({
    where: { id: existing.id },
    data: {
      ...rest,
      ...(parsed.data.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
  });
  // Rescore on any field change — rules may key on updated attrs.
  void rescoreLead(tenantId, row.id);
  res.json(row);
});

// D15: Convert Lead directly to a Draft Quotation. Bypasses Opportunity for
// short-cycle deals. UI fills in items after creation.
leadRouter.post("/:id/convert-to-quotation", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const lead = await prisma.lead.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!lead) return res.status(404).json({ error: "Not found" });
  if (lead.status === "Lost")
    return res.status(400).json({ error: "Cannot quote a Lost lead" });

  const name = await nextName(prisma, tenantId, "QTN-");
  const q = await prisma.quotation.create({
    data: {
      tenantId,
      name,
      partyType: "Lead",
      leadId: lead.id,
      quotationDate: new Date(),
      currency: "INR",
      status: "Draft",
    },
  });
  res.status(201).json({ id: q.id, name: q.name });
});

// Convert a Lead into a Customer. Atomic: creates the Customer, updates the
// Lead to point at it, flips Lead status to "Converted".
leadRouter.post("/:id/convert", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!lead) throw new Error("Not found");
      if (lead.status === "Converted" && lead.convertedCustomerId)
        throw new Error("Lead already converted");
      if (lead.status === "Lost") throw new Error("Cannot convert a Lost lead");

      const customer = await tx.customer.create({
        data: {
          tenantId,
          customerName: lead.companyName ?? lead.leadName,
          customerType: lead.companyName ? "Company" : "Individual",
          email: lead.email,
          mobile: lead.mobile,
        },
      });

      const updated = await tx.lead.update({
        where: { id: lead.id },
        data: {
          status: "Converted",
          convertedCustomerId: customer.id,
        },
        include: { convertedCustomer: true },
      });
      return updated;
    });
    void publishRealtime(tenantId, "lead", { id: result.id, status: "Converted" });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});
