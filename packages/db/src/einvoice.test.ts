// Set the master key BEFORE importing modules that snapshot it at load time.
process.env.MASTER_SECRET_KEY = "b".repeat(64);

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  _clearIrpAdapterCache,
  buildEinvoicePayload,
  getIrpAdapter,
  type EinvoicePayload,
  type IrpCredentials,
} from "./einvoice";
import { encryptSecrets } from "./secrets-crypto";

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

const seller = { gstin: "27AAAPL1234C1ZV", legalName: "Acme Seller Pvt Ltd" };

function fixture(customerGstin: string | null) {
  return {
    id: "si-1",
    name: "SINV-0001",
    postingDate: new Date("2026-03-15T10:00:00.000Z"),
    isReturn: false,
    grandTotal: dec(1180),
    netTotal: dec(1000),
    customer: { customerName: "Buyer Ltd", gstin: customerGstin },
    items: [
      {
        qty: dec(2),
        rate: dec(500),
        amount: dec(1000),
        item: { itemName: "Widget", hsnCode: "8471" },
      },
    ],
    taxes: [{ taxAmount: dec(180), rate: dec(18) }],
  };
}

describe("buildEinvoicePayload", () => {
  it("intra-state → splits tax into CGST + SGST, zero IGST", () => {
    // Both GSTINs start with '27' → same state → intra
    const p = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    expect(p.totals.igstValue).toBe(0);
    expect(p.totals.cgstValue).toBe(90);
    expect(p.totals.sgstValue).toBe(90);
    expect(p.document.supplyType).toBe("B2B");
    expect(p.document.docType).toBe("INV");
    expect(p.document.docDate).toBe("15/03/2026");
  });

  it("inter-state → all tax to IGST", () => {
    const p = buildEinvoicePayload(fixture("29XYZAB4567C1ZV"), seller);
    expect(p.totals.igstValue).toBe(180);
    expect(p.totals.cgstValue).toBe(0);
    expect(p.totals.sgstValue).toBe(0);
  });

  it("B2C when buyer has no GSTIN", () => {
    const p = buildEinvoicePayload(fixture(null), seller);
    expect(p.document.supplyType).toBe("B2C");
    expect(p.buyer.gstin).toBeNull();
    // No buyer state code → treated as intra-state (no IGST split)
    expect(p.totals.igstValue).toBe(0);
  });
});

describe("stub IRP adapter", () => {
  // Stub mode doesn't touch prisma — pass any object; tenantId is only
  // consulted for live-mode integration lookup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakePrisma = {} as any;

  it("returns a deterministic IRN for the same payload", async () => {
    const adapter = await getIrpAdapter(fakePrisma, "t1");
    const payload: EinvoicePayload = buildEinvoicePayload(fixture("27A1"), seller);
    const r1 = await adapter.generate(payload);
    const r2 = await adapter.generate(payload);
    expect(r1.irn).toEqual(r2.irn);
    expect(r1.irn).toMatch(/^[0-9a-f]{64}$/);
  });

  it("QR payload has JWS-like three-segment shape", async () => {
    const adapter = await getIrpAdapter(fakePrisma, "t1");
    const payload = buildEinvoicePayload(fixture("27A1"), seller);
    const r = await adapter.generate(payload);
    const parts = r.qrPayload.split(".");
    expect(parts).toHaveLength(3);
    // Middle segment is base64url-encoded JSON claims
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    expect(claims.DocNo).toBe("SINV-0001");
    expect(claims.Irn).toBe(r.irn);
  });

  it("cancel is a no-op that reports ok", async () => {
    const adapter = await getIrpAdapter(fakePrisma, "t1");
    const r = await adapter.cancel("dead".repeat(16), "test");
    expect(r.ok).toBe(true);
  });
});

describe("live IRP adapter (mocked fetch)", () => {
  let originalEnv: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  const creds: IrpCredentials = {
    endpoint: "https://gsp.example/v1.03",
    clientId: "cid",
    clientSecret: "csecret",
    username: "uname",
    password: "pw",
    gstin: "27AAAPL1234C1ZV",
  };

  // getIrpAdapter now does a 2-query cache-invalidation pattern:
  //   1. findFirst({select: {id, updatedAt}}) — cheap "is my cache stale?"
  //   2. findUnique({where: {id}}) — full row read only on miss/change
  // So tests must mock BOTH. The mock always returns a fresh copy so
  // per-test drift can be simulated by overriding integ.updatedAt.
  function fakePrismaWithIntegration(integ: unknown) {
    const head = integ
      ? {
          id: "integ-1",
          updatedAt: new Date("2026-08-26T00:00:00Z"),
        }
      : null;
    const full = integ
      ? { ...(integ as object), id: "integ-1", updatedAt: head!.updatedAt }
      : null;
    return {
      tenantIntegration: {
        findFirst: vi.fn().mockResolvedValue(head),
        findUnique: vi.fn().mockResolvedValue(full),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    originalEnv = process.env.EINVOICE_ADAPTER;
    process.env.EINVOICE_ADAPTER = "live";
    _clearIrpAdapterCache();
    fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      if (String(url).endsWith("/auth")) {
        return new Response(
          JSON.stringify({ token: "tok-abc", expiresIn: 21600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/invoice")) {
        return new Response(
          JSON.stringify({
            irn: "abc123def456",
            ackNo: "ACK-42",
            ackDate: "2026-08-26T10:00:00.000Z",
            signedQRCode: "hdr.claims.sig",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).endsWith("/cancel")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("nope", { status: 404 });
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.EINVOICE_ADAPTER;
    else process.env.EINVOICE_ADAPTER = originalEnv;
    fetchSpy.mockRestore();
    _clearIrpAdapterCache();
  });

  it("fetches token then generates via /invoice endpoint", async () => {
    const integ = {
      config: { gspProvider: "generic" },
      secrets: encryptSecrets(creds as unknown as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    const adapter = await getIrpAdapter(prisma, "t1");
    const payload = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    const r = await adapter.generate(payload);
    expect(r.irn).toBe("abc123def456");
    expect(r.ackNo).toBe("ACK-42");
    expect(r.qrPayload).toBe("hdr.claims.sig");
    // /auth called first, then /invoice
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/auth");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/invoice");
  });

  it("caches the token — subsequent generate reuses it (no re-auth)", async () => {
    const integ = {
      config: {},
      secrets: encryptSecrets(creds as unknown as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    const adapter = await getIrpAdapter(prisma, "t1");
    const payload = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    await adapter.generate(payload);
    await adapter.generate(payload);
    // 1 auth + 2 invoices = 3 fetches
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("caches the adapter per tenant — findUnique skipped on cache hit", async () => {
    const integ = {
      config: {},
      secrets: encryptSecrets(creds as unknown as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    await getIrpAdapter(prisma, "t1");
    await getIrpAdapter(prisma, "t1");
    // findFirst runs on EVERY call (cache-freshness check). findUnique only
    // on cache miss / integration edit → so exactly 1 call.
    expect(prisma.tenantIntegration.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.tenantIntegration.findUnique).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache when TenantIntegration.updatedAt changes", async () => {
    const integ = {
      config: {},
      secrets: encryptSecrets(creds as unknown as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    await getIrpAdapter(prisma, "t1");
    // Simulate admin editing the integration — updatedAt bumps.
    prisma.tenantIntegration.findFirst.mockResolvedValue({
      id: "integ-1",
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    prisma.tenantIntegration.findUnique.mockResolvedValue({
      ...integ,
      id: "integ-1",
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    await getIrpAdapter(prisma, "t1");
    // Both calls trigger a findUnique because the cached updatedAt no
    // longer matches the head read.
    expect(prisma.tenantIntegration.findUnique).toHaveBeenCalledTimes(2);
  });

  it("falls back to stub when no integration row exists", async () => {
    const prisma = fakePrismaWithIntegration(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = await getIrpAdapter(prisma, "t2");
    const payload = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    const r = await adapter.generate(payload);
    // Stub → deterministic 64-hex IRN, no fetch.
    expect(r.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to stub when secrets are missing required fields", async () => {
    const integ = {
      config: {},
      secrets: encryptSecrets({ endpoint: "x" } as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = await getIrpAdapter(prisma, "t3");
    const payload = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    const r = await adapter.generate(payload);
    expect(r.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchSpy).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws when the GSP /auth returns non-2xx", async () => {
    fetchSpy.mockRestore();
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("bad creds", { status: 401 }));
    const integ = {
      config: {},
      secrets: encryptSecrets(creds as unknown as Record<string, unknown>),
    };
    const prisma = fakePrismaWithIntegration(integ);
    const adapter = await getIrpAdapter(prisma, "t4");
    const payload = buildEinvoicePayload(fixture("27ABCDE1234C1ZV"), seller);
    await expect(adapter.generate(payload)).rejects.toThrow(/IRP auth failed/);
  });
});
