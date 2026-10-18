import { describe, expect, it } from "vitest";
import { STATIC_MCP_CATALOG, catalogByCategory, toolByName } from "./mcp-catalog";

describe("STATIC_MCP_CATALOG", () => {
  it("contains at least 40 tools", () => {
    expect(STATIC_MCP_CATALOG.length).toBeGreaterThanOrEqual(40);
  });

  it("every tool has name, description, category, http, input_schema", () => {
    for (const t of STATIC_MCP_CATALOG) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.http.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(t.http.path.startsWith("/")).toBe(true);
      expect(t.http.service).toBeTruthy();
      expect(t.input_schema).toBeTruthy();
    }
  });

  it("tool names are unique", () => {
    const names = STATIC_MCP_CATALOG.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("mutation flag is coherent — GETs are non-mutating, POSTs are usually mutating (submit/create/action)", () => {
    for (const t of STATIC_MCP_CATALOG) {
      if (t.http.method === "GET") {
        expect(t.mutation).toBe(false);
      }
    }
  });

  it("covers every major module", () => {
    const cats = new Set(STATIC_MCP_CATALOG.map((t) => t.category));
    for (const expected of ["accounting", "crm", "stock", "hr", "projects", "support", "reports", "agents"]) {
      expect(cats.has(expected)).toBe(true);
    }
  });
});

describe("catalogByCategory", () => {
  it("groups tools by category", () => {
    const groups = catalogByCategory();
    expect(groups.accounting).toBeDefined();
    expect(groups.crm.length).toBeGreaterThan(0);
    expect(groups.hr.length).toBeGreaterThan(0);
  });
});

describe("toolByName", () => {
  it("returns a tool for a known name", () => {
    const t = toolByName("sales_invoice.submit");
    expect(t).toBeDefined();
    expect(t?.http.method).toBe("POST");
    expect(t?.mutation).toBe(true);
  });

  it("returns undefined for unknown names", () => {
    expect(toolByName("does.not.exist")).toBeUndefined();
  });
});
