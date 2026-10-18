// Super-admin API for platform-level AI provider config. Lets the owner
// configure one or more LLM credentials (Claude, OpenAI, Brew, Azure,
// Ollama) that act as a fallback for any tenant without their own
// TenantIntegration row. UI lives at /admin/super/ai-providers.
//
// Endpoints:
//   GET    /super/ai-providers              list all (apiKey redacted)
//   POST   /super/ai-providers              create
//   PATCH  /super/ai-providers/:id          update (apiKey optional)
//   DELETE /super/ai-providers/:id          delete
//   POST   /super/ai-providers/:id/test     round-trip test the live config
//   POST   /super/ai-providers/:id/activate switch default
//
// Secrets handling: `apiKey` is accepted in plaintext from the UI and
// written through encryptSecrets(). On GET we never return the apiKey —
// the UI shows a "configured" badge instead so the operator rotates by
// re-entering, never by reading the old value.

import { Router } from "express";
import { z } from "zod";
import {
  prisma,
  encryptSecrets,
  decryptSecrets,
  buildChatProviderFromSecrets,
  type ChatProviderKind,
} from "@lumaara/db";
import { auditSuperAdmin, requireAuth, requireSuperAdmin } from "@lumaara/service-auth";

export const superAiProvidersRouter = Router();
superAiProvidersRouter.use(requireAuth, requireSuperAdmin, auditSuperAdmin("super-ai-providers"));

const PROVIDER_SLUGS = ["anthropic", "openai", "brew", "azure-openai", "ollama"] as const;

const createSchema = z.object({
  provider: z.enum(PROVIDER_SLUGS),
  label: z.string().min(1).max(80),
  apiKey: z.string().min(1).max(500).optional(), // ollama can skip
  baseUrl: z.string().url().max(500).optional(),
  defaultModel: z.string().min(1).max(120).optional(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  priority: z.coerce.number().int().min(0).max(10_000).default(100),
});
const patchSchema = createSchema.partial();

// Public shape: strip secrets, add a derived `hasApiKey` boolean.
function redact(row: {
  id: string;
  provider: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  defaultModel: string | null;
  baseUrl: string | null;
  secrets: unknown;
  lastTestedAt: Date | null;
  lastTestResult: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  let hasApiKey = false;
  try {
    const s = decryptSecrets(row.secrets as never);
    hasApiKey = typeof s.apiKey === "string" && s.apiKey.length > 0;
  } catch {
    // bad ciphertext → treat as missing
  }
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    isActive: row.isActive,
    isDefault: row.isDefault,
    priority: row.priority,
    defaultModel: row.defaultModel,
    baseUrl: row.baseUrl,
    hasApiKey,
    lastTestedAt: row.lastTestedAt,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

superAiProvidersRouter.get("/", async (_req, res) => {
  const rows = await prisma.platformAiProvider.findMany({
    orderBy: [{ isDefault: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
  });
  res.json(rows.map(redact));
});

superAiProvidersRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { apiKey, isDefault, ...rest } = parsed.data;

  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.platformAiProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    return tx.platformAiProvider.create({
      data: {
        ...rest,
        isDefault,
        secrets: encryptSecrets({ apiKey: apiKey ?? "" }) as never,
      },
    });
  });
  res.status(201).json(redact(row));
});

superAiProvidersRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.platformAiProvider.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const { apiKey, isDefault, ...rest } = parsed.data;
  const row = await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.platformAiProvider.updateMany({
        where: { isDefault: true, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }
    // Only overwrite secrets when apiKey is provided — leaving the field
    // blank in the UI preserves the stored key (standard "redacted secret"
    // UX from most SaaS integration pages).
    const nextSecrets =
      apiKey !== undefined
        ? (encryptSecrets({ apiKey }) as never)
        : undefined;
    return tx.platformAiProvider.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(isDefault !== undefined ? { isDefault } : {}),
        ...(nextSecrets ? { secrets: nextSecrets } : {}),
      },
    });
  });
  res.json(redact(row));
});

superAiProvidersRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.platformAiProvider.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.platformAiProvider.delete({ where: { id: existing.id } });
  res.status(204).end();
});

superAiProvidersRouter.post("/:id/activate", async (req, res) => {
  const existing = await prisma.platformAiProvider.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.$transaction(async (tx) => {
    await tx.platformAiProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await tx.platformAiProvider.update({
      where: { id: existing.id },
      data: { isDefault: true, isActive: true },
    });
  });
  const row = await prisma.platformAiProvider.findUnique({ where: { id: existing.id } });
  res.json(redact(row!));
});

superAiProvidersRouter.post("/:id/test", async (req, res) => {
  const row = await prisma.platformAiProvider.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: "Not found" });
  let apiKey = "";
  try {
    const s = decryptSecrets(row.secrets as never);
    apiKey = typeof s.apiKey === "string" ? s.apiKey : "";
  } catch {
    return res.status(400).json({ error: "Stored key is corrupt — re-save the provider" });
  }
  try {
    const provider = buildChatProviderFromSecrets({
      provider: row.provider as ChatProviderKind,
      apiKey,
      baseUrl: row.baseUrl ?? undefined,
      defaultModel: row.defaultModel ?? undefined,
    });
    const result = await provider.chat(
      "You are a connectivity test. Reply with the single word OK.",
      [{ role: "user", content: "ping" }],
    );
    await prisma.platformAiProvider.update({
      where: { id: row.id },
      data: { lastTestedAt: new Date(), lastTestResult: "ok" },
    });
    res.json({
      ok: true,
      provider: result.provider,
      model: result.model,
      snippet: result.text.slice(0, 160),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.platformAiProvider.update({
      where: { id: row.id },
      data: { lastTestedAt: new Date(), lastTestResult: msg.slice(0, 300) },
    });
    res.status(502).json({ ok: false, error: msg });
  }
});
