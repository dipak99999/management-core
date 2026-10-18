// Agent runtime — plan, execute, escalate.
//
// Contract:
//   1. Caller creates an AgentTask row with { agentKind, goal, contextJson }.
//   2. Runtime picks up Queued tasks, calls the planner to emit a JSON
//      plan of steps (Think / ToolCall / HumanApproval / Emit).
//   3. For each step, the executor calls the matching MCP tool via an
//      injected ToolDispatcher. Step rows record inputs, outputs, cost,
//      tokens, latency.
//   4. On HumanApproval, the task pauses in `AwaitingHuman`. The
//      approver's decision (via /agent-tasks/:id/resume) either
//      re-arms the runtime with the same plan or aborts.
//   5. On Emit, the task's final result is persisted to contextJson.output.
//
// The runtime is provider-agnostic: it uses the LLMRouter for planning
// (structured output), and calls back into MCP tools for actions.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

// A step the planner wants the executor to run.
export interface PlannedStep {
  kind: "Think" | "ToolCall" | "HumanApproval" | "Emit";
  toolName?: string;
  input?: Record<string, unknown>;
  reason?: string;
  // For HumanApproval: which upcoming tool call is being gated?
  gatedToolName?: string;
}

export interface AgentPlan {
  reasoning: string;
  steps: PlannedStep[];
}

// The planner asks the LLM for a plan given the agent's goal + context.
// Kept as a pure function for testability.
export const AGENT_PLAN_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["Think", "ToolCall", "HumanApproval", "Emit"] },
          toolName: { type: "string" },
          input: { type: "object" },
          reason: { type: "string" },
          gatedToolName: { type: "string" },
        },
        required: ["kind"],
      },
    },
  },
  required: ["reasoning", "steps"],
} as const;

export interface PlannerInput {
  agentKind: string;
  goal: string;
  context: Record<string, unknown>;
  availableTools: Array<{ name: string; description: string; input_schema?: unknown }>;
  policy: {
    maxStepsPerTask: number;
    humanApprovalMode: "Autonomous" | "Draft" | "ConfirmEach";
    toolAllowlist: string[];
    toolDenylist: string[];
  };
}

export async function planTask(
  llm: LLMProvider,
  input: PlannerInput,
): Promise<{ plan: AgentPlan; usage: LLMCallResult<AgentPlan> }> {
  const allowedTools = input.availableTools.filter((t) => {
    if (input.policy.toolDenylist.includes(t.name)) return false;
    if (input.policy.toolAllowlist.length > 0 && !input.policy.toolAllowlist.includes(t.name)) return false;
    return true;
  });
  const system = [
    `You are an autonomous agent named "${input.agentKind}".`,
    `Your goal: ${input.goal}`,
    `You have access to ${allowedTools.length} tools. Plan a sequence of steps to achieve the goal.`,
    `You MUST NOT exceed ${input.policy.maxStepsPerTask} steps.`,
    input.policy.humanApprovalMode === "ConfirmEach"
      ? "You MUST insert a HumanApproval step before every ToolCall that writes data."
      : input.policy.humanApprovalMode === "Draft"
        ? "You may draft records but MUST insert a HumanApproval before any submit/post/cancel action."
        : "You may act autonomously; only ask for HumanApproval when the outcome is irreversible.",
    "Emit a single final step of kind=Emit with the result at the end.",
  ].join("\n");
  const user = JSON.stringify({
    context: input.context,
    availableTools: allowedTools.map((t) => ({ name: t.name, description: t.description })),
  });
  const result = await llm.call<AgentPlan>({
    system,
    user,
    responseSchema: AGENT_PLAN_SCHEMA,
  });
  return { plan: result.parsed, usage: result };
}

// The tool dispatcher lets us swap out the transport in tests.
// Production wires this to the Universal MCP tool registry (Phase B).
export interface ToolDispatcher {
  invoke(
    toolName: string,
    input: Record<string, unknown>,
    ctx: { tenantId: string; agentTaskId: string },
  ): Promise<unknown>;
}

export interface ExecutorHooks {
  onStepStart?: (step: PlannedStep, ordinal: number) => Promise<{ stepId: string }>;
  onStepFinish?: (
    stepId: string,
    outcome: { status: "Succeeded" | "Failed" | "AwaitingHuman"; output?: unknown; error?: string },
  ) => Promise<void>;
  onEmit?: (output: unknown) => Promise<void>;
  onEscalate?: (step: PlannedStep, ordinal: number) => Promise<{ stepId: string }>;
}

export interface ExecuteResult {
  finalOutput: unknown;
  stepsRun: number;
  awaitingHuman: boolean;
}

export async function executePlan(
  plan: AgentPlan,
  dispatcher: ToolDispatcher,
  ctx: { tenantId: string; agentTaskId: string },
  hooks: ExecutorHooks = {},
): Promise<ExecuteResult> {
  let finalOutput: unknown = null;
  let stepsRun = 0;
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const ordinal = i + 1;
    if (step.kind === "HumanApproval") {
      await hooks.onEscalate?.(step, ordinal);
      return { finalOutput, stepsRun, awaitingHuman: true };
    }
    const startHook = await hooks.onStepStart?.(step, ordinal);
    const stepId = startHook?.stepId ?? "";
    if (step.kind === "Think") {
      await hooks.onStepFinish?.(stepId, { status: "Succeeded", output: { reason: step.reason } });
      stepsRun++;
      continue;
    }
    if (step.kind === "Emit") {
      finalOutput = step.input ?? {};
      await hooks.onEmit?.(finalOutput);
      await hooks.onStepFinish?.(stepId, { status: "Succeeded", output: finalOutput });
      stepsRun++;
      break;
    }
    if (step.kind === "ToolCall") {
      if (!step.toolName) {
        await hooks.onStepFinish?.(stepId, { status: "Failed", error: "toolName missing" });
        return { finalOutput, stepsRun, awaitingHuman: false };
      }
      try {
        const output = await dispatcher.invoke(step.toolName, step.input ?? {}, ctx);
        await hooks.onStepFinish?.(stepId, { status: "Succeeded", output });
        stepsRun++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await hooks.onStepFinish?.(stepId, { status: "Failed", error: msg });
        return { finalOutput, stepsRun, awaitingHuman: false };
      }
    }
  }
  return { finalOutput, stepsRun, awaitingHuman: false };
}
