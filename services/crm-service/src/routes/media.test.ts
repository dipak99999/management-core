import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

// The media router itself hits Prisma (findUnique/create/update/delete) and
// the S3 helpers. Rather than boot a real Postgres + S3 for a unit test, we
// stub `@lumaara/db` + `@lumaara/service-auth` at the module boundary via
// vi.mock — same pattern used by other packages in this monorepo — then
// import the router and drive it with mock Express req/res objects.
//
// The permission middlewares from perms("MediaAsset") short-circuit through
// our mock (they call next() unconditionally). The auth context is injected
// by handing each mock req the required shape.

// ── Module mocks ──────────────────────────────────────────────────────
const dbMock = {
  mediaAsset: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  tenantIntegration: {
    findFirst: vi.fn(),
  },
};

const s3Mock = {
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  presignGetObject: vi.fn().mockReturnValue("https://s3.example/signed"),
  loadS3Config: vi.fn().mockReturnValue({
    accessKeyId: "AKIA",
    secretAccessKey: "SECRET",
    region: "us-east-1",
    bucket: "media",
  }),
  decryptSecrets: vi.fn().mockReturnValue({
    accessKeyId: "AKIA",
    secretAccessKey: "SECRET",
    region: "us-east-1",
    bucket: "media",
  }),
};

vi.mock("@lumaara/db", () => ({
  prisma: dbMock,
  putObject: s3Mock.putObject,
  deleteObject: s3Mock.deleteObject,
  presignGetObject: s3Mock.presignGetObject,
  loadS3Config: s3Mock.loadS3Config,
  decryptSecrets: s3Mock.decryptSecrets,
}));

vi.mock("@lumaara/service-auth", () => ({
  perms: () => ({
    read: (_req: Request, _res: Response, next: () => void) => next(),
    write: (_req: Request, _res: Response, next: () => void) => next(),
    create: (_req: Request, _res: Response, next: () => void) => next(),
    delete: (_req: Request, _res: Response, next: () => void) => next(),
    submit: (_req: Request, _res: Response, next: () => void) => next(),
    cancel: (_req: Request, _res: Response, next: () => void) => next(),
  }),
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import AFTER the mocks — the router file resolves its imports lazily via
// the top-level ESM module graph and would otherwise capture the real ones.
// We do this inside a beforeAll() so the file compiles under CJS target too
// (top-level await would be an error under tsc module=commonjs).
let mediaRouter: import("express").Router;
let extensionFromFilename: (s: string) => string;
let extensionFromContentType: (s: string) => string;
let readImageSize: (b: Buffer, ct: string) => { width: number | null; height: number | null };

beforeAll(async () => {
  const mod = await import("./media");
  mediaRouter = mod.mediaRouter;
  extensionFromFilename = mod.extensionFromFilename;
  extensionFromContentType = mod.extensionFromContentType;
  readImageSize = mod.readImageSize;
});

// ── Test harness — drive the express router without a live server ─────
interface Layer {
  route: {
    path: string;
    stack: Array<{
      method: string;
      handle: (req: Request, res: Response, next: () => void) => void;
    }>;
  };
}

function findHandler(method: string, path: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers = (mediaRouter as any).stack as Layer[];
  const layer = layers.find(
    (l) =>
      l.route?.path === path &&
      l.route?.stack.some((s) => s.method === method.toLowerCase()),
  );
  if (!layer) throw new Error(`No handler for ${method} ${path}`);
  // Compose the middleware chain into a single call. Each middleware calls
  // next(); our mocked perms middlewares always do.
  const handlers = layer.route.stack
    .filter((s) => s.method === method.toLowerCase() || s.method === "_all")
    .map((s) => s.handle);
  return async (req: Partial<Request>, res: Partial<Response>) => {
    let idx = 0;
    const next = () => {
      const h = handlers[idx++];
      if (h) return h(req as Request, res as Response, next);
    };
    await next();
  };
}

function mockRes() {
  const res: Partial<Response> & {
    statusCode: number;
    body: unknown;
    _ended: boolean;
  } = {
    statusCode: 200,
    body: undefined,
    _ended: false,
  };
  res.status = ((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as Response["status"];
  res.json = ((payload: unknown) => {
    res.body = payload;
    res._ended = true;
    return res as Response;
  }) as Response["json"];
  res.end = (() => {
    res._ended = true;
    return res as Response;
  }) as Response["end"];
  return res;
}

function makeReq(over: Partial<Request> = {}): Partial<Request> {
  return {
    auth: { tenantId: "tenant-A", userId: "user-1", roles: [], role: "user" },
    query: {},
    params: {},
    body: {},
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// A 1×1 red PNG (valid header — used by readImageSize + dedup tests).
const RED_PIXEL_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAT2E3PgAAAABJRU5ErkJggg==";
const RED_PIXEL_PNG = Buffer.from(RED_PIXEL_PNG_B64, "base64");

beforeEach(() => {
  // clearAllMocks wipes call history but keeps mock impls. Do NOT use
  // restoreAllMocks in afterEach — on vi.fn() it also wipes the mock impls
  // (mockResolvedValue / mockReturnValue) declared at const-init time, so the
  // NEXT test starts with `loadS3Config()` returning undefined → loadS3ForTenant
  // returns null → the DELETE handler's S3 branch is skipped. We re-declare
  // the s3Mock defaults here to survive per-test overrides safely.
  vi.clearAllMocks();
  s3Mock.putObject.mockResolvedValue(undefined);
  s3Mock.deleteObject.mockResolvedValue(undefined);
  s3Mock.presignGetObject.mockReturnValue("https://s3.example/signed");
  s3Mock.loadS3Config.mockReturnValue({
    accessKeyId: "AKIA",
    secretAccessKey: "SECRET",
    region: "us-east-1",
    bucket: "media",
  });
  s3Mock.decryptSecrets.mockReturnValue({
    accessKeyId: "AKIA",
    secretAccessKey: "SECRET",
    region: "us-east-1",
    bucket: "media",
  });
  // Default: S3 integration IS configured for the tenant.
  dbMock.tenantIntegration.findFirst.mockResolvedValue({
    id: "int-1",
    secrets: { encrypted: "blob" },
  });
});

// ── Helper unit tests (pure functions) ────────────────────────────────

describe("media helpers", () => {
  it("extensionFromFilename picks the last dot-token", () => {
    expect(extensionFromFilename("logo.png")).toBe("png");
    expect(extensionFromFilename("archive.tar.gz")).toBe("gz");
    expect(extensionFromFilename("no-ext")).toBe("");
    expect(extensionFromFilename("UPPER.JPG")).toBe("jpg");
  });

  it("extensionFromContentType maps common MIMEs", () => {
    expect(extensionFromContentType("image/png")).toBe("png");
    expect(extensionFromContentType("image/jpeg")).toBe("jpg");
    expect(extensionFromContentType("application/pdf")).toBe("pdf");
    expect(extensionFromContentType("application/octet-stream")).toBe("");
  });

  it("readImageSize parses a PNG signature", () => {
    const size = readImageSize(RED_PIXEL_PNG, "image/png");
    expect(size).toEqual({ width: 1, height: 1 });
  });

  it("readImageSize returns null/null for non-images", () => {
    const junk = Buffer.from("not an image at all", "utf8");
    expect(readImageSize(junk, "application/pdf")).toEqual({
      width: null,
      height: null,
    });
  });
});

// ── Route: upload (new + dedup) ───────────────────────────────────────

describe("POST /upload", () => {
  it("creates a new MediaAsset row and puts to S3 when sha256 is unseen", async () => {
    dbMock.mediaAsset.findUnique.mockResolvedValueOnce(null);
    dbMock.mediaAsset.create.mockResolvedValueOnce({
      id: "asset-1",
      tenantId: "tenant-A",
      folder: "root",
      filename: "logo.png",
      storageKey: "media/tenant-A/somehash.png",
      contentType: "image/png",
      sizeBytes: RED_PIXEL_PNG.length,
      width: 1,
      height: 1,
      sha256: "somehash",
      uploadedBy: "user-1",
      createdAt: new Date().toISOString(),
    });

    const handler = findHandler("post", "/upload");
    const req = makeReq({
      body: {
        filename: "logo.png",
        contentType: "image/png",
        folder: "root",
        base64: RED_PIXEL_PNG_B64,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(s3Mock.putObject).toHaveBeenCalledTimes(1);
    expect(dbMock.mediaAsset.create).toHaveBeenCalledTimes(1);
    // Storage key must live under the tenant prefix.
    const createArg = dbMock.mediaAsset.create.mock.calls[0][0].data;
    expect(createArg.storageKey.startsWith("media/tenant-A/")).toBe(true);
    expect(createArg.tenantId).toBe("tenant-A");
    expect(createArg.width).toBe(1);
    expect(createArg.height).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).deduped).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).presignedUrl).toBe("https://s3.example/signed");
  });

  it("returns the existing row (200, deduped) when sha256 matches — no new S3 write", async () => {
    dbMock.mediaAsset.findUnique.mockResolvedValueOnce({
      id: "asset-existing",
      tenantId: "tenant-A",
      folder: "logos",
      filename: "logo.png",
      storageKey: "media/tenant-A/somehash.png",
      contentType: "image/png",
      sizeBytes: RED_PIXEL_PNG.length,
      width: 1,
      height: 1,
      sha256: "somehash",
      uploadedBy: "user-1",
      createdAt: new Date().toISOString(),
    });

    const handler = findHandler("post", "/upload");
    const req = makeReq({
      body: {
        filename: "logo.png",
        contentType: "image/png",
        folder: "root",
        base64: RED_PIXEL_PNG_B64,
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(s3Mock.putObject).not.toHaveBeenCalled();
    expect(dbMock.mediaAsset.create).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).id).toBe("asset-existing");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).deduped).toBe(true);
  });

  it("rejects empty body payloads with 400", async () => {
    const handler = findHandler("post", "/upload");
    const req = makeReq({
      body: {
        filename: "empty.txt",
        contentType: "text/plain",
        base64: "",
      },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(s3Mock.putObject).not.toHaveBeenCalled();
  });

  it("rejects when the tenant has no S3 integration", async () => {
    dbMock.mediaAsset.findUnique.mockResolvedValueOnce(null);
    dbMock.tenantIntegration.findFirst.mockResolvedValueOnce(null);
    const handler = findHandler("post", "/upload");
    const req = makeReq({
      body: {
        filename: "logo.png",
        contentType: "image/png",
        base64: RED_PIXEL_PNG_B64,
      },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(s3Mock.putObject).not.toHaveBeenCalled();
  });
});

// ── Route: list ───────────────────────────────────────────────────────

describe("GET / (list)", () => {
  it("filters by folder + search substring and attaches presignedUrl per row", async () => {
    dbMock.mediaAsset.findMany.mockResolvedValueOnce([
      {
        id: "a1",
        tenantId: "tenant-A",
        folder: "logos",
        filename: "acme-logo.png",
        storageKey: "media/tenant-A/aaa.png",
        contentType: "image/png",
        sizeBytes: 100,
        width: 1,
        height: 1,
        sha256: "aaa",
        uploadedBy: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    const handler = findHandler("get", "/");
    const req = makeReq({ query: { folder: "logos", search: "acme" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = res.body as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].presignedUrl).toBe("https://s3.example/signed");

    // Verify the WHERE clause we sent to Prisma.
    const findManyArgs = dbMock.mediaAsset.findMany.mock.calls[0][0];
    expect(findManyArgs.where.tenantId).toBe("tenant-A");
    expect(findManyArgs.where.folder).toBe("logos");
    expect(findManyArgs.where.filename).toEqual({
      contains: "acme",
      mode: "insensitive",
    });
  });
});

// ── Route: rename (PATCH) ─────────────────────────────────────────────

describe("PATCH /:id", () => {
  it("persists filename + folder changes for the tenant's own row", async () => {
    dbMock.mediaAsset.findFirst.mockResolvedValueOnce({
      id: "asset-1",
      tenantId: "tenant-A",
      folder: "root",
      filename: "old.png",
      storageKey: "media/tenant-A/xx.png",
      contentType: "image/png",
      sizeBytes: 10,
      width: 1,
      height: 1,
      sha256: "xx",
      uploadedBy: null,
      createdAt: new Date().toISOString(),
    });
    dbMock.mediaAsset.update.mockResolvedValueOnce({
      id: "asset-1",
      filename: "new-name.png",
      folder: "brand",
      storageKey: "media/tenant-A/xx.png",
      contentType: "image/png",
      sizeBytes: 10,
      width: 1,
      height: 1,
      sha256: "xx",
      tenantId: "tenant-A",
      uploadedBy: null,
      createdAt: new Date().toISOString(),
    });
    const handler = findHandler("patch", "/:id");
    const req = makeReq({
      params: { id: "asset-1" },
      body: { filename: "new-name.png", folder: "brand" },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(dbMock.mediaAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: { filename: "new-name.png", folder: "brand" },
    });
  });

  it("404s when the row is on a different tenant", async () => {
    dbMock.mediaAsset.findFirst.mockResolvedValueOnce(null);
    const handler = findHandler("patch", "/:id");
    const req = makeReq({
      params: { id: "asset-1" },
      body: { filename: "x" },
    });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(404);
    expect(dbMock.mediaAsset.update).not.toHaveBeenCalled();
  });
});

// ── Route: delete ─────────────────────────────────────────────────────

describe("DELETE /:id", () => {
  it("removes both the DB row and the S3 object", async () => {
    dbMock.mediaAsset.findFirst.mockResolvedValueOnce({
      id: "asset-1",
      tenantId: "tenant-A",
      storageKey: "media/tenant-A/xx.png",
    });
    dbMock.mediaAsset.delete.mockResolvedValueOnce({});
    const handler = findHandler("delete", "/:id");
    const req = makeReq({ params: { id: "asset-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(s3Mock.deleteObject).toHaveBeenCalledWith(
      expect.anything(),
      "media/tenant-A/xx.png",
    );
    expect(dbMock.mediaAsset.delete).toHaveBeenCalledWith({
      where: { id: "asset-1" },
    });
  });

  it("still deletes the DB row when S3 delete fails (best-effort)", async () => {
    dbMock.mediaAsset.findFirst.mockResolvedValueOnce({
      id: "asset-1",
      tenantId: "tenant-A",
      storageKey: "media/tenant-A/xx.png",
    });
    s3Mock.deleteObject.mockRejectedValueOnce(new Error("S3 down"));
    dbMock.mediaAsset.delete.mockResolvedValueOnce({});
    const handler = findHandler("delete", "/:id");
    const req = makeReq({ params: { id: "asset-1" } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(dbMock.mediaAsset.delete).toHaveBeenCalled();
  });
});

// ── Route: folders ────────────────────────────────────────────────────

describe("GET /folders", () => {
  it("returns distinct folders and ensures 'root' is always present", async () => {
    dbMock.mediaAsset.findMany.mockResolvedValueOnce([
      { folder: "logos" },
      { folder: "product-images" },
    ]);
    const handler = findHandler("get", "/folders");
    const req = makeReq();
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = res.body as string[];
    expect(list).toContain("root");
    expect(list).toContain("logos");
    expect(list).toContain("product-images");
  });
});
