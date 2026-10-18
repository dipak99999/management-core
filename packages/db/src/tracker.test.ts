import { describe, expect, it } from "vitest";
import { unwrapForPreview, wrapLinksAndInjectPixel } from "./tracker";

const OPTS = { trackingId: "tid-abc", baseUrl: "https://mkt.example.com" };
const OPTS_TRAILING = { trackingId: "tid-abc", baseUrl: "https://mkt.example.com/" };

function b64u(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("wrapLinksAndInjectPixel — link rewriting", () => {
  it("rewrites http/https anchors to click-tracker URLs (double-quoted)", () => {
    const html = `<p>Hi <a href="https://acme.com/deals">click here</a></p>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(
      `https://mkt.example.com/email/track/click/tid-abc?url=${b64u("https://acme.com/deals")}`,
    );
    // Original raw URL should NOT appear as an href anymore.
    expect(out).not.toContain(`href="https://acme.com/deals"`);
  });

  it("rewrites single-quoted hrefs", () => {
    const html = `<a href='http://acme.com/x'>x</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(
      `email/track/click/tid-abc?url=${b64u("http://acme.com/x")}`,
    );
  });

  it("strips trailing slash from baseUrl so URLs don't get double slashes", () => {
    const html = `<a href="https://acme.com/x">x</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS_TRAILING);
    expect(out).not.toContain("//email/track/");
    expect(out).toContain("/email/track/click/tid-abc");
  });

  it("skips mailto: / tel: / javascript: / anchor / relative URLs", () => {
    const html = [
      `<a href="mailto:x@y.com">mail</a>`,
      `<a href="tel:+1234">call</a>`,
      `<a href="javascript:alert(1)">bad</a>`,
      `<a href="#top">top</a>`,
      `<a href="/local/page">local</a>`,
    ].join("");
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(`href="mailto:x@y.com"`);
    expect(out).toContain(`href="tel:+1234"`);
    expect(out).toContain(`href="javascript:alert(1)"`);
    expect(out).toContain(`href="#top"`);
    expect(out).toContain(`href="/local/page"`);
    // No click-tracker URLs at all — nothing was http(s).
    expect(out).not.toContain("/email/track/click/");
  });

  it("honors data-notrack=\"1\" — leaves the anchor unwrapped", () => {
    const html = `<a href="https://acme.com/unsub" data-notrack="1">Unsubscribe</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(`href="https://acme.com/unsub"`);
    expect(out).not.toContain("/email/track/click/");
  });

  it("honors data-notrack='1' (single-quoted attribute value)", () => {
    const html = `<a href="https://acme.com/unsub" data-notrack='1'>u</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(`href="https://acme.com/unsub"`);
    expect(out).not.toContain("/email/track/click/");
  });

  it("does not double-wrap URLs that already point at our tracker", () => {
    const already = `${OPTS.baseUrl}/email/track/click/tid-abc?url=${b64u("https://x.com")}`;
    const html = `<a href="${already}">clicky</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    // Only ONE occurrence of the tracker path — no nested wraps.
    const count = out.split("/email/track/click/").length - 1;
    expect(count).toBe(1);
  });

  it("wraps multiple anchors in one pass and preserves surrounding markup", () => {
    const html = `<div><a href="https://a.com">A</a> and <a href="https://b.com">B</a></div>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(b64u("https://a.com"));
    expect(out).toContain(b64u("https://b.com"));
    expect(out).toContain("<div>");
    expect(out).toContain("</div>");
    expect(out).toContain(" and ");
  });

  it("preserves other attributes on the anchor (target, rel, class, etc.)", () => {
    const html = `<a class="btn" href="https://acme.com/x" target="_blank" rel="noopener">go</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(`class="btn"`);
    expect(out).toContain(`target="_blank"`);
    expect(out).toContain(`rel="noopener"`);
    expect(out).toContain("/email/track/click/tid-abc");
  });

  it("tolerates anchors with no href attribute at all", () => {
    const html = `<a name="anchor">bookmark</a>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(`<a name="anchor">bookmark</a>`);
  });

  it("tolerates malformed HTML (unclosed tag, extra whitespace)", () => {
    const html = `<a   href = "https://acme.com/x"  >x`;
    // Should not throw and should still rewrite the href.
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toContain(b64u("https://acme.com/x"));
  });
});

describe("wrapLinksAndInjectPixel — pixel injection", () => {
  it("injects the 1×1 open pixel just before </body>", () => {
    const html = `<html><body><p>hi</p></body></html>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toMatch(
      /<img src="https:\/\/mkt\.example\.com\/email\/track\/open\/tid-abc\.png"[^>]*><\/body>/,
    );
  });

  it("matches </BODY> case-insensitively", () => {
    const html = `<HTML><BODY><P>hi</P></BODY></HTML>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out).toMatch(/<img[^>]*\/email\/track\/open\/tid-abc\.png[^>]*><\/BODY>/);
  });

  it("appends the pixel when there is no body tag (fragment / no-body case)", () => {
    const html = `<p>Just a snippet</p>`;
    const out = wrapLinksAndInjectPixel(html, OPTS);
    expect(out.endsWith(`style="display:none">`)).toBe(true);
    expect(out).toContain("/email/track/open/tid-abc.png");
  });

  it("appends the pixel to empty input", () => {
    const out = wrapLinksAndInjectPixel("", OPTS);
    expect(out).toContain("/email/track/open/tid-abc.png");
  });

  it("pixel tag has width=1, height=1, and display:none styling for silent tracking", () => {
    const out = wrapLinksAndInjectPixel("", OPTS);
    expect(out).toContain(`width="1"`);
    expect(out).toContain(`height="1"`);
    expect(out).toContain(`style="display:none"`);
  });

  it("returns input unchanged when trackingId is falsy (safety)", () => {
    const html = `<p>hi <a href="https://x.com">x</a></p>`;
    expect(wrapLinksAndInjectPixel(html, { ...OPTS, trackingId: "" })).toBe(html);
  });
});

describe("unwrapForPreview", () => {
  it("removes the open pixel", () => {
    const wrapped = wrapLinksAndInjectPixel("<p>hi</p>", OPTS);
    expect(wrapped).toContain("/email/track/open/");
    const unwrapped = unwrapForPreview(wrapped);
    expect(unwrapped).not.toContain("/email/track/open/");
    expect(unwrapped).toContain("<p>hi</p>");
  });

  it("unwraps click-tracked hrefs back to raw URLs", () => {
    const wrapped = wrapLinksAndInjectPixel(
      `<a href="https://acme.com/deals">buy</a>`,
      OPTS,
    );
    const unwrapped = unwrapForPreview(wrapped);
    expect(unwrapped).toContain(`href="https://acme.com/deals"`);
    expect(unwrapped).not.toContain("/email/track/click/");
  });

  it("is a no-op on plain HTML", () => {
    const html = `<p>plain <a href="https://x.com">x</a></p>`;
    expect(unwrapForPreview(html)).toBe(html);
  });

  it("tolerates empty input", () => {
    expect(unwrapForPreview("")).toBe("");
  });
});
