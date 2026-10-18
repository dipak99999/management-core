import { Router } from "express";
import { z } from "zod";
import {
  decryptSecrets,
  esignProviderFromSecrets,
  nextName,
  prisma,
  type ESignSigner,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const esignRouter = Router();
export const publicSignRouter = Router();

const pE = perms("SignatureEnvelope");

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  order: z.coerce.number().int().min(1).optional(),
  role: z.string().optional().nullable(),
});

const createSchema = z.object({
  subject: z.string().min(1).max(300),
  message: z.string().optional().nullable(),
  documentUrl: z.string().url().optional().nullable(),
  documentBase64: z.string().optional().nullable(),
  sourceDoctype: z.string().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  sequential: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
  provider: z.enum(["Stub", "DocuSign", "ZohoSign"]).default("Stub"),
  signers: z.array(signerSchema).min(1),
});

esignRouter.get("/", pE.read, async (req, res) => {
  const rows = await prisma.signatureEnvelope.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: { signers: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

esignRouter.get("/:id", pE.read, async (req, res) => {
  const row = await prisma.signatureEnvelope.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { signers: { orderBy: { order: "asc" } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

esignRouter.post("/", pE.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "ENV-");
  const row = await prisma.signatureEnvelope.create({
    data: {
      tenantId,
      name,
      subject: b.subject,
      message: b.message ?? null,
      documentUrl: b.documentUrl ?? null,
      sourceDoctype: b.sourceDoctype ?? null,
      sourceId: b.sourceId ?? null,
      sequential: b.sequential,
      expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
      provider: b.provider,
      createdBy: req.auth!.userId,
      signers: {
        create: b.signers.map((s, i) => ({
          tenantId,
          order: b.sequential ? s.order ?? i + 1 : 0,
          signerName: s.name,
          signerEmail: s.email.toLowerCase(),
          role: s.role ?? null,
        })),
      },
    },
    include: { signers: true },
  });
  res.status(201).json(row);
});

esignRouter.post("/:id/send", pE.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const env = await prisma.signatureEnvelope.findFirst({
    where: { id: req.params.id, tenantId },
    include: { signers: { orderBy: { order: "asc" } } },
  });
  if (!env) return res.status(404).json({ error: "Not found" });
  if (env.status !== "Draft") {
    return res.status(400).json({ error: `Cannot send envelope in status ${env.status}` });
  }
  if (env.signers.length === 0) return res.status(400).json({ error: "No signers on envelope" });
  if (!env.documentUrl) return res.status(400).json({ error: "documentUrl required to send" });

  // Resolve the provider adapter from a matching TenantIntegration.
  // The Stub path uses the platform's own /public/sign/:token page — but
  // only hard-ships emails to signers if the operator has explicitly
  // opted into it. In production, Stub mode is disabled by default
  // because the earlier behavior silently marked envelopes "Sent"
  // without notifying signers.
  let externalId: string | null = null;
  if (env.provider === "Stub") {
    const allowStub =
      process.env.NODE_ENV !== "production" ||
      process.env.ESIGN_ALLOW_STUB === "1";
    if (!allowStub) {
      return res.status(503).json({
        error:
          "E-signature not configured. Pick a real provider (DocuSign / ZohoSign) in Settings → Integrations, or set ESIGN_ALLOW_STUB=1 to accept the self-hosted flow.",
      });
    }
  } else {
    const integration = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: env.provider, isActive: true },
    });
    if (!integration) {
      return res.status(400).json({ error: `No active ${env.provider} integration configured` });
    }
    const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
    const provider = esignProviderFromSecrets({ ...secrets, provider: env.provider });
    const signersInput: ESignSigner[] = env.signers.map((s) => ({
      name: s.signerName,
      email: s.signerEmail,
      order: s.order,
      role: s.role ?? undefined,
    }));
    const result = await provider.send({
      subject: env.subject,
      message: env.message,
      documentUrl: env.documentUrl,
      signers: signersInput,
      sequential: env.sequential,
    });
    externalId = result.externalId;
  }

  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    // Only the first signer gets Sent on send when sequential; others
    // wait until predecessors sign.
    for (const [i, s] of env.signers.entries()) {
      const shouldSend = !env.sequential || i === 0;
      await tx.signatureRequest.update({
        where: { id: s.id },
        data: shouldSend ? { status: "Sent" } : {},
      });
    }
    return tx.signatureEnvelope.update({
      where: { id: env.id },
      data: {
        status: "Sent",
        externalId,
        sentAt: now,
      },
      include: { signers: { orderBy: { order: "asc" } } },
    });
  });
  res.json(row);
});

esignRouter.post("/:id/void", pE.cancel, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "Voided by operator";
  const env = await prisma.signatureEnvelope.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!env) return res.status(404).json({ error: "Not found" });
  if (env.status === "Voided" || env.status === "Completed") {
    return res.status(400).json({ error: `Cannot void envelope in status ${env.status}` });
  }
  if (env.externalId && env.provider !== "Stub") {
    const integration = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: env.provider, isActive: true },
    });
    if (integration) {
      const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
      try {
        await esignProviderFromSecrets({ ...secrets, provider: env.provider }).void(env.externalId, reason);
      } catch {
        // continue with local void
      }
    }
  }
  const row = await prisma.signatureEnvelope.update({
    where: { id: env.id },
    data: { status: "Voided" },
  });
  res.json(row);
});

// Public sign — anyone with the accessToken can view + sign. Landing UI
// posts to /confirm with the operator's declared consent.

publicSignRouter.get("/:token", async (req, res) => {
  const row = await prisma.signatureRequest.findUnique({
    where: { accessToken: req.params.token },
    include: {
      envelope: { select: { subject: true, message: true, documentUrl: true, status: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.envelope.status !== "Sent") {
    return res.status(400).json({ error: `Envelope is ${row.envelope.status}` });
  }
  if (row.status !== "Sent") {
    return res.status(400).json({ error: `Request status is ${row.status}` });
  }
  res.json({
    subject: row.envelope.subject,
    message: row.envelope.message,
    documentUrl: row.envelope.documentUrl,
    signer: { name: row.signerName, email: row.signerEmail, role: row.role },
  });
});

const confirmSchema = z.object({
  agreed: z.literal(true),
});

publicSignRouter.post("/:token/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.signatureRequest.findUnique({
    where: { accessToken: req.params.token },
    include: { envelope: { include: { signers: { orderBy: { order: "asc" } } } } },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "Sent") return res.status(400).json({ error: "Not open for signing" });

  const now = new Date();
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.signatureRequest.update({
      where: { id: row.id },
      data: { status: "Signed", signedAt: now, signedIp: ip },
    });
    // If sequential, advance the next Pending signer to Sent.
    if (row.envelope.sequential) {
      const next = row.envelope.signers.find((s) => s.order > row.order && s.status === "Pending");
      if (next) {
        await tx.signatureRequest.update({
          where: { id: next.id },
          data: { status: "Sent" },
        });
      }
    }
    // Mark envelope Completed once every signer has signed.
    const remaining = await tx.signatureRequest.count({
      where: { envelopeId: row.envelopeId, status: { notIn: ["Signed"] } },
    });
    if (remaining === 0) {
      await tx.signatureEnvelope.update({
        where: { id: row.envelopeId },
        data: { status: "Completed", completedAt: now },
      });
    }
  });
  res.json({ ok: true });
});

const declineSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

publicSignRouter.post("/:token/decline", async (req, res) => {
  const parsed = declineSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await prisma.signatureRequest.findUnique({
    where: { accessToken: req.params.token },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  await prisma.$transaction(async (tx) => {
    await tx.signatureRequest.update({
      where: { id: row.id },
      data: { status: "Declined", declineReason: parsed.data.reason ?? null },
    });
    await tx.signatureEnvelope.update({
      where: { id: row.envelopeId },
      data: { status: "Declined" },
    });
  });
  res.json({ ok: true });
});
