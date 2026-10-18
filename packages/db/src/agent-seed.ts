// Reference-agent seeds. Called by /agents/seed-defaults on tenant
// setup to install a starter policy + a well-known agent kind
// (TicketTriage) that ships as an example.
//
// Adding a new reference agent:
//   1. Append it to REFERENCE_AGENTS below with its policy.
//   2. Optionally add a seedTasks list for a demo run.
//   3. Callers invoke seedReferenceAgents(prisma, tenantId).

import type { Prisma, PrismaClient } from "@prisma/client";

export interface ReferenceAgent {
  key: string;
  agentKind: string;
  displayName: string;
  description: string;
  goalTemplate: string;
  policy: {
    maxStepsPerTask: number;
    maxCostUsdPerTask: number;
    humanApprovalMode: "Autonomous" | "Draft" | "ConfirmEach";
    toolAllowlist: string[];
    toolDenylist: string[];
    allowedDoctypes: string[];
  };
}

export const REFERENCE_AGENTS: ReferenceAgent[] = [
  {
    key: "ticket-triage",
    agentKind: "TicketTriage",
    displayName: "Ticket Triage Agent",
    description:
      "Read a new DeskTicket, classify it, propose a canned response, and route to the right team.",
    goalTemplate:
      "Triage ticket {{ticketId}}: identify the category, assess urgency, suggest a canned reply, and either reply (if trivial) or escalate to the right team.",
    policy: {
      maxStepsPerTask: 20,
      maxCostUsdPerTask: 0.5,
      humanApprovalMode: "Draft", // proposes replies, human clicks send
      toolAllowlist: [
        "ticket_list", "ticket_get", "ticket_reply",
        "customer_list", "customer_get",
        "sales_invoice_list", "purchase_invoice_list",
      ],
      toolDenylist: [],
      allowedDoctypes: ["DeskTicket", "DeskTicketReply"],
    },
  },
  {
    key: "ar-chaser",
    agentKind: "ARChaser",
    displayName: "AR Chaser Agent",
    description:
      "Read AR aging, send tiered reminders, propose phone-call tasks, negotiate payment plans (with approval).",
    goalTemplate:
      "Review the AR aging for tenant. For each invoice overdue >{{daysOverdue}} days, send the next reminder in the cadence, and if the balance exceeds ₹{{escalationThreshold}}, escalate a call task to sales.",
    policy: {
      maxStepsPerTask: 100,
      maxCostUsdPerTask: 2,
      humanApprovalMode: "Autonomous",
      toolAllowlist: [
        "report_aging", "sales_invoice_list", "customer_list", "customer_get",
      ],
      toolDenylist: ["sales_invoice_cancel"],
      allowedDoctypes: ["PaymentReminder", "CrmActivity"],
    },
  },
  {
    key: "month-close",
    agentKind: "MonthClose",
    displayName: "Month-Close Agent",
    description:
      "Run FX revaluation, verify auto-reverse JEs posted, generate P&L, email CFO for sign-off.",
    goalTemplate:
      "Close the books for {{month}} {{year}}: run FX revaluation as of month-end, verify all recurring JEs posted, prepare P&L, and email the summary to {{cfoEmail}} for approval.",
    policy: {
      maxStepsPerTask: 30,
      maxCostUsdPerTask: 1,
      humanApprovalMode: "ConfirmEach",
      toolAllowlist: [
        "report_trial_balance", "report_profit_and_loss", "report_balance_sheet",
        "journal_entry_list", "sales_invoice_list", "purchase_invoice_list",
      ],
      toolDenylist: [],
      allowedDoctypes: ["JournalEntry"],
    },
  },
  {
    key: "purchase-suggester",
    agentKind: "PurchaseSuggester",
    displayName: "Purchase Suggester Agent",
    description:
      "Read stock reorder alerts + supplier scorecards, draft POs against best-fit suppliers.",
    goalTemplate:
      "Review items below reorder level. For each, pick the supplier with the highest scorecard rating and shortest lead-time, then draft a PO for the reorder qty.",
    policy: {
      maxStepsPerTask: 60,
      maxCostUsdPerTask: 1.5,
      humanApprovalMode: "Draft",
      toolAllowlist: [
        "warehouse_list", "supplier_list",
        "purchase_order_list", "item_list",
      ],
      toolDenylist: ["purchase_order_submit"],
      allowedDoctypes: ["PurchaseOrder"],
    },
  },
];

export interface AgentPolicySeed {
  id: string;
  tenantId: string;
  key: string;
  humanApprovalMode: string;
  maxStepsPerTask: number;
}

// Idempotent — upserts one AgentPolicy per reference agent for the
// tenant. Safe to re-run on every deploy. Returns the created/found
// rows so callers can wire further seed data (demo tasks, etc.).
//
// Accepts either the real PrismaClient or a duck-typed test stub
// (only `agentPolicy.upsert` is required). Typed loose because
// Prisma's generated payload types are too heavy to reify here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpsertCapable = { agentPolicy: { upsert: (args: any) => Promise<AgentPolicySeed> } };

export async function seedReferenceAgents(
  db: UpsertCapable,
  tenantId: string,
): Promise<AgentPolicySeed[]> {
  const rows: AgentPolicySeed[] = [];
  for (const agent of REFERENCE_AGENTS) {
    const row = await db.agentPolicy.upsert({
      where: { tenantId_key: { tenantId, key: agent.key } },
      update: {
        maxStepsPerTask: agent.policy.maxStepsPerTask,
        maxCostUsdPerTask: agent.policy.maxCostUsdPerTask,
        humanApprovalMode: agent.policy.humanApprovalMode,
        toolAllowlist: agent.policy.toolAllowlist,
        toolDenylist: agent.policy.toolDenylist,
        allowedDoctypes: agent.policy.allowedDoctypes,
      },
      create: {
        tenantId,
        key: agent.key,
        maxStepsPerTask: agent.policy.maxStepsPerTask,
        maxCostUsdPerTask: agent.policy.maxCostUsdPerTask,
        humanApprovalMode: agent.policy.humanApprovalMode,
        toolAllowlist: agent.policy.toolAllowlist,
        toolDenylist: agent.policy.toolDenylist,
        allowedDoctypes: agent.policy.allowedDoctypes,
      },
    });
    rows.push(row);
  }
  return rows;
}

// Reference lookup — the /agents/reference endpoint uses this to
// render the "Try one of these" agent chooser in the UI.
export function referenceAgentByKey(key: string): ReferenceAgent | undefined {
  return REFERENCE_AGENTS.find((a) => a.key === key);
}
