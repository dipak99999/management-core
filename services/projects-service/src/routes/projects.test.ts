// Minimum-viable coverage for the project router. Two guarantees:
//   1. GET /projects returns the rows Prisma returned (happy path).
//   2. The Prisma call is scoped by `tenantId` from the JWT.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  project: {
    findMany: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
  nextName: () => "PROJ-0001",
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
  const { projectRouter } = await import("./projects");
  const app = express();
  app.use(express.json());
  app.use("/projects", projectRouter);
  return app;
}

beforeEach(() => {
  prismaMock.project.findMany.mockReset();
});

describe("GET /projects", () => {
  it("returns rows from prisma with 200", async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: "p1", projectName: "Redesign", status: "Open", tenantId: "tenant-A" },
    ]);
    const app = await buildApp();
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].projectName).toBe("Redesign");
  });

  it("scopes the query by tenantId from the JWT", async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([]);
    const app = await buildApp();
    await request(app).get("/projects");
    expect(prismaMock.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A" }),
      }),
    );
  });
});
