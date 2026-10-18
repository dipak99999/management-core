import { Router } from "express";
import { z } from "zod";
import {
  decryptSecrets,
  deleteObject,
  loadS3Config,
  presignGetObject,
  presignPutObject,
  prisma,
  putObject,
} from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const attachmentRouter = Router();

attachmentRouter.use(requireAuth);

const p = perms("Attachment");

const createSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  // Base64-encoded file content. Decoded server-side; length gives us `size`.
  base64: z.string().min(1),
});

// If the tenant has a default S3 integration configured + active, uploads go
// to S3 and the row stores storageKey instead of bytes. Otherwise falls back
// to the DB-bytes path so nothing breaks for tenants without S3 set up.
async function loadS3ForTenant(tenantId: string) {
  const integration = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "s3", isActive: true, isDefault: true },
  });
  if (!integration) return null;
  try {
    return loadS3Config(decryptSecrets(integration.secrets));
  } catch {
    return null;
  }
}

function storageKey(tenantId: string, filename: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const safe = filename.replace(/[^\w.\-]+/g, "_");
  return `tenants/${tenantId}/${Date.now()}-${rand}-${safe}`;
}

// List attachments for a doc. Returns metadata only (no bytes).
attachmentRouter.get("/", p.read, async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const docId = typeof req.query.docId === "string" ? req.query.docId : undefined;
  if (!doctype || !docId)
    return res.status(400).json({ error: "doctype + docId query params required" });
  const rows = await prisma.attachment.findMany({
    where: { tenantId: req.auth!.tenantId, doctype, docId },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      storageKey: true,
      uploadedBy: true,
      uploadedAt: true,
    },
    orderBy: { uploadedAt: "desc" },
  });
  // Never leak the raw storageKey to the client — presence-only.
  res.json(rows.map(({ storageKey, ...r }) => ({ ...r, storage: storageKey ? "s3" : "db" })));
});

attachmentRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bytes = Buffer.from(parsed.data.base64, "base64");
  if (bytes.length === 0) return res.status(400).json({ error: "Empty file" });

  const tenantId = req.auth!.tenantId;
  const s3 = await loadS3ForTenant(tenantId);

  let dataFields: { bytes?: Buffer; storageKey?: string };
  if (s3) {
    const key = storageKey(tenantId, parsed.data.filename);
    try {
      await putObject(s3, key, bytes, parsed.data.mimeType);
    } catch (e) {
      return res.status(502).json({
        error: e instanceof Error ? e.message : "S3 upload failed",
      });
    }
    dataFields = { storageKey: key };
  } else {
    dataFields = { bytes };
  }

  const row = await prisma.attachment.create({
    data: {
      tenantId,
      doctype: parsed.data.doctype,
      docId: parsed.data.docId,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      size: bytes.length,
      ...dataFields,
      uploadedBy: req.auth!.userId,
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      storageKey: true,
      uploadedBy: true,
      uploadedAt: true,
    },
  });
  const { storageKey: sk, ...meta } = row;
  res.status(201).json({ ...meta, storage: sk ? "s3" : "db" });
});

// Alternate flow for browser direct-to-S3 upload. Returns a presigned PUT
// URL + the storageKey the client should send back to /finalize once the
// upload succeeds. This avoids streaming the bytes through our API.
const presignSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
});

attachmentRouter.post("/presign-upload", p.create, async (req, res) => {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const s3 = await loadS3ForTenant(tenantId);
  if (!s3) return res.status(400).json({ error: "No S3 integration configured" });
  const key = storageKey(tenantId, parsed.data.filename);
  const { url, headers } = presignPutObject(s3, key, parsed.data.mimeType, 900);
  res.json({ uploadUrl: url, headers, storageKey: key });
});

const finalizeSchema = z.object({
  doctype: z.string().min(1),
  docId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  storageKey: z.string().min(1),
  size: z.number().int().nonnegative(),
});

attachmentRouter.post("/finalize", p.create, async (req, res) => {
  const parsed = finalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  // Refuse keys that don't live under this tenant's prefix — prevents a user
  // from claiming an unrelated object.
  if (!parsed.data.storageKey.startsWith(`tenants/${tenantId}/`))
    return res.status(400).json({ error: "storageKey does not match tenant prefix" });
  const row = await prisma.attachment.create({
    data: {
      tenantId,
      doctype: parsed.data.doctype,
      docId: parsed.data.docId,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      size: parsed.data.size,
      storageKey: parsed.data.storageKey,
      uploadedBy: req.auth!.userId,
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      uploadedBy: true,
      uploadedAt: true,
    },
  });
  res.status(201).json({ ...row, storage: "s3" });
});

// Streams file bytes with Content-Disposition. If the attachment is stored in
// S3, issues a 302 to a short-lived presigned GET URL rather than piping the
// bytes through us.
//
// XSS mitigation: we NEVER serve user-uploaded HTML/SVG/JS inline. Those
// mime types force `Content-Disposition: attachment` so the browser
// downloads them instead of executing them in our origin (which would leak
// the JWT via localStorage). The additional `X-Content-Type-Options: nosniff`
// header (set globally by securityHeaders) prevents browsers from ignoring
// the declared Content-Type and rendering `xyz.png` as HTML.
const INLINE_SAFE_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
]);
function safeInlineDisposition(mimeType: string, requested: "attachment" | "inline"): "attachment" | "inline" {
  const m = mimeType.toLowerCase();
  if (requested === "attachment") return "attachment";
  return INLINE_SAFE_MIMES.has(m) ? "inline" : "attachment";
}

attachmentRouter.get("/:id/download", p.read, async (req, res) => {
  const row = await prisma.attachment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const requested = req.query.download === "1" ? "attachment" : "inline";
  const disposition = safeInlineDisposition(row.mimeType, requested);
  // Strip anything remotely suspicious from the filename before echoing it
  // in the Disposition header. Quotes, CR/LF, semicolons — all vectors for
  // header injection. Keep only word chars, dot, dash, underscore.
  const filename = row.filename.replace(/[^\w.\-]+/g, "_").slice(0, 200);

  if (row.storageKey) {
    const s3 = await loadS3ForTenant(req.auth!.tenantId);
    if (!s3) return res.status(500).json({ error: "S3 integration missing but attachment is S3-hosted" });
    const url = presignGetObject(
      s3,
      row.storageKey,
      300,
      `${disposition}; filename="${filename}"`,
    );
    return res.redirect(302, url);
  }
  if (!row.bytes) return res.status(500).json({ error: "Attachment has neither bytes nor storageKey" });
  res.setHeader("Content-Type", row.mimeType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`);
  res.setHeader("Content-Length", row.size.toString());
  // Extra belt-and-suspenders vs Content-Type sniffing on top of the global
  // nosniff header. Applies specifically to attachment payloads.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(row.bytes);
});

attachmentRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.attachment.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const isAdmin =
    req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin";
  if (existing.uploadedBy !== req.auth!.userId && !isAdmin)
    return res.status(403).json({ error: "Only the uploader can delete this attachment" });

  if (existing.storageKey) {
    const s3 = await loadS3ForTenant(req.auth!.tenantId);
    if (s3) {
      // Best-effort S3 delete; DB row goes either way.
      try {
        await deleteObject(s3, existing.storageKey);
      } catch {
        // Swallow — orphaned S3 object is preferable to a phantom DB row.
      }
    }
  }
  await prisma.attachment.delete({ where: { id: existing.id } });
  res.status(204).send();
});
