// Static Universal MCP Catalog.
//
// Every route with a stable API surface gets a `McpTool` entry here.
// Two consumers:
//   1. mcp-server — loads STATIC_MCP_CATALOG at boot and exposes each
//      as an MCP tool, dispatching to the target service over HTTP.
//   2. Agent runtime — loads the same catalog so the planner can
//      choose from the same universe.
//
// The list is hand-curated for stability (LLM prompts / agents rely on
// tool names), but ~90% of routes could be codegen'd from Zod schemas
// via zodToJsonSchema() (see mcp-manifest.ts). New tools go here.
//
// Naming: <doctype>.<action> (snake_case). e.g. sales_invoice.list.

import type { McpTool } from "./mcp-manifest";

// Reusable JSON-Schema fragments.
const idParam = { type: "string" as const, description: "Row id (cuid)" };
const pageQuery = {
  type: "object" as const,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 500 },
    offset: { type: "integer", minimum: 0 },
    q: { type: "string", description: "Free-text search" },
  },
};
const emptyObj = { type: "object" as const, properties: {} };

function mkList(
  service: string,
  path: string,
  name: string,
  description: string,
  category: string,
): McpTool {
  return {
    name,
    description,
    category,
    mutation: false,
    input_schema: pageQuery,
    http: { method: "GET", service, path },
  };
}

function mkGet(
  service: string,
  path: string,
  name: string,
  description: string,
  category: string,
): McpTool {
  return {
    name,
    description,
    category,
    mutation: false,
    input_schema: { type: "object", properties: { id: idParam }, required: ["id"] },
    http: { method: "GET", service, path },
  };
}

function mkCreate(
  service: string,
  path: string,
  name: string,
  description: string,
  category: string,
  schema: Record<string, unknown>,
): McpTool {
  return {
    name,
    description,
    category,
    mutation: true,
    input_schema: schema,
    http: { method: "POST", service, path },
  };
}

function mkAction(
  service: string,
  path: string,
  name: string,
  description: string,
  category: string,
  schema: Record<string, unknown> = emptyObj,
): McpTool {
  return {
    name,
    description,
    category,
    mutation: true,
    input_schema: schema,
    http: { method: "POST", service, path },
  };
}

// ─── The catalog ─────────────────────────────────────────────────────

export const STATIC_MCP_CATALOG: McpTool[] = [
  // ── Accounting (accounting-service) ─────────────────────────────
  mkList("accounting-service", "/customers", "customer.list", "List customers with optional search.", "accounting"),
  mkGet("accounting-service", "/customers/:id", "customer.get", "Fetch one customer by id.", "accounting"),
  mkCreate("accounting-service", "/customers", "customer.create", "Create a customer.", "accounting", {
    type: "object",
    properties: {
      customerName: { type: "string" },
      email: { type: "string", format: "email" },
      mobile: { type: "string" },
      gstin: { type: "string" },
      customerGroupId: { type: "string" },
    },
    required: ["customerName"],
  }),

  mkList("accounting-service", "/suppliers", "supplier.list", "List suppliers.", "accounting"),
  mkCreate("accounting-service", "/suppliers", "supplier.create", "Create a supplier.", "accounting", {
    type: "object",
    properties: {
      supplierName: { type: "string" },
      email: { type: "string", format: "email" },
      gstin: { type: "string" },
    },
    required: ["supplierName"],
  }),

  mkList("accounting-service", "/items", "item.list", "List items (products/services).", "accounting"),
  mkCreate("accounting-service", "/items", "item.create", "Create an item.", "accounting", {
    type: "object",
    properties: {
      itemCode: { type: "string" },
      itemName: { type: "string" },
      stockUom: { type: "string" },
      isStockItem: { type: "boolean" },
      itemGroup: { type: "string" },
    },
    required: ["itemCode", "itemName"],
  }),

  mkList("accounting-service", "/sales-invoices", "sales_invoice.list", "List sales invoices.", "accounting"),
  mkGet("accounting-service", "/sales-invoices/:id/full", "sales_invoice.get_full", "Fetch invoice with items + taxes + payments + GL.", "accounting"),
  mkAction("accounting-service", "/sales-invoices/:id/submit", "sales_invoice.submit", "Submit a draft sales invoice (posts GL).", "accounting"),
  mkAction("accounting-service", "/sales-invoices/:id/cancel", "sales_invoice.cancel", "Cancel a submitted sales invoice.", "accounting"),

  mkList("accounting-service", "/purchase-invoices", "purchase_invoice.list", "List purchase invoices.", "accounting"),
  mkList("accounting-service", "/purchase-orders", "purchase_order.list", "List purchase orders.", "accounting"),
  mkAction("accounting-service", "/purchase-orders/:id/submit", "purchase_order.submit", "Submit a draft PO.", "accounting"),

  mkList("accounting-service", "/payment-entries", "payment_entry.list", "List payment entries.", "accounting"),
  mkAction("accounting-service", "/payment-entries/:id/submit", "payment_entry.submit", "Submit a draft payment entry (posts GL).", "accounting"),

  mkList("accounting-service", "/journal-entries", "journal_entry.list", "List journal entries.", "accounting"),

  // Reports (read-only, safe for agents)
  {
    name: "report.trial_balance",
    description: "Trial Balance as of an optional 'as of' date.",
    category: "reports",
    mutation: false,
    input_schema: {
      type: "object",
      properties: { asOfDate: { type: "string", format: "date" } },
    },
    http: { method: "GET", service: "accounting-service", path: "/reports/trial-balance" },
  },
  {
    name: "report.profit_and_loss",
    description: "P&L for a period.",
    category: "reports",
    mutation: false,
    input_schema: {
      type: "object",
      properties: {
        fromDate: { type: "string", format: "date" },
        toDate: { type: "string", format: "date" },
      },
    },
    http: { method: "GET", service: "accounting-service", path: "/reports/profit-and-loss" },
  },
  {
    name: "report.balance_sheet",
    description: "Balance sheet as of a date.",
    category: "reports",
    mutation: false,
    input_schema: {
      type: "object",
      properties: { asOfDate: { type: "string", format: "date" } },
    },
    http: { method: "GET", service: "accounting-service", path: "/reports/balance-sheet" },
  },
  {
    name: "report.aging",
    description: "AR/AP aging buckets.",
    category: "reports",
    mutation: false,
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["ar", "ap"] },
        asOfDate: { type: "string", format: "date" },
      },
      required: ["kind"],
    },
    http: { method: "GET", service: "accounting-service", path: "/reports/aging" },
  },

  // ── CRM (crm-service) ────────────────────────────────────────────
  mkList("crm-service", "/leads", "lead.list", "List CRM leads.", "crm"),
  mkGet("crm-service", "/leads/:id", "lead.get", "Fetch one lead.", "crm"),
  mkCreate("crm-service", "/leads", "lead.create", "Create a lead.", "crm", {
    type: "object",
    properties: {
      leadName: { type: "string" },
      companyName: { type: "string" },
      email: { type: "string", format: "email" },
      mobile: { type: "string" },
      source: { type: "string" },
      status: { type: "string", enum: ["Open", "Contacted", "Interested", "Converted", "Lost"] },
    },
    required: ["leadName"],
  }),
  mkAction("crm-service", "/leads/:id/convert", "lead.convert_to_customer", "Convert a Qualified lead to a Customer.", "crm"),

  mkList("crm-service", "/opportunities", "opportunity.list", "List opportunities.", "crm"),
  mkList("crm-service", "/quotations", "quotation.list", "List quotations.", "crm"),
  mkAction("crm-service", "/quotations/:id/submit", "quotation.submit", "Submit a quotation.", "crm"),
  mkAction("crm-service", "/quotations/:id/convert-to-sales-order", "quotation.convert_to_sales_order", "Convert a submitted quotation into a Sales Order.", "crm"),

  mkList("crm-service", "/sales-orders", "sales_order.list", "List sales orders.", "crm"),
  mkAction("crm-service", "/sales-orders/:id/submit", "sales_order.submit", "Submit a sales order (creates dropship POs when applicable).", "crm"),
  mkAction("crm-service", "/sales-orders/:id/convert-to-invoice", "sales_order.convert_to_invoice", "Materialize an invoice from a SO.", "crm"),

  // Desk (support)
  mkList("crm-service", "/desk/tickets", "ticket.list", "List support tickets.", "support"),
  mkGet("crm-service", "/desk/tickets/:id", "ticket.get", "Fetch one ticket.", "support"),
  mkCreate("crm-service", "/desk/tickets", "ticket.create", "Create a ticket.", "support", {
    type: "object",
    properties: {
      subject: { type: "string" },
      description: { type: "string" },
      customerId: { type: "string" },
      priority: { type: "string", enum: ["Low", "Medium", "High", "Urgent"] },
    },
    required: ["subject"],
  }),
  mkAction("crm-service", "/desk/tickets/:id/reply", "ticket.reply", "Post a reply to a ticket.", "support", {
    type: "object",
    properties: { body: { type: "string" }, isInternal: { type: "boolean" } },
    required: ["body"],
  }),

  // ── Stock (stock-service) ────────────────────────────────────────
  mkList("stock-service", "/warehouses", "warehouse.list", "List warehouses.", "stock"),
  mkList("stock-service", "/stock-entries", "stock_entry.list", "List stock entries.", "stock"),
  mkAction("stock-service", "/stock-entries/:id/submit", "stock_entry.submit", "Submit a stock entry (Material Receipt / Issue / Transfer).", "stock"),
  mkAction("stock-service", "/stock-entries/:id/receive", "stock_entry.receive", "Complete an in-transit transfer.", "stock"),

  mkList("stock-service", "/delivery-notes", "delivery_note.list", "List delivery notes.", "stock"),
  mkAction("stock-service", "/delivery-notes/:id/submit", "delivery_note.submit", "Submit a delivery note (SLE + GL).", "stock"),

  mkList("stock-service", "/purchase-receipts", "purchase_receipt.list", "List purchase receipts.", "stock"),
  mkAction("stock-service", "/purchase-receipts/:id/submit", "purchase_receipt.submit", "Submit a purchase receipt (SLE + subcontracting).", "stock"),

  // ── HR (hr-service) ──────────────────────────────────────────────
  mkList("hr-service", "/employees", "employee.list", "List employees.", "hr"),
  mkGet("hr-service", "/employees/:id", "employee.get", "Fetch one employee.", "hr"),
  mkList("hr-service", "/leave-applications", "leave_application.list", "List leave applications.", "hr"),
  mkAction("hr-service", "/leave-applications/:id/approve", "leave_application.approve", "Approve a pending leave application.", "hr"),
  mkAction("hr-service", "/leave-applications/:id/reject", "leave_application.reject", "Reject a leave application with reason.", "hr", {
    type: "object",
    properties: { reason: { type: "string" } },
    required: ["reason"],
  }),

  mkList("hr-service", "/payroll-entries", "payroll_entry.list", "List payroll entries.", "hr"),
  mkAction("hr-service", "/payroll-entries/:id/submit", "payroll_entry.submit", "Bulk-generate salary slips and post payout JE.", "hr"),

  // ── Projects (projects-service) ──────────────────────────────────
  mkList("projects-service", "/projects", "project.list", "List projects.", "projects"),
  mkList("projects-service", "/tasks", "task.list", "List tasks.", "projects"),
  mkList("projects-service", "/issues", "issue.list", "List engineering issues.", "projects"),
  mkList("projects-service", "/timesheets", "timesheet.list", "List timesheets.", "projects"),

  // ── Agents (accounting-service) ──────────────────────────────────
  mkList("accounting-service", "/agents/tasks", "agent_task.list", "List agent tasks.", "agents"),
  mkGet("accounting-service", "/agents/tasks/:id", "agent_task.get", "Fetch an agent task with all its steps.", "agents"),
];

// Grouped view for MCP discovery UX.
export function catalogByCategory(): Record<string, McpTool[]> {
  const out: Record<string, McpTool[]> = {};
  for (const t of STATIC_MCP_CATALOG) {
    (out[t.category] ??= []).push(t);
  }
  return out;
}

// Look up a tool by name — hot path for the MCP dispatcher.
const BY_NAME = new Map(STATIC_MCP_CATALOG.map((t) => [t.name, t]));
export function toolByName(name: string): McpTool | undefined {
  return BY_NAME.get(name);
}
