import { Router } from "express";
import { prisma } from "@lumaara/db";

// Integration health — reports which of the pluggable providers the
// tenant has wired. Used by the admin UI to prevent "surprise 503" when a
// user tries to send an SMS / sign a document / generate an IRN.
//
// Each entry: provider key, configured (true/false), active (flag on the
// row), optional label. Does NOT return any secrets — only presence.

export const integrationHealthRouter = Router();

interface HealthEntry {
  provider: string;
  category: string;
  label: string;
  configured: boolean;
  active: boolean;
  note?: string;
}

// Static list of integrations we care about. The lookup is a simple
// `tenantIntegration` query matching `provider`. Extend as new provider
// types are added.
const CHECKS: Array<{ provider: string; category: string; label: string; note?: string }> = [
  { provider: "sms",       category: "Messaging",  label: "SMS (Twilio / MSG91)", note: "Required for OTP + outbound SMS" },
  { provider: "whatsapp",  category: "Messaging",  label: "WhatsApp Business API" },
  { provider: "irp",       category: "Compliance", label: "E-Invoicing (India IRP)", note: "Required for GSTR-1 submission" },
  { provider: "DocuSign",  category: "Signatures", label: "DocuSign" },
  { provider: "ZohoSign",  category: "Signatures", label: "Zoho Sign" },
  { provider: "s3",        category: "Backup",     label: "S3 off-site backup" },
  { provider: "linkedin",  category: "Social",     label: "LinkedIn posting" },
  { provider: "facebook",  category: "Social",     label: "Facebook posting" },
  { provider: "twitter",   category: "Social",     label: "X / Twitter posting" },
  { provider: "instagram", category: "Social",     label: "Instagram posting" },
  { provider: "zoom",      category: "Webinars",   label: "Zoom" },
  { provider: "webex",     category: "Webinars",   label: "Cisco Webex" },
  { provider: "googlemeet",category: "Webinars",   label: "Google Meet" },
  { provider: "LLMRouter", category: "AI",         label: "LLM Router (OpenAI / Anthropic / etc)" },
];

integrationHealthRouter.get("/health", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.tenantIntegration.findMany({
    where: { tenantId, provider: { in: CHECKS.map((c) => c.provider) } },
    select: { provider: true, isActive: true },
  });
  // Group rows by provider — a tenant could have multiple rows for the
  // same provider (one per sub-provider via config.provider). For health
  // we only report presence + at-least-one-active.
  const byProvider = new Map<string, { any: boolean; active: boolean }>();
  for (const r of rows) {
    const prev = byProvider.get(r.provider) ?? { any: false, active: false };
    byProvider.set(r.provider, {
      any: true,
      active: prev.active || r.isActive,
    });
  }
  const entries: HealthEntry[] = CHECKS.map((c) => {
    const state = byProvider.get(c.provider);
    return {
      provider: c.provider,
      category: c.category,
      label: c.label,
      configured: state?.any ?? false,
      active: state?.active ?? false,
      note: c.note,
    };
  });

  // Also check the PlatformAiProvider — the AI router can be wired at the
  // platform level without a tenant row (shared fallback).
  const platformAi = await prisma.platformAiProvider.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (platformAi) {
    const idx = entries.findIndex((e) => e.provider === "LLMRouter");
    if (idx >= 0 && !entries[idx].configured) {
      entries[idx] = { ...entries[idx], configured: true, active: true, note: "Platform-level AI provider active" };
    }
  }

  const configured = entries.filter((e) => e.active).length;
  const total = entries.length;
  res.json({
    tenantId,
    configured,
    total,
    coverage: Math.round((configured / total) * 100),
    entries,
  });
});
