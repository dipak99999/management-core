import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  attributeInvoice,
  getRoiBySource,
  recordTouchpoint,
  splitByModel,
} from "./attribution";

// ─── Fake Prisma ──────────────────────────────────────────────────────
//
// The engine only touches `prisma.attributionTouchpoint` (create, findMany,
// updateMany, update) plus the display-name lookups (`campaign`,
// `marketingJourney`, `webForm`, `webinarEvent`, `socialPost`).findMany.
// Everything else is unused, so we build the smallest shim that satisfies
// those call signatures.

interface FakeTouchpoint {
  id: string;
  tenantId: string;
  contactType: string;
  contactId: string;
  sourceType: string;
  sourceId: string;
  event: string;
  occurredAt: Date;
  attributedRevenue: number;
  attributedInvoiceId: string | null;
}

interface FakeNamedSource {
  id: string;
  tenantId: string;
  name?: string;
  content?: string;
}

interface FakeState {
  touchpoints: FakeTouchpoint[];
  campaigns?: FakeNamedSource[];
  journeys?: FakeNamedSource[];
  webForms?: FakeNamedSource[];
  webinars?: FakeNamedSource[];
  socialPosts?: FakeNamedSource[];
}

function whereMatch(row: FakeTouchpoint, where: any): boolean {
  if (!where) return true;
  if (where.tenantId != null && row.tenantId !== where.tenantId) return false;
  if (where.contactType != null && row.contactType !== where.contactType) return false;
  if (where.contactId != null && row.contactId !== where.contactId) return false;
  if (where.sourceType != null && row.sourceType !== where.sourceType) return false;
  if (where.attributedInvoiceId != null && row.attributedInvoiceId !== where.attributedInvoiceId)
    return false;
  if (where.occurredAt) {
    const t = row.occurredAt.getTime();
    if (where.occurredAt.gte && t < new Date(where.occurredAt.gte).getTime()) return false;
    if (where.occurredAt.lte && t > new Date(where.occurredAt.lte).getTime()) return false;
  }
  return true;
}

function fakePrisma(state: FakeState) {
  let nextId = 1;
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) =>
    ((calls[name] ??= []).push(args));

  const attributionTouchpoint = {
    create: vi.fn(async (args: { data: Omit<FakeTouchpoint, "id"> }) => {
      record("touchpoint.create", [args]);
      const row: FakeTouchpoint = {
        id: `tp-${nextId++}`,
        attributedRevenue: 0,
        attributedInvoiceId: null,
        ...(args.data as Partial<FakeTouchpoint>),
      } as FakeTouchpoint;
      state.touchpoints.push(row);
      return row;
    }),
    findMany: vi.fn(async (args: { where: any; orderBy?: any; select?: any }) => {
      record("touchpoint.findMany", [args]);
      let rows = state.touchpoints.filter((r) => whereMatch(r, args.where));
      if (args.orderBy?.occurredAt === "asc") {
        rows = [...rows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      }
      // Ignore select for tests — return full rows.
      return rows;
    }),
    updateMany: vi.fn(async (args: { where: any; data: Partial<FakeTouchpoint> }) => {
      record("touchpoint.updateMany", [args]);
      let count = 0;
      for (const r of state.touchpoints) {
        if (whereMatch(r, args.where)) {
          Object.assign(r, args.data);
          count++;
        }
      }
      return { count };
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Partial<FakeTouchpoint> }) => {
      record("touchpoint.update", [args]);
      const r = state.touchpoints.find((r) => r.id === args.where.id);
      if (r) Object.assign(r, args.data);
      return r;
    }),
  };

  const nameLookup = (list: FakeNamedSource[] | undefined) => ({
    findMany: vi.fn(async (args: { where: any }) => {
      const ids: string[] = args.where?.id?.in ?? [];
      const t = args.where?.tenantId;
      return (list ?? []).filter((r) => (!t || r.tenantId === t) && ids.includes(r.id));
    }),
  });

  const prisma = {
    attributionTouchpoint,
    campaign: nameLookup(state.campaigns),
    marketingJourney: nameLookup(state.journeys),
    webForm: nameLookup(state.webForms),
    webinarEvent: nameLookup(state.webinars),
    socialPost: nameLookup(state.socialPosts),
  } as unknown as PrismaClient;

  return { prisma, calls, state };
}

function tp(overrides: Partial<FakeTouchpoint> = {}): FakeTouchpoint {
  return {
    id: overrides.id ?? "seed",
    tenantId: overrides.tenantId ?? "t1",
    contactType: overrides.contactType ?? "Customer",
    contactId: overrides.contactId ?? "cust1",
    sourceType: overrides.sourceType ?? "Campaign",
    sourceId: overrides.sourceId ?? "camp1",
    event: overrides.event ?? "Open",
    occurredAt: overrides.occurredAt ?? new Date("2026-08-01T00:00:00Z"),
    attributedRevenue: overrides.attributedRevenue ?? 0,
    attributedInvoiceId: overrides.attributedInvoiceId ?? null,
  };
}

// ─── recordTouchpoint ─────────────────────────────────────────────────

describe("recordTouchpoint", () => {
  it("inserts a row with all supplied fields + defaulted occurredAt", async () => {
    const state: FakeState = { touchpoints: [] };
    const { prisma, calls } = fakePrisma(state);

    const row = await recordTouchpoint(prisma, {
      tenantId: "t1",
      contactType: "Customer",
      contactId: "cust1",
      sourceType: "Campaign",
      sourceId: "camp1",
      event: "Open",
    });

    expect(row.id).toBeTruthy();
    expect(state.touchpoints).toHaveLength(1);
    const args = calls["touchpoint.create"]![0]![0] as { data: FakeTouchpoint };
    expect(args.data.tenantId).toBe("t1");
    expect(args.data.contactType).toBe("Customer");
    expect(args.data.contactId).toBe("cust1");
    expect(args.data.sourceType).toBe("Campaign");
    expect(args.data.sourceId).toBe("camp1");
    expect(args.data.event).toBe("Open");
    expect(args.data.occurredAt).toBeInstanceOf(Date);
  });

  it("honors an explicit occurredAt", async () => {
    const state: FakeState = { touchpoints: [] };
    const { prisma } = fakePrisma(state);
    const when = new Date("2026-06-15T12:00:00Z");

    await recordTouchpoint(prisma, {
      tenantId: "t1",
      contactType: "Lead",
      contactId: "lead1",
      sourceType: "WebForm",
      sourceId: "wf1",
      event: "Submitted",
      occurredAt: when,
    });
    expect(state.touchpoints[0]!.occurredAt).toEqual(when);
  });
});

// ─── splitByModel ─────────────────────────────────────────────────────

describe("splitByModel", () => {
  const tps = [
    { id: "a", occurredAt: new Date("2026-08-01T00:00:00Z") },
    { id: "b", occurredAt: new Date("2026-08-05T00:00:00Z") },
    { id: "c", occurredAt: new Date("2026-08-10T00:00:00Z") },
  ];

  it("LastTouch → 100% to the newest", () => {
    expect(splitByModel(tps, 300, "LastTouch")).toEqual({ c: 300 });
  });

  it("FirstTouch → 100% to the oldest", () => {
    expect(splitByModel(tps, 300, "FirstTouch")).toEqual({ a: 300 });
  });

  it("Linear → amount / N per touchpoint", () => {
    expect(splitByModel(tps, 300, "Linear")).toEqual({ a: 100, b: 100, c: 100 });
  });

  it("empty input → empty splits", () => {
    expect(splitByModel([], 500, "LastTouch")).toEqual({});
    expect(splitByModel([], 500, "FirstTouch")).toEqual({});
    expect(splitByModel([], 500, "Linear")).toEqual({});
  });
});

// ─── attributeInvoice ─────────────────────────────────────────────────

describe("attributeInvoice", () => {
  it("LastTouch: single touchpoint gets 100%", async () => {
    const only = tp({ id: "only", occurredAt: new Date("2026-08-20T00:00:00Z") });
    const state: FakeState = { touchpoints: [only] };
    const { prisma } = fakePrisma(state);

    const { splits } = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 500,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      model: "LastTouch",
    });

    expect(splits).toEqual({ only: 500 });
    expect(state.touchpoints[0]!.attributedRevenue).toBe(500);
    expect(state.touchpoints[0]!.attributedInvoiceId).toBe("inv1");
  });

  it("LastTouch: three touchpoints — most recent gets 100%", async () => {
    const t1 = tp({ id: "old", occurredAt: new Date("2026-08-01T00:00:00Z") });
    const t2 = tp({ id: "mid", occurredAt: new Date("2026-08-10T00:00:00Z") });
    const t3 = tp({ id: "new", occurredAt: new Date("2026-08-20T00:00:00Z") });
    const state: FakeState = { touchpoints: [t1, t2, t3] };
    const { prisma } = fakePrisma(state);

    const { splits } = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 900,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      model: "LastTouch",
    });

    expect(splits).toEqual({ new: 900 });
    expect(state.touchpoints.find((r) => r.id === "new")!.attributedRevenue).toBe(900);
    expect(state.touchpoints.find((r) => r.id === "old")!.attributedRevenue).toBe(0);
    expect(state.touchpoints.find((r) => r.id === "mid")!.attributedRevenue).toBe(0);
  });

  it("FirstTouch: earliest touchpoint gets 100%", async () => {
    const t1 = tp({ id: "old", occurredAt: new Date("2026-08-01T00:00:00Z") });
    const t2 = tp({ id: "mid", occurredAt: new Date("2026-08-10T00:00:00Z") });
    const t3 = tp({ id: "new", occurredAt: new Date("2026-08-20T00:00:00Z") });
    const state: FakeState = { touchpoints: [t1, t2, t3] };
    const { prisma } = fakePrisma(state);

    const { splits } = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 900,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      model: "FirstTouch",
    });

    expect(splits).toEqual({ old: 900 });
    expect(state.touchpoints.find((r) => r.id === "old")!.attributedInvoiceId).toBe("inv1");
  });

  it("Linear: N touchpoints get amount/N", async () => {
    const t1 = tp({ id: "a", occurredAt: new Date("2026-08-01T00:00:00Z") });
    const t2 = tp({ id: "b", occurredAt: new Date("2026-08-05T00:00:00Z") });
    const t3 = tp({ id: "c", occurredAt: new Date("2026-08-10T00:00:00Z") });
    const t4 = tp({ id: "d", occurredAt: new Date("2026-08-15T00:00:00Z") });
    const state: FakeState = { touchpoints: [t1, t2, t3, t4] };
    const { prisma } = fakePrisma(state);

    const { splits } = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 400,
      postingDate: new Date("2026-08-20T00:00:00Z"),
      model: "Linear",
    });

    expect(splits).toEqual({ a: 100, b: 100, c: 100, d: 100 });
    for (const id of ["a", "b", "c", "d"]) {
      expect(state.touchpoints.find((r) => r.id === id)!.attributedRevenue).toBe(100);
      expect(state.touchpoints.find((r) => r.id === id)!.attributedInvoiceId).toBe("inv1");
    }
  });

  it("no touchpoints in window: no error, empty splits", async () => {
    const state: FakeState = { touchpoints: [] };
    const { prisma } = fakePrisma(state);
    const r = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 999,
      postingDate: new Date("2026-08-20T00:00:00Z"),
      model: "LastTouch",
    });
    expect(r.splits).toEqual({});
    expect(r.touchpoints).toEqual([]);
  });

  it("respects windowDays: touchpoints outside window ignored", async () => {
    const inside = tp({ id: "in", occurredAt: new Date("2026-08-15T00:00:00Z") });
    const stale = tp({ id: "stale", occurredAt: new Date("2026-01-01T00:00:00Z") });
    const state: FakeState = { touchpoints: [inside, stale] };
    const { prisma } = fakePrisma(state);

    const { splits } = await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 500,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      windowDays: 30,
      model: "LastTouch",
    });

    expect(splits).toEqual({ in: 500 });
    expect(state.touchpoints.find((r) => r.id === "stale")!.attributedRevenue).toBe(0);
  });

  it("re-runs are idempotent: previous attribution cleared before re-split", async () => {
    // First run — attribute against LastTouch → "new" gets 900.
    const t1 = tp({ id: "old", occurredAt: new Date("2026-08-01T00:00:00Z") });
    const t2 = tp({ id: "new", occurredAt: new Date("2026-08-20T00:00:00Z") });
    const state: FakeState = { touchpoints: [t1, t2] };
    const { prisma } = fakePrisma(state);

    await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 900,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      model: "LastTouch",
    });
    expect(state.touchpoints.find((r) => r.id === "new")!.attributedRevenue).toBe(900);

    // Second run — switch to Linear. The prior "new"=900 must be wiped first.
    await attributeInvoice(prisma, {
      tenantId: "t1",
      invoiceId: "inv1",
      customerId: "cust1",
      amount: 900,
      postingDate: new Date("2026-08-25T00:00:00Z"),
      model: "Linear",
    });
    expect(state.touchpoints.find((r) => r.id === "old")!.attributedRevenue).toBe(450);
    expect(state.touchpoints.find((r) => r.id === "new")!.attributedRevenue).toBe(450);
  });
});

// ─── getRoiBySource ───────────────────────────────────────────────────

describe("getRoiBySource", () => {
  it("groups by (sourceType, sourceId), sums revenue, counts unique contacts", async () => {
    const state: FakeState = {
      touchpoints: [
        tp({
          id: "1",
          sourceType: "Campaign",
          sourceId: "camp1",
          contactId: "custA",
          attributedRevenue: 300,
        }),
        tp({
          id: "2",
          sourceType: "Campaign",
          sourceId: "camp1",
          contactId: "custA", // same contact, so uniqueContacts stays 1
          attributedRevenue: 200,
        }),
        tp({
          id: "3",
          sourceType: "Campaign",
          sourceId: "camp1",
          contactId: "custB",
          attributedRevenue: 100,
        }),
        tp({
          id: "4",
          sourceType: "WebForm",
          sourceId: "wf1",
          contactId: "custC",
          attributedRevenue: 50,
        }),
      ],
      campaigns: [{ id: "camp1", tenantId: "t1", name: "Summer Sale" }],
      webForms: [{ id: "wf1", tenantId: "t1", name: "Contact Us" }],
    };
    const { prisma } = fakePrisma(state);

    const rows = await getRoiBySource(prisma, "t1", {
      from: new Date("2026-07-01T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
    });

    expect(rows).toHaveLength(2);
    // Sorted by attributedRevenue DESC → Campaign first (600 total).
    expect(rows[0]!.sourceType).toBe("Campaign");
    expect(rows[0]!.sourceId).toBe("camp1");
    expect(rows[0]!.sourceName).toBe("Summer Sale");
    expect(rows[0]!.touchpointCount).toBe(3);
    expect(rows[0]!.uniqueContacts).toBe(2);
    expect(rows[0]!.attributedRevenue).toBe(600);

    expect(rows[1]!.sourceType).toBe("WebForm");
    expect(rows[1]!.sourceName).toBe("Contact Us");
    expect(rows[1]!.uniqueContacts).toBe(1);
    expect(rows[1]!.attributedRevenue).toBe(50);
  });

  it("falls back to sourceId when the source row can't be resolved", async () => {
    const state: FakeState = {
      touchpoints: [
        tp({ sourceType: "Campaign", sourceId: "ghost-camp", attributedRevenue: 42 }),
      ],
      campaigns: [], // none — lookup returns nothing
    };
    const { prisma } = fakePrisma(state);

    const rows = await getRoiBySource(prisma, "t1", {
      from: new Date("2026-07-01T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
    });
    expect(rows[0]!.sourceName).toBe("ghost-camp");
  });

  it("filters by sourceType when provided", async () => {
    const state: FakeState = {
      touchpoints: [
        tp({ sourceType: "Campaign", sourceId: "c1", attributedRevenue: 100 }),
        tp({ sourceType: "WebForm", sourceId: "w1", attributedRevenue: 200 }),
      ],
      campaigns: [{ id: "c1", tenantId: "t1", name: "Camp One" }],
      webForms: [{ id: "w1", tenantId: "t1", name: "Form One" }],
    };
    const { prisma } = fakePrisma(state);

    const rows = await getRoiBySource(prisma, "t1", {
      from: new Date("2026-07-01T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
      sourceType: "WebForm",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sourceType).toBe("WebForm");
  });
});
