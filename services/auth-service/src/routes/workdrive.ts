import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@lumaara/db";
import { BCRYPT_COST, perms, requireAuth } from "@lumaara/service-auth";

// Zoho-WorkDrive-style file library. Standalone hierarchical file system
// distinct from doctype-scoped Attachments. Folders form a tree; files
// carry an immutable version history; public share links let external users
// download a specific file (optionally password-protected + expiring).
//
// Storage: DB bytes only for MVP simplicity — matches the existing
// Attachment fallback path. S3 could be layered on later by populating
// `storageKey` instead of `bytes` (schema supports both).

export const workdriveRouter = Router();
export const workdrivePublicRouter = Router();

workdriveRouter.use(requireAuth);

const folderPerms = perms("WorkDriveFolder");
const filePerms   = perms("WorkDriveFile");
const sharePerms  = perms("WorkDriveFile"); // shares gated by file perms

/* ─────────────────────────────── FOLDERS ──────────────────────────────── */

const folderUpsert = z.object({
  name: z.string().min(1).max(240),
  parentId: z.string().nullable().optional(),
});

// List folders under a parent (parentId null → root).
workdriveRouter.get("/folders", folderPerms.read, async (req, res) => {
  const parentId = typeof req.query.parentId === "string" ? req.query.parentId : null;
  const rows = await prisma.workDriveFolder.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      parentId: parentId === "root" || !parentId ? null : parentId,
      deletedAt: null,
    },
    include: { _count: { select: { children: true, files: true } } },
    orderBy: [{ name: "asc" }],
  });
  res.json(rows);
});

// Breadcrumb — walk parents up to root.
workdriveRouter.get("/folders/:id/breadcrumb", folderPerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const chain: { id: string; name: string }[] = [];
  let current = await prisma.workDriveFolder.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, name: true, parentId: true },
  });
  if (!current) return res.status(404).json({ error: "Not found" });
  while (current) {
    chain.unshift({ id: current.id, name: current.name });
    if (!current.parentId) break;
    current = await prisma.workDriveFolder.findFirst({
      where: { id: current.parentId, tenantId },
      select: { id: true, name: true, parentId: true },
    });
  }
  res.json(chain);
});

workdriveRouter.post("/folders", folderPerms.create, async (req, res) => {
  const parsed = folderUpsert.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  if (parsed.data.parentId) {
    const parent = await prisma.workDriveFolder.findFirst({
      where: { id: parsed.data.parentId, tenantId, deletedAt: null },
    });
    if (!parent) return res.status(400).json({ error: "Invalid parent folder" });
  }
  const row = await prisma.workDriveFolder.create({
    data: {
      tenantId,
      name: parsed.data.name,
      parentId: parsed.data.parentId ?? null,
      createdByUserId: req.auth!.userId,
    },
  });
  res.status(201).json(row);
});

workdriveRouter.put("/folders/:id", folderPerms.write, async (req, res) => {
  const parsed = folderUpsert.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.workDriveFolder.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  // Prevent moving into a descendant of itself — walk up from proposed parent.
  if (parsed.data.parentId && parsed.data.parentId !== existing.parentId) {
    let cur = parsed.data.parentId;
    while (cur) {
      if (cur === existing.id)
        return res.status(400).json({ error: "Cannot move a folder into itself" });
      const p = await prisma.workDriveFolder.findFirst({
        where: { id: cur, tenantId: req.auth!.tenantId },
        select: { parentId: true },
      });
      if (!p) break;
      cur = p.parentId ?? "";
    }
  }
  const row = await prisma.workDriveFolder.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name ?? undefined,
      parentId: parsed.data.parentId === undefined ? undefined : parsed.data.parentId,
    },
  });
  res.json(row);
});

// Soft-delete: mark folder + descendants + files as trashed (recursive walk).
workdriveRouter.delete("/folders/:id", folderPerms.delete, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const existing = await prisma.workDriveFolder.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const now = new Date();
  const toWalk: string[] = [existing.id];
  const collected: string[] = [];
  while (toWalk.length) {
    const cur = toWalk.pop()!;
    collected.push(cur);
    const kids = await prisma.workDriveFolder.findMany({
      where: { parentId: cur, tenantId },
      select: { id: true },
    });
    toWalk.push(...kids.map((k) => k.id));
  }
  await prisma.$transaction([
    prisma.workDriveFolder.updateMany({
      where: { id: { in: collected }, tenantId },
      data: { deletedAt: now },
    }),
    prisma.workDriveFile.updateMany({
      where: { folderId: { in: collected }, tenantId },
      data: { deletedAt: now },
    }),
  ]);
  res.status(204).send();
});

/* ─────────────────────────────── FILES ────────────────────────────────── */

const fileUpload = z.object({
  folderId: z.string().nullable().optional(), // null = root
  name: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  base64: z.string().min(1),
  note: z.string().max(500).optional(),
});

// List files in a folder (or root). Returns metadata only.
workdriveRouter.get("/files", filePerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const q: {
    folderId?: string | null;
    starred?: boolean;
    trashed?: boolean;
    search?: string;
  } = {};
  if (typeof req.query.folderId === "string") {
    q.folderId = req.query.folderId === "root" ? null : req.query.folderId;
  }
  if (req.query.starred === "true") q.starred = true;
  if (req.query.trashed === "true") q.trashed = true;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;

  const rows = await prisma.workDriveFile.findMany({
    where: {
      tenantId,
      ...(q.folderId !== undefined ? { folderId: q.folderId } : {}),
      ...(q.starred ? { starred: true } : {}),
      deletedAt: q.trashed ? { not: null } : null,
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    },
    select: {
      id: true,
      folderId: true,
      name: true,
      mimeType: true,
      size: true,
      starred: true,
      deletedAt: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { versions: true, comments: true, shareLinks: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
  });
  res.json(rows);
});

workdriveRouter.get("/files/:id", filePerms.read, async (req, res) => {
  const row = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      versions: {
        select: {
          id: true,
          version: true,
          size: true,
          mimeType: true,
          uploadedByUserId: true,
          note: true,
          createdAt: true,
        },
        orderBy: { version: "desc" },
      },
      comments: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Upload — creates a new file OR a new version if a file with the same name
// already exists in the same folder (Zoho behavior).
workdriveRouter.post("/files", filePerms.create, async (req, res) => {
  const parsed = fileUpload.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const bytes = Buffer.from(parsed.data.base64, "base64");
  if (bytes.length === 0) return res.status(400).json({ error: "Empty file" });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const folderId = parsed.data.folderId ?? null;
  if (folderId) {
    const f = await prisma.workDriveFolder.findFirst({
      where: { id: folderId, tenantId, deletedAt: null },
    });
    if (!f) return res.status(400).json({ error: "Invalid folder" });
  }

  const existing = await prisma.workDriveFile.findFirst({
    where: { tenantId, folderId, name: parsed.data.name, deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (existing) {
    const nextVersion = (existing.versions[0]?.version ?? 0) + 1;
    const [, file] = await prisma.$transaction([
      prisma.workDriveFileVersion.create({
        data: {
          fileId: existing.id,
          version: nextVersion,
          size: bytes.length,
          mimeType: parsed.data.mimeType,
          bytes,
          uploadedByUserId: userId,
          note: parsed.data.note ?? null,
        },
      }),
      prisma.workDriveFile.update({
        where: { id: existing.id },
        data: { size: bytes.length, mimeType: parsed.data.mimeType, updatedAt: new Date() },
      }),
    ]);
    return res.status(200).json({ ...file, versioned: true, version: nextVersion });
  }

  const created = await prisma.workDriveFile.create({
    data: {
      tenantId,
      folderId,
      name: parsed.data.name,
      mimeType: parsed.data.mimeType,
      size: bytes.length,
      createdByUserId: userId,
      versions: {
        create: {
          version: 1,
          size: bytes.length,
          mimeType: parsed.data.mimeType,
          bytes,
          uploadedByUserId: userId,
          note: parsed.data.note ?? "Initial upload",
        },
      },
    },
  });
  res.status(201).json({ ...created, versioned: false, version: 1 });
});

// Download latest version (or a specific version if ?version= is supplied).
workdriveRouter.get("/files/:id/download", filePerms.read, async (req, res) => {
  const file = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!file) return res.status(404).json({ error: "Not found" });
  const versionParam = typeof req.query.version === "string" ? Number(req.query.version) : undefined;
  const v = await prisma.workDriveFileVersion.findFirst({
    where: {
      fileId: file.id,
      ...(versionParam ? { version: versionParam } : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!v || !v.bytes) return res.status(404).json({ error: "Version not found" });
  res.setHeader("Content-Type", v.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.name.replace(/"/g, "")}"`);
  res.send(Buffer.from(v.bytes));
});

// Rename / move / star toggle.
workdriveRouter.put("/files/:id", filePerms.write, async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(240).optional(),
      folderId: z.string().nullable().optional(),
      starred: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (parsed.data.folderId) {
    const f = await prisma.workDriveFolder.findFirst({
      where: { id: parsed.data.folderId, tenantId: req.auth!.tenantId, deletedAt: null },
    });
    if (!f) return res.status(400).json({ error: "Invalid destination folder" });
  }
  const row = await prisma.workDriveFile.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name ?? undefined,
      folderId: parsed.data.folderId === undefined ? undefined : parsed.data.folderId,
      starred: parsed.data.starred ?? undefined,
    },
  });
  res.json(row);
});

// Trash a file (soft delete).
workdriveRouter.delete("/files/:id", filePerms.delete, async (req, res) => {
  const existing = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.workDriveFile.update({
    where: { id: existing.id },
    data: { deletedAt: existing.deletedAt ? null : new Date() },
  });
  res.status(204).send();
});

// Restore from trash.
workdriveRouter.post("/files/:id/restore", filePerms.write, async (req, res) => {
  const existing = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.workDriveFile.update({ where: { id: existing.id }, data: { deletedAt: null } });
  res.json({ ok: true });
});

// Purge — permanently delete trashed file + all versions.
workdriveRouter.post("/files/:id/purge", filePerms.delete, async (req, res) => {
  const existing = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (!existing.deletedAt)
    return res.status(400).json({ error: "Trash a file before purging" });
  await prisma.workDriveFile.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ─────────────────────────────── COMMENTS ─────────────────────────────── */

workdriveRouter.post("/files/:id/comments", filePerms.write, async (req, res) => {
  const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const file = await prisma.workDriveFile.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!file) return res.status(404).json({ error: "File not found" });
  const row = await prisma.workDriveComment.create({
    data: { fileId: file.id, userId: req.auth!.userId, body: parsed.data.body },
  });
  res.status(201).json(row);
});

workdriveRouter.delete("/comments/:id", filePerms.delete, async (req, res) => {
  const existing = await prisma.workDriveComment.findFirst({
    where: { id: req.params.id, file: { tenantId: req.auth!.tenantId } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.workDriveComment.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ─────────────────────────────── SHARE LINKS ──────────────────────────── */

function newToken() {
  return randomBytes(24).toString("base64url");
}

const shareCreate = z.object({
  fileId: z.string().min(1),
  label: z.string().max(120).optional(),
  password: z.string().min(4).max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

workdriveRouter.post("/share-links", sharePerms.write, async (req, res) => {
  const parsed = shareCreate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const file = await prisma.workDriveFile.findFirst({
    where: { id: parsed.data.fileId, tenantId: req.auth!.tenantId },
  });
  if (!file) return res.status(404).json({ error: "File not found" });
  const link = await prisma.workDriveShareLink.create({
    data: {
      tenantId: req.auth!.tenantId,
      fileId: file.id,
      token: newToken(),
      createdByUserId: req.auth!.userId,
      label: parsed.data.label ?? null,
      passwordHash: parsed.data.password ? await bcrypt.hash(parsed.data.password, BCRYPT_COST) : null,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });
  res.status(201).json({
    ...link,
    passwordHash: undefined,
    isPasswordProtected: !!link.passwordHash,
  });
});

workdriveRouter.get("/share-links", sharePerms.read, async (req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : undefined;
  const rows = await prisma.workDriveShareLink.findMany({
    where: { tenantId: req.auth!.tenantId, ...(fileId ? { fileId } : {}) },
    include: { file: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(
    rows.map((r) => ({ ...r, passwordHash: undefined, isPasswordProtected: !!r.passwordHash })),
  );
});

workdriveRouter.post("/share-links/:id/toggle", sharePerms.write, async (req, res) => {
  const existing = await prisma.workDriveShareLink.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.workDriveShareLink.update({
    where: { id: existing.id },
    data: { isActive: !existing.isActive },
  });
  res.json({ ...row, passwordHash: undefined, isPasswordProtected: !!row.passwordHash });
});

workdriveRouter.delete("/share-links/:id", sharePerms.delete, async (req, res) => {
  const existing = await prisma.workDriveShareLink.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.workDriveShareLink.delete({ where: { id: existing.id } });
  res.status(204).send();
});

/* ──────────────────────── PUBLIC SHARE ENDPOINTS ──────────────────────── */
//
// Mounted at `/public/drive/shares/:token` — no requireAuth.

async function loadShare(token: string) {
  return prisma.workDriveShareLink.findUnique({
    where: { token },
    include: { file: true },
  });
}

workdrivePublicRouter.get("/shares/:token", async (req, res) => {
  const share = await loadShare(req.params.token);
  if (!share || !share.isActive) return res.status(404).json({ error: "Not found" });
  if (share.expiresAt && share.expiresAt < new Date())
    return res.status(410).json({ error: "Share link has expired" });
  if (share.file.deletedAt)
    return res.status(410).json({ error: "File has been removed" });
  res.json({
    fileName: share.file.name,
    mimeType: share.file.mimeType,
    size: share.file.size,
    isPasswordProtected: !!share.passwordHash,
    expiresAt: share.expiresAt,
  });
});

// Public download — validates password (if set), then streams the latest
// version bytes.
workdrivePublicRouter.post("/shares/:token/download", async (req, res) => {
  const share = await loadShare(req.params.token);
  if (!share || !share.isActive) return res.status(404).json({ error: "Not found" });
  if (share.expiresAt && share.expiresAt < new Date())
    return res.status(410).json({ error: "Share link has expired" });
  if (share.file.deletedAt)
    return res.status(410).json({ error: "File has been removed" });

  if (share.passwordHash) {
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";
    const ok = await bcrypt.compare(supplied, share.passwordHash);
    if (!ok) return res.status(401).json({ error: "Password required or incorrect" });
  }

  const v = await prisma.workDriveFileVersion.findFirst({
    where: { fileId: share.fileId },
    orderBy: { version: "desc" },
  });
  if (!v || !v.bytes) return res.status(404).json({ error: "No content" });

  await prisma.workDriveShareLink.update({
    where: { id: share.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });

  res.setHeader("Content-Type", v.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${share.file.name.replace(/"/g, "")}"`,
  );
  res.send(Buffer.from(v.bytes));
});
