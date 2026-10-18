"use client";

// Shell → accounting-service agent surface. Same-origin proxy via shell's
// next.config.js rewrite `/api/accounting/agents/* → :4002/agents/*`.
import { loadSession } from "./auth";

const AGENT = "/api/accounting/agents";

function authHeader(): Record<string, string> {
  const s = loadSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
}

export interface McpTool {
  name: string;
  description: string;
  category: string;
  mutation: boolean;
  service?: string;
  method?: string;
  input_schema?: Record<string, unknown>;
}

export interface AgentTask {
  id: string;
  goal: string;
  status: string;
  createdAt: string;
  policyKey?: string;
}

export const agentApi = {
  async catalog(): Promise<McpTool[]> {
    // Skip the fetch when the user isn't signed in — avoids a guaranteed 401
    // on cold start (AssistShell mounts before auth hydrates on the login
    // page). Empty palette is the same user-visible result the catch would
    // produce, without the Chrome console noise.
    if (!loadSession()) return [];
    const res = await fetch(`${AGENT}/tool-catalog`, {
      headers: { ...authHeader() },
    });
    if (!res.ok) throw new Error(`catalog: ${res.status}`);
    // Endpoint returns { total, tools[] } — unwrap.
    const body = (await res.json()) as { tools?: McpTool[] } | McpTool[];
    if (Array.isArray(body)) return body;
    return body.tools ?? [];
  },
  async createTask(
    goal: string,
    opts?: { policyKey?: string; agentKind?: string; context?: Record<string, unknown> },
  ): Promise<AgentTask> {
    const res = await fetch(`${AGENT}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({
        goal,
        // Server requires agentKind. Default to a generic freeform agent —
        // planner picks tools from the full catalog when kind is generic.
        agentKind: opts?.agentKind ?? "freeform",
        policyKey: opts?.policyKey,
        contextJson: opts?.context ?? {},
      }),
    });
    if (!res.ok) throw new Error(`create task: ${res.status} ${await res.text()}`);
    return res.json();
  },
  async runTask(id: string): Promise<unknown> {
    const res = await fetch(`${AGENT}/tasks/${id}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: "{}",
    });
    if (!res.ok) throw new Error(`run: ${res.status} ${await res.text()}`);
    return res.json();
  },
  // SSE handle for a task. Server emits named events:
  //   snapshot         — initial task + all steps so far
  //   step.new         — a step just started
  //   step.finished    — a step just finished (success or error)
  //   task.status      — task status changed
  //   done             — task terminal (Completed / Failed / Cancelled)
  //
  // The callback receives `{ event, data }` for every event so the caller
  // can react to each transition.
  events(
    id: string,
    onevent: (msg: { event: string; data: unknown }) => void,
  ): { close: () => void } {
    const s = loadSession();
    const url = `${AGENT}/tasks/${id}/events${s ? `?access_token=${encodeURIComponent(s.token)}` : ""}`;
    const es = new EventSource(url);
    const names = ["snapshot", "step.new", "step.finished", "task.status", "done"];
    for (const name of names) {
      es.addEventListener(name, (e) => {
        const ev = e as MessageEvent<string>;
        let data: unknown;
        try {
          data = JSON.parse(ev.data);
        } catch {
          data = ev.data;
        }
        onevent({ event: name, data });
      });
    }
    return { close: () => es.close() };
  },
};
