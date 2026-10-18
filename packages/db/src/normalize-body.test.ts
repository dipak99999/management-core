// The normalize-body helper lives in @lumaara/service-auth, but the vitest
// suite lives here in packages/db. Import from the source path so we don't
// depend on inter-package resolution during test runs.
import { describe, expect, it } from "vitest";
import { normalizeBody } from "../../service-auth/src/normalize-body";

type Ctx = { body: unknown };
function run(body: unknown): unknown {
  const req = { body } as Ctx;
  let called = false;
  normalizeBody(req as never, {} as never, () => {
    called = true;
  });
  if (!called) throw new Error("middleware did not call next()");
  return req.body;
}

describe("normalizeBody middleware", () => {
  it("converts empty strings to null", () => {
    expect(run({ email: "" })).toEqual({ email: null });
  });

  it("treats whitespace-only strings as empty", () => {
    expect(run({ name: "  " })).toEqual({ name: null });
  });

  it("trims non-empty strings", () => {
    expect(run({ name: "  Alice  " })).toEqual({ name: "Alice" });
  });

  it("passes non-string values through", () => {
    expect(
      run({ n: 42, b: true, d: null, arr: [1, 2], nested: { x: false } }),
    ).toEqual({ n: 42, b: true, d: null, arr: [1, 2], nested: { x: false } });
  });

  it("walks arrays + nested objects", () => {
    expect(
      run({
        customer: { name: "  Bob  ", email: "" },
        items: [{ note: "" }, { note: "keep" }],
      }),
    ).toEqual({
      customer: { name: "Bob", email: null },
      items: [{ note: null }, { note: "keep" }],
    });
  });

  it("leaves top-level primitives untouched (body-parser only accepts objects)", () => {
    // Middleware only touches body when it's a truthy object; primitives no-op.
    const req = { body: "raw string" } as { body: unknown };
    normalizeBody(req as never, {} as never, () => {});
    expect(req.body).toBe("raw string");
  });
});
