// L8: Slack incoming-webhook adapter. Simplest possible integration —
// POST a JSON blob to the tenant-configured webhook URL. See
// https://api.slack.com/messaging/webhooks for the shape.

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
  username?: string;
  icon_emoji?: string;
}

export async function postSlackMessage(
  webhookUrl: string,
  msg: SlackMessage,
): Promise<void> {
  const r = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(msg),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Slack post failed (${r.status}): ${text.slice(0, 200)}`);
  }
}
