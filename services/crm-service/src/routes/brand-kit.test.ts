// Unit tests for brand-kit routes.
//
// Prisma + service-auth are mocked at the module boundary so this suite is
// hermetic (no live Postgres). Follows the same pattern as campaigns.test.ts.

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────
const prismaMock = {
  brandKit: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
  mediaAsset: {
    findFirst: vi.fn(),
  },
  tenantIntegration: {
    findFirst: vi.fn(),
  },
};

vi.mock("@lumaara/db", () => ({
  prisma: prismaMock,
  // Not touched by the tested paths but the router imports lazily; provide
  // no-op stubs so import doesn't blow up if a code path happens to call in.
  loadS3Config: vi.fn(),
  presignGetObject: vi.fn(() => "https://s3.example/signed"),
  decryptSecrets: vi.fn(() => ({})),
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
  const { brandKitRouter } = await import("./brand-kit");
  const app = express();
  app.use(express.json());
  app.use("/brand-kit", brandKitRouter);
  return app;
}

function defaultKit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "bk-1",
    tenantId: "tenant-A",
    logoAssetId: null,
    faviconAssetId: null,
    primaryColor: "#1e40af",
    secondaryColor: "#0ea5e9",
    accentColor: "#f59e0b",
    neutralColor: "#111827",
    headingFont: "Inter, sans-serif",
    bodyFont: "Inter, sans-serif",
    footerHtml: null,
    socialLinks: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── GET /brand-kit — creates default row when absent ──────────────────
describe("GET /brand-kit", () => {
  it("returns the existing row when one is saved", async () => {
    prismaMock.brandKit.findUnique.mockResolvedValueOnce(
      defaultKit({ primaryColor: "#ff00ff" }),
    );
    const app = await buildApp();
    const res = await request(app).get("/brand-kit");
    expect(res.status).toBe(200);
    expect(res.body.primaryColor).toBe("#ff00ff");
    expect(prismaMock.brandKit.create).not.toHaveBeenCalled();
  });

  it("creates a default row when the tenant has none yet (never 404s)", async () => {
    prismaMock.brandKit.findUnique.mockResolvedValueOnce(null);
    prismaMock.brandKit.create.mockResolvedValueOnce(defaultKit());
    const app = await buildApp();
    const res = await request(app).get("/brand-kit");
    expect(res.status).toBe(200);
    expect(prismaMock.brandKit.create).toHaveBeenCalledWith({
      data: { tenantId: "tenant-A" },
    });
    expect(res.body.tenantId).toBe("tenant-A");
  });
});

// ── PUT /brand-kit — validation + persist ─────────────────────────────
describe("PUT /brand-kit", () => {
  it("accepts a valid #RRGGBB hex and normalises to lowercase", async () => {
    prismaMock.brandKit.upsert.mockImplementationOnce(async ({ create }) =>
      defaultKit(create),
    );
    const app = await buildApp();
    const res = await request(app)
      .put("/brand-kit")
      .send({ primaryColor: "#ABCDEF" });
    expect(res.status).toBe(200);
    expect(res.body.primaryColor).toBe("#abcdef");
  });

  it("rejects an invalid colour like 'red' with 400", async () => {
    const app = await buildApp();
    const res = await request(app).put("/brand-kit").send({ primaryColor: "red" });
    expect(res.status).toBe(400);
    expect(prismaMock.brandKit.upsert).not.toHaveBeenCalled();
  });

  it("persists social links JSON", async () => {
    const links = {
      twitter: "https://twitter.com/acme",
      linkedin: "https://linkedin.com/company/acme",
    };
    prismaMock.brandKit.upsert.mockImplementationOnce(async ({ create }) =>
      defaultKit(create),
    );
    const app = await buildApp();
    const res = await request(app)
      .put("/brand-kit")
      .send({ socialLinks: links });
    expect(res.status).toBe(200);
    // Confirm the data was actually passed to upsert.
    const arg = prismaMock.brandKit.upsert.mock.calls[0][0];
    expect(arg.create.socialLinks).toEqual(links);
    expect(arg.update.socialLinks).toEqual(links);
  });

  it("rejects a logoAssetId that doesn't belong to the tenant", async () => {
    prismaMock.mediaAsset.findFirst.mockResolvedValueOnce(null);
    const app = await buildApp();
    const res = await request(app)
      .put("/brand-kit")
      .send({ logoAssetId: "asset-from-other-tenant" });
    expect(res.status).toBe(400);
    expect(prismaMock.brandKit.upsert).not.toHaveBeenCalled();
  });

  it("expands a #RGB shorthand to full #RRGGBB", async () => {
    prismaMock.brandKit.upsert.mockImplementationOnce(async ({ create }) =>
      defaultKit(create),
    );
    const app = await buildApp();
    const res = await request(app).put("/brand-kit").send({ accentColor: "#FA0" });
    expect(res.status).toBe(200);
    expect(res.body.accentColor).toBe("#ffaa00");
  });
});

// ── GET /brand-kit/preview.html — HTML content ────────────────────────
describe("GET /brand-kit/preview.html", () => {
  it("returns HTML with the palette colours embedded", async () => {
    prismaMock.brandKit.findUnique.mockResolvedValueOnce(
      defaultKit({ primaryColor: "#123456", accentColor: "#abcdef" }),
    );
    const app = await buildApp();
    const res = await request(app).get("/brand-kit/preview.html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("#123456");
    expect(res.text).toContain("#abcdef");
  });
});
