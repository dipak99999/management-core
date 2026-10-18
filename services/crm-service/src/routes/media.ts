import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  decryptSecrets,
  deleteObject,
  loadS3Config,
  presignGetObject,
  prisma,
  putObject,
} from "@lumaara/db";
import { getLogger, perms } from "@lumaara/service-auth";

// Marketing media library — per-tenant image/file store with sha256 dedup.
// Uploads flow through packages/db/src/s3.ts into
// s3://…/media/<tenantId>/<sha>.<ext>. MediaAsset row is dedup by
// (tenantId, sha256) so re-uploading the same file returns the existing row
// with no extra S3 write.
//
// Upload transport: JSON body with base64-encoded bytes (same pattern as
// auth-service/attachments — avoids adding busboy/multer to the service).
// Image dimensions are extracted via magic-byte parsing (see readImageSize)
// for PNG/JPEG/GIF/WebP without a dep on `sharp`.

export const mediaRouter = Router();
const p = perms("MediaAsset");
const log = getLogger("crm-service");
const PRESIGN_TTL_SEC = 900; // 15 minutes

// ── S3 config loader (mirrors auth-service/attachments) ────────────────
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

// ── Health ────────────────────────────────────────────────────────────
mediaRouter.get("/health", (_req, res) => {
  res.json({ ok: true, kind: "media-library" });
});

// ── Distinct folder list — put BEFORE /:id so it doesn't match the id param ─
mediaRouter.get("/folders", p.read, async (req, res) => {
  const rows = await prisma.mediaAsset.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: { folder: true },
    distinct: ["folder"],
    orderBy: { folder: "asc" },
  });
  const folders = rows.map((r) => r.folder);
  if (!folders.includes("root")) folders.unshift("root");
  res.json(folders);
});

// ── List with folder + search filter + presigned URLs ─────────────────
mediaRouter.get("/", p.read, async (req, res) => {
  const folder = typeof req.query.folder === "string" ? req.query.folder : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));

  const rows = await prisma.mediaAsset.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(folder ? { folder } : {}),
      ...(search ? { filename: { contains: search, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  const s3 = await loadS3ForTenant(req.auth!.tenantId);
  const withUrls = rows.map((r) => ({
    ...r,
    presignedUrl: s3 ? presignGetObject(s3, r.storageKey, PRESIGN_TTL_SEC) : null,
  }));
  res.json(withUrls);
});

// ── Single by id (with presigned url) ─────────────────────────────────
mediaRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.mediaAsset.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  const s3 = await loadS3ForTenant(req.auth!.tenantId);
  res.json({
    ...row,
    presignedUrl: s3 ? presignGetObject(s3, row.storageKey, PRESIGN_TTL_SEC) : null,
  });
});

// ── Upload (JSON + base64) ────────────────────────────────────────────
const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  folder: z.string().min(1).max(120).optional(),
  base64: z.string().min(1),
});

mediaRouter.post("/upload", p.create, async (req, res) => {
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bytes = Buffer.from(parsed.data.base64, "base64");
  if (bytes.length === 0) return res.status(400).json({ error: "Empty file" });

  const tenantId = req.auth!.tenantId;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const folder = (parsed.data.folder ?? "root").trim() || "root";

  // Dedup: same tenant + same sha256 → return existing row unchanged. This
  // avoids an S3 put AND avoids duplicate DB rows when a user uploads the
  // company logo 20× from different email drafts.
  const existing = await prisma.mediaAsset.findUnique({
    where: { tenantId_sha256: { tenantId, sha256 } },
  });
  if (existing) {
    const s3 = await loadS3ForTenant(tenantId);
    return res.status(200).json({
      ...existing,
      presignedUrl: s3 ? presignGetObject(s3, existing.storageKey, PRESIGN_TTL_SEC) : null,
      deduped: true,
    });
  }

  const s3 = await loadS3ForTenant(tenantId);
  if (!s3) {
    return res.status(400).json({
      error:
        "No S3 integration configured for this tenant. Configure an S3 (or S3-compatible) integration under Admin → Integrations first.",
    });
  }

  const ext = extensionFromFilename(parsed.data.filename) || extensionFromContentType(parsed.data.contentType);
  const storageKey = `media/${tenantId}/${sha256}${ext ? `.${ext}` : ""}`;

  try {
    await putObject(s3, storageKey, bytes, parsed.data.contentType);
  } catch (e) {
    return res.status(502).json({
      error: e instanceof Error ? e.message : "S3 upload failed",
    });
  }

  // Best-effort dimension extraction for images. Silent fallback on unknown /
  // unsupported formats — width/height stay null. Never blocks the upload.
  const { width, height } = readImageSize(bytes, parsed.data.contentType);

  const row = await prisma.mediaAsset.create({
    data: {
      tenantId,
      folder,
      filename: parsed.data.filename,
      storageKey,
      contentType: parsed.data.contentType,
      sizeBytes: bytes.length,
      width,
      height,
      sha256,
      uploadedBy: req.auth!.userId ?? null,
    },
  });

  res.status(201).json({
    ...row,
    presignedUrl: presignGetObject(s3, row.storageKey, PRESIGN_TTL_SEC),
    deduped: false,
  });
});

// ── Rename / re-folder ────────────────────────────────────────────────
const patchSchema = z
  .object({
    filename: z.string().min(1).max(255).optional(),
    folder: z.string().min(1).max(120).optional(),
  })
  .refine((v) => v.filename !== undefined || v.folder !== undefined, {
    message: "Provide filename and/or folder",
  });

mediaRouter.patch("/:id", p.write, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.mediaAsset.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.filename !== undefined ? { filename: parsed.data.filename } : {}),
      ...(parsed.data.folder !== undefined ? { folder: parsed.data.folder.trim() || "root" } : {}),
    },
  });
  const s3 = await loadS3ForTenant(req.auth!.tenantId);
  res.json({
    ...row,
    presignedUrl: s3 ? presignGetObject(s3, row.storageKey, PRESIGN_TTL_SEC) : null,
  });
});

// ── Delete (S3 best-effort, DB row always) ────────────────────────────
mediaRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.mediaAsset.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  // Only remove the S3 object if no OTHER MediaAsset row in this tenant
  // shares the same storageKey (dedup keeps them stable, but a manual DB
  // insert could theoretically create a collision — cheap guard).
  const s3 = await loadS3ForTenant(req.auth!.tenantId);
  if (s3) {
    try {
      await deleteObject(s3, existing.storageKey);
    } catch (e) {
      log.warn("media: S3 delete failed (orphan object left)", {
        storageKey: existing.storageKey,
        error: e instanceof Error ? e.message : String(e),
      });
      // Continue — orphaned S3 object is preferable to a phantom DB row.
    }
  }
  await prisma.mediaAsset.delete({ where: { id: existing.id } });
  res.status(204).end();
});

// ── Helpers (exported for tests) ──────────────────────────────────────

export function extensionFromFilename(filename: string): string {
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(filename);
  return m ? m[1].toLowerCase() : "";
}

export function extensionFromContentType(ct: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/html": "html",
  };
  return map[ct.toLowerCase()] ?? "";
}

// Magic-byte image size detector for PNG/JPEG/GIF/WebP. Returns
// {width:null,height:null} for anything else (SVG, non-image, malformed).
// This is deliberately dep-free — sharp works but isn't a declared dep of
// crm-service so we avoid the strict-peer resolution risk in pnpm.
export function readImageSize(
  bytes: Buffer,
  contentType: string,
): { width: number | null; height: number | null } {
  try {
    const ct = contentType.toLowerCase();
    // PNG: signature + IHDR chunk starts at byte 16 (width) / 20 (height), BE u32.
    if (ct === "image/png" && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    // GIF: signature GIF87a/GIF89a, then LE u16 width @6, height @8.
    if (ct === "image/gif" && bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    // WebP: RIFF....WEBP; VP8/VP8L/VP8X sub-chunks carry the size.
    if (ct === "image/webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
      const fourcc = bytes.toString("ascii", 12, 16);
      if (fourcc === "VP8 " && bytes.length >= 30) {
        // Lossy: skip 3 bytes tag + 3 bytes start code, then 14-bit LE dims.
        const w = bytes.readUInt16LE(26) & 0x3fff;
        const h = bytes.readUInt16LE(28) & 0x3fff;
        return { width: w, height: h };
      }
      if (fourcc === "VP8L" && bytes.length >= 25) {
        const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
        const w = 1 + (((b1 & 0x3f) << 8) | b0);
        const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width: w, height: h };
      }
      if (fourcc === "VP8X" && bytes.length >= 30) {
        // 24-bit LE width-1 @ 24, height-1 @ 27.
        const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width: w, height: h };
      }
    }
    // JPEG: scan SOFn markers (0xFFC0..0xFFCF except DHT/DAC/DNL).
    if ((ct === "image/jpeg" || ct === "image/jpg") && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue; }
        // Skip fill bytes.
        while (i < bytes.length && bytes[i] === 0xff) i++;
        const marker = bytes[i]; i++;
        if (marker === 0xd8 || marker === 0xd9) continue;                // SOI/EOI
        if (marker >= 0xd0 && marker <= 0xd7) continue;                  // RSTn
        const segLen = bytes.readUInt16BE(i);
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          if (i + 7 <= bytes.length) {
            const h = bytes.readUInt16BE(i + 3);
            const w = bytes.readUInt16BE(i + 5);
            return { width: w, height: h };
          }
        }
        i += segLen;
      }
    }
  } catch {
    // Malformed image — fall through to null/null.
  }
  return { width: null, height: null };
}
