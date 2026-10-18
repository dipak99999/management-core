"use client";

// Assist Shell — AI Mode surface. Deliberately minimal:
//   - Centered "What's next?" heading (only when chat is empty)
//   - Large prompt textarea with slash-command palette
//   - Mode toggle top-right so users can switch back to Manual
// No left rail, no chip row, no suggested action pills.
//
// On submit:
//   POST /agents/tasks (goal = prompt)
//   POST /agents/tasks/:id/run
//   SSE  /agents/tasks/:id/events

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { agentApi, type McpTool } from "../lib/agent-api";
import { setMode } from "../lib/mode";
import { MODULE_REGISTRY, planAllows, type ModuleKey } from "@lumaara/shared-types";

// Subscription plan loaded from /my-plan — gates which module/submodule
// chips the user sees. `null` while loading; after load it's always an
// object (empty arrays when the tenant has no active plan).
interface PlanSnapshot {
  allowedModules: string[];
  allowedSubmodules: string[];
  planName?: string;
  isSuperAdmin?: boolean;
}

// ── Scoped module/submodule picker ─────────────────────────────────────
//
// Drives from `MODULE_REGISTRY` (packages/shared-types/src/modules.ts) so
// the Brew surface stays in sync with the sidebar + route gating. The
// user's active SubscriptionPlan filters what's visible — modules not in
// `allowedModules` don't appear at all, submodules not in
// `allowedSubmodules` are hidden from the drill-down.
//
// Flow:
//   1. User sees the 5 top-level module chips (hrms, payroll, finance,
//      sales, manufacturing) — only those their plan allows.
//   2. Clicking one expands to show its submodule chips (plan-filtered).
//   3. Clicking a submodule sets the full scope { module, submodule }.
//   4. Submit prefixes the goal with `[Module: X — Submodule: Y]` AND
//      sends `module` + `submodule` in the API body so the server-side
//      enforcer can 403 non-allowed scopes (defense-in-depth — a bad
//      client could craft the request without going through the UI).

interface Scope {
  moduleKey: ModuleKey;
  moduleLabel: string;
  submoduleKey?: string;
  submoduleLabel?: string;
  // Short description handed to the LLM so it understands the user's
  // domain of interest (nouns to retrieve, verbs to prefer).
  hint: string;
}

// Map ModuleKey → the McpTool.category used by the slash palette.
// Lets us keep SlashPalette filtering working while the chips drive
// from the registry.
const MODULE_CATEGORY: Record<ModuleKey, string> = {
  hrms: "hr",
  payroll: "hr",
  finance: "accounting",
  sales: "crm",
  manufacturing: "stock",
};

function hintFor(moduleKey: ModuleKey, submoduleLabel?: string): string {
  const base: Record<ModuleKey, string> = {
    hrms: "HR: employees, attendance, leave, recruitment, appraisals, training",
    payroll: "Payroll: salary slips, payroll runs, salary structures, loans, TDS",
    finance: "Finance: invoices, payments, GL, journal entries, taxes, assets, POS",
    sales: "Sales/CRM: leads, opportunities, quotations, campaigns, support, projects",
    manufacturing: "Manufacturing/Inventory: warehouses, stock, BOMs, work orders, deliveries",
  };
  return submoduleLabel ? `${base[moduleKey]} — focused on ${submoduleLabel}` : base[moduleKey];
}

function ScopedModulePicker({
  plan,
  active,
  onSelect,
}: {
  plan: PlanSnapshot | null;
  active: Scope | null;
  onSelect: (s: Scope | null) => void;
}) {
  // When plan is still loading, don't flash the full un-filtered list —
  // render nothing and let the fallback copy below do its job.
  if (!plan) return null;

  // Super admins see everything; otherwise filter to allowedModules.
  const visibleModules = MODULE_REGISTRY.filter(
    (m) => plan.isSuperAdmin || plan.allowedModules.includes(m.key),
  );

  if (visibleModules.length === 0) {
    return (
      <div className="mt-4 text-center text-sm text-ink-muted">
        Your plan doesn&apos;t include any modules yet.{" "}
        <a href="/settings/billing" className="text-ink underline">Pick a plan</a>{" "}
        to unlock the AI assistant.
      </div>
    );
  }

  // Which module is "expanded" to show its submodules — either the
  // currently-active scope, or neither.
  const expandedKey = active?.moduleKey ?? null;

  return (
    <div className="mt-4 space-y-3">
      {/* Top row — the 5 (or fewer) modules the plan allows */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {visibleModules.map((m) => {
          const isExpanded = expandedKey === m.key;
          return (
            <button
              key={m.key}
              onClick={() => {
                if (isExpanded) onSelect(null);
                else onSelect({ moduleKey: m.key, moduleLabel: m.label, hint: hintFor(m.key) });
              }}
              className={isExpanded ? "pill-active" : "pill-outline"}
              title={hintFor(m.key)}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Second row — submodules of the expanded module, plan-filtered.
          Only submodules in `allowedSubmodules` are shown. A locked
          submodule icon could be surfaced here but hiding entirely is
          cleaner UX — "if I can see it, I can click it". */}
      {expandedKey && (() => {
        const mod = MODULE_REGISTRY.find((m) => m.key === expandedKey)!;
        const subs = mod.submodules.filter(
          (s) => plan.isSuperAdmin || plan.allowedSubmodules.includes(s.key),
        );
        if (subs.length === 0) {
          return (
            <div className="text-center text-xs text-ink-muted">
              Your plan includes {mod.label} but none of its submodules.
              Ask the AI about the module as a whole, or{" "}
              <a href="/settings/billing" className="text-ink underline">upgrade</a>.
            </div>
          );
        }
        return (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-xs text-ink-muted me-1">Focus on:</span>
            {subs.map((s) => {
              const isActive = active?.submoduleKey === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => {
                    onSelect({
                      moduleKey: mod.key,
                      moduleLabel: mod.label,
                      submoduleKey: s.key,
                      submoduleLabel: s.label,
                      hint: hintFor(mod.key, s.label),
                    });
                  }}
                  className={`${isActive ? "chip chip-solid-navy" : "chip"} text-xs`}
                  title={`Focus Brew on ${s.label}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ── Lumaara wordmark (top-left, matches manual mode's sidebar brand) ──
//
// AI mode is a full-screen surface — without the manual-mode sidebar
// there's no brand anchor. Mirror the LUMAARA mark that lives at the
// top of the manual-mode sidebar so users have the same visual cue
// across modes and know which app they're in.
// ── Example prompts under the hero. Help first-timers get past the
// blank-canvas problem. Scope-aware: when a module is picked, show
// prompts for that module; else show a broad starter set.

const EXAMPLE_CHIPS: Record<ModuleKey | "default", string[]> = {
  default: [
    "Show overdue invoices",
    "Create a lead for Priya at Acme",
    "What's our runway?",
    "Draft a quotation for 20 units of SKU-100",
    "Who's out this week?",
    "List items below reorder level",
  ],
  sales: [
    "Show hot leads from the last 7 days",
    "Create a lead for Priya at Acme — priya@acme.com",
    "Convert LEAD-DEMO-001 to a customer",
    "Draft a follow-up email for the Acme opportunity",
  ],
  finance: [
    "Show overdue invoices by customer",
    "Create a draft invoice for Acme — ₹50,000 consulting",
    "What's our cash runway at current burn?",
    "Reconcile the latest HDFC statement",
  ],
  hrms: [
    "Who's on leave this week?",
    "Approve all pending leave requests under 2 days",
    "Draft an offer letter for a Senior Engineer at ₹18L",
    "Show headcount by department",
  ],
  payroll: [
    "Pull last month's payroll summary",
    "Who has pending salary slips?",
    "Show statutory deductions by category",
    "Draft this month's payroll run",
  ],
  manufacturing: [
    "List items below reorder level",
    "Show open work orders by workstation",
    "What's the stock value by warehouse?",
    "Create a stock entry: 50 units of SKU-100 to Mumbai warehouse",
  ],
};

function ExampleChips({
  scopeModule,
  onPick,
}: {
  scopeModule?: ModuleKey;
  onPick: (text: string) => void;
}) {
  const chips = (scopeModule && EXAMPLE_CHIPS[scopeModule]) ?? EXAMPLE_CHIPS.default;
  return (
    <div className="mt-8 flex flex-wrap justify-center gap-2 max-w-3xl mx-auto">
      {chips.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          className="px-3.5 py-2 rounded-pill bg-white border border-ink/10 text-sm text-ink-muted hover:text-ink hover:border-ink/25 hover:bg-canvas-warm transition"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function AiBrandMark() {
  return (
    <div className="fixed top-5 start-6 z-50 pointer-events-none">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-brand-gradient grid place-items-center shadow-brand-glow">
          <span className="text-white text-sm font-bold">L</span>
        </div>
        <span className="font-wordmark text-xl text-ink tracking-wide">LUMAARA</span>
      </div>
    </div>
  );
}

// ── Mode toggle (top-right) ────────────────────────────────────────────

function ModeToggle() {
  return (
    <div className="fixed top-5 end-6 z-50">
      <div className="inline-flex bg-white rounded-pill border border-ink/10 shadow-card p-0.5">
        <button className="px-4 py-2 rounded-pill text-xs font-semibold uppercase tracking-widest bg-ink text-white inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2z" />
          </svg>
          AI Mode
        </button>
        <button
          onClick={() => setMode("manual")}
          className="px-4 py-2 rounded-pill text-xs font-semibold uppercase tracking-widest text-ink-muted hover:text-ink"
        >
          Manual Mode
        </button>
      </div>
    </div>
  );
}

// ── Slash palette ──────────────────────────────────────────────────────

function SlashPalette({
  query,
  tools,
  scopeCategory,
  onPick,
}: {
  query: string;
  tools: McpTool[];
  scopeCategory?: string;
  onPick: (t: McpTool) => void;
}) {
  const filtered = tools
    .filter((t) => {
      // Narrow to the active module scope when set — makes /<x> palette
      // deterministic per module.
      if (scopeCategory && t.category !== scopeCategory) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    })
    .slice(0, 12);

  if (filtered.length === 0) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        No tool matches “{query}”.
      </div>
    );
  }

  return (
    <div className="max-h-[50vh] overflow-y-auto py-1">
      {filtered.map((t) => (
        <button
          key={t.name}
          onClick={() => onPick(t)}
          className="w-full text-start px-4 py-2.5 hover:bg-canvas-warm flex items-start gap-3"
        >
          <span
            className={`chip ${
              t.mutation ? "chip-solid-navy" : "chip-outline-gold"
            } text-[10px]`}
          >
            {t.category}
          </span>
          <span className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink truncate">
              /{t.name}
            </div>
            <div className="text-xs text-ink-muted truncate">
              {t.description}
            </div>
          </span>
          {t.mutation && (
            <span className="text-[10px] text-red-600 font-semibold uppercase tracking-widest">
              write
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Message list ───────────────────────────────────────────────────────

interface AssistMsg {
  id: string;
  role: "user" | "agent";
  text: string;
  meta?: string;
}

function MessageList({ msgs }: { msgs: AssistMsg[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs]);
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-6 max-w-4xl mx-auto w-full">
      {msgs.map((m) => (
        <div
          key={m.id}
          className={
            m.role === "user"
              ? "flex justify-end"
              : "flex justify-start"
          }
        >
          <div
            className={`max-w-[720px] rounded-2xl px-5 py-3.5 text-[15px] ${
              m.role === "user"
                ? "bg-ink text-white"
                : "bg-white border border-ink/8 text-ink"
            }`}
          >
            <div className="whitespace-pre-wrap">{m.text}</div>
            {m.meta && (
              <div
                className={`text-[10px] mt-1 uppercase tracking-widest ${
                  m.role === "user" ? "text-white/60" : "text-ink-muted"
                }`}
              >
                {m.meta}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────

// Browser SpeechRecognition wiring — Chrome/Safari (webkit prefix on
// Safari; standard on Chrome). Firefox has no support, in which case the
// mic button hides itself.
type SpeechRec = SpeechRecognition & {
  onresult?: (e: SpeechRecognitionEvent) => void;
  onend?: () => void;
  onerror?: (e: unknown) => void;
};
function getSpeechRecognitionCtor():
  | (new () => SpeechRec)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function AssistShell() {
  const [prompt, setPrompt] = useState("");
  const [msgs, setMsgs] = useState<AssistMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [showPalette, setShowPalette] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [listening, setListening] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    setSpeechAvailable(getSpeechRecognitionCtor() !== null);
  }, []);

  // Load the tenant's plan on mount. The chips + submodule drill-down
  // read from it; a null plan short-circuits the picker UI to "no
  // modules" state. We re-fetch after the auth token might have
  // refreshed by listening for storage events on `lumaara.session`.
  useEffect(() => {
    async function loadPlan(): Promise<void> {
      try {
        const token = (() => { try { return JSON.parse(localStorage.getItem("lumaara.session") ?? "{}").token ?? ""; } catch { return ""; } })();
        if (!token) { setPlan({ allowedModules: [], allowedSubmodules: [] }); return; }
        const r = await fetch("/api/auth-svc/my-plan", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!r.ok) { setPlan({ allowedModules: [], allowedSubmodules: [] }); return; }
        setPlan(await r.json() as PlanSnapshot);
      } catch {
        setPlan({ allowedModules: [], allowedSubmodules: [] });
      }
    }
    void loadPlan();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "lumaara.session") void loadPlan();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function toggleMic() {
    // Stop if already listening
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setListening(false);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    let finalTranscript = "";
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTranscript += r[0].transcript;
        else interim += r[0].transcript;
      }
      setPrompt((finalTranscript + interim).trimStart());
    };
    rec.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  useEffect(() => {
    agentApi
      .catalog()
      .then(setTools)
      .catch(() => {
        /* palette just stays empty on failure */
      });
  }, []);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "/")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slashQuery = prompt.startsWith("/") ? prompt.slice(1) : "";
  useEffect(() => {
    setShowPalette(prompt.startsWith("/"));
  }, [prompt]);

  // Auto-grow textarea up to 8 lines
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [prompt]);

  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setShowPalette(false);
    }
  }

  function pickTool(t: McpTool) {
    setPrompt(`/${t.name} `);
    setShowPalette(false);
    inputRef.current?.focus();
  }

  async function submit(override?: string) {
    const raw = (override ?? prompt).trim();
    if (!raw || busy) return;

    // Client-side plan gating — defense in depth with the server check.
    // Catches the common case without a round-trip + lets us show a
    // nicer message than the server's 403.
    if (scope && plan && !plan.isSuperAdmin) {
      if (!planAllows(plan, scope.moduleKey, scope.submoduleKey)) {
        const target = scope.submoduleLabel ?? scope.moduleLabel;
        setMsgs((m) => [
          ...m,
          { id: `u-${Date.now()}`, role: "user", text: raw },
          {
            id: `sys-${Date.now()}`,
            role: "agent",
            text:
              `This feature is not part of your subscription.\n\n` +
              `"${target}" needs a plan that includes it. Visit Settings → Billing to upgrade.`,
            meta: "Subscription",
          },
        ]);
        setPrompt("");
        return;
      }
    }

    const scopeLabel = scope
      ? scope.submoduleLabel
        ? `${scope.moduleLabel} / ${scope.submoduleLabel}`
        : scope.moduleLabel
      : null;
    // Scope the goal so the LLM planner biases toward the picked module's
    // tools + concepts. Kept in a `[Module: X / Submodule: Y]` prefix that
    // both the model and any log reader can parse.
    const goal = scope
      ? `[Module: ${scope.moduleLabel}${scope.submoduleLabel ? ` — Submodule: ${scope.submoduleLabel}` : ""} — ${scope.hint}]\n\n${raw}`
      : raw;
    const uid = `u-${Date.now()}`;
    setMsgs((m) => [
      ...m,
      {
        id: uid,
        role: "user",
        text: raw,
        meta: scopeLabel ? `Scope: ${scopeLabel}` : undefined,
      },
    ]);
    setPrompt("");
    setBusy(true);

    try {
      const task = await agentApi.createTask(goal);
      const tid = `agent-${task.id}`;
      setMsgs((m) => [
        ...m,
        {
          id: tid,
          role: "agent",
          text: "Planning…",
          meta: `Task ${task.id.slice(0, 8)} · ${scopeLabel ?? "any"}`,
        },
      ]);

      // Roll up incoming step events into a running narrative in the
      // agent's message bubble. Each step goes on its own line so the user
      // can follow the tool-call chain in real time.
      const stepLines: string[] = [];
      const stream = agentApi.events(task.id, ({ event, data }) => {
        const t = data as { toolName?: string; status?: string; output?: unknown; input?: unknown; kind?: string; task?: { status?: string; errorMessage?: string } };
        if (event === "step.new") {
          const tool = t?.toolName ?? t?.kind ?? "step";
          stepLines.push(`▸ ${tool}…`);
        } else if (event === "step.finished") {
          const tool = t?.toolName ?? t?.kind ?? "step";
          const status = t?.status ?? "done";
          const short =
            typeof t?.output === "object" && t.output !== null
              ? JSON.stringify(t.output).slice(0, 240)
              : String(t?.output ?? "");
          const idx = stepLines.findIndex((l) => l.includes(tool) && l.endsWith("…"));
          const line = `${status === "Succeeded" ? "✓" : "⚠"} ${tool} — ${short}`;
          if (idx >= 0) stepLines[idx] = line;
          else stepLines.push(line);
        } else if (event === "task.status") {
          if (t?.task?.errorMessage) stepLines.push(`⚠ ${t.task.errorMessage}`);
        }
        setMsgs((m) =>
          m.map((x) =>
            x.id === tid ? { ...x, text: stepLines.join("\n") || "Planning…" } : x,
          ),
        );
      });

      try {
        await agentApi.runTask(task.id);
        setMsgs((m) =>
          m.map((x) =>
            x.id === tid
              ? {
                  ...x,
                  text: stepLines.length
                    ? `${stepLines.join("\n")}\n\nDone.`
                    : "Done. Open the task for step-by-step details.",
                }
              : x,
          ),
        );
      } finally {
        stream.close();
      }
    } catch (err) {
      setMsgs((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: "agent",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          meta: "Failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  const hasChat = msgs.length > 0;

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <AiBrandMark />
      <ModeToggle />

      <main className={`flex-1 flex flex-col px-6 ${hasChat ? "" : "justify-center"}`}>
        {hasChat ? (
          <MessageList msgs={msgs} />
        ) : (
          <div className="text-center mb-10">
            <h1 className="font-wordmark text-[72px] leading-[1.05] text-ink">
              What&apos;s next?
            </h1>
            <ExampleChips
              scopeModule={scope?.moduleKey}
              onPick={(text) => {
                setPrompt(text);
                inputRef.current?.focus();
              }}
            />
          </div>
        )}

        {/* Prompt input — bigger, wider, centered */}
        <div className="relative max-w-4xl w-full mx-auto pb-8">
          {showPalette && (
            <div className="absolute bottom-full mb-2 start-0 end-0 card z-30">
              <SlashPalette
                query={slashQuery}
                tools={tools}
                scopeCategory={scope ? MODULE_CATEGORY[scope.moduleKey] : undefined}
                onPick={pickTool}
              />
            </div>
          )}

          <div className="card p-3 flex items-end gap-3 shadow-raised">
            <button
              className="w-11 h-11 rounded-2xl text-ink-muted hover:bg-canvas-warm grid place-items-center flex-shrink-0"
              aria-label="Attach"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
            {scope && (
              <button
                onClick={() => setScope(null)}
                className="chip chip-solid-navy self-center flex-shrink-0"
                title="Clear module scope"
              >
                {scope.submoduleLabel
                  ? `${scope.moduleLabel} / ${scope.submoduleLabel}`
                  : scope.moduleLabel}
                <span className="ms-1 opacity-70 hover:opacity-100">×</span>
              </button>
            )}
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={
                scope
                  ? `Ask about ${scope.submoduleLabel ?? scope.moduleLabel}…`
                  : "Ask, create, or explore…"
              }
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none py-3 px-1 text-[18px] leading-6 placeholder:text-ink-faint text-ink min-h-[52px] max-h-60"
              autoFocus
            />
            {speechAvailable && (
              <button
                onClick={toggleMic}
                className={`w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0 transition ${
                  listening
                    ? "bg-red-500 text-white animate-pulse"
                    : "text-ink-muted hover:bg-canvas-warm"
                }`}
                aria-label={listening ? "Stop dictation" : "Start dictation"}
                title={listening ? "Stop dictation" : "Voice input"}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4 10a6 6 0 0 0 12 0M10 16v3M7 19h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <button
              onClick={() => submit()}
              disabled={!prompt.trim() || busy}
              className="w-11 h-11 rounded-2xl bg-ink text-white grid place-items-center flex-shrink-0 disabled:opacity-40 hover:bg-ink-soft transition"
              aria-label="Send"
            >
              {busy ? (
                <span className="w-4 h-4 rounded-full border-2 border-white/60 border-t-transparent animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 16V4M4 10l6-6 6 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>

          {/* Module scope chips — plan-gated. Only modules in the user's
              SubscriptionPlan appear; picking one expands to show the
              plan-allowed submodules so you can scope further.  Server
              re-validates on submit so a tampered client still can't ask
              about a module the plan doesn't include. */}
          <ScopedModulePicker plan={plan} active={scope} onSelect={setScope} />

          <div className="text-[11px] text-ink-muted text-center mt-3">
            Pick a module above to focus the AI on it, or type{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-ink/10 font-mono">/</kbd> to invoke a tool.{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-ink/10 font-mono">Enter</kbd> to send,{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-ink/10 font-mono">Shift+Enter</kbd> for a new line.
          </div>
        </div>
      </main>
    </div>
  );
}
