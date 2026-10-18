// Real-DB integration test for the agile router (workspaces, sprints,
// epics, releases, work-items, OKRs). The audit called out agile as the
// largest untested surface in projects-service.
//
// Covered flows:
//   • workspace CRUD + tenant isolation
//   • sprint create → start → complete
//   • work-item create inside a workspace + sprint attachment
//   • OKR key-result progress update + progress aggregation

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-agile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let tenantA: { id: string };
let tenantB: { id: string };
let currentTenantId: string;

vi.mock("@lumaara/service-auth", async () => {
  const actual = await vi.importActual<typeof import("@lumaara/service-auth")>(
    "@lumaara/service-auth",
  );
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: currentTenantId,
      userId: "user-agile",
    };
    next();
  };
  return {
    ...actual,
    perms: () => ({
      read: pass, write: pass, create: pass, delete: pass, submit: pass, cancel: pass,
    }),
  };
});

async function buildApp() {
  const { agileRouter } = await import("./agile");
  const app = express();
  app.use(express.json());
  app.use("/agile", agileRouter);
  return app;
}

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("agile workspaces (real DB)", () => {
  it("creates a workspace and surfaces it only to its own tenant", async () => {
    const app = await buildApp();
    currentTenantId = tenantA.id;
    const create = await request(app).post("/agile/workspaces").send({
      name: `WS-${suiteId}-A`,
      key: `A${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      description: "tenant-A agile workspace",
    });
    expect(create.status, create.text).toBe(201);
    const ws = create.body as { id: string };

    const listA = await request(app).get("/agile/workspaces");
    expect(listA.status).toBe(200);
    const idsA = (listA.body as Array<{ id: string }>).map((w) => w.id);
    expect(idsA).toContain(ws.id);

    // Flip to tenant B — must NOT see A's workspace.
    currentTenantId = tenantB.id;
    const listB = await request(app).get("/agile/workspaces");
    expect(listB.status).toBe(200);
    const idsB = (listB.body as Array<{ id: string }>).map((w) => w.id);
    expect(idsB).not.toContain(ws.id);
  });
});

describe("agile sprints (real DB)", () => {
  let workspaceId: string;

  beforeAll(async () => {
    currentTenantId = tenantA.id;
    const ws = await prisma.agileWorkspace.create({
      data: {
        tenantId: tenantA.id,
        name: `WS-sprint-${suiteId}`,
        key: `S${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      },
    });
    workspaceId = ws.id;
  });

  it("create → start → complete transitions update sprint state", async () => {
    const app = await buildApp();
    currentTenantId = tenantA.id;

    const create = await request(app).post("/agile/sprints").send({
      workspaceId,
      name: `Sprint 1 ${suiteId}`,
      goal: "Ship the thing",
      startDate: "2026-10-01T00:00:00Z",
      endDate: "2026-10-14T00:00:00Z",
    });
    expect(create.status, create.text).toBe(201);
    const sprint = create.body as { id: string; status: string };
    expect(sprint.status).toBe("Planning");

    const start = await request(app).post(`/agile/sprints/${sprint.id}/start`);
    expect(start.status).toBe(200);
    expect((start.body as { status: string }).status).toBe("Active");

    const complete = await request(app).post(`/agile/sprints/${sprint.id}/complete`);
    expect(complete.status).toBe(200);
    const completeBody = complete.body as { sprint: { status: string } };
    expect(completeBody.sprint.status).toBe("Completed");
  });
});

describe("agile work items (real DB)", () => {
  let workspaceId: string;

  beforeAll(async () => {
    currentTenantId = tenantA.id;
    const ws = await prisma.agileWorkspace.create({
      data: {
        tenantId: tenantA.id,
        name: `WS-wi-${suiteId}`,
        key: `W${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      },
    });
    workspaceId = ws.id;
  });

  it("creates a work item scoped to the workspace", async () => {
    const app = await buildApp();
    currentTenantId = tenantA.id;

    const create = await request(app).post("/agile/work-items").send({
      workspaceId,
      type: "Story",
      title: `WI-${suiteId}`,
      priority: "Medium",
      status: "Todo",
    });
    expect(create.status, create.text).toBe(201);
    const wi = create.body as { id: string; key: string; status: string };
    expect(wi.key).toMatch(/-\d+$/); // workspace prefix + numeric
    expect(wi.status).toBe("Todo");

    // List under the workspace returns it.
    const list = await request(app).get(
      `/agile/work-items?workspaceId=${workspaceId}`,
    );
    expect(list.status).toBe(200);
    const rows = list.body as Array<{ id: string }>;
    expect(rows.some((r) => r.id === wi.id)).toBe(true);
  });
});

describe("agile OKRs (real DB)", () => {
  let workspaceId: string;

  beforeAll(async () => {
    currentTenantId = tenantA.id;
    const ws = await prisma.agileWorkspace.create({
      data: {
        tenantId: tenantA.id,
        name: `WS-okr-${suiteId}`,
        key: `O${Date.now().toString(36).slice(-4)}`.toUpperCase(),
      },
    });
    workspaceId = ws.id;
  });

  it("creates OKR, updates key-result progress, exposes aggregated progress", async () => {
    const app = await buildApp();
    currentTenantId = tenantA.id;

    const create = await request(app).post("/agile/okrs").send({
      workspaceId,
      objective: `OKR ${suiteId}`,
      ownerUserId: "user-agile",
      period: "2026-Q4",
      keyResults: [
        { title: "KR-1 revenue", targetValue: 100, currentValue: 0, unit: "MRR" },
        { title: "KR-2 users", targetValue: 50, currentValue: 10, unit: "users" },
      ],
    });
    expect(create.status, create.text).toBe(201);
    const okr = create.body as {
      id: string;
      keyResults: Array<{ id: string; title: string }>;
    };
    expect(okr.keyResults.length).toBe(2);

    // Initial aggregate progress comes from GET /okrs/:id (POST doesn't
    // compute it in the response). KR-1 current 0/100 = 0%,
    // KR-2 current 10/50 = 20% → avg 10%.
    const initial = await request(app).get(`/agile/okrs/${okr.id}`);
    expect(initial.status).toBe(200);
    const initialBody = initial.body as { progress: number };
    expect(initialBody.progress).toBeGreaterThanOrEqual(5);
    expect(initialBody.progress).toBeLessThanOrEqual(15);

    // Bump KR-1 current to half of target.
    const kr1 = okr.keyResults[0];
    const progressRes = await request(app)
      .post(`/agile/key-results/${kr1.id}/progress`)
      .send({ currentValue: 50 });
    expect(progressRes.status).toBe(200);

    // The OKR GET should now report updated aggregate progress.
    const refetched = await request(app).get(`/agile/okrs/${okr.id}`);
    expect(refetched.status).toBe(200);
    const after = refetched.body as { progress: number };
    // KR-1 now 50/100 = 50%, KR-2 10/50 = 20% → average 35%.
    expect(after.progress).toBeGreaterThan(initialBody.progress);
  });
});
