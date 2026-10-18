import { Router } from "express";
import { z } from "zod";
import {
  Prisma,
  REFERENCE_AGENTS,
  STATIC_MCP_CATALOG,
  executePlan,
  mcpToolCatalog,
  nextName,
  planTask,
  prisma,
  referenceAgentByKey,
  resolveAgentRouter,
  seedReferenceAgents,
  type PlannedStep,
  type ToolDispatcher,
} from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// Agentic runtime — HTTP surface for AgentTasks.
//
// Endpoints:
//   POST /agents/tasks          — create + queue an agent task
//   POST /agents/tasks/:id/run  — planner + executor loop (sync — v1)
//   POST /agents/tasks/:id/resume — after human approval, continue
//   POST /agents/tasks/:id/cancel
//   GET  /agents/tasks          — list, with filter by status/kind
//   GET  /agents/tasks/:id      — task + all steps
//
// v1 runs the loop synchronously in the request handler. v2 will
// offload to a queue so long agents don't block a socket.

export const agentRouter = Router();
const pT = perms("AgentTask");
const pP = perms("AgentPolicy");

// ── Policy CRUD ────────────────────────────────────────────────────

const policySchema = z.object({
  key: z.string().min(1).max(60),
  maxStepsPerTask: z.coerce.number().int().min(1).max(500).default(50),
  maxCostUsdPerTask: z.coerce.number().nonnegative().default(1),
  allowedDoctypes: z.array(z.string()).default([]),
  humanApprovalMode: z.enum(["Autonomous", "Draft", "ConfirmEach"]).default("Draft"),
  toolAllowlist: z.array(z.string()).default([]),
  toolDenylist: z.array(z.string()).default([]),
});

agentRouter.get("/policies", pP.read, async (req, res) => {
  res.json(
    await prisma.agentPolicy.findMany({
      where: { tenantId: req.auth!.tenantId },
      orderBy: { key: "asc" },
    }),
  );
});

agentRouter.post("/policies", pP.create, async (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const row = await prisma.agentPolicy.upsert({
    where: { tenantId_key: { tenantId: req.auth!.tenantId, key: b.key } },
    update: {
      maxStepsPerTask: b.maxStepsPerTask,
      maxCostUsdPerTask: new Prisma.Decimal(b.maxCostUsdPerTask),
      allowedDoctypes: b.allowedDoctypes,
      humanApprovalMode: b.humanApprovalMode,
      toolAllowlist: b.toolAllowlist,
      toolDenylist: b.toolDenylist,
    },
    create: {
      tenantId: req.auth!.tenantId,
      key: b.key,
      maxStepsPerTask: b.maxStepsPerTask,
      maxCostUsdPerTask: new Prisma.Decimal(b.maxCostUsdPerTask),
      allowedDoctypes: b.allowedDoctypes,
      humanApprovalMode: b.humanApprovalMode,
      toolAllowlist: b.toolAllowlist,
      toolDenylist: b.toolDenylist,
    },
  });
  res.status(201).json(row);
});

// ── Task CRUD ───────────────────────────────────────────────────────

const createTaskSchema = z.object({
  agentKind: z.string().min(1),
  goal: z.string().min(1),
  contextJson: z.record(z.unknown()).default({}),
  policyKey: z.string().optional(),
});

agentRouter.get("/tasks", pT.read, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const agentKind = typeof req.query.agentKind === "string" ? req.query.agentKind : undefined;
  const rows = await prisma.agentTask.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(status ? { status } : {}),
      ...(agentKind ? { agentKind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

agentRouter.get("/tasks/:id", pT.read, async (req, res) => {
  const row = await prisma.agentTask.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      steps: { orderBy: { ordinal: "asc" } },
      policy: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

agentRouter.post("/tasks", pT.create, async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;
  const tenantId = req.auth!.tenantId;
  const name = await nextName(prisma, tenantId, "AGT-");
  let policyId: string | null = null;
  if (b.policyKey) {
    const pol = await prisma.agentPolicy.findFirst({
      where: { tenantId, key: b.policyKey },
      select: { id: true },
    });
    if (!pol) return res.status(400).json({ error: `Policy '${b.policyKey}' not found` });
    policyId = pol.id;
  }
  const row = await prisma.agentTask.create({
    data: {
      tenantId,
      name,
      agentKind: b.agentKind,
      goal: b.goal,
      contextJson: b.contextJson as Prisma.InputJsonValue,
      policyId,
      startedByUserId: req.auth!.userId,
    },
  });
  res.status(201).json(row);
});

// ── Runner ──────────────────────────────────────────────────────────

// Unified LLM resolution — same chain used by /ai/chat (RAG Q&A):
//   TenantIntegration LLMRouter → tenant single-provider → PlatformAiProvider
//   (super-admin default) → env fallback → stub.
//
// Operators configure ONE key at /admin/super/ai-providers (encrypted via
// MASTER_SECRET_KEY) and both AI surfaces (Brew bar + AI mode landing)
// resolve to the same provider. Previously this file only looked for
// TenantIntegration provider="LLMRouter" and fell back to stub — a
// configured OpenAI/Claude key in PlatformAiProvider was ignored.
async function loadRouter(tenantId: string) {
  return resolveAgentRouter(tenantId);
}

// Simple in-process HTTP dispatcher — sends the tool call to the
// matching service via internal fetch, propagating auth. In prod v2,
// replace with a message-queue call for durability.
//
// `requestId` is forwarded so downstream logs stitch to the caller's
// x-request-id. OTel traceparent is left to auto-instrumentation.
function makeHttpDispatcher(
  authHeader: string,
  requestId: string | undefined,
): ToolDispatcher {
  const SERVICE_URLS: Record<string, string> = {
    "accounting-service": process.env.ACCOUNTING_SERVICE_URL ?? "http://localhost:4002",
    "auth-service": process.env.AUTH_SERVICE_URL ?? "http://localhost:4001",
    "crm-service": process.env.CRM_SERVICE_URL ?? "http://localhost:4004",
    "hr-service": process.env.HR_SERVICE_URL ?? "http://localhost:4005",
    "projects-service": process.env.PROJECTS_SERVICE_URL ?? "http://localhost:4006",
    "stock-service": process.env.STOCK_SERVICE_URL ?? "http://localhost:4003",
  };
  return {
    async invoke(toolName, input) {
      // Look in both the dynamic registry and the static catalog so any
      // tool the planner could pick is dispatchable.
      const tool =
        mcpToolCatalog().find((t) => t.name === toolName) ??
        STATIC_MCP_CATALOG.find((t) => t.name === toolName);
      if (!tool) throw new Error(`Unknown tool: ${toolName}`);
      const base = SERVICE_URLS[tool.http.service];
      if (!base) throw new Error(`No base URL for service ${tool.http.service}`);
      const method = tool.http.method;
      const url = new URL(tool.http.path, base);
      const body =
        method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(input);
      if ((method === "GET" || method === "DELETE") && Object.keys(input).length > 0) {
        for (const [k, v] of Object.entries(input)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            url.searchParams.set(k, String(v));
          }
        }
      }
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: authHeader,
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
        body,
        // Bound the wait — a slow downstream service must not tie up this
        // agent handler forever (would saturate the express pool).
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Tool ${toolName} → ${res.status}: ${text.slice(0, 300)}`);
      }
      if (res.status === 204) return null;
      return await res.json().catch(() => null);
    },
  };
}

agentRouter.post("/tasks/:id/run", pT.submit, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const task = await prisma.agentTask.findFirst({
    where: { id: req.params.id, tenantId },
    include: { policy: true },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.status !== "Queued") {
    return res.status(400).json({ error: `Cannot run task in status ${task.status}` });
  }

  const policy = task.policy ?? {
    maxStepsPerTask: 50,
    humanApprovalMode: "Draft" as const,
    toolAllowlist: [] as string[],
    toolDenylist: [] as string[],
  };
  const router = await loadRouter(tenantId);
  // Merge the dynamic registry (defineMcpTool() at boot) with the static
  // hand-curated catalog so the planner sees every callable tool, not
  // just the ones registered in this process.
  const inline = mcpToolCatalog();
  const inlineNames = new Set(inline.map((t) => t.name));
  const catalog = [
    ...inline,
    ...STATIC_MCP_CATALOG.filter((t) => !inlineNames.has(t.name)),
  ];
  await prisma.agentTask.update({
    where: { id: task.id },
    data: { status: "Planning", startedAt: new Date() },
  });
  let planResult;
  try {
    const primaryChain = router; // planner uses default routing
    planResult = await planTask(
      {
        name: "router",
        async call<T>(inp: Parameters<Parameters<typeof planTask>[0]["call"]>[0]) {
          return await primaryChain.call<T>("agent.plan", inp);
        },
      },
      {
        agentKind: task.agentKind,
        goal: task.goal,
        context: task.contextJson as Record<string, unknown>,
        availableTools: catalog.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        policy: {
          maxStepsPerTask: policy.maxStepsPerTask ?? 50,
          humanApprovalMode: policy.humanApprovalMode as "Autonomous" | "Draft" | "ConfirmEach",
          toolAllowlist: policy.toolAllowlist ?? [],
          toolDenylist: policy.toolDenylist ?? [],
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.agentTask.update({
      where: { id: task.id },
      data: { status: "Failed", errorMessage: msg, completedAt: new Date() },
    });
    return res.status(400).json({ error: `Plan failed: ${msg}` });
  }
  const plan = planResult.plan;
  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      planJson: plan as unknown as Prisma.InputJsonValue,
      status: "Running",
    },
  });

  const auth = req.headers.authorization ?? "";
  const dispatcher = makeHttpDispatcher(auth, req.requestId);
  let ordinal = 0;

  const result = await executePlan(
    plan,
    dispatcher,
    { tenantId, agentTaskId: task.id },
    {
      async onStepStart(step: PlannedStep, ord: number) {
        ordinal = ord;
        const row = await prisma.agentStep.create({
          data: {
            tenantId,
            taskId: task.id,
            ordinal: ord,
            kind: step.kind,
            toolName: step.toolName ?? null,
            inputJson: (step.input ?? null) as Prisma.InputJsonValue,
            status: "Running",
            startedAt: new Date(),
          },
        });
        return { stepId: row.id };
      },
      async onStepFinish(stepId, outcome) {
        await prisma.agentStep.update({
          where: { id: stepId },
          data: {
            status: outcome.status,
            outputJson: (outcome.output ?? null) as Prisma.InputJsonValue,
            errorMessage: outcome.error ?? null,
            finishedAt: new Date(),
          },
        });
      },
      async onEscalate(step: PlannedStep, ord: number) {
        const row = await prisma.agentStep.create({
          data: {
            tenantId,
            taskId: task.id,
            ordinal: ord,
            kind: "HumanApproval",
            toolName: step.gatedToolName ?? null,
            inputJson: (step.input ?? null) as Prisma.InputJsonValue,
            status: "AwaitingHuman",
            startedAt: new Date(),
          },
        });
        await prisma.agentTask.update({
          where: { id: task.id },
          data: { status: "AwaitingHuman", escalatedStepId: row.id },
        });
        return { stepId: row.id };
      },
      async onEmit(output) {
        await prisma.agentTask.update({
          where: { id: task.id },
          data: {
            status: "Completed",
            completedAt: new Date(),
            contextJson: {
              ...(task.contextJson as Record<string, unknown>),
              output,
            } as Prisma.InputJsonValue,
          },
        });
      },
    },
  );

  const final = await prisma.agentTask.findFirst({
    where: { id: task.id },
    include: { steps: { orderBy: { ordinal: "asc" } } },
  });
  res.json({ result, task: final, stepsRun: result.stepsRun, lastOrdinal: ordinal });
});

agentRouter.post("/tasks/:id/cancel", pT.cancel, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const task = await prisma.agentTask.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!task) return res.status(404).json({ error: "Not found" });
  if (task.status === "Completed" || task.status === "Cancelled") {
    return res.status(400).json({ error: `Already ${task.status}` });
  }
  const row = await prisma.agentTask.update({
    where: { id: task.id },
    data: { status: "Cancelled", completedAt: new Date() },
  });
  res.json(row);
});

// ── Reference agents catalogue + one-shot seed ─────────────────────
//
// GET  /agents/reference        — list built-in agent recipes
// GET  /agents/reference/:key   — details for one recipe
// POST /agents/seed-defaults    — install every reference agent's
//                                 AgentPolicy for the current tenant
//                                 (idempotent — safe to re-run)

agentRouter.get("/reference", pT.read, async (_req, res) => {
  res.json(REFERENCE_AGENTS.map((a) => ({
    key: a.key,
    agentKind: a.agentKind,
    displayName: a.displayName,
    description: a.description,
    goalTemplate: a.goalTemplate,
    policy: a.policy,
  })));
});

agentRouter.get("/reference/:key", pT.read, async (req, res) => {
  const ref = referenceAgentByKey(req.params.key);
  if (!ref) return res.status(404).json({ error: "Not found" });
  res.json(ref);
});

agentRouter.post("/seed-defaults", pP.create, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await seedReferenceAgents(prisma, tenantId);
  res.json({ seeded: rows.length, policies: rows });
});

// ── Server-Sent Events stream for a running task ────────────────────
// GET /agents/tasks/:id/events streams one JSON event per AgentStep
// change; UI opens this alongside POST /run to render live progress.
// EventSource can't send Authorization headers, so we accept `?access_token=`
// as a fallback and promote it to the header before requireAuth runs.
function acceptQueryTokenForSse(
  req: import("express").Request,
  _res: import("express").Response,
  next: import("express").NextFunction,
) {
  const q = req.query.access_token;
  if (!req.headers.authorization && typeof q === "string" && q.length > 0) {
    req.headers.authorization = `Bearer ${q}`;
  }
  next();
}

agentRouter.get("/tasks/:id/events", acceptQueryTokenForSse, pT.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const task = await prisma.agentTask.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, status: true },
  });
  if (!task) return res.status(404).json({ error: "Not found" });

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const initialSteps = await prisma.agentStep.findMany({
    where: { taskId: task.id, tenantId },
    orderBy: { ordinal: "asc" },
  });
  const initialTask = await prisma.agentTask.findFirst({
    where: { id: task.id, tenantId },
  });
  send("snapshot", { task: initialTask, steps: initialSteps });

  let lastStepUpdate = new Date(0);
  let lastTaskStatus = initialTask?.status ?? task.status;
  const seenStepIds = new Set(initialSteps.map((s) => s.id));

  const interval = setInterval(async () => {
    try {
      const [freshTask, freshSteps] = await Promise.all([
        prisma.agentTask.findFirst({ where: { id: task.id, tenantId } }),
        prisma.agentStep.findMany({
          where: { taskId: task.id, tenantId },
          orderBy: { ordinal: "asc" },
        }),
      ]);
      if (!freshTask) return;

      for (const s of freshSteps) {
        if (!seenStepIds.has(s.id)) {
          send("step.new", s);
          seenStepIds.add(s.id);
        } else if (s.finishedAt && s.finishedAt > lastStepUpdate) {
          send("step.finished", s);
        }
      }
      lastStepUpdate = freshSteps
        .filter((s) => s.finishedAt)
        .reduce<Date>((acc, s) => (s.finishedAt! > acc ? s.finishedAt! : acc), lastStepUpdate);

      if (freshTask.status !== lastTaskStatus) {
        send("task.status", { status: freshTask.status, task: freshTask });
        lastTaskStatus = freshTask.status;
      }
      if (["Completed", "Failed", "Cancelled"].includes(freshTask.status)) {
        clearInterval(interval);
        send("done", { task: freshTask });
        res.end();
      }
    } catch {
      // Silent — next poll retries.
    }
  }, 750);

  req.on("close", () => {
    clearInterval(interval);
    try { res.end(); } catch { /* ignore */ }
  });
});

// Universal MCP catalog — what the planner sees. Useful to inspect
// which tools exist without booting the mcp-server.
agentRouter.get("/tool-catalog", pT.read, async (_req, res) => {
  const inline = mcpToolCatalog();
  const seen = new Set(inline.map((t) => t.name));
  const combined = [
    ...inline,
    ...STATIC_MCP_CATALOG.filter((t) => !seen.has(t.name)),
  ];
  res.json({
    total: combined.length,
    tools: combined.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      mutation: t.mutation,
      service: t.http.service,
      method: t.http.method,
    })),
  });
});
