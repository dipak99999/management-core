import { describe, expect, it } from "vitest";
import {
  compileSegment,
  SegmentError,
  type Node,
} from "./segment";

// The compiler is pure — it takes JSON in, produces a Prisma WHERE object
// out. Every test here asserts the shape of that WHERE. The safety tests
// (SQL-injection attempts, unknown fields, etc.) are the load-bearing ones;
// listmonk's raw-SQL approach is exactly what these guard against.

const TENANT = "tenant-a";

describe("compileSegment — Customer column ops", () => {
  it("eq compiles to Prisma equals", () => {
    const w = compileSegment("Customer", { field: "email", op: "eq", value: "a@b.com" });
    expect(w).toEqual({ email: { equals: "a@b.com" } });
  });

  it("ne compiles to Prisma not", () => {
    const w = compileSegment("Customer", { field: "email", op: "ne", value: "a@b.com" });
    expect(w).toEqual({ email: { not: "a@b.com" } });
  });

  it("contains compiles to insensitive Prisma contains", () => {
    const w = compileSegment("Customer", { field: "email", op: "contains", value: "@acme.com" });
    expect(w).toEqual({ email: { contains: "@acme.com", mode: "insensitive" } });
  });

  it("startsWith compiles to insensitive Prisma startsWith", () => {
    const w = compileSegment("Customer", { field: "customerName", op: "startsWith", value: "Ac" });
    expect(w).toEqual({ customerName: { startsWith: "Ac", mode: "insensitive" } });
  });

  it("endsWith compiles to insensitive Prisma endsWith", () => {
    const w = compileSegment("Customer", { field: "email", op: "endsWith", value: "@acme.com" });
    expect(w).toEqual({ email: { endsWith: "@acme.com", mode: "insensitive" } });
  });

  it("in compiles to Prisma in", () => {
    const w = compileSegment("Customer", {
      field: "territory",
      op: "in",
      value: ["IN", "US"],
    });
    expect(w).toEqual({ territory: { in: ["IN", "US"] } });
  });

  it("notIn compiles to Prisma notIn", () => {
    const w = compileSegment("Customer", {
      field: "customerGroup",
      op: "notIn",
      value: ["Retail"],
    });
    expect(w).toEqual({ customerGroup: { notIn: ["Retail"] } });
  });

  it("gt / gte / lt / lte compile to Prisma comparison ops", () => {
    expect(
      compileSegment("Customer", { field: "createdAt", op: "gt", value: "2025-01-01" }),
    ).toEqual({ createdAt: { gt: "2025-01-01" } });
    expect(
      compileSegment("Customer", { field: "createdAt", op: "gte", value: "2025-01-01" }),
    ).toEqual({ createdAt: { gte: "2025-01-01" } });
    expect(
      compileSegment("Customer", { field: "createdAt", op: "lt", value: "2025-01-01" }),
    ).toEqual({ createdAt: { lt: "2025-01-01" } });
    expect(
      compileSegment("Customer", { field: "createdAt", op: "lte", value: "2025-01-01" }),
    ).toEqual({ createdAt: { lte: "2025-01-01" } });
  });

  it("isNull compiles to equals: null", () => {
    const w = compileSegment("Customer", { field: "gstin", op: "isNull" });
    expect(w).toEqual({ gstin: { equals: null } });
  });

  it("notNull compiles to not: null", () => {
    const w = compileSegment("Customer", { field: "email", op: "notNull" });
    expect(w).toEqual({ email: { not: null } });
  });

  it("between compiles to gte + lte", () => {
    const w = compileSegment("Customer", {
      field: "createdAt",
      op: "between",
      value: ["2025-01-01", "2025-12-31"],
    });
    expect(w).toEqual({ createdAt: { gte: "2025-01-01", lte: "2025-12-31" } });
  });
});

describe("compileSegment — Lead column ops", () => {
  it("eq on Lead.email works", () => {
    const w = compileSegment("Lead", { field: "email", op: "eq", value: "l@x.com" });
    expect(w).toEqual({ email: { equals: "l@x.com" } });
  });

  it("in on Lead.status compiles", () => {
    const w = compileSegment("Lead", {
      field: "status",
      op: "in",
      value: ["Open", "Contacted"],
    });
    expect(w).toEqual({ status: { in: ["Open", "Contacted"] } });
  });

  it("contains on Lead.leadName compiles", () => {
    const w = compileSegment("Lead", { field: "leadName", op: "contains", value: "acme" });
    expect(w).toEqual({ leadName: { contains: "acme", mode: "insensitive" } });
  });
});

describe("compileSegment — boolean nesting", () => {
  it("and: compiles to Prisma AND array", () => {
    const w = compileSegment("Customer", {
      and: [
        { field: "email", op: "contains", value: "@acme.com" },
        { field: "territory", op: "eq", value: "IN" },
      ],
    });
    expect(w).toEqual({
      AND: [
        { email: { contains: "@acme.com", mode: "insensitive" } },
        { territory: { equals: "IN" } },
      ],
    });
  });

  it("or: compiles to Prisma OR array", () => {
    const w = compileSegment("Customer", {
      or: [
        { field: "customerGroup", op: "eq", value: "Retail" },
        { field: "customerGroup", op: "eq", value: "Wholesale" },
      ],
    });
    expect(w).toEqual({
      OR: [
        { customerGroup: { equals: "Retail" } },
        { customerGroup: { equals: "Wholesale" } },
      ],
    });
  });

  it("not: compiles to Prisma NOT wrapper", () => {
    const w = compileSegment("Customer", {
      not: { field: "email", op: "eq", value: "spam@x.com" },
    });
    expect(w).toEqual({ NOT: { email: { equals: "spam@x.com" } } });
  });

  it("5-level nested and/or/not compiles correctly", () => {
    const tree: Node = {
      and: [
        {
          or: [
            {
              not: {
                and: [
                  {
                    or: [
                      { field: "email", op: "contains", value: "@a.com" },
                      { field: "email", op: "contains", value: "@b.com" },
                    ],
                  },
                  { field: "territory", op: "eq", value: "IN" },
                ],
              },
            },
            { field: "customerGroup", op: "eq", value: "VIP" },
          ],
        },
        { field: "gstin", op: "notNull" },
      ],
    };
    const w = compileSegment("Customer", tree);
    expect(w).toEqual({
      AND: [
        {
          OR: [
            {
              NOT: {
                AND: [
                  {
                    OR: [
                      { email: { contains: "@a.com", mode: "insensitive" } },
                      { email: { contains: "@b.com", mode: "insensitive" } },
                    ],
                  },
                  { territory: { equals: "IN" } },
                ],
              },
            },
            { customerGroup: { equals: "VIP" } },
          ],
        },
        { gstin: { not: null } },
      ],
    });
  });
});

describe("compileSegment — customData JSONB path", () => {
  it("eq on customData.<key> compiles to path+equals", () => {
    const w = compileSegment("Customer", {
      field: "customData.city",
      op: "eq",
      value: "Delhi",
    });
    expect(w).toEqual({ customData: { path: ["city"], equals: "Delhi" } });
  });

  it("contains on customData.<key> compiles to path+string_contains", () => {
    const w = compileSegment("Customer", {
      field: "customData.notes",
      op: "contains",
      value: "urgent",
    });
    expect(w).toEqual({ customData: { path: ["notes"], string_contains: "urgent" } });
  });

  it("isNull on customData.<key> compiles to path+equals:null", () => {
    const w = compileSegment("Customer", { field: "customData.city", op: "isNull" });
    expect(w).toEqual({ customData: { path: ["city"], equals: null } });
  });

  it("rejects nested customData path (customData.city.zip)", () => {
    expect(() =>
      compileSegment("Customer", { field: "customData.city.zip", op: "eq", value: "x" }),
    ).toThrow(SegmentError);
  });
});

describe("compileSegment — errors", () => {
  it("unknown field throws UnknownField", () => {
    try {
      compileSegment("Customer", { field: "password", op: "eq", value: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("UnknownField");
    }
  });

  it("unknown op throws BadOp", () => {
    try {
      compileSegment("Customer", { field: "email", op: "regex", value: ".*" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("BadOp");
    }
  });

  it("in with non-array value throws TypeMismatch", () => {
    try {
      compileSegment("Customer", { field: "territory", op: "in", value: "IN" });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("TypeMismatch");
    }
  });

  it("between with non-pair array throws TypeMismatch", () => {
    expect(() =>
      compileSegment("Customer", { field: "createdAt", op: "between", value: ["2025-01-01"] }),
    ).toThrow(/between expects/);
  });

  it("empty and: throws EmptyGroup", () => {
    try {
      compileSegment("Customer", { and: [] });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("EmptyGroup");
    }
  });

  it("empty or: throws EmptyGroup", () => {
    try {
      compileSegment("Customer", { or: [] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SegmentError).code).toBe("EmptyGroup");
    }
  });

  it("node with both and: and or: throws BadNode", () => {
    expect(() =>
      compileSegment("Customer", { and: [{ field: "email", op: "eq", value: "x" }], or: [] } as unknown as Node),
    ).toThrow(SegmentError);
  });

  it("empty leaf {} throws BadNode", () => {
    expect(() => compileSegment("Customer", {} as unknown as Node)).toThrow(SegmentError);
  });

  it("unknown doctype throws UnknownDoctype", () => {
    try {
      compileSegment(
        "Supplier" as unknown as "Customer",
        { field: "email", op: "eq", value: "x" },
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("UnknownDoctype");
    }
  });
});

describe("compileSegment — SQL-injection defence (listmonk regression tests)", () => {
  // These are the tests that justify the JSON-DSL approach over listmonk's
  // raw-SQL segments. Every hostile input must either (a) compile to a Prisma
  // filter with the payload stored as a literal string value (Prisma
  // parameterizes) or (b) be rejected outright.

  it("value containing SQL is passed through as a literal string", () => {
    const w = compileSegment("Customer", {
      field: "email",
      op: "eq",
      value: "'; DROP TABLE customers; --",
    });
    expect(w).toEqual({ email: { equals: "'; DROP TABLE customers; --" } });
  });

  it("value containing SQL in contains is passed through as literal", () => {
    const w = compileSegment("Customer", {
      field: "customerName",
      op: "contains",
      value: "Robert'); DROP TABLE customers;--",
    });
    // Prisma binds the value; no SQL splicing possible.
    expect(w).toEqual({
      customerName: {
        contains: "Robert'); DROP TABLE customers;--",
        mode: "insensitive",
      },
    });
  });

  it("field containing SQL fragment throws UnknownField", () => {
    try {
      compileSegment("Customer", {
        field: "email; DROP TABLE customers;--",
        op: "eq",
        value: "x",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("UnknownField");
    }
  });

  it("field as a SQL subquery throws UnknownField", () => {
    try {
      compileSegment("Customer", {
        field: "(SELECT password FROM users)",
        op: "eq",
        value: "x",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SegmentError);
      expect((e as SegmentError).code).toBe("UnknownField");
    }
  });

  it("customData key with SQL fragment throws UnknownField", () => {
    try {
      compileSegment("Customer", {
        field: "customData.city; DROP TABLE customers;--",
        op: "eq",
        value: "x",
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SegmentError).code).toBe("UnknownField");
    }
  });

  it("secret-looking fields (password, apiKey) are rejected", () => {
    expect(() =>
      compileSegment("Customer", { field: "password", op: "eq", value: "x" }),
    ).toThrow(SegmentError);
    expect(() =>
      compileSegment("Customer", { field: "secretApiKey", op: "eq", value: "x" }),
    ).toThrow(SegmentError);
  });

  it("non-string field (object) throws UnknownField", () => {
    try {
      compileSegment("Customer", { field: { $ne: null } as unknown as string, op: "eq", value: "x" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as SegmentError).code).toBe("UnknownField");
    }
  });
});

describe("compileSegment — tenant scoping", () => {
  it("wraps compiled tree in AND with tenantId when tenantId is passed", () => {
    const w = compileSegment(
      "Customer",
      { field: "email", op: "eq", value: "x@y.com" },
      TENANT,
    );
    expect(w).toEqual({
      AND: [{ tenantId: TENANT }, { email: { equals: "x@y.com" } }],
    });
  });

  it("tenant scoping applied even for and: root", () => {
    const w = compileSegment(
      "Customer",
      {
        and: [
          { field: "email", op: "eq", value: "x@y.com" },
          { field: "territory", op: "eq", value: "IN" },
        ],
      },
      TENANT,
    );
    expect(w).toEqual({
      AND: [
        { tenantId: TENANT },
        {
          AND: [
            { email: { equals: "x@y.com" } },
            { territory: { equals: "IN" } },
          ],
        },
      ],
    });
  });

  it("no tenantId passed → no wrapping (test/preview-only path)", () => {
    const w = compileSegment("Customer", { field: "email", op: "eq", value: "x" });
    expect(w).toEqual({ email: { equals: "x" } });
    expect(w.AND).toBeUndefined();
  });
});
