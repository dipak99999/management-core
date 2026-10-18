// Curated MCP tools that expose Lumaara to LLMs. Each tool declares:
//   - name         → snake_case identifier the model calls
//   - description  → what it does + when to use it (matters — this is the
//                    only doc the model sees when planning)
//   - inputSchema  → JSON Schema for arguments
//   - handler      → runs the actual REST call via LumaaraClient
//
// The goal is ~30-40 high-signal tools covering the most-used workflows.
// A dumping-ground of every REST endpoint would overwhelm the model's
// planning; we instead expose CRUD verbs on major doctypes + a few
// composite operations (submit, cancel, convert, generate).

import { z } from "zod";
import { STATIC_MCP_CATALOG, type McpTool as CatalogTool } from "@lumaara/db";
import type { LumaaraClient, ServiceName } from "./lumaara-client";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  handler: (args: Record<string, unknown>, client: LumaaraClient) => Promise<unknown>;
}

// ── Shared arg helpers ─────────────────────────────────────────────────

const StringArg = { type: "string" } as const;
const NumberArg = { type: "number" } as const;
const BoolArg   = { type: "boolean" } as const;

function paginated(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      limit:  { type: "number", description: "Max rows (default 20, max 100)" },
      cursor: { type: "string", description: "Pagination cursor from a previous response" },
      search: { type: "string", description: "Free-text search across common fields" },
      ...extra,
    },
    additionalProperties: false,
  };
}

function idArg(name = "id"): Record<string, unknown> {
  return {
    type: "object",
    properties: { [name]: { type: "string", description: `CUID of the record` } },
    required: [name],
    additionalProperties: false,
  };
}

// ── Auth tool (special: no JWT required, sets one on the client) ──────

const loginSchema = z.object({
  tenantSlug: z.string(),
  email: z.string().email(),
  password: z.string(),
});

const login: McpTool = {
  name: "login",
  description:
    "Authenticate against Lumaara and cache a JWT for subsequent tool calls in this session. Call this FIRST if you haven't been given a token via environment (LUMAARA_JWT). Returns tenant + user info on success.",
  inputSchema: {
    type: "object",
    properties: {
      tenantSlug: { type: "string", description: "Workspace slug, e.g. 'demo'" },
      email:      { type: "string", description: "User email" },
      password:   { type: "string", description: "Password (never logged)" },
    },
    required: ["tenantSlug", "email", "password"],
    additionalProperties: false,
  },
  async handler(args, client) {
    const { tenantSlug, email, password } = loginSchema.parse(args);
    const res = await client.request<{
      token: string;
      user: { email: string; role: string };
      tenant: { name: string; slug: string };
    }>("auth", "POST", "/auth/login", {
      body: { tenantSlug, email, password },
    });
    client.setJwt(res.token);
    return {
      ok: true,
      user: res.user,
      tenant: res.tenant,
      note: "JWT cached for this session. Subsequent tool calls will use it automatically.",
    };
  },
};

const whoami: McpTool = {
  name: "whoami",
  description:
    "Return the currently authenticated user + tenant. Useful to confirm the session before performing writes.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async handler(_args, client) {
    if (!client.hasJwt()) return { authenticated: false, hint: "Call `login` first." };
    return client.request("auth", "GET", "/auth/me");
  },
};

// ── Generic CRUD factory ──────────────────────────────────────────────
//
// Builds `list/get/create/update/delete` tools for a doctype in one call.
// The heavy lifting is in Lumaara's REST layer (validation, permissions,
// audit); this just proxies. Every write tool includes a "confirm" note in
// its description so the model doesn't fire destructive ops speculatively.

interface DoctypeSpec {
  /** Short human name — used in tool descriptions. */
  label: string;
  /** REST path prefix — e.g. "/customers". */
  path: string;
  /** Which service owns the route. */
  service: ServiceName;
  /** Human noun for hints — "customer", "invoice". */
  noun: string;
  /** Extra list-query args exposed to the model. */
  listQuery?: Record<string, unknown>;
  /** JSON Schema for the create payload (top-level object). */
  createSchema?: Record<string, unknown>;
  /** JSON Schema for update payload (top-level object; usually a subset of create). */
  updateSchema?: Record<string, unknown>;
  /** Skip these verbs for read-only doctypes. */
  omit?: ("list" | "get" | "create" | "update" | "delete")[];
}

function crudTools(spec: DoctypeSpec): McpTool[] {
  const out: McpTool[] = [];
  const omit = new Set(spec.omit ?? []);

  if (!omit.has("list")) {
    out.push({
      name: `list_${plural(spec.noun)}`,
      description: `List ${spec.label} with optional search/pagination.`,
      inputSchema: paginated(spec.listQuery),
      async handler(args, client) {
        return client.request(spec.service, "GET", spec.path, { query: args as Record<string, string> });
      },
    });
  }
  if (!omit.has("get")) {
    out.push({
      name: `get_${spec.noun}`,
      description: `Fetch one ${spec.label} record by id.`,
      inputSchema: idArg(),
      async handler(args, client) {
        return client.request(spec.service, "GET", `${spec.path}/${args.id}`);
      },
    });
  }
  if (!omit.has("create") && spec.createSchema) {
    out.push({
      name: `create_${spec.noun}`,
      description: `Create a new ${spec.label}. WRITE — confirm with user before firing.`,
      inputSchema: spec.createSchema,
      async handler(args, client) {
        return client.request(spec.service, "POST", spec.path, { body: args });
      },
    });
  }
  if (!omit.has("update") && spec.updateSchema) {
    out.push({
      name: `update_${spec.noun}`,
      description: `Patch fields on a ${spec.label}. WRITE — confirm with user before firing.`,
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, ...(spec.updateSchema as { properties?: Record<string, unknown> }).properties },
        required: ["id"],
        additionalProperties: false,
      },
      async handler(args, client) {
        const { id, ...body } = args as { id: string } & Record<string, unknown>;
        return client.request(spec.service, "PUT", `${spec.path}/${id}`, { body });
      },
    });
  }
  if (!omit.has("delete")) {
    out.push({
      name: `delete_${spec.noun}`,
      description: `Delete a ${spec.label}. DESTRUCTIVE — always ask user before firing.`,
      inputSchema: idArg(),
      async handler(args, client) {
        return client.request(spec.service, "DELETE", `${spec.path}/${args.id}`);
      },
    });
  }
  return out;
}

function plural(noun: string): string {
  if (noun.endsWith("y")) return noun.slice(0, -1) + "ies";
  if (noun.endsWith("s")) return noun;
  return noun + "s";
}

// ── Workflow actions (submit/cancel/convert) ──────────────────────────
//
// These are named for what they do so the model can reason about intent.
// Each maps to a `POST /:doctype/:id/:action` endpoint in the service.

interface ActionSpec {
  name: string;
  description: string;
  service: ServiceName;
  method: "POST" | "PUT";
  urlBuilder: (args: Record<string, unknown>) => string;
  bodyBuilder?: (args: Record<string, unknown>) => unknown;
  extraArgs?: Record<string, unknown>;
}

function actionTool(spec: ActionSpec): McpTool {
  const properties = { id: { type: "string" }, ...(spec.extraArgs ?? {}) };
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties,
      required: ["id"],
      additionalProperties: false,
    },
    async handler(args, client) {
      return client.request(spec.service, spec.method, spec.urlBuilder(args), {
        body: spec.bodyBuilder ? spec.bodyBuilder(args) : undefined,
      });
    },
  };
}

// ── Reports ───────────────────────────────────────────────────────────

const reports: McpTool[] = [
  {
    name: "report_trial_balance",
    description: "Trial balance for the tenant across a period. Returns { accounts: [{code, name, debit, credit}], totals }.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string", description: "ISO date (YYYY-MM-DD)" },
        toDate:   { type: "string", description: "ISO date (YYYY-MM-DD)" },
      },
      additionalProperties: false,
    },
    async handler(args, client) {
      return client.request("accounting", "GET", "/reports/trial-balance", { query: args as Record<string, string> });
    },
  },
  {
    name: "report_profit_and_loss",
    description: "P&L / income statement for a period. Groups income vs expense.",
    inputSchema: {
      type: "object",
      properties: {
        fromDate: { type: "string" },
        toDate:   { type: "string" },
      },
      additionalProperties: false,
    },
    async handler(args, client) {
      return client.request("accounting", "GET", "/reports/profit-and-loss", { query: args as Record<string, string> });
    },
  },
  {
    name: "report_balance_sheet",
    description: "Balance sheet as-of a date. Groups assets / liabilities / equity.",
    inputSchema: {
      type: "object",
      properties: { asOf: { type: "string" } },
      additionalProperties: false,
    },
    async handler(args, client) {
      return client.request("accounting", "GET", "/reports/balance-sheet", { query: args as Record<string, string> });
    },
  },
  {
    name: "report_cash_flow",
    description: "Cash flow statement (operating/investing/financing) for a period.",
    inputSchema: {
      type: "object",
      properties: { fromDate: { type: "string" }, toDate: { type: "string" } },
      additionalProperties: false,
    },
    async handler(args, client) {
      return client.request("accounting", "GET", "/reports/cash-flow", { query: args as Record<string, string> });
    },
  },
  {
    name: "report_sales_analytics",
    description: "CRM sales analytics — pipeline value, conversions, top salespersons.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async handler(_args, client) {
      return client.request("crm", "GET", "/reports/sales-analytics");
    },
  },
];

// ── Assemble all tools ────────────────────────────────────────────────

export function buildTools(): McpTool[] {
  const customerCreate = {
    type: "object",
    properties: {
      customerName: { type: "string" },
      customerType: { type: "string", enum: ["Company", "Individual"] },
      email:  { type: "string" },
      mobile: { type: "string" },
      gstin:  { type: "string", description: "India GST identifier, 15 chars" },
      territoryId:     { type: "string" },
      customerGroupId: { type: "string" },
    },
    required: ["customerName"],
    additionalProperties: false,
  };
  const customerUpdate = {
    type: "object",
    properties: customerCreate.properties,
    additionalProperties: false,
  };

  const supplierCreate = {
    type: "object",
    properties: {
      supplierName: { type: "string" },
      supplierType: { type: "string", enum: ["Company", "Individual"] },
      email:  { type: "string" },
      mobile: { type: "string" },
      gstin:  { type: "string" },
    },
    required: ["supplierName"],
    additionalProperties: false,
  };

  const itemCreate = {
    type: "object",
    properties: {
      itemCode:     { type: "string" },
      itemName:     { type: "string" },
      stockUom:     { type: "string", description: "Unit of measure (e.g. Unit, Nos, Kg)" },
      standardRate: { type: "number" },
      isStockItem:  { type: "boolean" },
    },
    required: ["itemCode", "itemName"],
    additionalProperties: false,
  };

  const leadCreate = {
    type: "object",
    properties: {
      leadName:    { type: "string" },
      companyName: { type: "string" },
      email:       { type: "string" },
      mobile:      { type: "string" },
      source:      { type: "string" },
      status:      { type: "string", enum: ["Open", "Contacted", "Interested", "Converted", "Lost"] },
    },
    required: ["leadName"],
    additionalProperties: false,
  };

  const oppCreate = {
    type: "object",
    properties: {
      name:              { type: "string", description: "Auto-numbered — omit to let server assign" },
      partyType:         { type: "string", enum: ["Lead", "Customer"] },
      leadId:            { type: "string" },
      customerId:        { type: "string" },
      expectedAmount:    { type: "number" },
      expectedCloseDate: { type: "string", description: "ISO date" },
      source:            { type: "string" },
    },
    required: ["partyType"],
    additionalProperties: false,
  };

  const quotationCreate = {
    type: "object",
    properties: {
      partyType:  { type: "string", enum: ["Lead", "Customer"] },
      leadId:     { type: "string" },
      customerId: { type: "string" },
      currency:   { type: "string", description: "3-letter, default INR" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            qty:    { type: "number" },
            rate:   { type: "number" },
          },
          required: ["itemId", "qty", "rate"],
        },
      },
    },
    required: ["partyType", "items"],
    additionalProperties: false,
  };

  const invoiceCreate = {
    type: "object",
    properties: {
      customerId: { type: "string" },
      currency:   { type: "string" },
      dueDate:    { type: "string", description: "ISO date" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            qty:    { type: "number" },
            rate:   { type: "number" },
          },
          required: ["itemId", "qty", "rate"],
        },
      },
    },
    required: ["customerId", "items"],
    additionalProperties: false,
  };

  const paymentCreate = {
    type: "object",
    properties: {
      paymentType: { type: "string", enum: ["Receive", "Pay"] },
      partyType:   { type: "string", enum: ["Customer", "Supplier"] },
      partyId:     { type: "string" },
      paidAmount:  { type: "number" },
      modeOfPayment: { type: "string", description: "e.g. Bank, Cash, UPI" },
      references: {
        type: "array",
        items: {
          type: "object",
          properties: {
            referenceDoctype: { type: "string", enum: ["SalesInvoice", "PurchaseInvoice"] },
            referenceId:      { type: "string" },
            allocatedAmount:  { type: "number" },
          },
        },
      },
    },
    required: ["paymentType", "partyType", "partyId", "paidAmount"],
    additionalProperties: false,
  };

  const todoCreate = {
    type: "object",
    properties: {
      description: { type: "string" },
      dueDate:     { type: "string", description: "ISO date" },
      priority:    { type: "string", enum: ["Low", "Medium", "High"] },
    },
    required: ["description"],
    additionalProperties: false,
  };

  return [
    // Session
    login,
    whoami,

    // CRM ────────────────────────────────────────────
    ...crudTools({ label: "leads",         path: "/leads",         service: "crm", noun: "lead",         createSchema: leadCreate, updateSchema: leadCreate }),
    ...crudTools({ label: "opportunities", path: "/opportunities", service: "crm", noun: "opportunity",  createSchema: oppCreate,  updateSchema: oppCreate }),
    ...crudTools({ label: "quotations",    path: "/quotations",    service: "crm", noun: "quotation",    createSchema: quotationCreate }),
    ...crudTools({ label: "sales orders",  path: "/sales-orders",  service: "crm", noun: "sales_order",  omit: ["create", "update"] }),
    ...crudTools({ label: "campaigns",     path: "/campaigns",     service: "crm", noun: "campaign" }),

    actionTool({
      name: "convert_lead_to_customer",
      description: "Convert a Lead into a Customer. Preserves email/phone; opens up sales invoicing on the account.",
      service: "crm", method: "POST",
      urlBuilder: (a) => `/leads/${a.id}/convert`,
    }),
    actionTool({
      name: "submit_quotation",
      description: "Submit a draft quotation, locking totals and issuing the quotation number to the customer.",
      service: "crm", method: "POST",
      urlBuilder: (a) => `/quotations/${a.id}/submit`,
    }),
    actionTool({
      name: "convert_quotation_to_sales_order",
      description: "Once the customer accepts, roll a submitted quotation into a Sales Order.",
      service: "crm", method: "POST",
      urlBuilder: (a) => `/quotations/${a.id}/convert-to-sales-order`,
    }),
    actionTool({
      name: "submit_sales_order",
      description: "Submit a draft sales order — moves it to 'To Deliver' state and reserves stock where applicable.",
      service: "crm", method: "POST",
      urlBuilder: (a) => `/sales-orders/${a.id}/submit`,
    }),
    actionTool({
      name: "convert_sales_order_to_invoice",
      description: "Materialize a Sales Invoice from a submitted Sales Order (billing step).",
      service: "crm", method: "POST",
      urlBuilder: (a) => `/sales-orders/${a.id}/convert-to-invoice`,
    }),

    // Accounting ─────────────────────────────────────
    ...crudTools({ label: "customers", path: "/customers", service: "accounting", noun: "customer", createSchema: customerCreate, updateSchema: customerUpdate }),
    ...crudTools({ label: "suppliers", path: "/suppliers", service: "accounting", noun: "supplier", createSchema: supplierCreate }),
    ...crudTools({ label: "items",     path: "/items",     service: "accounting", noun: "item",     createSchema: itemCreate }),

    ...crudTools({ label: "sales invoices",    path: "/sales-invoices",    service: "accounting", noun: "sales_invoice",    createSchema: invoiceCreate }),
    ...crudTools({ label: "purchase invoices", path: "/purchase-invoices", service: "accounting", noun: "purchase_invoice", omit: ["create"] }),
    ...crudTools({ label: "purchase orders",   path: "/purchase-orders",   service: "accounting", noun: "purchase_order",   omit: ["create"] }),
    ...crudTools({ label: "payments",          path: "/payment-entries",   service: "accounting", noun: "payment",          createSchema: paymentCreate }),
    ...crudTools({ label: "journal entries",   path: "/journal-entries",   service: "accounting", noun: "journal_entry",    omit: ["create"] }),

    actionTool({
      name: "submit_sales_invoice",
      description: "Submit a draft sales invoice — posts GL entries + starts due-date clock. Confirm with user first.",
      service: "accounting", method: "POST",
      urlBuilder: (a) => `/sales-invoices/${a.id}/submit`,
    }),
    actionTool({
      name: "cancel_sales_invoice",
      description: "Cancel a submitted sales invoice. Reverses GL entries. Destructive — confirm.",
      service: "accounting", method: "POST",
      urlBuilder: (a) => `/sales-invoices/${a.id}/cancel`,
    }),

    // HR ─────────────────────────────────────────────
    ...crudTools({ label: "employees",           path: "/employees",           service: "hr", noun: "employee",         omit: ["delete"] }),
    ...crudTools({ label: "salary slips",        path: "/salary-slips",        service: "hr", noun: "salary_slip",       omit: ["create", "update"] }),
    ...crudTools({ label: "leave applications",  path: "/leave-applications",  service: "hr", noun: "leave_application", omit: ["create"] }),
    ...crudTools({ label: "attendance",          path: "/attendance",          service: "hr", noun: "attendance",        omit: ["create"] }),
    ...crudTools({ label: "job openings",        path: "/job-openings",        service: "hr", noun: "job_opening" }),
    ...crudTools({ label: "job applicants",      path: "/job-applicants",      service: "hr", noun: "job_applicant" }),
    ...crudTools({ label: "expense claims",      path: "/expense-claims",      service: "hr", noun: "expense_claim",     omit: ["create"] }),
    ...crudTools({ label: "holiday lists",       path: "/holiday-lists",       service: "hr", noun: "holiday_list" }),

    actionTool({
      name: "approve_leave_application",
      description: "Approve a pending leave application. Requires HR Manager role.",
      service: "hr", method: "POST",
      urlBuilder: (a) => `/leave-applications/${a.id}/approve`,
    }),
    actionTool({
      name: "reject_leave_application",
      description: "Reject a pending leave application.",
      service: "hr", method: "POST",
      urlBuilder: (a) => `/leave-applications/${a.id}/reject`,
      extraArgs: { reason: { type: "string" } },
      bodyBuilder: (a) => ({ reason: a.reason }),
    }),
    actionTool({
      name: "submit_salary_slip",
      description: "Submit a draft salary slip. Posts payroll GL entries.",
      service: "hr", method: "POST",
      urlBuilder: (a) => `/salary-slips/${a.id}/submit`,
    }),

    // Stock ──────────────────────────────────────────
    ...crudTools({ label: "warehouses",    path: "/warehouses",    service: "stock", noun: "warehouse" }),
    ...crudTools({ label: "stock entries", path: "/stock-entries", service: "stock", noun: "stock_entry", omit: ["create"] }),
    ...crudTools({ label: "delivery notes", path: "/delivery-notes", service: "stock", noun: "delivery_note", omit: ["create"] }),
    ...crudTools({ label: "work orders",   path: "/work-orders",   service: "stock", noun: "work_order",   omit: ["create"] }),
    ...crudTools({ label: "material requests", path: "/material-requests", service: "stock", noun: "material_request", omit: ["create"] }),

    // Projects ───────────────────────────────────────
    ...crudTools({ label: "projects",   path: "/projects",   service: "projects", noun: "project" }),
    ...crudTools({ label: "tasks",      path: "/tasks",      service: "projects", noun: "task" }),
    ...crudTools({ label: "timesheets", path: "/timesheets", service: "projects", noun: "timesheet", omit: ["create"] }),

    // Todos ──────────────────────────────────────────
    ...crudTools({ label: "todos", path: "/todos", service: "auth", noun: "todo", createSchema: todoCreate }),

    // Reports ────────────────────────────────────────
    ...reports,

    // Auto-generated: the Universal MCP Catalog from @lumaara/db.
    // Every route in the static catalog becomes a tool that dispatches
    // to the correct service via LumaaraClient. Skipped when the name
    // is already claimed by a hand-curated tool above.
    ...autoToolsFromCatalog(),
  ];
}

// Convert @lumaara/db's STATIC_MCP_CATALOG into MCP tool handlers.
// Hand-curated tools above take priority (they cover login, whoami,
// domain-specific convert flows). Any name collision is resolved in
// favor of the hand-curated version.
function autoToolsFromCatalog(): McpTool[] {
  const handRolled = new Set<string>([
    "login", "whoami",
    "report_trial_balance", "report_profit_and_loss", "report_balance_sheet",
    "report_cash_flow", "report_sales_analytics",
    "convert_lead_to_customer", "submit_quotation", "convert_quotation_to_sales_order",
    "submit_sales_order", "convert_sales_order_to_invoice", "submit_sales_invoice",
    "cancel_sales_invoice", "approve_leave_application", "reject_leave_application",
    "submit_salary_slip",
  ]);
  const out: McpTool[] = [];
  for (const t of STATIC_MCP_CATALOG) {
    const catalogName = t.name.replace(/\./g, "_");
    if (handRolled.has(catalogName)) continue;
    out.push(catalogToolToMcp(t, catalogName));
  }
  return out;
}

function catalogToolToMcp(t: CatalogTool, mcpName: string): McpTool {
  const serviceMap: Record<string, ServiceName> = {
    "accounting-service": "accounting",
    "auth-service": "auth",
    "crm-service": "crm",
    "hr-service": "hr",
    "projects-service": "projects",
    "stock-service": "stock",
  };
  const service = serviceMap[t.http.service];
  if (!service) {
    // No matching known service — skip by returning a minimal noop.
    return {
      name: mcpName,
      description: `${t.description} [WARN: unknown service ${t.http.service}]`,
      inputSchema: t.input_schema,
      handler: async () => ({ error: `Service ${t.http.service} is not routable` }),
    };
  }
  const method = t.http.method;

  return {
    name: mcpName,
    description: t.description,
    inputSchema: t.input_schema as Record<string, unknown>,
    handler: async (args, client) => {
      // Path params: convert e.g. "/customers/:id" using args.id.
      let path = t.http.path;
      const pathArgs = new Set<string>();
      path = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_full: string, key: string) => {
        pathArgs.add(key);
        const v = (args as Record<string, unknown>)[key];
        if (v == null) throw new Error(`Missing required path parameter: ${key}`);
        return encodeURIComponent(String(v));
      });
      // Body / query = args minus path params.
      const remainder: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (!pathArgs.has(k)) remainder[k] = v;
      }
      if (method === "GET" || method === "DELETE") {
        const query: Record<string, string | number | boolean | undefined> = {};
        for (const [k, v] of Object.entries(remainder)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            query[k] = v;
          }
        }
        return client.request(service, method, path, { query });
      }
      return client.request(service, method, path, { body: remainder });
    },
  };
}
