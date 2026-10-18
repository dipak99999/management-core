// Adapter wiring tests — always run. Each adapter accepts an injectable
// `fetchImpl`, so we can stub the HTTP layer and assert on the exact
// request shape (URL, method, headers, body) AND the parsing of the
// response into the normalized Lumaara shape.
//
// This covers the ground that `integrations-live.test.ts` only covered
// when credentials were provided — but using mocks so the tests run on
// a laptop + CI without any third-party setup. The live file still
// exists for release-time smoke tests against real sandboxes; see its
// header comment for env-var gates.

import { describe, expect, it, vi } from "vitest";
import {
  AwsRekognitionProvider,
  GoogleMeetAdapter,
  WebexAdapter,
  fetchPlaidTransactions,
  pollGmailNewMessages,
  pollOutlookNewMessages,
  refreshGmailAccessToken,
  refreshOutlookAccessToken,
  validatePlaidCreds,
} from "./index";

// Build a fetch stub that returns the given JSON body with the given
// status. Returned alongside a captured-calls array for assertions.
function stubFetch(responses: Array<{ status?: number; json: unknown; text?: string }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const impl: typeof fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json),
      headers: new Headers(),
    } as unknown as Response;
  }) as typeof fetch;
  return { impl, calls };
}

// ── Plaid ────────────────────────────────────────────────────────────
describe("Plaid adapter — fetchPlaidTransactions", () => {
  it("POSTs to /transactions/get with creds in the body + normalizes txns", async () => {
    const { impl, calls } = stubFetch([
      {
        json: {
          transactions: [
            {
              transaction_id: "txn-1",
              date: "2026-03-15",
              name: "ACME COFFEE",
              merchant_name: "Acme Coffee",
              amount: 4.5, // Plaid: positive = money OUT
              iso_currency_code: "USD",
              payment_meta: { reference_number: "ref-7" },
              category: ["Food and Drink", "Coffee"],
            },
          ],
          total_transactions: 1,
          request_id: "req-abc",
        },
      },
    ]);
    const creds = validatePlaidCreds({
      plaidClientId: "cid", plaidSecret: "secret", plaidAccessToken: "atok", plaidEnv: "sandbox",
    });
    const txns = await fetchPlaidTransactions(creds, "2026-03-01", "2026-03-31", impl);

    expect(calls[0].url).toBe("https://sandbox.plaid.com/transactions/get");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({
      client_id: "cid",
      secret: "secret",
      access_token: "atok",
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });
    expect(txns).toHaveLength(1);
    // Amount sign is inverted so + = deposit (matches Lumaara BankTransaction convention).
    expect(txns[0]).toMatchObject({
      externalId: "txn-1",
      description: "Acme Coffee",
      amount: -4.5,
      referenceNumber: "ref-7",
    });
  });

  it("surfaces upstream errors with the Plaid error code + message", async () => {
    const { impl } = stubFetch([
      { status: 400, json: { error: { error_code: "INVALID_ACCESS_TOKEN", error_message: "token invalid" } } },
    ]);
    const creds = validatePlaidCreds({
      plaidClientId: "cid", plaidSecret: "s", plaidAccessToken: "atok", plaidEnv: "sandbox",
    });
    await expect(
      fetchPlaidTransactions(creds, "2026-03-01", "2026-03-31", impl),
    ).rejects.toThrow(/INVALID_ACCESS_TOKEN.*token invalid/);
  });
});

// ── Gmail ────────────────────────────────────────────────────────────
describe("Gmail adapter", () => {
  it("refreshGmailAccessToken POSTs form-encoded creds + returns access_token", async () => {
    const { impl, calls } = stubFetch([{ json: { access_token: "ya29.fake" } }]);
    const at = await refreshGmailAccessToken("cid", "csec", "rtok", impl);

    expect(at).toBe("ya29.fake");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.headers).toMatchObject({ "content-type": "application/x-www-form-urlencoded" });
    const bodyParams = new URLSearchParams(String(calls[0].init?.body));
    expect(bodyParams.get("client_id")).toBe("cid");
    expect(bodyParams.get("client_secret")).toBe("csec");
    expect(bodyParams.get("refresh_token")).toBe("rtok");
    expect(bodyParams.get("grant_type")).toBe("refresh_token");
  });

  it("pollGmailNewMessages first-call reads profile to get bootstrap historyId", async () => {
    const { impl, calls } = stubFetch([{ json: { historyId: "9001" } }]);
    const r = await pollGmailNewMessages("ya29.fake", null, impl);

    expect(r.messages).toEqual([]);
    expect(r.newHistoryId).toBe("9001");
    expect(calls[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer ya29.fake" });
  });
});

// ── Outlook ──────────────────────────────────────────────────────────
describe("Outlook adapter", () => {
  it("refreshOutlookAccessToken POSTs to the per-tenant MS token endpoint", async () => {
    const { impl, calls } = stubFetch([{ json: { access_token: "eyJ.fake" } }]);
    const at = await refreshOutlookAccessToken("cid", "csec", "rtok", "common", impl);

    expect(at).toBe("eyJ.fake");
    expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    const bp = new URLSearchParams(String(calls[0].init?.body));
    expect(bp.get("client_id")).toBe("cid");
    expect(bp.get("refresh_token")).toBe("rtok");
    expect(bp.get("grant_type")).toBe("refresh_token");
  });

  it("pollOutlookNewMessages normalizes Graph delta payloads", async () => {
    const { impl, calls } = stubFetch([
      {
        json: {
          value: [
            {
              id: "AQMk",
              subject: "Invoice attached",
              from: { emailAddress: { name: "Acme AP", address: "ap@acme.com" } },
              toRecipients: [{ emailAddress: { address: "me@lumaara.io" } }],
              bodyPreview: "Please find the March invoice",
              receivedDateTime: "2026-03-20T10:11:12Z",
              conversationId: "conv-1",
            },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=xyz",
        },
      },
    ]);
    const r = await pollOutlookNewMessages("eyJ.fake", null, impl);

    expect(calls[0].init?.headers).toMatchObject({ authorization: "Bearer eyJ.fake" });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      providerMessageId: "AQMk",
      fromEmail: "ap@acme.com",
      fromName: "Acme AP",
      subject: "Invoice attached",
      threadId: "conv-1",
    });
    expect(r.newDeltaLink).toContain("$deltatoken=xyz");
  });
});

// ── AWS Rekognition ─────────────────────────────────────────────────
describe("AWS Rekognition adapter", () => {
  it("compare() returns similarity normalized to 0..1 range", async () => {
    const { impl, calls } = stubFetch([
      { json: { FaceMatches: [{ Similarity: 94.3 }] } },
    ]);
    const provider = new AwsRekognitionProvider(
      { region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "SKEY" },
      impl,
    );
    const sim = await provider.compare(Buffer.from("fakeimg"), "existingBase64==");

    expect(calls[0].url).toBe("https://rekognition.us-east-1.amazonaws.com/");
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-amz-target"]).toBe("RekognitionService.CompareFaces");
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\//);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.SourceImage.Bytes).toBe("existingBase64==");
    expect(body.SimilarityThreshold).toBe(70);
    expect(sim).toBeCloseTo(0.943, 3);
  });

  it("compare() returns 0 on no face match (non-2xx)", async () => {
    const { impl } = stubFetch([{ status: 400, json: { message: "InvalidImageException" } }]);
    const provider = new AwsRekognitionProvider(
      { region: "us-east-1", accessKeyId: "AKIA", secretAccessKey: "SKEY" },
      impl,
    );
    const sim = await provider.compare(Buffer.from("x"), "y");
    expect(sim).toBe(0);
  });
});

// ── Webex ────────────────────────────────────────────────────────────
describe("Webex adapter", () => {
  it("create() POSTs ISO-formatted start/end + returns normalized join url", async () => {
    const { impl, calls } = stubFetch([
      { json: { id: "mtg-123", webLink: "https://webex.com/meet/abc" } },
    ]);
    const adapter = new WebexAdapter("t1", { token: "wbx-tok" }, impl);
    const start = new Date("2026-04-01T10:00:00Z");
    const end = new Date("2026-04-01T11:00:00Z");
    const r = await adapter.create({
      topic: "Q2 planning", startAt: start, endAt: end, timezone: "UTC",
    });

    expect(calls[0].url).toBe("https://webexapis.com/v1/meetings");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer wbx-tok");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({
      title: "Q2 planning",
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: "UTC",
    });
    expect(r.externalId).toBe("mtg-123");
    expect(r.joinUrl).toBe("https://webex.com/meet/abc");
  });

  it("delete() tolerates 404 (meeting already removed)", async () => {
    const { impl } = stubFetch([{ status: 404, json: { message: "Not found" } }]);
    const adapter = new WebexAdapter("t1", { token: "wbx-tok" }, impl);
    await expect(adapter.delete("mtg-gone")).resolves.toBeUndefined();
  });
});

// ── Google Meet ──────────────────────────────────────────────────────
describe("Google Meet adapter", () => {
  it("create() POSTs calendar event with conferenceData + returns hangoutLink", async () => {
    const { impl, calls } = stubFetch([
      { json: { id: "evt-7", hangoutLink: "https://meet.google.com/abc-defg-hij" } },
    ]);
    const adapter = new GoogleMeetAdapter("t1", { accessToken: "ya29.gm", calendarId: "primary" }, impl);
    const r = await adapter.create({
      topic: "Design sync",
      startAt: new Date("2026-04-02T15:00:00Z"),
      endAt: new Date("2026-04-02T16:00:00Z"),
      timezone: "America/Los_Angeles",
    });

    expect(calls[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ya29.gm");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.summary).toBe("Design sync");
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(body.start.timeZone).toBe("America/Los_Angeles");
    expect(r.externalId).toBe("evt-7");
    expect(r.joinUrl).toBe("https://meet.google.com/abc-defg-hij");
  });
});
