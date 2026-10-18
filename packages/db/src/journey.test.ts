import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  advanceEnrollment,
  fireJourneyTrigger,
  validateGraph,
  waitConfigToMs,
  type JourneyEdge,
  type JourneyNode,
} from "./journey";

// ─── Graph validation ─────────────────────────────────────────────────

describe("validateGraph", () => {
  it("accepts a minimal trigger → exit graph", () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "x", type: "exit" },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "x" }];
    const r = validateGraph(nodes, edges);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts trigger → sendEmail → exit", () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "e", type: "sendEmail", data: { subject: "hi", bodyHtml: "hello" } },
      { id: "x", type: "exit" },
    ];
    const edges: JourneyEdge[] = [
      { id: "e1", source: "t", target: "e" },
      { id: "e2", source: "e", target: "x" },
    ];
    expect(validateGraph(nodes, edges).ok).toBe(true);
  });

  it("rejects a graph with no trigger node", () => {
    const r = validateGraph(
      [{ id: "x", type: "exit" }],
      [],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/missing trigger/);
  });

  it("rejects a graph with multiple trigger nodes", () => {
    const r = validateGraph(
      [
        { id: "t1", type: "trigger" },
        { id: "t2", type: "trigger" },
        { id: "x", type: "exit" },
      ],
      [
        { id: "e1", source: "t1", target: "x" },
        { id: "e2", source: "t2", target: "x" },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/multiple trigger/);
  });

  it("rejects a graph with an orphan (unreachable) action node", () => {
    const r = validateGraph(
      [
        { id: "t", type: "trigger" },
        { id: "e", type: "sendEmail" }, // never referenced
        { id: "x", type: "exit" },
      ],
      [{ id: "e1", source: "t", target: "x" }],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/orphan node: e/);
  });

  it("rejects a graph with a cycle", () => {
    const r = validateGraph(
      [
        { id: "t", type: "trigger" },
        { id: "a", type: "sendEmail" },
        { id: "b", type: "sendSms" },
      ],
      [
        { id: "e1", source: "t", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "a" },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/cycle/);
  });

  it("rejects a branch node without exactly 2 outgoing edges", () => {
    const r = validateGraph(
      [
        { id: "t", type: "trigger" },
        { id: "b", type: "branch", data: { condition: { field: "email", op: "notNull" } } },
        { id: "x", type: "exit" },
      ],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "x", sourceHandle: "yes" },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/branch b must have exactly 2 outgoing edges/);
  });

  it("rejects a branch whose outgoing edges lack yes/no handles", () => {
    const r = validateGraph(
      [
        { id: "t", type: "trigger" },
        { id: "b", type: "branch" },
        { id: "x", type: "exit" },
        { id: "y", type: "exit" },
      ],
      [
        { id: "e1", source: "t", target: "b" },
        { id: "e2", source: "b", target: "x", sourceHandle: "left" },
        { id: "e3", source: "b", target: "y", sourceHandle: "right" },
      ],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/sourceHandle/);
  });

  it("rejects an edge that references a missing node", () => {
    const r = validateGraph(
      [{ id: "t", type: "trigger" }, { id: "x", type: "exit" }],
      [{ id: "e1", source: "t", target: "missing" }],
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join("|")).toMatch(/not in nodes/);
  });
});

// ─── waitConfigToMs ───────────────────────────────────────────────────

describe("waitConfigToMs", () => {
  it("sums seconds + minutes + hours + days", () => {
    expect(waitConfigToMs({ seconds: 1 })).toBe(1_000);
    expect(waitConfigToMs({ minutes: 2 })).toBe(120_000);
    expect(waitConfigToMs({ hours: 1 })).toBe(3_600_000);
    expect(waitConfigToMs({ days: 1 })).toBe(86_400_000);
    expect(waitConfigToMs({ hours: 1, minutes: 30 })).toBe(3_600_000 + 1_800_000);
  });

  it("treats null/undefined/empty as 0", () => {
    expect(waitConfigToMs(null)).toBe(0);
    expect(waitConfigToMs(undefined)).toBe(0);
    expect(waitConfigToMs({})).toBe(0);
  });
});

// ─── advanceEnrollment ────────────────────────────────────────────────

// Fake Prisma shaped exactly to what journey.ts touches. Each test builds
// one enrollment + one journey and asserts what fake-prisma methods got
// called with.

interface FakeState {
  enrollment: Record<string, unknown> | null;
  journey: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  branchMatches?: boolean;
  journeys?: Array<{ id: string; triggerConfig?: Record<string, unknown> | null }>;
}

function fakePrisma(state: FakeState) {
  const calls: Record<string, unknown[][]> = {};
  const track = (name: string) =>
    vi.fn(async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      // Mutate the local enrollment on updates so subsequent reads see it.
      if (name === "enrollment.update" && state.enrollment) {
        const a = args[0] as { data: Record<string, unknown> };
        state.enrollment = { ...state.enrollment, ...a.data };
      }
      return {};
    });

  const enrollmentFindUnique = vi.fn(async () => state.enrollment);
  const journeyFindUnique = vi.fn(async () => state.journey);

  const enrollmentUpdate = track("enrollment.update");
  const journeyUpdate = track("journey.update");
  const emailCreate = track("email.create");
  const smsCreate = track("sms.create");
  const waCreate = track("wa.create");
  const clmUpsert = track("clm.upsert");
  const clmDelete = track("clm.delete");
  const customerUpdate = track("customer.update");
  const customerCount = vi.fn(async () => (state.branchMatches ? 1 : 0));
  const leadCount = vi.fn(async () => (state.branchMatches ? 1 : 0));
  const customerFindFirst = vi.fn(async () => state.customer ?? null);
  const enrollmentCreate = track("enrollment.create");
  const journeyFindMany = vi.fn(async () => state.journeys ?? []);

  const prisma = {
    journeyEnrollment: {
      findUnique: enrollmentFindUnique,
      update: enrollmentUpdate,
      create: enrollmentCreate,
    },
    marketingJourney: {
      findUnique: journeyFindUnique,
      update: journeyUpdate,
      findMany: journeyFindMany,
    },
    emailMessage: { create: emailCreate },
    smsMessage: { create: smsCreate },
    whatsappMessage: { create: waCreate },
    contactListMember: { upsert: clmUpsert, deleteMany: clmDelete },
    customer: {
      findFirst: customerFindFirst,
      update: customerUpdate,
      count: customerCount,
    },
    lead: {
      count: leadCount,
    },
  } as unknown as PrismaClient;

  return { prisma, calls };
}

function makeEnrollment(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "enr1",
    tenantId: "t1",
    journeyId: "j1",
    contactType: "Customer",
    contactId: "c1",
    emailTo: "c1@example.com",
    mobileTo: "+911111",
    currentNodeId: null,
    status: "Active",
    nextTickAt: new Date(),
    ...overrides,
  };
}

function makeJourney(nodes: JourneyNode[], edges: JourneyEdge[]): Record<string, unknown> {
  return {
    id: "j1",
    tenantId: "t1",
    status: "Active",
    nodesJson: nodes,
    edgesJson: edges,
  };
}

describe("advanceEnrollment", () => {
  it("trigger → sendEmail → completes and inserts an EmailMessage", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "e", type: "sendEmail", data: { subject: "Hi", bodyHtml: "<p>hi</p>" } },
    ];
    const edges: JourneyEdge[] = [
      { id: "e1", source: "t", target: "e" },
      // no outgoing from "e" → completes after send.
    ];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);

    // Step 1: bootstrap onto trigger + advance to sendEmail.
    const r1 = await advanceEnrollment(prisma, "enr1");
    expect(r1.status).toBe("advanced");
    expect(r1.nodeId).toBe("e");

    // Step 2: sendEmail fires + completes (no outgoing edge).
    const r2 = await advanceEnrollment(prisma, "enr1");
    expect(r2.status).toBe("completed");

    // EmailMessage insert has correct tenant + toEmail.
    expect(calls["email.create"]).toBeDefined();
    const emailArgs = calls["email.create"]![0]![0] as { data: Record<string, unknown> };
    expect(emailArgs.data.tenantId).toBe("t1");
    expect(emailArgs.data.toEmail).toBe("c1@example.com");
    expect(emailArgs.data.subject).toBe("Hi");
    expect(emailArgs.data.linkedDoctype).toBe("JourneyEnrollment");
  });

  it("wait node schedules nextTickAt in the future and advances to next node", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "w", type: "wait", data: { minutes: 10 } },
      { id: "x", type: "exit" },
    ];
    const edges: JourneyEdge[] = [
      { id: "e1", source: "t", target: "w" },
      { id: "e2", source: "w", target: "x" },
    ];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);

    // Step 1: bootstrap trigger → wait pointer.
    await advanceEnrollment(prisma, "enr1");
    // Step 2: land on wait — advance pointer to next node + schedule tick.
    const r = await advanceEnrollment(prisma, "enr1");
    expect(r.status).toBe("waiting");
    expect(r.nodeId).toBe("x");

    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const last = updates[updates.length - 1]![0].data as { nextTickAt: Date; currentNodeId: string };
    expect(last.currentNodeId).toBe("x");
    expect(last.nextTickAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it("sendSms creates an SmsMessage row with mobileTo", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "s", type: "sendSms", data: { body: "Yo" } },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "s" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1"); // trigger → s
    await advanceEnrollment(prisma, "enr1"); // send sms + complete

    expect(calls["sms.create"]).toBeDefined();
    const args = calls["sms.create"]![0]![0] as { data: Record<string, unknown> };
    expect(args.data.tenantId).toBe("t1");
    expect(args.data.toMobile).toBe("+911111");
    expect(args.data.body).toBe("Yo");
  });

  it("sendWhatsapp creates a WhatsappMessage row", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "w", type: "sendWhatsapp", data: { templateName: "welcome_v1" } },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "w" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1");
    await advanceEnrollment(prisma, "enr1");

    expect(calls["wa.create"]).toBeDefined();
    const args = calls["wa.create"]![0]![0] as { data: Record<string, unknown> };
    expect(args.data.toMobile).toBe("+911111");
    expect(args.data.body).toBe("template:welcome_v1");
    expect(args.data.direction).toBe("outbound");
  });

  it("branch node picks the 'yes' path when condition matches", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "b", type: "branch", data: { condition: { field: "email", op: "notNull" } } },
      { id: "y", type: "exit" },
      { id: "n", type: "exit" },
    ];
    const edges: JourneyEdge[] = [
      { id: "e1", source: "t", target: "b" },
      { id: "e2", source: "b", target: "y", sourceHandle: "yes" },
      { id: "e3", source: "b", target: "n", sourceHandle: "no" },
    ];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
      branchMatches: true,
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1"); // trigger → b
    const r = await advanceEnrollment(prisma, "enr1"); // b → y
    expect(r.status).toBe("advanced");
    expect(r.nodeId).toBe("y");
    // Then exit.
    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const beforeExit = updates[updates.length - 1]![0].data as { currentNodeId: string };
    expect(beforeExit.currentNodeId).toBe("y");
  });

  it("branch node picks the 'no' path when condition fails", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "b", type: "branch", data: { condition: { field: "email", op: "notNull" } } },
      { id: "y", type: "exit" },
      { id: "n", type: "exit" },
    ];
    const edges: JourneyEdge[] = [
      { id: "e1", source: "t", target: "b" },
      { id: "e2", source: "b", target: "y", sourceHandle: "yes" },
      { id: "e3", source: "b", target: "n", sourceHandle: "no" },
    ];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
      branchMatches: false,
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1"); // trigger → b
    const r = await advanceEnrollment(prisma, "enr1"); // b → n
    expect(r.nodeId).toBe("n");
    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const beforeExit = updates[updates.length - 1]![0].data as { currentNodeId: string };
    expect(beforeExit.currentNodeId).toBe("n");
  });

  it("exit node marks enrollment Completed immediately", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "x", type: "exit" },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "x" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1"); // trigger → x
    const r = await advanceEnrollment(prisma, "enr1"); // x
    expect(r.status).toBe("completed");
    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const last = updates[updates.length - 1]![0].data as { status: string };
    expect(last.status).toBe("Completed");
  });

  it("no outgoing edge from a non-terminal node → marks Completed", async () => {
    // Only a trigger and no other nodes — nothing to advance to.
    const nodes: JourneyNode[] = [{ id: "t", type: "trigger" }];
    const edges: JourneyEdge[] = [];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    const r = await advanceEnrollment(prisma, "enr1");
    expect(r.status).toBe("completed");
    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const last = updates[updates.length - 1]![0].data as { status: string };
    expect(last.status).toBe("Completed");
  });

  it("runtime error inside a node → marks Failed with lastError", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "a", type: "addToList" /* missing listId → throws */ },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "a" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1"); // trigger → a
    const r = await advanceEnrollment(prisma, "enr1"); // a throws
    expect(r.status).toBe("failed");
    const updates = calls["enrollment.update"] as Array<[{ data: Record<string, unknown> }]>;
    const last = updates[updates.length - 1]![0].data as { status: string; lastError: string };
    expect(last.status).toBe("Failed");
    expect(last.lastError).toMatch(/missing listId/);
  });

  it("addToList upserts a ContactListMember", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "a", type: "addToList", data: { listId: "list-1" } },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "a" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1");
    await advanceEnrollment(prisma, "enr1");
    expect(calls["clm.upsert"]).toBeDefined();
    const args = calls["clm.upsert"]![0]![0] as { create: Record<string, unknown> };
    expect(args.create.listId).toBe("list-1");
    expect(args.create.contactId).toBe("c1");
  });

  it("updateContact merges into Customer.customData", async () => {
    const nodes: JourneyNode[] = [
      { id: "t", type: "trigger" },
      { id: "u", type: "updateContact", data: { attribute: "tier", value: "gold" } },
    ];
    const edges: JourneyEdge[] = [{ id: "e1", source: "t", target: "u" }];
    const state: FakeState = {
      enrollment: makeEnrollment(),
      journey: makeJourney(nodes, edges),
      customer: { customData: { existing: 1 } },
    };
    const { prisma, calls } = fakePrisma(state);
    await advanceEnrollment(prisma, "enr1");
    await advanceEnrollment(prisma, "enr1");
    expect(calls["customer.update"]).toBeDefined();
    const args = calls["customer.update"]![0]![0] as { data: { customData: Record<string, unknown> } };
    expect(args.data.customData).toEqual({ existing: 1, tier: "gold" });
  });
});

// ─── fireJourneyTrigger ───────────────────────────────────────────────

describe("fireJourneyTrigger", () => {
  it("creates JourneyEnrollment rows for every active journey whose config matches", async () => {
    const state: FakeState = {
      enrollment: null,
      journey: null,
      journeys: [
        { id: "j1", triggerConfig: { listId: "list-a" } },
        { id: "j2", triggerConfig: { listId: "list-b" } }, // does NOT match
        { id: "j3", triggerConfig: { listId: "list-a" } },
      ],
    };
    const { prisma, calls } = fakePrisma(state);
    const r = await fireJourneyTrigger(prisma, {
      tenantId: "t1",
      triggerType: "ListAdd",
      match: { listId: "list-a" },
      contactType: "Customer",
      contactId: "c1",
      emailTo: "c1@example.com",
    });
    expect(r.enrolled).toBe(2);
    expect(calls["enrollment.create"]).toBeDefined();
    expect(calls["enrollment.create"]!.length).toBe(2);
    const firstArgs = calls["enrollment.create"]![0]![0] as { data: Record<string, unknown> };
    expect(firstArgs.data.journeyId).toBe("j1");
    expect(firstArgs.data.contactId).toBe("c1");
    expect(firstArgs.data.status).toBe("Active");
  });

  it("returns 0 when no active journey matches", async () => {
    const state: FakeState = {
      enrollment: null,
      journey: null,
      journeys: [], // nothing returned by findMany
    };
    const { prisma } = fakePrisma(state);
    const r = await fireJourneyTrigger(prisma, {
      tenantId: "t1",
      triggerType: "LeadCreated",
      contactType: "Lead",
      contactId: "l1",
    });
    expect(r.enrolled).toBe(0);
  });
});
