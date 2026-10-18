// Minimum-viable coverage for the items-read router (stock-service). Two
// guarantees:
//   1. GET /items returns the rows Prisma returned (happy path).
//   2. The Prisma call is scoped by `tenantId` from the JWT.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  item: {
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
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
  const { itemsReadRouter } = await import("./items-read");
  const app = express();
  app.use(express.json());
  app.use("/items", itemsReadRouter);
  return app;
}

beforeEach(() => {
  prismaMock.item.findMany.mockReset();
});

describe("GET /items", () => {
  it("returns rows from prisma with 200", async () => {
    prismaMock.item.findMany.mockResolvedValueOnce([
      { id: "i1", itemCode: "ITM-001", itemName: "Widget", stockUom: "Nos", standardRate: "10.00", isStockItem: true },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].itemCode).toBe("ITM-001");
  });

  it("scopes the query by tenantId from the JWT", async () => {
    prismaMock.item.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    await request(app).get("/items");
    expect(prismaMock.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A" }),
      }),
    );
  });
});
