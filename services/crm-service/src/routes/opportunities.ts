import { Router } from "express";
import { z } from "zod";
import {
  loadActiveBlueprintStages,
  nextName,
  prisma,
  validateCustomData,
  validateStageTransition,
} from "@lumaara/db";
import { perms, publishRealtime } from "@lumaara/service-auth";

export const opportunityRouter = Router();

const p = perms("Opportunity");

const baseSchema = z.object({
  partyType: z.enum(["Lead", "Customer"]),
  leadId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  expectedAmount: z.coerce.number().nonnegative().default(0),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  source: z.string().optional().nullable(),
  status: z.enum(["Open", "Quotation", "Converted", "Lost"]).default("Open"),
  remarks: z.string().optional().nullable(),
  // D8: campaign attribution.
  campaignId: z.string().optional().nullable(),
  // I5: custom fields
  customData: z.record(z.unknown()).optional().nullable(),
});

const upsertSchema = baseSchema.refine(
  (p) =>
    (p.partyType === "Lead" && p.leadId && !p.customerId) ||
    (p.partyType === "Customer" && p.customerId && !p.leadId),
  { message: "partyType must match exactly one of leadId/customerId" },
);

// Partial variant (no refine) — used by PUT for status-only kanban moves and
// inline edits where the party isn't being changed.
const patchSchema = baseSchema.partial();

opportunityRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.opportunity.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      lead: { select: { name: true, leadName: true } },
      customer: { select: { customerName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(rows);
});

opportunityRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.opportunity.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      lead: true,
      customer: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Full detail: opportunity + party + quotes-from-this-opp + party's other
// quotations. `oppQuotations` are ones we can prove came from THIS opp
// (via Quotation.opportunityId); `partyQuotations` are everything else
// for the same party — related activity, might not be linked to the opp.
opportunityRouter.get("/:id/full", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;

  const opp = await prisma.opportunity.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      lead: true,
      customer: true,
    },
  });
  if (!opp) return res.status(404).json({ error: "Not found" });

  const quoteFields = {
    id: true,
    name: true,
    status: true,
    quotationDate: true,
    grandTotal: true,
  } as const;

  const [oppQuotations, partyQuotations] = await Promise.all([
    // Quotes explicitly spawned from this opp.
    prisma.quotation.findMany({
      where: { tenantId, opportunityId: opp.id },
      select: quoteFields,
      orderBy: { quotationDate: "desc" },
    }),
    // Other quotes for the same party — exclude the opp-linked ones so
    // the UI can render two distinct lists without dedup logic.
    prisma.quotation.findMany({
      where: {
        tenantId,
        NOT: { opportunityId: opp.id },
        ...(opp.leadId
          ? { leadId: opp.leadId }
          : opp.customerId
            ? { customerId: opp.customerId }
            : { id: "__none__" }),
      },
      select: quoteFields,
      orderBy: { quotationDate: "desc" },
      take: 20,
    }),
  ]);

  res.json({ opportunity: opp, oppQuotations, partyQuotations });
});

opportunityRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const p = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (p.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: p.leadId, tenantId } });
    if (!lead) return res.status(400).json({ error: "Invalid lead" });
  }
  if (p.customerId) {
    const c = await prisma.customer.findFirst({ where: { id: p.customerId, tenantId } });
    if (!c) return res.status(400).json({ error: "Invalid customer" });
  }

  let customData;
  try {
    customData = await validateCustomData(
      prisma,
      tenantId,
      "Opportunity",
      (p.customData as Record<string, unknown> | undefined) ?? undefined,
    );
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }

  const name = await nextName(prisma, tenantId, "OPP-");
  const row = await prisma.opportunity.create({
    data: {
      tenantId,
      name,
      partyType: p.partyType,
      leadId: p.leadId ?? null,
      customerId: p.customerId ?? null,
      expectedAmount: p.expectedAmount,
      expectedCloseDate: p.expectedCloseDate ? new Date(p.expectedCloseDate) : null,
      source: p.source ?? null,
      status: p.status,
      remarks: p.remarks ?? null,
      customData: customData ?? undefined,
    },
  });
  void publishRealtime(tenantId, "opportunity", { id: row.id, status: row.status });
  res.status(201).json(row);
});

// D15+: Convert an Opportunity to a Draft Quotation. Mirrors the Lead
// convert-to-quotation flow but ALSO stamps opportunityId on the created
// Quotation so the opp detail page can show its spawned quotes distinctly
// from other quotes for the same party. Flips the opp's status to
// "Quotation" (matches the Open|Quotation|Converted|Lost enum).
//
// Route order: registered BEFORE the PUT below (which uses /:id) — both
// use POST vs PUT so no actual conflict, but keeping convert endpoints
// near-adjacent to POST/GET is convention across the codebase.
opportunityRouter.post("/:id/convert-to-quotation", p.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const opp = await tx.opportunity.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!opp) throw new Error("Not found");
      if (opp.status === "Lost")
        throw new Error("Cannot quote a Lost opportunity");
      if (opp.status === "Converted")
        throw new Error("Opportunity already fully converted");

      const name = await nextName(tx, tenantId, "QTN-");
      const quote = await tx.quotation.create({
        data: {
          tenantId,
          name,
          // Prefer customerId when both are present on the opp; falls
          // back to lead. Matches the "Lead | Customer" enum on both docs.
          partyType: opp.customerId ? "Customer" : "Lead",
          leadId: opp.customerId ? null : opp.leadId,
          customerId: opp.customerId,
          quotationDate: new Date(),
          currency: "INR",
          status: "Draft",
          opportunityId: opp.id,
        },
      });
      // Advance the opp's status if still Open (don't overwrite Converted
      // or Lost — a subsequent re-quote from a Converted opp would
      // otherwise regress the state).
      if (opp.status === "Open") {
        await tx.opportunity.update({
          where: { id: opp.id },
          data: { status: "Quotation" },
        });
      }
      return { id: quote.id, name: quote.name, oppId: opp.id };
    });
    void publishRealtime(tenantId, "opportunity", { id: result.oppId, status: "Quotation" });
    res.status(201).json({ id: result.id, name: result.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Not found" ? 404 : 400).json({ error: msg });
  }
});

// Partial update — primarily used by the kanban board to move opportunities
// between status columns via drag-and-drop, but accepts any of the upsert
// fields for future inline edits.
opportunityRouter.put("/:id", p.write, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.opportunity.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // Blueprint guard: if a status change is proposed and an active
  // blueprint exists for Opportunity, enforce mandatory-fields +
  // allowed-transition rules against the record's PROPOSED after-image
  // (existing merged with the incoming patch — a user is allowed to
  // fill a required field and change status in the same PUT).
  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    const stages = await loadActiveBlueprintStages(prisma, tenantId, "Opportunity");
    if (stages.length > 0) {
      const proposed: Record<string, unknown> = {
        ...existing,
        ...parsed.data,
        customData: parsed.data.customData ?? existing.customData ?? {},
      };
      const check = validateStageTransition(
        stages,
        existing.status,
        parsed.data.status,
        proposed,
      );
      if (!check.ok) {
        return res.status(400).json({ error: check.error, missingFields: check.missingFields });
      }
    }
  }

  let customData;
  if (parsed.data.customData !== undefined) {
    try {
      customData = await validateCustomData(
        prisma,
        tenantId,
        "Opportunity",
        parsed.data.customData as Record<string, unknown> | null,
        { docId: existing.id },
      );
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  }

  const d = parsed.data;
  const row = await prisma.opportunity.update({
    where: { id: existing.id },
    data: {
      ...(d.partyType !== undefined ? { partyType: d.partyType } : {}),
      ...(d.leadId !== undefined ? { leadId: d.leadId } : {}),
      ...(d.customerId !== undefined ? { customerId: d.customerId } : {}),
      ...(d.expectedAmount !== undefined ? { expectedAmount: d.expectedAmount } : {}),
      ...(d.expectedCloseDate !== undefined
        ? { expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate) : null }
        : {}),
      ...(d.source !== undefined ? { source: d.source } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.remarks !== undefined ? { remarks: d.remarks } : {}),
      ...(d.campaignId !== undefined ? { campaignId: d.campaignId } : {}),
      ...(d.customData !== undefined ? { customData: customData ?? undefined } : {}),
    },
    include: {
      lead: { select: { name: true, leadName: true } },
      customer: { select: { customerName: true } },
    },
  });
  if (d.status !== undefined && d.status !== existing.status) {
    void publishRealtime(tenantId, "opportunity", { id: row.id, status: row.status });
  }
  res.json(row);
});
