// Minimum-viable coverage for the employee router. Two guarantees:
//   1. GET /employees returns the rows Prisma returned (happy path).
//   2. The Prisma call is scoped by `tenantId` from the JWT — regression
//      here would be a cross-tenant data leak.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  employee: {
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
  Prisma: {},
  validateCustomData: () => null,
  nextName: () => "EMP-0001",
}));

vi.mock("@lumaara/service-auth", () => {
  const pass = (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: "tenant-A",
      userId: "user-U",
    };
    next();
  };
  return {
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
  };
});

async function buildApp() {
  const { employeeRouter } = await import("./employees");
  const app = express();
  app.use(express.json());
  app.use("/employees", employeeRouter);
  return app;
}

beforeEach(() => {
  prismaMock.employee.findMany.mockReset();
});

describe("GET /employees", () => {
  it("returns rows from prisma with 200", async () => {
    prismaMock.employee.findMany.mockResolvedValueOnce([
      { id: "e1", employeeCode: "EMP-0001", employeeName: "Alice", tenantId: "tenant-A" },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/employees");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].employeeName).toBe("Alice");
  });

  it("scopes the query by tenantId from the JWT", async () => {
    prismaMock.employee.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    await request(app).get("/employees");
    expect(prismaMock.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A" }),
      }),
    );
  });
});
