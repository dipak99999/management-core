// Real-DB integration test for the timesheets router.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      userId: "user-test",
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
  const { timesheetRouter } = await import("./timesheets");
  const app = express();
  app.use(express.json());
  app.use("/timesheets", timesheetRouter);
  return app;
}

let empA: { id: string };
let empB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  empA = await prisma.employee.create({
    data: { tenantId: tenantA.id, employeeCode: `EMP-TS-${suiteId}-A`, employeeName: "Alice" },
    select: { id: true },
  });
  empB = await prisma.employee.create({
    data: { tenantId: tenantB.id, employeeCode: `EMP-TS-${suiteId}-B`, employeeName: "Bob" },
    select: { id: true },
  });
  await prisma.timesheet.createMany({
    data: [
      {
        tenantId: tenantA.id, name: `TS-${suiteId}-A1`, employeeId: empA.id,
        weekStartDate: new Date("2026-01-05"),
      },
      {
        tenantId: tenantB.id, name: `TS-${suiteId}-B1`, employeeId: empB.id,
        weekStartDate: new Date("2026-01-05"),
      },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
  await prisma.$disconnect();
});

describe("GET /timesheets (real DB)", () => {
  it("returns only tenant A's timesheets", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/timesheets");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`TS-${suiteId}-A1`);
    expect(names).not.toContain(`TS-${suiteId}-B1`);
  });

  it("returns only tenant B's timesheets", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/timesheets");
    expect(res.status).toBe(200);
    const names = (res.body as { name: string }[]).map((r) => r.name);
    expect(names).toContain(`TS-${suiteId}-B1`);
    expect(names).not.toContain(`TS-${suiteId}-A1`);
  });
});
