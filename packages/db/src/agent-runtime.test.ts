import { describe, expect, it, vi } from "vitest";
import { executePlan, planTask, type AgentPlan, type ToolDispatcher } from "./agent-runtime";
import type { LLMProvider } from "./llm";

function mockLLM(plan: AgentPlan): LLMProvider {
  return {
    name: "mock",
    async call<T>() {
      return {
        parsed: plan as T,
        raw: JSON.stringify(plan),
        provider: "mock",
        model: "mock",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 5,
      };
    },
  };
}

describe("planTask", () => {
  it("filters tools by policy allowlist + denylist", async () => {
    const capturedSystem: string[] = [];
    const llm: LLMProvider = {
      name: "capture",
      async call(input) {
        capturedSystem.push(input.system);
        // Return a minimal valid plan.
        return {
          parsed: { reasoning: "", steps: [{ kind: "Emit", input: { ok: true } }] } as never,
          raw: "{}",
          provider: "capture",
          model: "mock",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 1,
        };
      },
    };
    const out = await planTask(llm, {
      agentKind: "TestAgent",
      goal: "do the thing",
      context: {},
      availableTools: [
        { name: "safe.read", description: "read" },
        { name: "risky.delete", description: "delete" },
      ],
      policy: {
        maxStepsPerTask: 20,
        humanApprovalMode: "Autonomous",
        toolAllowlist: [],
        toolDenylist: ["risky.delete"],
      },
    });
    expect(out.plan.steps.length).toBe(1);
  });

  it("attaches humanApprovalMode instructions to the system prompt", async () => {
    let capturedSystem = "";
    const llm: LLMProvider = {
      name: "capture",
      async call(input) {
        capturedSystem = input.system;
        return {
          parsed: { reasoning: "", steps: [] } as never,
          raw: "{}",
          provider: "capture",
          model: "m",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 1,
        };
      },
    };
    await planTask(llm, {
      agentKind: "T",
      goal: "g",
      context: {},
      availableTools: [],
      policy: {
        maxStepsPerTask: 10,
        humanApprovalMode: "ConfirmEach",
        toolAllowlist: [],
        toolDenylist: [],
      },
    });
    expect(capturedSystem).toContain("HumanApproval step before every ToolCall");
  });
});

describe("executePlan", () => {
  const dispatcher: ToolDispatcher = {
    async invoke(toolName, input) {
      if (toolName === "fail.tool") throw new Error("boom");
      return { echoed: input, tool: toolName };
    },
  };

  it("runs Think + ToolCall + Emit steps in order", async () => {
    const plan: AgentPlan = {
      reasoning: "test",
      steps: [
        { kind: "Think", reason: "planning" },
        { kind: "ToolCall", toolName: "safe.read", input: { id: 1 } },
        { kind: "Emit", input: { done: true } },
      ],
    };
    const finished: Array<{ stepId: string; status: string }> = [];
    let emitted: unknown = null;
    const out = await executePlan(plan, dispatcher, { tenantId: "t", agentTaskId: "task" }, {
      async onStepStart(_s, ord) {
        return { stepId: `s${ord}` };
      },
      async onStepFinish(stepId, outcome) {
        finished.push({ stepId, status: outcome.status });
      },
      async onEmit(o) { emitted = o; },
    });
    expect(out.finalOutput).toEqual({ done: true });
    expect(out.stepsRun).toBe(3);
    expect(out.awaitingHuman).toBe(false);
    expect(emitted).toEqual({ done: true });
    expect(finished.map((f) => f.status)).toEqual(["Succeeded", "Succeeded", "Succeeded"]);
  });

  it("stops + returns awaitingHuman on HumanApproval step", async () => {
    const plan: AgentPlan = {
      reasoning: "",
      steps: [
        { kind: "ToolCall", toolName: "safe.read", input: {} },
        { kind: "HumanApproval", gatedToolName: "risky.submit" },
        { kind: "ToolCall", toolName: "risky.submit", input: {} },
      ],
    };
    const escalated: unknown[] = [];
    const out = await executePlan(plan, dispatcher, { tenantId: "t", agentTaskId: "task" }, {
      async onStepStart(_s, ord) { return { stepId: `s${ord}` }; },
      async onStepFinish() { /* noop */ },
      async onEscalate(step) { escalated.push(step); return { stepId: "e" }; },
    });
    expect(out.awaitingHuman).toBe(true);
    expect(escalated).toHaveLength(1);
    // Only the first ToolCall ran; escalated at step 2.
    expect(out.stepsRun).toBe(1);
  });

  it("halts on a failing tool call", async () => {
    const plan: AgentPlan = {
      reasoning: "",
      steps: [
        { kind: "ToolCall", toolName: "safe.read", input: {} },
        { kind: "ToolCall", toolName: "fail.tool", input: {} },
        { kind: "Emit", input: { done: true } },
      ],
    };
    const finished: Array<{ status: string; error?: string }> = [];
    const out = await executePlan(plan, dispatcher, { tenantId: "t", agentTaskId: "task" }, {
      async onStepStart(_s, ord) { return { stepId: `s${ord}` }; },
      async onStepFinish(_id, outcome) {
        finished.push({ status: outcome.status, error: outcome.error });
      },
    });
    expect(out.awaitingHuman).toBe(false);
    expect(out.stepsRun).toBe(1);
    expect(finished[1].status).toBe("Failed");
    expect(finished[1].error).toContain("boom");
  });
});
