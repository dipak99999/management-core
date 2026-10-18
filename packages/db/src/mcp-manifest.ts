// Universal MCP — route manifest + Zod-to-JSON-Schema converter.
//
// Each REST route describes itself via `mcp: { name, description,
// category, mutation }` in its route file. A collector scans registered
// routes and produces a manifest that becomes MCP tools 1:1.
//
// v1 supports the subset of Zod we actually use in routes: string,
// number, boolean, array, object, enum, optional, nullable, literal.
// Anything else (union, discriminatedUnion, transform) falls back to
// { type: "string" } — routes with such shapes should provide an
// explicit `input_schema` override in their mcp metadata.

import type { ZodTypeAny } from "zod";

export interface McpToolMeta {
  name: string;          // "sales_invoice.list", "customer.create"
  description: string;   // shown to the LLM at discovery
  category: string;      // grouping key ("accounting" | "crm" | ...)
  mutation: boolean;     // true = writes; guardrails apply
  // Optional explicit input schema — overrides Zod introspection.
  input_schema?: Record<string, unknown>;
}

export interface McpTool extends McpToolMeta {
  // JSON Schema for the tool's input. Generated from Zod or overridden.
  input_schema: Record<string, unknown>;
  // The HTTP verb + path the tool wraps. The MCP server dispatches to
  // this endpoint on the caller's behalf, propagating auth.
  http: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; service: string };
}

// Minimal Zod → JSON-Schema converter. Handles the shapes routes use.
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName?: string; [k: string]: unknown };
  const t = def.typeName as string | undefined;
  switch (t) {
    case "ZodString": {
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: unknown; regex?: RegExp }>;
      const s: Record<string, unknown> = { type: "string" };
      for (const c of checks) {
        if (c.kind === "email") s.format = "email";
        else if (c.kind === "url") s.format = "uri";
        else if (c.kind === "uuid") s.format = "uuid";
        else if (c.kind === "datetime") s.format = "date-time";
        else if (c.kind === "min") s.minLength = c.value;
        else if (c.kind === "max") s.maxLength = c.value;
        else if (c.kind === "regex" && c.regex) s.pattern = c.regex.source;
      }
      return s;
    }
    case "ZodNumber": {
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: unknown }>;
      const s: Record<string, unknown> = { type: "number" };
      for (const c of checks) {
        if (c.kind === "int") s.type = "integer";
        else if (c.kind === "min") s.minimum = c.value;
        else if (c.kind === "max") s.maximum = c.value;
      }
      return s;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodDate":
      return { type: "string", format: "date-time" };
    case "ZodEnum": {
      const values = (def.values ?? []) as string[];
      return { type: "string", enum: values };
    }
    case "ZodLiteral": {
      const v = def.value as unknown;
      return { const: v };
    }
    case "ZodArray": {
      const inner = def.type as ZodTypeAny;
      return { type: "array", items: zodToJsonSchema(inner) };
    }
    case "ZodObject": {
      const shape = ((def.shape ?? (() => ({}))) as () => Record<string, ZodTypeAny>)();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(val);
        if (!isOptional(val)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault": {
      const inner = def.innerType as ZodTypeAny;
      return zodToJsonSchema(inner);
    }
    case "ZodEffects": {
      const inner = def.schema as ZodTypeAny;
      return zodToJsonSchema(inner);
    }
    case "ZodRecord": {
      return { type: "object", additionalProperties: true };
    }
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      // Fall back to permissive shape — the route validator will still enforce.
      return { type: "string" };
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const t = (schema._def as { typeName?: string }).typeName;
  return t === "ZodOptional" || t === "ZodDefault" || t === "ZodNullable";
}

// Manifest builder — routes register themselves via `defineMcpTool`,
// then `mcpToolCatalog()` returns the ordered list for the MCP server.
const REGISTRY: McpTool[] = [];

export function defineMcpTool(
  meta: McpToolMeta,
  http: McpTool["http"],
  inputSchema: ZodTypeAny | Record<string, unknown> | undefined,
): void {
  const schema =
    meta.input_schema
      ? meta.input_schema
      : inputSchema && typeof (inputSchema as ZodTypeAny)._def === "object"
        ? zodToJsonSchema(inputSchema as ZodTypeAny)
        : (inputSchema as Record<string, unknown>) ?? { type: "object" };
  REGISTRY.push({ ...meta, input_schema: schema, http });
}

export function mcpToolCatalog(): McpTool[] {
  return REGISTRY.slice().sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category),
  );
}

// Reset the registry — used in tests only.
export function _resetMcpToolCatalog(): void {
  REGISTRY.length = 0;
}
