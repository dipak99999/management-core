// Minimum-viable coverage for the customer router. Two guarantees:
//   1. GET /customers returns the rows Prisma returned (happy path).
//   2. The Prisma call is scoped by `tenantId` from the JWT — a regression
//      here would be a multi-tenant data leak.
//
// Prisma and service-auth are mocked at the module boundary so this suite is
// hermetic (no live Postgres, no JWT signing).

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  customer: {
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
  // The router imports these but the /GET path doesn't touch them; provide
  // no-op stubs so import-time evaluation doesn't blow up.
  isValidPan: () => true,
  validateCustomData: () => null,
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
  const { customerRouter } = await import("./customers");
  const app = express();
  app.use(express.json());
  app.use("/customers", customerRouter);
  return app;
}

beforeEach(() => {
  prismaMock.customer.findMany.mockReset();
});

describe("GET /customers", () => {
  it("returns rows from prisma with 200", async () => {
    prismaMock.customer.findMany.mockResolvedValueOnce([
      { id: "c1", customerName: "Acme", tenantId: "tenant-A" },
      { id: "c2", customerName: "Globex", tenantId: "tenant-A" },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/customers");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].customerName).toBe("Acme");
  });

  it("scopes the query by tenantId from the JWT", async () => {
    prismaMock.customer.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    await request(app).get("/customers");
    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A" }),
      }),
    );
  });
});
