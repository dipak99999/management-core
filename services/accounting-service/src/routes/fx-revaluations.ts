import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  buildRevaluationJE,
  computeRevaluation,
  firstOfNextMonth,
  nextName,
  prisma,
  resolveRate,
  type OpenAP,
  type OpenAR,
} from "@lumaara/db";
import { postGLEntries, requireTenantDefaults } from "../lib/gl-posting";
import { getAllowedCompanyIds, perms } from "@lumaara/service-auth";

// Module 57 — FX Revaluation routes.
//
// Flow:
//   1. POST /fx-revaluations/preview { asOfDate, rates }
//      → pulls open FX AR/AP, runs computeRevaluation, persists a
//      Preview row, returns the summary.
//   2. POST /fx-revaluations/:id/commit
//      → builds the JE, posts via postGLEntries, updates run to
//      Committed with journalEntryId.
//   3. POST /fx-revaluations/:id/discard
//      → soft-discard for audit.
//
// The Preview row survives even if the operator never commits so ops
// can audit "what would this reval have been?" scenarios.

export const fxRevalRouter = Router();
const p = perms("JournalEntry");

const rateSchema = z.object({
  currency: z.string().min(3).max(3),
  rate: z.coerce.number().positive(),
});

const previewSchema = z.object({
  asOfDate: z.string().datetime(),
  // Rates are optional — any missing currency is auto-resolved from
  // the ExchangeRate master (direct → inverse → triangle via USD).
  rates: z.array(rateSchema).optional().default([]),
  companyId: z.string().optional().nullable(),
});

fxRevalRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.fxRevaluationRun.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      journalEntry: { select: { name: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(rows);
});

fxRevalRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.fxRevaluationRun.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { journalEntry: true },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

fxRevalRouter.post("/preview", p.create, async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const allowed = await getAllowedCompanyIds(req.auth!);
  const companyWhere = b.companyId
    ? { companyId: b.companyId }
    : allowed !== null
      ? { companyId: { in: allowed } }
      : {};

  // Fetch tenant base currency.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { baseCurrency: true },
  });
  const baseCurrency = tenant?.baseCurrency ?? "INR";

  // Open FX AR: Submitted SI with outstanding > 0 and non-base currency.
  const arRows = await prisma.salesInvoice.findMany({
    where: {
      tenantId,
      status: "Submitted",
      outstandingAmt: { gt: 0 },
      currency: { not: baseCurrency },
      ...companyWhere,
    },
    select: {
      id: true, name: true, customerId: true, currency: true,
      outstandingAmt: true, conversionRate: true,
    },
  });
  const ar: OpenAR[] = arRows.map((r) => ({
    id: r.id,
    name: r.name,
    customerId: r.customerId,
    currency: r.currency,
    outstandingAmt: Number(r.outstandingAmt),
    originalRate: Number(r.conversionRate),
  }));

  const apRows = await prisma.purchaseInvoice.findMany({
    where: {
      tenantId,
      status: "Submitted",
      outstandingAmt: { gt: 0 },
      currency: { not: baseCurrency },
      ...companyWhere,
    },
    select: {
      id: true, name: true, supplierId: true, currency: true,
      outstandingAmt: true, conversionRate: true,
    },
  });
  const ap: OpenAP[] = apRows.map((r) => ({
    id: r.id,
    name: r.name,
    supplierId: r.supplierId,
    currency: r.currency,
    outstandingAmt: Number(r.outstandingAmt),
    originalRate: Number(r.conversionRate),
  }));

  // Union of currencies present in AR + AP.
  const currencies = new Set<string>();
  for (const r of ar) currencies.add(r.currency);
  for (const r of ap) currencies.add(r.currency);
  currencies.delete(baseCurrency);

  // Start with operator-provided rates, then fill gaps from ExchangeRate.
  const rateMap = new Map<string, { currency: string; rate: number; source?: string }>();
  for (const r of b.rates) {
    rateMap.set(r.currency.toUpperCase(), { currency: r.currency.toUpperCase(), rate: r.rate, source: "operator" });
  }
  const asOfDate = new Date(b.asOfDate);
  const missing: string[] = [];
  for (const cur of currencies) {
    if (rateMap.has(cur)) continue;
    const resolved = await resolveRate(prisma, tenantId, cur, baseCurrency, asOfDate);
    if (resolved) {
      rateMap.set(cur, { currency: cur, rate: resolved.rate, source: resolved.source });
    } else {
      missing.push(cur);
    }
  }
  if (missing.length > 0) {
    return res.status(400).json({
      error: `No ExchangeRate configured for: ${missing.join(", ")}. Provide rates in the request body or seed /exchange-rates.`,
      missing,
    });
  }
  const effectiveRates = Array.from(rateMap.values()).map((r) => ({ currency: r.currency, rate: r.rate }));

  const summary = computeRevaluation(ar, ap, effectiveRates, baseCurrency);

  const run = await prisma.fxRevaluationRun.create({
    data: {
      tenantId,
      asOfDate: asOfDate,
      ratesJson: Array.from(rateMap.values()) as unknown as Prisma.InputJsonValue,
      summaryJson: summary as unknown as Prisma.InputJsonValue,
      status: "Preview",
      createdBy: req.auth!.userId,
    },
  });

  res.json({ run, summary, rates: Array.from(rateMap.values()) });
});

const commitSchema = z.object({
  companyId: z.string().optional().nullable(),
});

fxRevalRouter.post("/:id/commit", p.submit, async (req, res) => {
  const parsed = commitSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const run = await prisma.fxRevaluationRun.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!run) return res.status(404).json({ error: "Not found" });
  if (run.status !== "Preview") {
    return res.status(400).json({ error: `Cannot commit run in status ${run.status}` });
  }
  const summary = run.summaryJson as unknown as {
    lines: Array<unknown>;
    totals: { arDelta: number; apDelta: number; netFxGainLoss: number };
  };
  if (summary.lines.length === 0) {
    return res.status(400).json({ error: "Nothing to commit — no non-zero deltas" });
  }

  // Resolve accounts via effective-defaults (Company override → Tenant default).
  const defaults = await requireTenantDefaults(
    prisma,
    tenantId,
    ["defaultReceivableAccountId", "defaultPayableAccountId", "defaultFxGainLossAccountId"],
    parsed.data.companyId ?? undefined,
  );

  const jeLines = buildRevaluationJE({
    summary: summary as unknown as import("@lumaara/db").RevaluationSummary,
    debtorsAccountId: defaults.defaultReceivableAccountId!,
    creditorsAccountId: defaults.defaultPayableAccountId!,
    fxGainLossAccountId: defaults.defaultFxGainLossAccountId!,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const jeName = await nextName(tx, tenantId, "JV-");
      const reverseOn = firstOfNextMonth(run.asOfDate);
      const je = await tx.journalEntry.create({
        data: {
          tenantId,
          name: jeName,
          postingDate: run.asOfDate,
          status: "Submitted",
          remarks: `FX Revaluation as of ${run.asOfDate.toISOString().slice(0, 10)} (auto-reverses ${reverseOn.toISOString().slice(0, 10)})`,
          companyId: parsed.data.companyId ?? null,
          isReversing: true,
          reverseOnDate: reverseOn,
          accounts: {
            create: jeLines.map((l) => ({
              accountId: l.accountId,
              debit: new Prisma.Decimal(l.debit),
              credit: new Prisma.Decimal(l.credit),
              remarks: l.remarks,
            })),
          },
        },
      });
      await postGLEntries(tx, {
        tenantId,
        postingDate: run.asOfDate,
        voucherType: "JournalEntry",
        voucherId: je.id,
        voucherName: je.name,
        companyId: parsed.data.companyId ?? null,
        lines: jeLines,
      });
      const updatedRun = await tx.fxRevaluationRun.update({
        where: { id: run.id },
        data: {
          status: "Committed",
          journalEntryId: je.id,
          committedAt: new Date(),
          committedBy: req.auth!.userId,
        },
      });
      return { run: updatedRun, journalEntry: je };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Commit failed" });
  }
});

fxRevalRouter.post("/:id/discard", p.cancel, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const run = await prisma.fxRevaluationRun.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!run) return res.status(404).json({ error: "Not found" });
  if (run.status === "Committed") {
    return res.status(400).json({
      error: "Cannot discard a committed run. Cancel the linked JE instead.",
    });
  }
  const updated = await prisma.fxRevaluationRun.update({
    where: { id: run.id },
    data: { status: "Discarded" },
  });
  res.json(updated);
});
