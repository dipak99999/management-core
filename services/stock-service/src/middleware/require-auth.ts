import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthContext, JwtClaims } from "@lumaara/shared-types";
import { JWT_SECRET, requireModule } from "@lumaara/service-auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const moduleGate = requireModule();

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  try {
    const claims = jwt.verify(
      header.slice(7),
      JWT_SECRET,
    ) as JwtClaims;
    req.auth = claims;
    return moduleGate(req, res, next);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
