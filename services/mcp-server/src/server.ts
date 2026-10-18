// Assemble a fresh MCP Server bound to a specific LumaaraClient. Called once
// per stdio process and once per HTTP+SSE session (so each remote connection
// carries its own JWT + auth state).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { LumaaraClient } from "./lumaara-client";
import { buildTools, type McpTool } from "./tools";
import { LumaaraApiError } from "./lumaara-client";

export function createLumaaraMcpServer(client: LumaaraClient): Server {
  const tools = buildTools();
  const byName = new Map<string, McpTool>(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "lumaara-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return errorContent(`Unknown tool: ${request.params.name}`);
    }
    // Every tool except `login` requires an authenticated session.
    if (tool.name !== "login" && !client.hasJwt()) {
      return errorContent(
        "Not authenticated. Call the `login` tool first with tenantSlug + email + password, or start the server with LUMAARA_JWT set.",
      );
    }
    try {
      const result = await tool.handler(request.params.arguments ?? {}, client);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof LumaaraApiError) {
        return errorContent(`Lumaara API error ${err.status}: ${err.message}`);
      }
      return errorContent(err instanceof Error ? err.message : "Tool failed");
    }
  });

  return server;
}

function errorContent(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}
