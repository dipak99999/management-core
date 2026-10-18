import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@lumaara/db";
import { PORTAL_JWT_SECRET as PORTAL_SECRET } from "./secrets";

// K3: Portal JWT middleware. Separate namespace from staff auth — different
// audience ("portal") and different req property (`req.portal`). Populates
// { portalUserId, tenantId, partyType, partyId, email } so downstream
// routes can filter Prisma queries by the caller's party.

export interface PortalContext {
  portalUserId: string;
  tenantId: string;
  partyType: "Customer" | "Supplier";
  partyId: string;
  email: string;
}

export interface PortalJwtClaims {
  portalUserId: string;
  tenantId: string;
  partyType: "Customer" | "Supplier";
  partyId: string;
  email: string;
  aud: "portal";
  iat?: number; // populated by jsonwebtoken at sign time
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portal?: PortalContext;
    }
  }
}

const PORTAL_TTL = "12h"; // portal sessions are shorter than staff

export function signPortalToken(claims: Omit<PortalJwtClaims, "aud">): string {
  return jwt.sign({ ...claims, aud: "portal" }, PORTAL_SECRET, {
    expiresIn: PORTAL_TTL,
  });
}

export async function requirePortalAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });
  const raw = header.slice(7);

  try {
    const claims = jwt.verify(raw, PORTAL_SECRET) as PortalJwtClaims;
    if (claims.aud !== "portal")
      return res.status(401).json({ error: "Wrong audience" });

    // Verify the portal user still exists + is active + token wasn't issued
    // before the last credential change (tokenEpoch check).
    const user = await prisma.portalUser.findFirst({
      where: { id: claims.portalUserId, tenantId: claims.tenantId },
      select: {
        id: true,
        isActive: true,
        partyType: true,
        partyId: true,
        email: true,
        tokenEpoch: true,
      },
    });
    if (!user || !user.isActive)
      return res.status(401).json({ error: "Account disabled" });
    const iatMs = typeof claims.iat === "number" ? claims.iat * 1000 : 0;
    if (iatMs > 0 && user.tokenEpoch.getTime() > iatMs)
      return res.status(401).json({ error: "Token superseded by credential change" });

    req.portal = {
      portalUserId: user.id,
      tenantId: claims.tenantId,
      partyType: user.partyType as "Customer" | "Supplier",
      partyId: user.partyId,
      email: user.email,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired portal token" });
  }
}
