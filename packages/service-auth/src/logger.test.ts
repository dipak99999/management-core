// Tests for the secret-redaction pass added to the shared logger.
//
// The logger writes to process.stdout/stderr; we capture the lines, parse
// each as JSON, and assert that sensitive fields never appear in cleartext.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger } from "./logger";

// Each test captures stdout+stderr writes and reparses the JSON lines the
// logger emitted. We use spies on the actual process streams rather than
// mocking the whole logger module so we exercise the real code path.
function captureLogLines() {
  const lines: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
  return {
    lines,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

function parsed(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .flatMap((line) => line.split("\n"))
    .filter((s) => s.trim().length > 0)
    .map((s) => JSON.parse(s) as Record<string, unknown>);
}

describe("logger secret redaction", () => {
  let cap: ReturnType<typeof captureLogLines>;
  beforeEach(() => {
    cap = captureLogLines();
  });
  afterEach(() => {
    cap.restore();
  });

  it("redacts top-level password + token keys", () => {
    const log = getLogger("logger-redact-test-1");
    log.info("login attempt", {
      email: "ada@example.com",
      password: "hunter2",
      token: "eyJhbGciOi.payload.sig",
    });
    const [row] = parsed(cap.lines);
    expect(row.password).toBe("[REDACTED]");
    expect(row.token).toBe("[REDACTED]");
    expect(row.email).toBe("ada@example.com"); // not redacted
  });

  it("redacts nested keys inside objects", () => {
    const log = getLogger("logger-redact-test-2");
    log.info("provider call", {
      provider: {
        name: "openai",
        apiKey: "sk-realkey",
        config: { baseUrl: "https://api.openai.com", secret: "nested-leak" },
      },
    });
    const [row] = parsed(cap.lines);
    const provider = row.provider as Record<string, unknown>;
    expect(provider.name).toBe("openai");
    expect(provider.apiKey).toBe("[REDACTED]");
    const config = provider.config as Record<string, unknown>;
    expect(config.baseUrl).toBe("https://api.openai.com");
    expect(config.secret).toBe("[REDACTED]");
  });

  it("redacts Authorization-style header dumps", () => {
    const log = getLogger("logger-redact-test-3");
    log.warn("inbound", {
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer eyJabc.def",
        cookie: "session=xyz",
      },
    });
    const [row] = parsed(cap.lines);
    const headers = row.headers as Record<string, unknown>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.Authorization).toBe("[REDACTED]");
    expect(headers.cookie).toBe("[REDACTED]");
  });

  it("redacts items inside arrays of objects", () => {
    const log = getLogger("logger-redact-test-4");
    log.info("batch", {
      items: [
        { email: "a@x.com", password: "p1" },
        { email: "b@x.com", password: "p2" },
      ],
    });
    const [row] = parsed(cap.lines);
    const items = row.items as Array<Record<string, unknown>>;
    expect(items[0].email).toBe("a@x.com");
    expect(items[0].password).toBe("[REDACTED]");
    expect(items[1].password).toBe("[REDACTED]");
  });

  it("leaves non-sensitive context fully intact", () => {
    const log = getLogger("logger-redact-test-5");
    log.info("ping", { ok: true, latencyMs: 42, service: "auth" });
    const [row] = parsed(cap.lines);
    expect(row.ok).toBe(true);
    expect(row.latencyMs).toBe(42);
  });
});
