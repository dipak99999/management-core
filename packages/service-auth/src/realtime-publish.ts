/**
 * Fire-and-forget publish to the auth-service SSE event bus. Call this
 * from any staff-service mutation that watchers on a list page would
 * care about (pick-list submitted, delivery-trip stop completed, etc.).
 *
 * Non-fatal: a publish failure never blocks the mutation. Returns a
 * Promise so callers can await when they want to, but typically fire
 * without await.
 *
 * Requires AUTH_INTERNAL_URL + SERVICE_SECRET env; silently no-ops when
 * either is missing so local dev isn't blocked by the missing config.
 */
export async function publishRealtime(
  tenantId: string,
  channel: string,
  data?: unknown,
): Promise<void> {
  const url = process.env.AUTH_INTERNAL_URL ?? "";
  const secret = process.env.SERVICE_SECRET ?? "";
  if (!url || !secret) return;
  try {
    await fetch(`${url}/stream/_internal/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-secret": secret,
      },
      body: JSON.stringify({ tenantId, channel, data }),
    });
  } catch {
    // Non-fatal — realtime is best-effort.
  }
}
