import { Router } from "express";
import { requireAuth } from "@lumaara/service-auth";
import { eventBus } from "../lib/event-bus";

export const streamRouter = Router();

// Internal cross-service publish — protected by SERVICE_SECRET. Call from
// stock-service / crm-service / etc. after a mutation to notify watching
// browsers. Mounted BEFORE requireAuth below so it doesn't need a JWT.
streamRouter.post("/_internal/publish", (req, res) => {
  const secret = process.env.SERVICE_SECRET ?? "";
  const got = req.headers["x-service-secret"];
  if (!secret || got !== secret) return res.status(403).json({ error: "forbidden" });
  const b = req.body as { tenantId?: string; channel?: string; data?: unknown };
  if (!b.tenantId || !b.channel) return res.status(400).json({ error: "tenantId + channel required" });
  eventBus.publish(b.tenantId, b.channel, b.data ?? {});
  res.status(204).send();
});

// EventSource can't set custom headers (RFC spec limitation), so the
// Bearer token has to come via a query param on SSE connects. Lift the
// token into the Authorization header before requireAuth runs so the
// normal auth path handles API tokens, OAuth, and JWTs uniformly. The
// token leaks into URL-level logs — acceptable for short-lived JWTs,
// but tenants should treat SSE URLs as sensitive.
streamRouter.use((req, res, next) => {
  if (!req.header("authorization") && typeof req.query.token === "string") {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

streamRouter.use(requireAuth);

/**
 * Server-sent events stream, tenant-scoped. Clients subscribe with
 * `?channel=pick-list&channel=delivery-note` and get push notifications
 * for those channels within their tenant.
 *
 * Services publish via `eventBus.publish(tenantId, channel, data)` from
 * their mutation handlers (e.g. the stock-service PickList submit route).
 *
 * Payload shape (JSON): `{ type, id?, by?, at }`. Keep payloads small —
 * the frontend typically re-fetches on receipt instead of trusting
 * push-delivered state.
 */
streamRouter.get("/", (req, res) => {
  const tenantId = req.auth!.tenantId;
  const channelsParam = req.query.channel;
  const channels = Array.isArray(channelsParam)
    ? (channelsParam as string[])
    : typeof channelsParam === "string"
      ? [channelsParam]
      : [];

  if (channels.length === 0) {
    return res.status(400).json({ error: "At least one ?channel= query is required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Nginx/CloudFront proxies buffer by default; disable it on this route.
    "X-Accel-Buffering": "no",
  });
  res.write(":ok\n\n");

  const send = (channel: string, data: unknown) => {
    res.write(`event: ${channel}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = eventBus.subscribe(tenantId, channels, send);

  // Keep-alive comment every 25s — most proxies kill idle streams after 30s.
  const keepalive = setInterval(() => {
    res.write(":ka\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
    res.end();
  });
});
