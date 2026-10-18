import type { NextFunction, Request, Response } from "express";
import { createHash } from "node:crypto";
import { prisma } from "@lumaara/db";
import { getLogger } from "./logger";

// Idempotency middleware for mutating endpoints. Client supplies
// `Idempotency-Key` on a POST/PUT/PATCH; the first response is persisted for
// 24h and replayed on retry. Absence of the header is a no-op so callers that
// don't opt in still get non-idempotent semantics.
//
// Guarantees:
//   * Same key + same body → replays the original response.
//   * Same key + different body → 422 (client bug: keys must be 1:1 with intent).
//   * Concurrent duplicates → whichever transaction commits its insert first
//     wins; the loser's persist fails on the unique constraint (swallowed).
//
// Mount AFTER requireAuth — the store is scoped by tenantId.

const TTL_MS = 24 * 60 * 60 * 1000;

function fingerprintBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

export function idempotency(endpoint: string) {
  const log = getLogger("idempotency");

  return async function (req: Request, res: Response, next: NextFunction) {
    const key = req.header("idempotency-key")?.trim();
    if (!key) return next();

    const tenantId = req.auth?.tenantId;
    if (!tenantId) return next();

    if (key.length < 1 || key.length > 255) {
      res.status(400).json({
        error: "Invalid Idempotency-Key header (1–255 chars required)",
      });
      return;
    }

    const fingerprint = fingerprintBody(req.body);

    let existing;
    try {
      existing = await prisma.idempotencyKey.findUnique({
        where: { tenantId_endpoint_key: { tenantId, endpoint, key } },
      });
    } catch (e) {
      // Cache lookup failed — better to let the request proceed than block on
      // a DB blip. Duplicates are worse than one lost cache-hit.
      log.warn("idempotency lookup failed — proceeding without dedupe", {
        endpoint,
        error: e instanceof Error ? e.message : String(e),
      });
      return next();
    }

    if (existing) {
      if (existing.expiresAt <= new Date()) {
        // Expired — evict and treat as miss.
        try {
          await prisma.idempotencyKey.delete({ where: { id: existing.id } });
        } catch {
          // swallow
        }
      } else if (existing.fingerprint !== fingerprint) {
        res.status(422).json({
          error:
            "Idempotency-Key reused with a different request body — keys must map 1:1 to a request intent.",
        });
        return;
      } else {
        // Cache hit — replay stored response.
        res
          .status(existing.responseStatus)
          .json(existing.responseBody);
        return;
      }
    }

    // Cache miss. Wrap res.json to capture the eventual response body + status
    // and persist them best-effort. Persist is fire-and-forget — it must not
    // delay delivery of the response. A retry that arrives before the write
    // commits will trigger the create's unique-constraint path (below).
    const originalJson = res.json.bind(res);
    (res as Response & { json: typeof res.json }).json = ((body: unknown) => {
      const responseStatus = res.statusCode || 200;
      prisma.idempotencyKey
        .create({
          data: {
            tenantId,
            userId: req.auth?.userId ?? null,
            endpoint,
            key,
            fingerprint,
            responseStatus,
            // Prisma's Json input accepts any JSON-serializable value; the
            // cast placates strict TS without changing runtime semantics.
            responseBody: body as never,
            expiresAt: new Date(Date.now() + TTL_MS),
          },
        })
        .catch((e) => {
          // Unique constraint = concurrent duplicate landed first. That's the
          // correct outcome — one row per (tenant, endpoint, key). Any other
          // failure is worth logging but not fatal.
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.includes("Unique constraint")) {
            log.warn("idempotency persist failed", { endpoint, key, error: msg });
          }
        });
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}
