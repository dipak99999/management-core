import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { _resetMcpToolCatalog, defineMcpTool, mcpToolCatalog, zodToJsonSchema } from "./mcp-manifest";

beforeEach(() => _resetMcpToolCatalog());

describe("zodToJsonSchema", () => {
  it("converts strings with min / max / email", () => {
    expect(zodToJsonSchema(z.string().email().min(3).max(100))).toEqual({
      type: "string",
      format: "email",
      minLength: 3,
      maxLength: 100,
    });
  });

  it("converts numbers with int + range", () => {
    expect(zodToJsonSchema(z.coerce.number().int().min(0).max(9))).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 9,
    });
  });

  it("converts enums to string + enum values", () => {
    expect(zodToJsonSchema(z.enum(["A", "B"]))).toEqual({ type: "string", enum: ["A", "B"] });
  });

  it("converts nested objects with required vs optional keys", () => {
    const s = z.object({
      name: z.string(),
      email: z.string().email().optional(),
      count: z.number().int().default(0),
    });
    const j = zodToJsonSchema(s) as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(j.type).toBe("object");
    expect(j.required).toEqual(["name"]); // email is optional; count has default
    expect(j.additionalProperties).toBe(false);
    expect((j.properties.email as { format: string }).format).toBe("email");
  });

  it("converts arrays with items", () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  it("unwraps optional + nullable + default", () => {
    expect(zodToJsonSchema(z.string().optional())).toEqual({ type: "string" });
    expect(zodToJsonSchema(z.string().nullable())).toEqual({ type: "string" });
    expect(zodToJsonSchema(z.string().default("x"))).toEqual({ type: "string" });
  });
});

describe("mcpToolCatalog", () => {
  it("registers tools + returns them sorted by category then name", () => {
    defineMcpTool(
      { name: "z_last", description: "last", category: "z", mutation: false },
      { method: "GET", path: "/z", service: "test" },
      z.object({}),
    );
    defineMcpTool(
      { name: "a_first", description: "first", category: "a", mutation: true },
      { method: "POST", path: "/a", service: "test" },
      z.object({ id: z.string() }),
    );
    const catalog = mcpToolCatalog();
    expect(catalog.map((t) => t.name)).toEqual(["a_first", "z_last"]);
    expect(catalog[0].input_schema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    });
  });

  it("honours explicit input_schema override", () => {
    defineMcpTool(
      {
        name: "custom",
        description: "",
        category: "a",
        mutation: false,
        input_schema: { type: "object", properties: { hand: { type: "string" } } },
      },
      { method: "GET", path: "/c", service: "test" },
      z.object({ ignored: z.string() }),
    );
    const [t] = mcpToolCatalog();
    expect(t.input_schema).toEqual({
      type: "object",
      properties: { hand: { type: "string" } },
    });
  });
});
