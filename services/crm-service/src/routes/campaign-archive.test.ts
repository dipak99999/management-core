import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";

// Mock @lumaara/db BEFORE importing the router — Vitest hoists vi.mock so
// this works even though it appears below the import in source order.
const findFirstMock = vi.fn();
vi.mock("@lumaara/db", () => ({
  prisma: {
    campaign: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
  },
  // Pass-through so the route's `withCrossTenant({where})` still hands a
  // valid `{where}` bag to findFirst — we assert on args separately below.
  withCrossTenant: <T extends object>(args: T) => args,
}));

// After the mock: import the router + helpers.
import {
  campaignArchiveRouter,
  renderArchiveHtml,
  substitutePublicTokens,
  unwrapTrackedLinks,
} from "./campaign-archive";

// --- test harness --------------------------------------------------------

let baseUrl = "";
let server: import("http").Server;

beforeAll(async () => {
  const app = express();
  app.use("/a", campaignArchiveRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --- pure-helper tests ---------------------------------------------------

describe("substitutePublicTokens", () => {
  it("substitutes {{first_name}} → empty", () => {
    expect(substitutePublicTokens("Hi {{first_name}}!")).toBe("Hi !");
  });

  it("substitutes {{email}} + {{last_name}} → empty", () => {
    expect(substitutePublicTokens("{{email}}/{{last_name}}")).toBe("/");
  });

  it("substitutes {{unsubscribe_url}} → #", () => {
    expect(substitutePublicTokens('<a href="{{unsubscribe_url}}">u</a>')).toBe(
      '<a href="#">u</a>',
    );
  });

  it("strips {{tracking_pixel}} entirely", () => {
    expect(substitutePublicTokens("body{{tracking_pixel}}end")).toBe("bodyend");
  });

  it("leaves unknown tokens intact for downstream merge pipelines", () => {
    expect(substitutePublicTokens("Hi {{custom_var}}")).toBe("Hi {{custom_var}}");
  });

  it("tolerates whitespace + mixed case in token name", () => {
    expect(substitutePublicTokens("{{  First_Name  }}")).toBe("");
  });
});

describe("unwrapTrackedLinks", () => {
  it("unwraps a full-URL wrapped click", () => {
    // aHR0cHM6Ly9leGFtcGxlLmNvbQ== decodes to https://example.com
    const wrapped = "/email/track/click/xyz?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==";
    expect(unwrapTrackedLinks(wrapped)).toBe("https://example.com");
  });

  it("unwraps inside an anchor href", () => {
    const wrapped =
      '<a href="/email/track/click/abc123?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==">click</a>';
    expect(unwrapTrackedLinks(wrapped)).toBe(
      '<a href="https://example.com">click</a>',
    );
  });

  it("unwraps with a host prefix", () => {
    const wrapped =
      "https://mail.example.org/email/track/click/tid?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==";
    expect(unwrapTrackedLinks(wrapped)).toBe("https://example.com");
  });

  it("supports base64url variant (- and _ instead of + and /)", () => {
    // Encoded from https://example.com/a?b=c using base64url (no padding
    // fully-URL-safe form).
    const url = "https://example.com/a?b=c";
    const b64url = Buffer.from(url)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const wrapped = `/email/track/click/tid?url=${b64url}`;
    expect(unwrapTrackedLinks(wrapped)).toBe(url);
  });

  it("leaves the wrapper alone if the decoded value isn't a URL", () => {
    // "hello" is not a URL — keep wrapper.
    const b64 = Buffer.from("hello").toString("base64");
    const wrapped = `/email/track/click/tid?url=${b64}`;
    expect(unwrapTrackedLinks(wrapped)).toBe(wrapped);
  });
});

describe("renderArchiveHtml", () => {
  it("prepends the archive HTML comment", () => {
    const out = renderArchiveHtml("<p>hi</p>");
    expect(out.startsWith("<!-- Archived campaign")).toBe(true);
    expect(out).toContain("<p>hi</p>");
  });

  it("applies both substitution and unwrap in one pass", () => {
    const body =
      'Hi {{first_name}}, <a href="/email/track/click/x?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==">click</a>';
    const out = renderArchiveHtml(body);
    expect(out).toContain("Hi ,");
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toContain("{{first_name}}");
  });
});

// --- integration-style route tests ---------------------------------------

describe("GET /a/:slug (HTML)", () => {
  it("returns 200 + HTML + cache header when archiveEnabled=true", async () => {
    findFirstMock.mockResolvedValueOnce({
      bodyHtml: "<h1>Hello {{first_name}}</h1>",
      archiveEnabled: true,
    });
    const res = await fetch(`${baseUrl}/a/live-slug`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const body = await res.text();
    expect(body).toContain("<!-- Archived campaign");
    expect(body).toContain("<h1>Hello </h1>");
  });

  it("returns 404 + no-store when archiveEnabled=false", async () => {
    findFirstMock.mockResolvedValueOnce({
      bodyHtml: "<p>secret</p>",
      archiveEnabled: false,
    });
    const res = await fetch(`${baseUrl}/a/disabled-slug`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("This campaign is not available");
    expect(body).not.toContain("secret");
  });

  it("returns 404 when slug not found", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/a/missing-slug`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("This campaign is not available");
  });

  it("unwraps click-tracked links in the served HTML", async () => {
    findFirstMock.mockResolvedValueOnce({
      bodyHtml:
        '<a href="/email/track/click/xyz?url=aHR0cHM6Ly9leGFtcGxlLmNvbQ==">visit</a>',
      archiveEnabled: true,
    });
    const res = await fetch(`${baseUrl}/a/unwrap-slug`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('href="https://example.com"');
    expect(body).not.toContain("/email/track/click/");
  });

  it("preserves unicode + special characters in body", async () => {
    const body = "<p>你好 — café ☕ €50 <em>&amp;</em></p>";
    findFirstMock.mockResolvedValueOnce({
      bodyHtml: body,
      archiveEnabled: true,
    });
    const res = await fetch(`${baseUrl}/a/unicode-slug`);
    expect(res.status).toBe(200);
    const out = await res.text();
    expect(out).toContain("你好");
    expect(out).toContain("café");
    expect(out).toContain("☕");
    expect(out).toContain("€50");
    expect(out).toContain("&amp;");
  });

  it("passes the slug through to Prisma via archiveSlug lookup", async () => {
    findFirstMock.mockResolvedValueOnce({
      bodyHtml: "<p>x</p>",
      archiveEnabled: true,
    });
    await fetch(`${baseUrl}/a/probe-slug`);
    // The last call — assert it looked up by archiveSlug.
    const [call] = findFirstMock.mock.calls.slice(-1);
    const args = call[0] as { where: { archiveSlug: string } };
    expect(args.where.archiveSlug).toBe("probe-slug");
  });

  it("preserves the /health route on the same router", async () => {
    const res = await fetch(`${baseUrl}/a/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, kind: "archive" });
  });
});

describe("GET /a/:slug.json", () => {
  it("returns raw bodyHtml + metadata as JSON", async () => {
    const sentAt = new Date("2026-01-01T12:00:00Z");
    findFirstMock.mockResolvedValueOnce({
      name: "Winter Newsletter",
      subject: "Happy 2026",
      sentAt,
      bodyHtml: "<h1>Hello {{first_name}}</h1>",
      archiveEnabled: true,
    });
    const res = await fetch(`${baseUrl}/a/winter.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const json = await res.json();
    expect(json.name).toBe("Winter Newsletter");
    expect(json.subject).toBe("Happy 2026");
    expect(json.sentAt).toBe(sentAt.toISOString());
    expect(json.publishedAt).toBe(sentAt.toISOString());
    // Body is returned RAW — no substitution or unwrap — so integrators can
    // decide how to render it themselves.
    expect(json.bodyHtml).toBe("<h1>Hello {{first_name}}</h1>");
  });

  it("returns 404 JSON when archiveEnabled=false", async () => {
    findFirstMock.mockResolvedValueOnce({
      name: "n",
      subject: "s",
      sentAt: null,
      bodyHtml: "<p>x</p>",
      archiveEnabled: false,
    });
    const res = await fetch(`${baseUrl}/a/disabled.json`);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Not available" });
  });

  it("returns 404 JSON when slug not found", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/a/missing.json`);
    expect(res.status).toBe(404);
  });
});
