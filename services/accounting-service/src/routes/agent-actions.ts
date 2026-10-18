import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Agent action timeline + undo.
//
// Surfaces every successful agent tool call to a user-visible timeline
// so the user can see what the AI coworker just did and roll it back
// with one click. Only "undoable" steps appear in the timeline — we
// hide reads, thinks and emits.
//
// Endpoints:
//   GET  /agents/actions/recent   — N most-recent undoable agent steps
//   POST /agents/actions/:id/undo — reverse the step via its inverse tool
//
// Undoability is a hardcoded map (UNDO_MAP). Every create_X auto-maps to
// delete_X; the submit/approve actions get bespoke inverses.

export const agentActionsRouter = Router();
const pAct = perms("AgentTask"); // reuse the task permission scope

// Known inverse operations keyed by original toolName. Each spec is the
// raw HTTP shape of the reversal — kept here instead of going through
// the universal MCP catalog, because the delete tools live only in the
// hand-rolled mcp-server tool list.
interface UndoSpec {
  method: "DELETE" | "POST";
  service: "accounting" | "crm" | "hr" | "stock" | "projects" | "auth";
  // `{id}` is replaced with the id extracted from outputJson.
  pathTemplate: string;
  label: string;
}

function pickId(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  if (typeof o.id === "string") return o.id;
  if (o.data && typeof (o.data as Record<string, unknown>).id === "string") {
    return (o.data as Record<string, unknown>).id as string;
  }
  return null;
}

// UNDO_MAP only lists tools whose inverse endpoint actually exists on
// the backing service. If you add a new create_* here, verify a DELETE
// (or safe inverse) is live — otherwise the user gets a 4xx on Undo.
const UNDO_MAP: Record<string, UndoSpec> = {
  // CRUD creates — DELETE the record. Server rejects if referenced.
  create_campaign:      { method: "DELETE", service: "crm",        pathTemplate: "/campaigns/{id}",        label: "Delete campaign" },
  create_customer:      { method: "DELETE", service: "accounting", pathTemplate: "/customers/{id}",        label: "Delete customer" },
  create_supplier:      { method: "DELETE", service: "accounting", pathTemplate: "/suppliers/{id}",        label: "Delete supplier" },
  create_item:          { method: "DELETE", service: "accounting", pathTemplate: "/items/{id}",            label: "Delete item" },
  create_sales_invoice: { method: "DELETE", service: "accounting", pathTemplate: "/sales-invoices/{id}",   label: "Delete invoice" },
  create_holiday_list:  { method: "DELETE", service: "hr",         pathTemplate: "/holiday-lists/{id}",    label: "Delete holiday list" },
  create_project:       { method: "DELETE", service: "projects",   pathTemplate: "/projects/{id}",         label: "Delete project" },
  create_task:          { method: "DELETE", service: "projects",   pathTemplate: "/tasks/{id}",            label: "Delete task" },
  create_todo:          { method: "DELETE", service: "auth",       pathTemplate: "/todos/{id}",            label: "Delete todo" },

  // State transitions — invert via the matching reversal endpoint.
  submit_sales_invoice: { method: "POST", service: "accounting", pathTemplate: "/sales-invoices/{id}/cancel", label: "Cancel invoice" },
};

const SERVICE_URLS: Record<UndoSpec["service"], string> = {
  "accounting": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:4002",
  "auth":       process.env.AUTH_SERVICE_URL       ?? "http://localhost:4001",
  "crm":        process.env.CRM_SERVICE_URL        ?? "http://localhost:4004",
  "hr":         process.env.HR_SERVICE_URL         ?? "http://localhost:4005",
  "projects":   process.env.PROJECTS_SERVICE_URL   ?? "http://localhost:4006",
  "stock":      process.env.STOCK_SERVICE_URL      ?? "http://localhost:4003",
};

// Redo spec: the original forward operation. Replays the tool with the
// step's inputJson. For creates, that produces a NEW entity (different
// id) — the result is stashed in redoneOutputJson so the user can undo
// again via that fresh id.
interface RedoSpec {
  method: "POST";
  service: UndoSpec["service"];
  pathTemplate: string; // "/leads" for create_lead, "/sales-invoices/{id}/submit" for submit_sales_invoice
  label: string;
  // Some tools pass {id} in the input (submit/cancel) — the id substitutes
  // into the path and is stripped from the body.
  idInPath?: boolean;
}

const REDO_MAP: Record<string, RedoSpec> = {
  create_campaign:      { method: "POST", service: "crm",        pathTemplate: "/campaigns",      label: "Re-create campaign" },
  create_customer:      { method: "POST", service: "accounting", pathTemplate: "/customers",      label: "Re-add customer" },
  create_supplier:      { method: "POST", service: "accounting", pathTemplate: "/suppliers",      label: "Re-add supplier" },
  create_item:          { method: "POST", service: "accounting", pathTemplate: "/items",          label: "Re-add item" },
  create_sales_invoice: { method: "POST", service: "accounting", pathTemplate: "/sales-invoices", label: "Re-draft invoice" },
  create_holiday_list:  { method: "POST", service: "hr",         pathTemplate: "/holiday-lists",  label: "Re-create holiday list" },
  create_project:       { method: "POST", service: "projects",   pathTemplate: "/projects",       label: "Re-create project" },
  create_task:          { method: "POST", service: "projects",   pathTemplate: "/tasks",          label: "Re-create task" },
  create_todo:          { method: "POST", service: "auth",       pathTemplate: "/todos",          label: "Re-add todo" },

  submit_sales_invoice: { method: "POST", service: "accounting", pathTemplate: "/sales-invoices/{id}/submit", label: "Re-submit invoice", idInPath: true },
};

const UNDOABLE_TOOLS = new Set(Object.keys(UNDO_MAP));

// Minimal human-readable summary for the timeline card.
function summarize(toolName: string, output: unknown): string {
  const spec = UNDO_MAP[toolName];
  const id = pickId(output);
  const name =
    output && typeof output === "object" && "name" in (output as Record<string, unknown>)
      ? ((output as Record<string, unknown>).name as string | undefined)
      : undefined;
  const subject = name ?? id ?? "";
  switch (toolName) {
    case "create_lead":          return `Created lead ${subject}`;
    case "create_customer":      return `Added customer ${subject}`;
    case "create_sales_invoice": return `Drafted invoice ${subject}`;
    case "submit_sales_invoice": return `Submitted invoice ${subject}`;
    case "create_opportunity":   return `Created opportunity ${subject}`;
    case "create_quotation":     return `Drafted quotation ${subject}`;
    case "create_task":          return `Created task ${subject}`;
    case "create_project":       return `Started project ${subject}`;
    case "create_todo":          return `Added todo ${subject}`;
    default:                     return `${spec?.label ?? toolName} ${subject}`.trim();
  }
}

agentActionsRouter.get("/actions/recent", pAct.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    50,
  );

  // Return both live (undoneAt=null) and recently-undone (redoneAt=null)
  // steps so the panel can show "Undo" or "Redo" per card.
  const steps = await prisma.agentStep.findMany({
    where: {
      tenantId,
      kind: "ToolCall",
      status: "Succeeded",
      toolName: { in: Array.from(UNDOABLE_TOOLS) },
      // Hide steps that have been undone AND redone — they're "live" via
      // the new entity, which has its own fresh step record. Only one
      // row per logical action in the timeline.
      OR: [
        { undoneAt: null },                       // live
        { undoneAt: { not: null }, redoneAt: null }, // undone but still redoable
      ],
    },
    orderBy: { finishedAt: "desc" },
    take: limit,
    select: {
      id: true,
      toolName: true,
      inputJson: true,
      outputJson: true,
      finishedAt: true,
      taskId: true,
      undoneAt: true,
    },
  });

  res.json(
    steps.map((s) => {
      const isUndone = s.undoneAt !== null;
      return {
        id: s.id,
        toolName: s.toolName,
        summary: summarize(s.toolName!, s.outputJson),
        finishedAt: s.finishedAt,
        taskId: s.taskId,
        state: isUndone ? "undone" : "live",
        undoneAt: s.undoneAt,
        undoable: !isUndone,
        undoLabel: UNDO_MAP[s.toolName!]?.label ?? "Undo",
        redoable: isUndone && !!REDO_MAP[s.toolName!],
        redoLabel: REDO_MAP[s.toolName!]?.label ?? "Redo",
      };
    }),
  );
});

agentActionsRouter.post("/actions/:id/undo", pAct.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userEmail = req.auth!.email ?? null;
  const step = await prisma.agentStep.findFirst({
    where: { id: req.params.id, tenantId, kind: "ToolCall", status: "Succeeded" },
  });
  if (!step)         return res.status(404).json({ error: "Step not found" });
  if (!step.toolName) return res.status(400).json({ error: "Step has no toolName" });
  if (step.undoneAt)  return res.status(409).json({ error: "Already undone" });

  const spec = UNDO_MAP[step.toolName];
  if (!spec) return res.status(400).json({ error: `No undo for tool ${step.toolName}` });

  // Pull the entity id either from the step's output (create flow) or
  // from the step's input (submit flow — the id was the input arg).
  let id = pickId(step.outputJson);
  if (!id && step.inputJson && typeof step.inputJson === "object") {
    const i = step.inputJson as Record<string, unknown>;
    if (typeof i.id === "string") id = i.id;
  }
  if (!id) return res.status(400).json({ error: "Could not derive id from step" });

  const authHeader = req.header("authorization") ?? "";
  const url = new URL(
    spec.pathTemplate.replace("{id}", encodeURIComponent(id)),
    SERVICE_URLS[spec.service],
  );
  const r = await fetch(url, {
    method: spec.method,
    headers: { "content-type": "application/json", authorization: authHeader },
    body: spec.method === "POST" ? JSON.stringify({}) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return res.status(400).json({ error: `${spec.label} failed (${r.status}): ${t.slice(0, 200)}` });
  }

  await prisma.agentStep.update({
    where: { id: step.id },
    data: { undoneAt: new Date(), undoneByUserEmail: userEmail },
  });

  res.json({ ok: true, action: spec.label });
});

// Redo — replay the original tool call with the step's inputJson. Only
// valid on steps that have been undone (otherwise there's nothing to
// redo; the entity already exists live).
agentActionsRouter.post("/actions/:id/redo", pAct.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userEmail = req.auth!.email ?? null;
  const step = await prisma.agentStep.findFirst({
    where: { id: req.params.id, tenantId, kind: "ToolCall", status: "Succeeded" },
  });
  if (!step)         return res.status(404).json({ error: "Step not found" });
  if (!step.toolName) return res.status(400).json({ error: "Step has no toolName" });
  if (!step.undoneAt) return res.status(409).json({ error: "Nothing to redo — step is still live" });
  if (step.redoneAt)  return res.status(409).json({ error: "Already redone" });

  const spec = REDO_MAP[step.toolName];
  if (!spec) return res.status(400).json({ error: `No redo for tool ${step.toolName}` });

  // Build the request body from the step's stored inputJson. Strip `id`
  // if the spec puts it in the path (submit/cancel pattern).
  const inputBody = (step.inputJson ?? {}) as Record<string, unknown>;
  let body: Record<string, unknown> = { ...inputBody };
  let path = spec.pathTemplate;
  if (spec.idInPath) {
    const id = typeof body.id === "string" ? body.id : null;
    if (!id) return res.status(400).json({ error: "Original input lacked id" });
    path = path.replace("{id}", encodeURIComponent(id));
    delete body.id;
  }

  const authHeader = req.header("authorization") ?? "";
  const url = new URL(path, SERVICE_URLS[spec.service]);
  const r = await fetch(url, {
    method: spec.method,
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return res.status(400).json({ error: `${spec.label} failed (${r.status}): ${t.slice(0, 200)}` });
  }
  const result = await r.json().catch(() => null);

  await prisma.agentStep.update({
    where: { id: step.id },
    data: {
      redoneAt: new Date(),
      redoneByUserEmail: userEmail,
      redoneOutputJson: result ?? undefined,
    },
  });

  res.json({ ok: true, action: spec.label, result });
});
