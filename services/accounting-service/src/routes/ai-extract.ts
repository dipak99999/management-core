import { Router } from "express";
import { z } from "zod";
import {
  AiBudgetExceededError,
  Prisma,
  assertAiBudgetAvailable,
  extractInvoiceFromLLM,
  extractReceiptFromLLM,
  extractBusinessCardFromLLM,
  extractBankStatementFromLLM,
  extractVendorQuoteFromLLM,
  pickProvider,
  prisma,
  resolveAgentRouter,
  stubProvider,
  validateExtractedInvoice,
  validateExtractedReceipt,
  validateExtractedBusinessCard,
  validateExtractedBankStatement,
  validateExtractedVendorQuote,
  type LLMCallInput,
  type LLMCallResult,
  type LLMProvider,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Module 54 — AI extraction routes.
//
// POST /ai/extract-invoice: accepts either OCR text OR a base64 PDF/image,
// runs the LLM extraction, persists an AIExtractionJob with the raw
// output + usage, returns the parsed invoice + validation warnings for
// operator review. No PI is created yet — the operator hits
// POST /:jobId/confirm to actually create the Draft PurchaseInvoice.
//
// Provider resolution: reads tenant integrations. If none configured,
// falls back to the stub (returns empty extract for real inputs, canned
// data for STUB_INVOICE: sentinel — handy for demos + tests).

export const aiExtractRouter = Router();
const p = perms("PurchaseInvoice");

// Provider registry built per-request. "stub" always available as a
// deterministic fallback for demos / tests. "router" wraps the tenant's
// configured LLMRouter (OpenAI/Anthropic/etc. from TenantIntegration or
// PlatformAiProvider) + is picked by default when any extraction use-case
// hits the route — the stub is only used when preferredProvider="stub".
async function providersFor(tenantId: string): Promise<Record<string, LLMProvider>> {
  const configured: Record<string, LLMProvider> = { stub: stubProvider };
  try {
    const router = await resolveAgentRouter(tenantId);
    // Adapt LLMRouter.call(useCase, input) → LLMProvider.call(input).
    const useCase = "extract";
    const adapter: LLMProvider = {
      name: "router",
      async call<T>(input: LLMCallInput): Promise<LLMCallResult<T>> {
        return router.call<T>(useCase, input);
      },
    };
    configured.router = adapter;
  } catch {
    // No real provider configured — stub-only. The validator surfaces a
    // user-facing "configure AI provider" warning so the UX is honest.
  }
  return configured;
}

const extractSchema = z.object({
  // At least one of sourceText / attachmentBase64 is required.
  sourceText: z.string().optional(),
  attachmentBase64: z.string().optional(),
  attachmentMimeType: z.string().optional(),
  preferredProvider: z.string().optional(),
});

aiExtractRouter.post("/extract-invoice", p.create, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  if (!b.sourceText && !b.attachmentBase64) {
    return res.status(400).json({ error: "Provide either sourceText or attachmentBase64" });
  }

  // Create the job row up-front so a failure mid-call still leaves an
  // audit trail. Status flips as the call progresses.
  const job = await prisma.aIExtractionJob.create({
    data: {
      tenantId,
      targetDoctype: "PurchaseInvoice",
      sourceKind: b.attachmentBase64 ? (b.attachmentMimeType?.includes("pdf") ? "pdf" : "image") : "text",
      status: "Running",
      createdBy: req.auth!.userId,
    },
  });

  try {
    // Hard-stop: refuse the LLM call if the tenant is over its monthly
    // AI budget. Throws AiBudgetExceededError → mapped to 402 below.
    await assertAiBudgetAvailable(tenantId);
    const providers = await providersFor(tenantId);
    const provider = pickProvider(providers, b.preferredProvider);
    const result = await extractInvoiceFromLLM({
      provider,
      sourceText: b.sourceText,
      attachment:
        b.attachmentBase64 && b.attachmentMimeType
          ? { mimeType: b.attachmentMimeType, base64Data: b.attachmentBase64 }
          : undefined,
    });

    const warnings = validateExtractedInvoice(result.parsed);
    const updated = await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Extracted",
        rawOutput: result.parsed as unknown as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputTokens: Math.round(result.inputTokens),
        outputTokens: Math.round(result.outputTokens),
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    res.json({ job: updated, extracted: result.parsed, warnings });
  } catch (e) {
    await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    if (e instanceof AiBudgetExceededError) {
      return res.status(402).json({
        error: e.message,
        code: e.code,
        spentUsd: e.spentUsd,
        budgetUsd: e.budgetUsd,
      });
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Extraction failed" });
  }
});

// Confirm the extract: create a Draft PurchaseInvoice from the extracted
// data. Operator has reviewed + optionally edited the extract in the
// UI; they pass the (possibly-edited) shape back here along with a
// resolved supplierId (they picked from the existing Supplier list —
// we don't auto-create suppliers).
const confirmSchema = z.object({
  supplierId: z.string().min(1),
  // Item IDs must be resolved by the operator (fuzzy-match extraction
  // to Item master is a follow-up). Line-items on the confirmed PI
  // use these resolved IDs.
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.coerce.number().positive(),
        rate: z.coerce.number().nonnegative(),
      }),
    )
    .min(1),
  supplierInvoiceNo: z.string().optional().nullable(),
  postingDate: z.string().datetime().optional(),
  currency: z.string().default("INR"),
});

aiExtractRouter.post("/extract-invoice/:jobId/confirm", p.create, async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;

  const job = await prisma.aIExtractionJob.findFirst({
    where: { id: req.params.jobId, tenantId },
  });
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "Extracted") {
    return res.status(400).json({ error: `Cannot confirm job in status ${job.status}` });
  }

  // Delegate to the existing /purchase-invoices flow so all tax/round-off
  // logic is preserved. We hit its create schema by proxying the shape.
  //
  // v1: simplified — create the PI inline with the fields we have.
  // Full parity with the interactive PI form (custom fields, payment
  // terms, etc.) is a follow-up.
  const supplier = await prisma.supplier.findFirst({
    where: { id: b.supplierId, tenantId },
  });
  if (!supplier) return res.status(400).json({ error: "Supplier not found" });

  const linesSum = b.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const nextName = (await import("@lumaara/db")).nextName;
  const name = await nextName(prisma, tenantId, "PINV-");

  const pi = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseInvoice.create({
      data: {
        tenantId,
        name,
        supplierId: b.supplierId,
        supplierInvoiceNo: b.supplierInvoiceNo ?? null,
        postingDate: b.postingDate ? new Date(b.postingDate) : new Date(),
        currency: b.currency,
        conversionRate: new Prisma.Decimal(1),
        netTotal: new Prisma.Decimal(linesSum),
        grandTotal: new Prisma.Decimal(linesSum),
        outstandingAmt: new Prisma.Decimal(linesSum),
        status: "Draft",
        items: {
          create: b.lines.map((l) => ({
            itemId: l.itemId,
            qty: new Prisma.Decimal(l.qty),
            rate: new Prisma.Decimal(l.rate),
            amount: new Prisma.Decimal(l.qty * l.rate),
          })),
        },
      },
    });
    await tx.aIExtractionJob.update({
      where: { id: job.id },
      data: { status: "Confirmed", createdDocId: created.id },
    });
    return created;
  });

  res.status(201).json({ purchaseInvoice: pi });
});

aiExtractRouter.post("/extract-invoice/:jobId/discard", p.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const job = await prisma.aIExtractionJob.findFirst({
    where: { id: req.params.jobId, tenantId },
  });
  if (!job) return res.status(404).json({ error: "Not found" });
  const updated = await prisma.aIExtractionJob.update({
    where: { id: job.id },
    data: { status: "Discarded" },
  });
  res.json(updated);
});

aiExtractRouter.get("/extract-invoice", p.read, async (req, res) => {
  const rows = await prisma.aIExtractionJob.findMany({
    where: { tenantId: req.auth!.tenantId, targetDoctype: "PurchaseInvoice" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(rows);
});

// ── Receipt → Expense Claim ──────────────────────────────────────────
//
// Same flow as /extract-invoice: upload → extract → review → confirm.
// On confirm we create a Draft ExpenseClaim scoped to the uploading user.

const pExpense = perms("ExpenseClaim");

aiExtractRouter.post("/extract-receipt", pExpense.create, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (!b.sourceText && !b.attachmentBase64) {
    return res.status(400).json({ error: "Provide either sourceText or attachmentBase64" });
  }

  const job = await prisma.aIExtractionJob.create({
    data: {
      tenantId,
      targetDoctype: "ExpenseClaim",
      sourceKind: b.attachmentBase64 ? (b.attachmentMimeType?.includes("pdf") ? "pdf" : "image") : "text",
      status: "Running",
      createdBy: req.auth!.userId,
    },
  });

  try {
    // Hard-stop: refuse the LLM call if the tenant is over its monthly
    // AI budget. Throws AiBudgetExceededError → mapped to 402 below.
    await assertAiBudgetAvailable(tenantId);
    const providers = await providersFor(tenantId);
    const provider = pickProvider(providers, b.preferredProvider);
    const result = await extractReceiptFromLLM({
      provider,
      sourceText: b.sourceText,
      attachment: b.attachmentBase64 && b.attachmentMimeType
        ? { mimeType: b.attachmentMimeType, base64Data: b.attachmentBase64 }
        : undefined,
    });
    const warnings = validateExtractedReceipt(result.parsed);
    const updated = await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Extracted",
        rawOutput: result.parsed as unknown as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputTokens: Math.round(result.inputTokens),
        outputTokens: Math.round(result.outputTokens),
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    res.json({ job: updated, extracted: result.parsed, warnings });
  } catch (e) {
    await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    if (e instanceof AiBudgetExceededError) {
      return res.status(402).json({
        error: e.message,
        code: e.code,
        spentUsd: e.spentUsd,
        budgetUsd: e.budgetUsd,
      });
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Extraction failed" });
  }
});

// ── Business Card → Lead ─────────────────────────────────────────────
//
// Cross-service: the CRM lead lives on crm-service. We extract here
// (keeps all AI-extract flows under one roof + reuses the LLM provider
// resolver) and the frontend posts the confirmed shape to crm-service's
// /leads endpoint. v1 doesn't do the cross-service create here to avoid
// propagating auth across services — simpler + the UI already lives in
// crm-web, which has its own API client.

const pLead = perms("Lead");

aiExtractRouter.post("/extract-business-card", pLead.create, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (!b.sourceText && !b.attachmentBase64) {
    return res.status(400).json({ error: "Provide either sourceText or attachmentBase64" });
  }

  const job = await prisma.aIExtractionJob.create({
    data: {
      tenantId,
      targetDoctype: "Lead",
      sourceKind: b.attachmentBase64 ? (b.attachmentMimeType?.includes("pdf") ? "pdf" : "image") : "text",
      status: "Running",
      createdBy: req.auth!.userId,
    },
  });

  try {
    // Hard-stop: refuse the LLM call if the tenant is over its monthly
    // AI budget. Throws AiBudgetExceededError → mapped to 402 below.
    await assertAiBudgetAvailable(tenantId);
    const providers = await providersFor(tenantId);
    const provider = pickProvider(providers, b.preferredProvider);
    const result = await extractBusinessCardFromLLM({
      provider,
      sourceText: b.sourceText,
      attachment: b.attachmentBase64 && b.attachmentMimeType
        ? { mimeType: b.attachmentMimeType, base64Data: b.attachmentBase64 }
        : undefined,
    });
    const warnings = validateExtractedBusinessCard(result.parsed);
    const updated = await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Extracted",
        rawOutput: result.parsed as unknown as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputTokens: Math.round(result.inputTokens),
        outputTokens: Math.round(result.outputTokens),
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    res.json({ job: updated, extracted: result.parsed, warnings });
  } catch (e) {
    await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    if (e instanceof AiBudgetExceededError) {
      return res.status(402).json({
        error: e.message,
        code: e.code,
        spentUsd: e.spentUsd,
        budgetUsd: e.budgetUsd,
      });
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Extraction failed" });
  }
});

// ── Bank Statement → Reconciliation lines ────────────────────────────
//
// Same upload → extract → review → confirm flow. The confirm step is
// out of scope here — the operator reviews the parsed rows on the Bank
// Reconciliation screen and imports selected rows as BankTransactions,
// which then flow through the existing match-against-JournalEntries
// logic.

const pBankTxn = perms("BankTransaction");

aiExtractRouter.post("/extract-bank-statement", pBankTxn.create, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (!b.sourceText && !b.attachmentBase64) {
    return res.status(400).json({ error: "Provide either sourceText or attachmentBase64" });
  }

  const job = await prisma.aIExtractionJob.create({
    data: {
      tenantId,
      targetDoctype: "BankTransaction",
      sourceKind: b.attachmentBase64 ? (b.attachmentMimeType?.includes("pdf") ? "pdf" : "image") : "text",
      status: "Running",
      createdBy: req.auth!.userId,
    },
  });

  try {
    // Hard-stop: refuse the LLM call if the tenant is over its monthly
    // AI budget. Throws AiBudgetExceededError → mapped to 402 below.
    await assertAiBudgetAvailable(tenantId);
    const providers = await providersFor(tenantId);
    const provider = pickProvider(providers, b.preferredProvider);
    const result = await extractBankStatementFromLLM({
      provider,
      sourceText: b.sourceText,
      attachment: b.attachmentBase64 && b.attachmentMimeType
        ? { mimeType: b.attachmentMimeType, base64Data: b.attachmentBase64 }
        : undefined,
    });
    const warnings = validateExtractedBankStatement(result.parsed);
    const updated = await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Extracted",
        rawOutput: result.parsed as unknown as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputTokens: Math.round(result.inputTokens),
        outputTokens: Math.round(result.outputTokens),
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    res.json({ job: updated, extracted: result.parsed, warnings });
  } catch (e) {
    await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    if (e instanceof AiBudgetExceededError) {
      return res.status(402).json({
        error: e.message,
        code: e.code,
        spentUsd: e.spentUsd,
        budgetUsd: e.budgetUsd,
      });
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Extraction failed" });
  }
});

// ── Vendor Quote → Supplier Quotation ────────────────────────────────
//
// Mirrors /extract-invoice but produces a SupplierQuotation (price-only,
// pre-PO) rather than a PurchaseInvoice (post-GRN, payable). The UI
// posts the confirmed shape to buying-service's /supplier-quotations
// endpoint — we extract-only here to keep the LLM provider resolution
// in one place.

const pSupplierQuote = perms("SupplierQuotation");

aiExtractRouter.post("/extract-vendor-quote", pSupplierQuote.create, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  if (!b.sourceText && !b.attachmentBase64) {
    return res.status(400).json({ error: "Provide either sourceText or attachmentBase64" });
  }

  const job = await prisma.aIExtractionJob.create({
    data: {
      tenantId,
      targetDoctype: "SupplierQuotation",
      sourceKind: b.attachmentBase64 ? (b.attachmentMimeType?.includes("pdf") ? "pdf" : "image") : "text",
      status: "Running",
      createdBy: req.auth!.userId,
    },
  });

  try {
    // Hard-stop: refuse the LLM call if the tenant is over its monthly
    // AI budget. Throws AiBudgetExceededError → mapped to 402 below.
    await assertAiBudgetAvailable(tenantId);
    const providers = await providersFor(tenantId);
    const provider = pickProvider(providers, b.preferredProvider);
    const result = await extractVendorQuoteFromLLM({
      provider,
      sourceText: b.sourceText,
      attachment: b.attachmentBase64 && b.attachmentMimeType
        ? { mimeType: b.attachmentMimeType, base64Data: b.attachmentBase64 }
        : undefined,
    });
    const warnings = validateExtractedVendorQuote(result.parsed);
    const updated = await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Extracted",
        rawOutput: result.parsed as unknown as Prisma.InputJsonValue,
        provider: result.provider,
        model: result.model,
        inputTokens: Math.round(result.inputTokens),
        outputTokens: Math.round(result.outputTokens),
        latencyMs: result.latencyMs,
        completedAt: new Date(),
      },
    });
    res.json({ job: updated, extracted: result.parsed, warnings });
  } catch (e) {
    await prisma.aIExtractionJob.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        errorMessage: e instanceof Error ? e.message : "Unknown error",
        completedAt: new Date(),
      },
    });
    if (e instanceof AiBudgetExceededError) {
      return res.status(402).json({
        error: e.message,
        code: e.code,
        spentUsd: e.spentUsd,
        budgetUsd: e.budgetUsd,
      });
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Extraction failed" });
  }
});
