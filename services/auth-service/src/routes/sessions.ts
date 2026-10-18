import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const sessionRouter = Router();

sessionRouter.use(requireAuth);

// List all sessions for the current user (both active and revoked). "Current
// session" flag helps the UI so a user can't accidentally kill their own tab.
sessionRouter.get("/", async (req, res) => {
  const rows = await prisma.userSession.findMany({
    where: { userId: req.auth!.userId },
    orderBy: [{ revokedAt: "asc" }, { lastActiveAt: "desc" }],
    select: {
      id: true,
      jti: true,
      userAgent: true,
      ipAddress: true,
      lastActiveAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  // The JWT that authenticated this call carries a jti; find it so the UI can
  // flag "current session".
  const authHeader = req.header("authorization") ?? "";
  const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // JWT payload is the 2nd base64url segment — cheap parse w/o verify (we
  // already know the token is valid because we're past requireAuth).
  let currentJti: string | null = null;
  try {
    const seg = raw.split(".")[1];
    if (seg) {
      const payload = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
      if (typeof payload.jti === "string") currentJti = payload.jti;
    }
  } catch {
    // ignore
  }
  res.json({ sessions: rows, currentJti });
});

sessionRouter.post("/:id/revoke", async (req, res) => {
  const row = await prisma.userSession.findFirst({
    where: { id: req.params.id, userId: req.auth!.userId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.revokedAt) return res.status(400).json({ error: "Already revoked" });
  const updated = await prisma.userSession.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  res.json(updated);
});

// Revoke every other session (i.e. sign out everywhere else). Uses the auth
// header jti to preserve the current session.
sessionRouter.post("/revoke-others", async (req, res) => {
  const authHeader = req.header("authorization") ?? "";
  const raw = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let currentJti: string | null = null;
  try {
    const seg = raw.split(".")[1];
    if (seg) {
      const payload = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
      if (typeof payload.jti === "string") currentJti = payload.jti;
    }
  } catch {
    // ignore
  }
  const result = await prisma.userSession.updateMany({
    where: {
      userId: req.auth!.userId,
      revokedAt: null,
      ...(currentJti ? { NOT: { jti: currentJti } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  res.json({ revoked: result.count });
});
