// OpenAPI 3.1 spec generator, sourced from the same MCP tool catalog the
// LLM router + external MCP clients see. One place to add a tool,
// automatic docs everywhere.
//
// Every catalog entry becomes:
//   - a path (from tool.http.path, with :params converted to {params})
//   - an operation of tool.http.method
//   - request body (POST/PUT/PATCH) or query params from tool.input_schema
//   - response body: generic "success" (200) + auth (401, 403) errors
//
// Downstream:
//   * services/accounting-service/src/routes/openapi.ts serves the spec
//     at GET /openapi.json (public — no auth required, so third-party
//     tools like Postman/Swagger-UI can consume it)
//   * apps/shell/app/admin/api-docs renders Swagger UI over it
//   * Codegen: `openapi-typescript` in any client repo produces types.

import { STATIC_MCP_CATALOG } from "./mcp-catalog";
import type { McpTool } from "./mcp-manifest";

export interface OpenApiBuildOptions {
  /** Public base URL of the API — usually the shell origin. */
  serverUrl: string;
  /** Semver of the running platform. */
  version: string;
  /** Optional title override. */
  title?: string;
}

interface OASPathItem {
  get?: OASOperation;
  post?: OASOperation;
  put?: OASOperation;
  patch?: OASOperation;
  delete?: OASOperation;
  parameters?: OASParameter[];
}

interface OASOperation {
  summary: string;
  description: string;
  tags: string[];
  operationId: string;
  security: Array<Record<string, string[]>>;
  parameters?: OASParameter[];
  requestBody?: {
    required: boolean;
    content: Record<string, { schema: unknown }>;
  };
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: unknown }> }
  >;
}

interface OASParameter {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: { type: string };
}

// Convert Express-style `/customers/:id/submit` → OpenAPI `/customers/{id}/submit`
// and return the list of path parameter names encountered so we can declare
// them in the operation.
function toOpenApiPath(expressPath: string): {
  path: string;
  params: string[];
} {
  const params: string[] = [];
  const path = expressPath.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, (_, name) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path, params };
}

// Turn a tool's `input_schema` into either an OpenAPI request body (writes)
// or a set of query parameters (reads).
function operationParamsAndBody(
  tool: McpTool,
  pathParams: string[],
): { parameters: OASParameter[]; requestBody?: OASOperation["requestBody"] } {
  const parameters: OASParameter[] = pathParams.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));

  const schemaProps = (tool.input_schema?.properties ?? {}) as Record<
    string,
    { type?: string }
  >;

  // For GETs, top-level scalar props become query params.
  if (tool.http.method === "GET") {
    for (const [name, prop] of Object.entries(schemaProps)) {
      if (pathParams.includes(name)) continue;
      const t = typeof prop === "object" && prop && "type" in prop
        ? String(prop.type)
        : "string";
      if (["string", "number", "integer", "boolean"].includes(t)) {
        parameters.push({
          name,
          in: "query",
          required: false,
          schema: { type: t },
        });
      }
    }
    return { parameters };
  }

  // For writes, the whole schema becomes the request body.
  return {
    parameters,
    requestBody: {
      required: false,
      content: {
        "application/json": {
          schema: tool.input_schema ?? { type: "object" },
        },
      },
    },
  };
}

export function buildOpenApiSpec(opts: OpenApiBuildOptions): Record<string, unknown> {
  const paths: Record<string, OASPathItem> = {};

  for (const tool of STATIC_MCP_CATALOG) {
    const { path, params } = toOpenApiPath(tool.http.path);
    const method = tool.http.method.toLowerCase() as
      | "get" | "post" | "put" | "patch" | "delete";
    if (!paths[path]) paths[path] = {};
    const { parameters, requestBody } = operationParamsAndBody(tool, params);
    const op: OASOperation = {
      summary: tool.description,
      description: `${tool.description}\n\n**MCP tool name:** \`${tool.name}\`\n**Category:** ${tool.category}\n**Service:** \`${tool.http.service}\``,
      tags: [tool.category],
      operationId: tool.name.replace(/\./g, "_"),
      security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
      parameters,
      ...(requestBody ? { requestBody } : {}),
      responses: {
        "200": {
          description: "Success",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "401": { description: "Missing or invalid bearer token" },
        "403": {
          description: "Authenticated but not permitted for this action",
        },
        "422": { description: "Validation error — see body.error" },
      },
    };
    paths[path][method] = op;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: opts.title ?? "Lumaara ERP API",
      version: opts.version,
      description:
        "Public HTTP API. Every action here is also exposed as an MCP tool at `/sse` (see docs/MCP.md).",
      contact: { name: "Lumaara" },
      license: { name: "Proprietary" },
    },
    servers: [{ url: opts.serverUrl }],
    tags: Array.from(new Set(STATIC_MCP_CATALOG.map((t) => t.category))).map(
      (name) => ({ name }),
    ),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Session JWT from `POST /auth/login`",
        },
        apiKeyAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API-Token",
          description:
            "Long-lived tenant API token (`ont_*`) minted at `/admin/api-tokens`. Scopes gate which tools are callable.",
        },
      },
    },
    paths,
  };
}
