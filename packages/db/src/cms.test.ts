import { describe, expect, it } from "vitest";
import { isPubliclyReadable, resolvePublishedAt, slugify } from "./cms";

describe("slugify", () => {
  it("lowercases and hyphens non-alphanumeric runs", () => {
    expect(slugify("About Us")).toBe("about-us");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("  spaced  ")).toBe("spaced");
    expect(slugify("---leading")).toBe("leading");
    expect(slugify("trailing---")).toBe("trailing");
  });

  it("collapses runs of non-alphanumerics to a single dash", () => {
    expect(slugify("many !!! bangs")).toBe("many-bangs");
  });

  it("caps at 60 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(60);
  });

  it("strips non-ASCII (author must supply an ascii slug for these)", () => {
    // 'é' is non-ASCII and gets replaced by the [^a-z0-9]+ class along
    // with any other non-alphanumeric chars.
    expect(slugify("café")).toBe("caf");
  });
});

describe("resolvePublishedAt — publish-timestamp semantics", () => {
  const now = new Date("2026-03-15T10:00:00.000Z");
  const historical = new Date("2025-11-01T09:00:00.000Z");

  it("returns null when the doc stays Draft on create", () => {
    expect(resolvePublishedAt(null, false, now)).toBeNull();
  });

  it("stamps now when a fresh doc is created as Published", () => {
    expect(resolvePublishedAt(null, true, now)).toEqual(now);
  });

  it("stamps now the first time a Draft is flipped to Published", () => {
    expect(resolvePublishedAt(null, true, now)).toEqual(now);
  });

  it("preserves the original publishedAt when re-publishing after an unpublish", () => {
    // The doc was originally published in November; now it's being flipped
    // back to Published in March. We keep the November date — it's the
    // canonical "first published" anchor for RSS/sitemap ordering.
    expect(resolvePublishedAt(historical, true, now)).toEqual(historical);
  });

  it("preserves publishedAt when unpublishing", () => {
    // Unpublish shouldn't erase history — you might republish later.
    expect(resolvePublishedAt(historical, false, now)).toEqual(historical);
  });

  it("preserves publishedAt on a straight edit of a published doc", () => {
    // Editing bodyHtml on a Published doc should never touch publishedAt.
    expect(resolvePublishedAt(historical, true, now)).toEqual(historical);
  });
});

describe("isPubliclyReadable — publish-gate", () => {
  it("false when the row is null", () => {
    expect(isPubliclyReadable(null)).toBe(false);
  });

  it("false when the row is Draft", () => {
    expect(isPubliclyReadable({ isPublished: false })).toBe(false);
  });

  it("true when the row is Published", () => {
    expect(isPubliclyReadable({ isPublished: true })).toBe(true);
  });
});
