// Real-database integration test for GET /items. See
// services/accounting-service/src/routes/customers.integration.test.ts for
// the full rationale.

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@lumaara/db";

const suiteId = `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
  await prisma.item.createMany({
    data: [
      { tenantId: tenantA.id, itemCode: "ITM-A01", itemName: "Widget" },
      { tenantId: tenantA.id, itemCode: "ITM-A02", itemName: "Gadget" },
      { tenantId: tenantB.id, itemCode: "ITM-B01", itemName: "Sprocket" },
    ],
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("GET /items (real DB)", () => {
  it("returns only the calling tenant's items (tenant A view)", async () => {
    currentTenantId = tenantA.id;
    const app = await buildApp();
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    const names = (res.body as { itemName: string }[]).map((i) => i.itemName).sort();
    expect(names).toEqual(["Gadget", "Widget"]);
    expect(names).not.toContain("Sprocket");
  });

  it("returns only the calling tenant's items (tenant B view)", async () => {
    currentTenantId = tenantB.id;
    const app = await buildApp();
    const res = await request(app).get("/items");
    expect(res.status).toBe(200);
    const names = (res.body as { itemName: string }[]).map((i) => i.itemName);
    expect(names).toEqual(["Sprocket"]);
    expect(names).not.toContain("Widget");
    expect(names).not.toContain("Gadget");
  });
});
