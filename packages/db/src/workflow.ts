import { PrismaClient, Prisma } from "@prisma/client";
import { getPrismaDelegate } from "./prisma-delegate";

// ---------- Workflow-eligible doctypes ----------
//
// Only doctypes whose primary table has a `status` string field can be gated
// by a workflow. This map also gives us a safe doctype→Prisma delegate lookup
// so we never dispatch to an arbitrary table name from user input.

// Delegate map: keys are the DOCTYPE strings used by RolePermission +
// Workflow.doctype. Values are the Prisma model delegate names
// (`prisma.<key>` after camelCasing).
export const WORKFLOW_DOCTYPES = [
  "SalesInvoice",
  "PurchaseInvoice",
  "PaymentEntry",
  "JournalEntry",
  "DeliveryNote",
  "PurchaseReceipt",
  "StockEntry",
  "WorkOrder",
  "Quotation",
  "SalesOrder",
  "SalarySlip",
  "Lead",
  "Opportunity",
  "Employee",
  "ExpenseClaim",
  "LeaveApplication",
  "Loan",
  "Project",
  "Task",
  "Timesheet",
  "Asset",
  "JobCard",
] as const;

export type WorkflowDoctype = (typeof WORKFLOW_DOCTYPES)[number];

function isWorkflowDoctype(dt: string): dt is WorkflowDoctype {
  return (WORKFLOW_DOCTYPES as readonly string[]).includes(dt);
}

// Returns the Prisma delegate for a given doctype (already tenant-scoped by
// caller). Casts through `any` because Prisma doesn't expose a way to look up
// delegates by string at the type level; the whitelist above is what makes
// this safe.
function delegateFor(
  prisma: PrismaClient | Prisma.TransactionClient,
  doctype: WorkflowDoctype,
) {
  const key = doctype.charAt(0).toLowerCase() + doctype.slice(1);
  const delegate = getPrismaDelegate(prisma, key);
  if (!delegate) throw new Error(`No Prisma delegate for doctype ${doctype}`);
  return delegate;
}

// ---------- Workflow lookup ----------

export interface ActiveWorkflow {
  id: string;
  name: string;
  doctype: string;
  statusField: string;
  states: {
    id: string;
    stateName: string;
    docStatus: number;
    style: string | null;
    sortOrder: number;
  }[];
  transitions: {
    id: string;
    fromState: string;
    actionLabel: string;
    toState: string;
    allowedRoles: string[];
  }[];
}

// Returns the ONE active workflow for a doctype in a tenant, or null if none.
// Also validates the doctype is workflow-eligible.
export async function getActiveWorkflow(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  doctype: string,
): Promise<ActiveWorkflow | null> {
  if (!isWorkflowDoctype(doctype)) return null;
  const workflow = await prisma.workflow.findFirst({
    where: { tenantId, doctype, isActive: true },
    include: {
      states: { orderBy: { sortOrder: "asc" } },
      transitions: true,
    },
  });
  return workflow as ActiveWorkflow | null;
}

// ---------- Apply a transition ----------

export interface ApplyParams {
  tenantId: string;
  doctype: string;
  docId: string;
  action: string; // matches WorkflowTransition.actionLabel
  userRoles: string[];
  // Legacy "admin" flag — treated as SystemManager everywhere.
  isSystemManager: boolean;
}

export interface ApplyResult {
  ok: true;
  fromState: string;
  toState: string;
  doc: Record<string, unknown>;
}

// Runs one workflow transition. Validates:
// - Doctype is workflow-eligible
// - An active workflow exists for that doctype
// - The doc exists in the current tenant
// - Doc's current status matches a valid `fromState` for the requested action
// - User holds a role listed in the transition's allowedRoles (or is SystemManager)
// Then updates the doc's status field to the transition's `toState`.
//
// Runs in a single transaction so the read-modify-write is safe.
export async function applyWorkflowTransition(
  prisma: PrismaClient,
  params: ApplyParams,
): Promise<ApplyResult> {
  return await prisma.$transaction(async (tx) => {
    if (!isWorkflowDoctype(params.doctype))
      throw new Error(`Doctype ${params.doctype} is not workflow-eligible`);

    const workflow = await getActiveWorkflow(tx, params.tenantId, params.doctype);
    if (!workflow)
      throw new Error(`No active workflow for ${params.doctype}`);

    const delegate = delegateFor(tx, params.doctype as WorkflowDoctype);
    const doc = (await delegate.findFirst({
      where: { id: params.docId, tenantId: params.tenantId },
    })) as Record<string, unknown> | null;
    if (!doc) throw new Error("Document not found");

    const currentState = doc[workflow.statusField] as string | null;
    if (!currentState) throw new Error(`Doc has no ${workflow.statusField} set`);

    // Find the transition whose fromState + actionLabel match. There can be
    // multiple actions from one state, but only one action name per fromState.
    const transition = workflow.transitions.find(
      (t) => t.fromState === currentState && t.actionLabel === params.action,
    );
    if (!transition)
      throw new Error(
        `No transition "${params.action}" from state "${currentState}" in workflow ${workflow.name}`,
      );

    // Role check: SystemManager always allowed. Otherwise the user needs at
    // least one role listed in allowedRoles.
    if (!params.isSystemManager) {
      const allowed = transition.allowedRoles.some((r) => params.userRoles.includes(r));
      if (!allowed)
        throw new Error(
          `Your roles cannot perform "${params.action}" — requires: ${
            transition.allowedRoles.length > 0
              ? transition.allowedRoles.join(", ")
              : "SystemManager"
          }`,
        );
    }

    // Validate toState exists in the workflow (guards against orphaned transitions).
    const targetState = workflow.states.find((s) => s.stateName === transition.toState);
    if (!targetState)
      throw new Error(`Workflow ${workflow.name} has no state "${transition.toState}"`);

    const updated = await delegate.update({
      where: { id: doc.id },
      data: { [workflow.statusField]: transition.toState },
    });

    return {
      ok: true as const,
      fromState: transition.fromState,
      toState: transition.toState,
      doc: updated as Record<string, unknown>,
    };
  });
}

// Returns the transitions available to `userRoles` from the doc's current
// state. Used to render workflow action buttons on the detail page.
export async function availableActions(
  prisma: PrismaClient | Prisma.TransactionClient,
  params: { tenantId: string; doctype: string; docId: string; userRoles: string[]; isSystemManager: boolean },
): Promise<{
  workflow: { id: string; name: string } | null;
  currentState: string | null;
  transitions: {
    id: string;
    actionLabel: string;
    toState: string;
    allowed: boolean;
  }[];
}> {
  if (!isWorkflowDoctype(params.doctype))
    return { workflow: null, currentState: null, transitions: [] };

  const workflow = await getActiveWorkflow(prisma, params.tenantId, params.doctype);
  if (!workflow) return { workflow: null, currentState: null, transitions: [] };

  const delegate = delegateFor(prisma, params.doctype as WorkflowDoctype);
  const doc = (await delegate.findFirst({
    where: { id: params.docId, tenantId: params.tenantId },
    select: { [workflow.statusField]: true },
  })) as Record<string, unknown> | null;
  if (!doc) return { workflow: { id: workflow.id, name: workflow.name }, currentState: null, transitions: [] };

  const currentState = doc[workflow.statusField] as string | null;
  const outgoing = workflow.transitions.filter((t) => t.fromState === currentState);

  return {
    workflow: { id: workflow.id, name: workflow.name },
    currentState,
    transitions: outgoing.map((t) => ({
      id: t.id,
      actionLabel: t.actionLabel,
      toState: t.toState,
      allowed:
        params.isSystemManager ||
        t.allowedRoles.some((r) => params.userRoles.includes(r)),
    })),
  };
}
