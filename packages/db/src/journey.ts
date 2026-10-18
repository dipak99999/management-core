// Marketing P2 — Journey graph model + runner.
//
// A MarketingJourney stores a directed graph (React Flow-compatible) in
// `nodesJson` + `edgesJson`. JourneyEnrollment tracks a single contact's
// position; the scheduler tick calls `advanceEnrollment` to step it forward.
//
// Node kinds
// ----------
//   trigger        — entry point; no config. Exactly one per journey.
//   wait           — pause. config: {seconds?, minutes?, hours?, days?}
//                    (all optional; the runner sums the biggest set).
//   sendEmail      — enqueue an EmailMessage. config:
//                    {templateId?, subject?, bodyHtml?, fromName?, fromEmail?}
//   sendSms        — enqueue an SmsMessage. config: {templateId?, body?}
//   sendWhatsapp   — enqueue a WhatsappMessage. config:
//                    {templateName, vars?: string[]}
//   addToList      — ContactListMember upsert. config: {listId}
//   removeFromList — ContactListMember delete. config: {listId}
//   updateContact  — merge into Customer.customData. config: {attribute, value}
//   branch         — evaluate segment condition against contact. config:
//                    {condition: {field, op, value}}. Requires TWO outgoing
//                    edges with sourceHandle="yes"|"no".
//   exit           — terminal; mark enrollment Completed.
//
// The runner is deliberately conservative — one node per tick. wait nodes set
// `nextTickAt`; every other kind performs its side-effect + falls straight
// through to the next node in the graph. If no outgoing edge exists, the
// enrollment is marked Completed. On any error the enrollment is marked
// Failed with `lastError` populated.

import type { Prisma, PrismaClient } from "@prisma/client";
import { compileSegment, type Doctype as SegmentDoctype } from "./segment";

// ─── Types ─────────────────────────────────────────────────────────────

export type NodeKind =
  | "trigger"
  | "wait"
  | "sendEmail"
  | "sendSms"
  | "sendWhatsapp"
  | "addToList"
  | "removeFromList"
  | "updateContact"
  | "branch"
  | "exit";

export interface JourneyNode {
  id: string;
  type: NodeKind;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface JourneyEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  // For branch nodes: "yes" | "no". Everything else ignores this.
  sourceHandle?: string;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
}

// ─── Graph validation ──────────────────────────────────────────────────

/**
 * Structural validation for a journey graph. Called before a journey is
 * activated so we catch bad shapes at the edit boundary rather than during
 * a tick (where the failure becomes a per-enrollment Failed row).
 */
export function validateGraph(
  nodes: JourneyNode[],
  edges: JourneyEdge[],
): ValidateResult {
  const errors: string[] = [];

  if (!Array.isArray(nodes)) {
    return { ok: false, errors: ["nodes must be an array"] };
  }
  if (!Array.isArray(edges)) {
    return { ok: false, errors: ["edges must be an array"] };
  }

  // ── Node checks ────────────────────────────────────────────────────
  const nodeIds = new Set<string>();
  const duplicateIds: string[] = [];
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || n.id.length === 0) {
      errors.push(`node missing id: ${JSON.stringify(n)}`);
      continue;
    }
    if (nodeIds.has(n.id)) duplicateIds.push(n.id);
    nodeIds.add(n.id);
  }
  for (const d of duplicateIds) errors.push(`duplicate node id: ${d}`);

  // Exactly one trigger.
  const triggers = nodes.filter((n) => n?.type === "trigger");
  if (triggers.length === 0) errors.push("missing trigger node");
  if (triggers.length > 1) errors.push(`multiple trigger nodes: ${triggers.length}`);

  // ── Edge checks ────────────────────────────────────────────────────
  for (const e of edges) {
    if (!e || typeof e.id !== "string") {
      errors.push(`edge missing id: ${JSON.stringify(e)}`);
      continue;
    }
    if (!nodeIds.has(e.source)) errors.push(`edge ${e.id} source ${e.source} not in nodes`);
    if (!nodeIds.has(e.target)) errors.push(`edge ${e.id} target ${e.target} not in nodes`);
  }

  // ── Orphan check — every non-trigger, non-exit node must be reachable
  //    from the trigger via a directed path. Also every node except exits
  //    should have an outgoing edge (otherwise the enrollment would just
  //    stall). Both signals overlap; we compute reachability.
  const trigger = triggers[0];
  if (trigger) {
    const outByNode = new Map<string, JourneyEdge[]>();
    for (const e of edges) {
      const arr = outByNode.get(e.source) ?? [];
      arr.push(e);
      outByNode.set(e.source, arr);
    }
    const reachable = new Set<string>();
    const stack: string[] = [trigger.id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of outByNode.get(cur) ?? []) stack.push(e.target);
    }
    for (const n of nodes) {
      if (n.type === "trigger") continue;
      if (n.type === "exit") continue;
      if (!reachable.has(n.id)) errors.push(`orphan node: ${n.id} (${n.type})`);
    }

    // ── Cycle check (simplest rule: no cycles at all). Runs a DFS with
    //    grey/black coloring; a back-edge into a grey node = cycle.
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const id of nodeIds) color.set(id, WHITE);
    let hasCycle = false;
    function dfs(id: string): void {
      color.set(id, GREY);
      for (const e of outByNode.get(id) ?? []) {
        const c = color.get(e.target) ?? WHITE;
        if (c === GREY) {
          hasCycle = true;
          return;
        }
        if (c === WHITE) dfs(e.target);
      }
      color.set(id, BLACK);
    }
    for (const id of nodeIds) {
      if (color.get(id) === WHITE) dfs(id);
      if (hasCycle) break;
    }
    if (hasCycle) errors.push("cycle detected in graph");
  }

  // ── Branch check — every branch node must have exactly 2 outgoing
  //    edges with sourceHandle="yes" and "no".
  const outByNodeAll = new Map<string, JourneyEdge[]>();
  for (const e of edges) {
    const arr = outByNodeAll.get(e.source) ?? [];
    arr.push(e);
    outByNodeAll.set(e.source, arr);
  }
  for (const n of nodes) {
    if (n?.type !== "branch") continue;
    const outs = outByNodeAll.get(n.id) ?? [];
    if (outs.length !== 2) {
      errors.push(`branch ${n.id} must have exactly 2 outgoing edges (has ${outs.length})`);
      continue;
    }
    const handles = new Set(outs.map((e) => e.sourceHandle ?? ""));
    if (!handles.has("yes") || !handles.has("no")) {
      errors.push(
        `branch ${n.id} outgoing edges must have sourceHandle "yes" and "no" (got ${[...handles].join(",")})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Runner ────────────────────────────────────────────────────────────

// Minimal shapes so the module doesn't depend on Prisma types. The real
// PrismaClient satisfies these; tests supply mocks with the same shape.
interface JourneyRow {
  id: string;
  tenantId: string;
  status: string;
  nodesJson: unknown;
  edgesJson: unknown;
}
interface EnrollmentRow {
  id: string;
  tenantId: string;
  journeyId: string;
  contactType: string;
  contactId: string;
  emailTo: string | null;
  mobileTo: string | null;
  currentNodeId: string | null;
  status: string;
  nextTickAt: Date | null;
}

function parseGraph(row: JourneyRow): { nodes: JourneyNode[]; edges: JourneyEdge[] } {
  const nodes = Array.isArray(row.nodesJson) ? (row.nodesJson as JourneyNode[]) : [];
  const edges = Array.isArray(row.edgesJson) ? (row.edgesJson as JourneyEdge[]) : [];
  return { nodes, edges };
}

/** Sum a wait-node config into milliseconds. Missing / zero → 0. */
export function waitConfigToMs(cfg: Record<string, unknown> | null | undefined): number {
  if (!cfg) return 0;
  const seconds = Number(cfg.seconds ?? 0) || 0;
  const minutes = Number(cfg.minutes ?? 0) || 0;
  const hours = Number(cfg.hours ?? 0) || 0;
  const days = Number(cfg.days ?? 0) || 0;
  return (
    seconds * 1000 +
    minutes * 60_000 +
    hours * 3_600_000 +
    days * 86_400_000
  );
}

function findOutgoing(edges: JourneyEdge[], sourceId: string, handle?: string): JourneyEdge | null {
  const outs = edges.filter((e) => e.source === sourceId);
  if (outs.length === 0) return null;
  if (handle !== undefined) {
    return outs.find((e) => e.sourceHandle === handle) ?? null;
  }
  return outs[0] ?? null;
}

async function loadContactAttribs(
  prisma: PrismaClient,
  contactType: string,
  contactId: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const p = prisma as unknown as {
    customer: { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> };
    lead: { findFirst: (a: unknown) => Promise<Record<string, unknown> | null> };
  };
  if (contactType === "Customer") {
    return p.customer.findFirst({ where: { id: contactId, tenantId } });
  }
  if (contactType === "Lead") {
    return p.lead.findFirst({ where: { id: contactId, tenantId } });
  }
  return null;
}

/**
 * Evaluate a branch condition against the contact record. We reuse the
 * segment DSL compiler so the condition grammar (field/op/value +
 * customData.<k>) is identical to segments. Returns true when the compiled
 * WHERE matches the target contact.
 */
async function evaluateBranch(
  prisma: PrismaClient,
  tenantId: string,
  contactType: string,
  contactId: string,
  condition: unknown,
): Promise<boolean> {
  if (!condition || typeof condition !== "object") return false;
  const doctype: SegmentDoctype | null =
    contactType === "Customer" ? "Customer" : contactType === "Lead" ? "Lead" : null;
  if (!doctype) return false;

  // Compile the DSL into a Prisma WHERE, then count with the contact id
  // fenced in. Match iff count >= 1.
  const where = compileSegment(doctype, condition as never, tenantId);
  const p = prisma as unknown as {
    customer: { count: (a: unknown) => Promise<number> };
    lead: { count: (a: unknown) => Promise<number> };
  };
  const merged = { AND: [where, { id: contactId }] };
  const count =
    doctype === "Customer"
      ? await p.customer.count({ where: merged })
      : await p.lead.count({ where: merged });
  return count >= 1;
}

/** Convenience typed accessors — keeps advanceEnrollment terse. */
type PrismaAny = PrismaClient & Record<string, any>;

/**
 * Advance one enrollment by one node. Idempotent per-node when the caller
 * respects `nextTickAt` (the scheduler tick does). Errors are captured on
 * the enrollment row rather than thrown so a bad journey can't crash the
 * whole batch.
 */
export async function advanceEnrollment(
  prisma: PrismaClient,
  enrollmentId: string,
): Promise<{ status: "advanced" | "waiting" | "completed" | "failed"; nodeId: string | null }> {
  const p = prisma as PrismaAny;

  const enrollment = (await p.journeyEnrollment.findUnique({
    where: { id: enrollmentId },
  })) as EnrollmentRow | null;
  if (!enrollment) return { status: "failed", nodeId: null };
  if (enrollment.status !== "Active") {
    return { status: "failed", nodeId: enrollment.currentNodeId };
  }

  const journey = (await p.marketingJourney.findUnique({
    where: { id: enrollment.journeyId },
  })) as JourneyRow | null;
  if (!journey) {
    await p.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "Failed", lastError: "Journey missing" },
    });
    return { status: "failed", nodeId: null };
  }

  const { nodes, edges } = parseGraph(journey);

  try {
    // Bootstrap: currentNodeId=null means we haven't visited any node yet.
    // Point at the trigger and fall through to advance one step from it.
    let currentNodeId = enrollment.currentNodeId;
    if (!currentNodeId) {
      const trigger = nodes.find((n) => n.type === "trigger");
      if (!trigger) {
        await p.journeyEnrollment.update({
          where: { id: enrollment.id },
          data: { status: "Failed", lastError: "No trigger node" },
        });
        return { status: "failed", nodeId: null };
      }
      currentNodeId = trigger.id;
    }

    const node = nodes.find((n) => n.id === currentNodeId);
    if (!node) {
      await p.journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { status: "Failed", lastError: `Current node ${currentNodeId} not in graph` },
      });
      return { status: "failed", nodeId: currentNodeId };
    }

    const now = new Date();
    const data = (node.data ?? {}) as Record<string, unknown>;

    // Terminal: exit — mark complete immediately.
    if (node.type === "exit") {
      await markCompleted(p, enrollment, journey, node.id, now);
      return { status: "completed", nodeId: node.id };
    }

    // wait — advance the pointer to the next node AND schedule the enrollment
    // to be picked up again only after the wait duration. If there is no
    // outgoing edge, the journey is malformed — treat it as an early
    // completion. Doing both in one step keeps the runner deterministic
    // (one tick = one node visit) without needing a separate "entered
    // vs consumed" marker on the enrollment row.
    if (node.type === "wait") {
      const ms = waitConfigToMs(data);
      const nextTickAt = new Date(now.getTime() + ms);
      const nxt = findOutgoing(edges, node.id);
      if (!nxt) {
        await markCompleted(p, enrollment, journey, node.id, now);
        return { status: "completed", nodeId: node.id };
      }
      await p.journeyEnrollment.update({
        where: { id: enrollment.id },
        data: { currentNodeId: nxt.target, nextTickAt },
      });
      return { status: "waiting", nodeId: nxt.target };
    }

    // Perform side-effect for the node.
    let nextHandle: string | undefined;
    switch (node.type) {
      case "trigger":
        // no-op; fall through to advance.
        break;
      case "sendEmail":
        await p.emailMessage.create({
          data: {
            tenantId: enrollment.tenantId,
            toEmail: enrollment.emailTo ?? "",
            subject: String(data.subject ?? ""),
            body: String(data.bodyHtml ?? ""),
            fromEmail: (data.fromEmail as string | undefined) ?? null,
            fromName: (data.fromName as string | undefined) ?? null,
            templateId: (data.templateId as string | undefined) ?? null,
            status: "Pending",
            linkedDoctype: "JourneyEnrollment",
            linkedId: enrollment.id,
          },
        });
        break;
      case "sendSms":
        await p.smsMessage.create({
          data: {
            tenantId: enrollment.tenantId,
            toMobile: enrollment.mobileTo ?? "",
            body: String(data.body ?? ""),
            templateId: (data.templateId as string | undefined) ?? null,
            status: "Pending",
            linkedDoctype: "JourneyEnrollment",
            linkedId: enrollment.id,
          },
        });
        break;
      case "sendWhatsapp": {
        // The WhatsappMessage row stores the rendered body; template lookup +
        // Meta merge-var resolution happens at send time. Here we only pin
        // the template name so the sender can find it. If a rendered body is
        // supplied on the node data, use it verbatim; else placeholder.
        const body =
          typeof data.body === "string"
            ? (data.body as string)
            : `template:${String(data.templateName ?? "")}`;
        await p.whatsappMessage.create({
          data: {
            tenantId: enrollment.tenantId,
            toMobile: enrollment.mobileTo ?? "",
            body,
            status: "Pending",
            direction: "outbound",
            linkedDoctype: "JourneyEnrollment",
            linkedId: enrollment.id,
          },
        });
        break;
      }
      case "addToList": {
        const listId = String(data.listId ?? "");
        if (!listId) throw new Error("addToList: missing listId");
        await p.contactListMember.upsert({
          where: {
            listId_contactType_contactId: {
              listId,
              contactType: enrollment.contactType,
              contactId: enrollment.contactId,
            },
          },
          create: {
            listId,
            contactType: enrollment.contactType,
            contactId: enrollment.contactId,
          },
          update: {},
        });
        break;
      }
      case "removeFromList": {
        const listId = String(data.listId ?? "");
        if (!listId) throw new Error("removeFromList: missing listId");
        await p.contactListMember.deleteMany({
          where: {
            listId,
            contactType: enrollment.contactType,
            contactId: enrollment.contactId,
          },
        });
        break;
      }
      case "updateContact": {
        const attribute = String(data.attribute ?? "");
        if (!attribute) throw new Error("updateContact: missing attribute");
        const value = data.value;
        // Only Customer supported for MVP — Lead has customData too but the
        // journey plan targets Customer. Merge into JSON.
        if (enrollment.contactType !== "Customer") break;
        const cust = (await p.customer.findFirst({
          where: { id: enrollment.contactId, tenantId: enrollment.tenantId },
          select: { customData: true },
        })) as { customData: Record<string, unknown> | null } | null;
        const merged = { ...(cust?.customData ?? {}), [attribute]: value };
        await p.customer.update({
          where: { id: enrollment.contactId },
          // Prisma's InputJsonValue narrows on newer client versions; the
          // in-memory shape is a plain object of JSON-safe values so the
          // cast is safe. Remove once Prisma types allow Record<string, unknown>.
          data: { customData: merged as Prisma.InputJsonValue },
        });
        break;
      }
      case "branch": {
        const condition = data.condition;
        const matched = await evaluateBranch(
          prisma,
          enrollment.tenantId,
          enrollment.contactType,
          enrollment.contactId,
          condition,
        );
        nextHandle = matched ? "yes" : "no";
        break;
      }
      default:
        throw new Error(`Unknown node type: ${(node as JourneyNode).type}`);
    }

    // Advance pointer along the appropriate outgoing edge.
    const nxt = findOutgoing(edges, node.id, nextHandle);
    if (!nxt) {
      await markCompleted(p, enrollment, journey, node.id, now);
      return { status: "completed", nodeId: node.id };
    }
    await p.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { currentNodeId: nxt.target, nextTickAt: now },
    });
    return { status: "advanced", nodeId: nxt.target };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await p.journeyEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "Failed", lastError: msg.slice(0, 500), nextTickAt: null },
    });
    await p.marketingJourney.update({
      where: { id: journey.id },
      data: { totalFailed: { increment: 1 } },
    }).catch(() => {});
    return { status: "failed", nodeId: enrollment.currentNodeId };
  }
}

async function markCompleted(
  p: PrismaAny,
  enrollment: EnrollmentRow,
  journey: JourneyRow,
  nodeId: string,
  now: Date,
): Promise<void> {
  await p.journeyEnrollment.update({
    where: { id: enrollment.id },
    data: {
      status: "Completed",
      currentNodeId: nodeId,
      completedAt: now,
      nextTickAt: null,
    },
  });
  await p.marketingJourney.update({
    where: { id: journey.id },
    data: { totalCompleted: { increment: 1 } },
  }).catch(() => {});
  // Marketing P3 — write an attribution touchpoint on journey completion so
  // the SI-submit attribution engine can credit revenue back to the journey.
  // Best-effort: a stall here must not mark the enrollment as failed. Wrapped
  // in try/catch because `p.attributionTouchpoint` may not exist on shim
  // clients used in tests (accessing .create on undefined throws sync).
  try {
    await p.attributionTouchpoint?.create?.({
      data: {
        tenantId: enrollment.tenantId,
        contactType: enrollment.contactType,
        contactId: enrollment.contactId,
        sourceType: "Journey",
        sourceId: journey.id,
        event: "Completed",
        occurredAt: now,
      },
    });
  } catch {
    // swallow — attribution is non-fatal
  }
}

// ─── Trigger-fire helper ───────────────────────────────────────────────

/**
 * Find and enroll into all journeys matching a specific trigger event.
 *
 * Called from route handlers after contact-list add / lead create / form
 * submit. Failures don't block the caller — a single bad journey shouldn't
 * fail the primary action.
 *
 * Idempotent: JourneyEnrollment has a unique (journeyId, contactType,
 * contactId) constraint; duplicate enrolls are swallowed.
 */
export async function fireJourneyTrigger(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    triggerType:
      | "ListAdd"
      | "LeadCreated"
      | "FormSubmit"
      | "TagAdded"
      | "ScheduledDate"
      | "WebinarRegistered";
    // Trigger-specific filter — must match `MarketingJourney.triggerConfig`.
    // We keep the check simple: shallow-equal of the provided keys.
    match?: Record<string, unknown>;
    contactType: "Customer" | "Lead";
    contactId: string;
    emailTo?: string | null;
    mobileTo?: string | null;
  },
): Promise<{ enrolled: number }> {
  const p = prisma as PrismaAny;
  const journeys = (await p.marketingJourney.findMany({
    where: {
      tenantId: args.tenantId,
      status: "Active",
      triggerType: args.triggerType,
    },
  })) as Array<{ id: string; triggerConfig: Record<string, unknown> | null }>;

  let enrolled = 0;
  for (const j of journeys) {
    // Trigger-config match: for ListAdd we need triggerConfig.listId to match,
    // for FormSubmit the formId, etc. If args.match is omitted we take that as
    // "fire on every journey with this triggerType".
    if (args.match) {
      const cfg = j.triggerConfig ?? {};
      let ok = true;
      for (const [k, v] of Object.entries(args.match)) {
        if (cfg[k] !== v) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    const now = new Date();
    try {
      await p.journeyEnrollment.create({
        data: {
          tenantId: args.tenantId,
          journeyId: j.id,
          contactType: args.contactType,
          contactId: args.contactId,
          emailTo: args.emailTo ?? null,
          mobileTo: args.mobileTo ?? null,
          currentNodeId: null,
          status: "Active",
          nextTickAt: now,
        },
      });
      await p.marketingJourney.update({
        where: { id: j.id },
        data: { totalEnrolled: { increment: 1 } },
      }).catch(() => {});
      // Marketing P3 — attribution touchpoint on enrollment. Best-effort;
      // uses optional-chain so shim Prisma clients (tests) without the
      // AttributionTouchpoint delegate don't throw synchronously.
      try {
        await p.attributionTouchpoint?.create?.({
          data: {
            tenantId: args.tenantId,
            contactType: args.contactType,
            contactId: args.contactId,
            sourceType: "Journey",
            sourceId: j.id,
            event: "Enrolled",
            occurredAt: now,
          },
        });
      } catch {
        // swallow — attribution is non-fatal
      }
      enrolled++;
    } catch {
      // Unique-constraint violation = already enrolled; ignore.
    }
  }
  return { enrolled };
}
