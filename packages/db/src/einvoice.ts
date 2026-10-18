import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { decryptSecrets } from "./secrets-crypto";

// GST India e-invoice (IRP) integration.
//
// Two adapters ship:
//   * StubIrpAdapter (default) — deterministic sha256(payload) IRN, no
//     network call. Keeps tests + design-partner demos green when no live
//     GSTN credentials are configured.
//   * LiveIrpAdapter — REST client against a GSP (GST Suvidha Provider)
//     that fronts the NIC IRP. Most SMEs use one of Cygnet, IRIS, Masters
//     India, ClearTax, or TaxPro. Direct-to-NIC requires per-tenant
//     public-key encryption of the app password + is fiddly enough that
//     we route everything through a GSP layer.
//
// Selection precedence per invoice generate:
//   1. `EINVOICE_ADAPTER` env — must be "live" to attempt a live call.
//   2. Tenant must have an active TenantIntegration row with provider="irp".
//   3. That row's `secrets` (encrypted) must decrypt to a well-shaped
//      IrpCredentials bag.
//   4. Any of the above missing → StubIrpAdapter (with a log warning in
//      "live" mode so operators can spot missing config).
//
// TenantIntegration.secrets shape (encrypted at rest via encryptSecrets):
//   {
//     endpoint: "https://api.<gsp>.com/v1.03",  // GSP base URL
//     clientId: "...",     // GSP-issued
//     clientSecret: "...", // GSP-issued
//     username: "...",     // GSTN portal username
//     password: "...",     // GSTN portal password
//     gstin: "27ABCDE1234F1Z5"  // seller GSTIN (may differ from Tenant.companyGstin
//                                 // for multi-branch tenants)
//   }
//
// TenantIntegration.config shape (plaintext):
//   { gspProvider: "cygnet" | "iris" | "generic" }

export interface IrpAdapter {
  generate(payload: EinvoicePayload): Promise<IrnResponse>;
  cancel(irn: string, reason: string): Promise<{ ok: boolean }>;
}

export interface IrnResponse {
  irn: string;
  ackNo: string;
  ackDate: Date;
  qrPayload: string;
}

// Minimal payload — the real IRP schema has 200+ fields. What's included:
// seller GSTIN, buyer info, line items (with HSN + qty + rate), and totals.
// The stub adapter only reads the deterministic fields to compute the hash.
export interface EinvoicePayload {
  version: "1.1";
  seller: { gstin: string; legalName: string; stateCode: string };
  buyer: {
    gstin: string | null;
    legalName: string;
    stateCode: string;
  };
  document: {
    supplyType: "B2B" | "B2C" | "SEZWP" | "SEZWOP" | "EXPWP" | "EXPWOP" | "DEXP";
    docType: "INV" | "CRN" | "DBN";
    docNo: string;
    docDate: string; // DD/MM/YYYY (IRP format)
  };
  itemList: EinvoiceLine[];
  totals: {
    taxableValue: number;
    igstValue: number;
    cgstValue: number;
    sgstValue: number;
    grandTotal: number;
  };
}

export interface EinvoiceLine {
  slNo: string;
  itemDescription: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
  taxableValue: number;
  gstRate: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
}

type SiForEinvoice = {
  id: string;
  name: string;
  postingDate: Date;
  isReturn: boolean;
  grandTotal: Prisma.Decimal | number;
  netTotal: Prisma.Decimal | number;
  customer: {
    customerName: string;
    gstin: string | null;
  };
  items: Array<{
    qty: Prisma.Decimal | number;
    rate: Prisma.Decimal | number;
    amount: Prisma.Decimal | number;
    item: { itemName: string; hsnCode?: string | null };
  }>;
  taxes: Array<{
    taxAmount: Prisma.Decimal | number;
    rate: Prisma.Decimal | number;
  }>;
};

// Extract 2-digit state code from GSTIN (positions 0-1 in the 15-char GSTIN).
function stateCodeFromGstin(gstin: string | null | undefined): string {
  if (!gstin || gstin.length < 2) return "";
  return gstin.slice(0, 2);
}

// Format Date → DD/MM/YYYY (IRP spec).
function irpDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function buildEinvoicePayload(
  si: SiForEinvoice,
  seller: { gstin: string; legalName: string },
): EinvoicePayload {
  const sellerState = stateCodeFromGstin(seller.gstin);
  const buyerState = stateCodeFromGstin(si.customer.gstin);
  const interstate = !!buyerState && buyerState !== sellerState;
  const supplyType = si.customer.gstin ? "B2B" : "B2C";
  const docType = si.isReturn ? "CRN" : "INV";

  const itemList: EinvoiceLine[] = si.items.map((line, idx) => {
    const qty = Number(line.qty);
    const rate = Number(line.rate);
    const amount = Number(line.amount);
    // Naive per-line tax attribution — divide invoice totals proportionally
    // by line taxable value. Real IRP filings must carry per-line GST
    // computed at source; caller can supply richer data if available.
    return {
      slNo: String(idx + 1),
      itemDescription: line.item.itemName,
      hsnCode: line.item.hsnCode ?? "",
      quantity: qty,
      unit: "NOS",
      unitPrice: rate,
      totalAmount: amount,
      taxableValue: amount,
      gstRate: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
    };
  });

  const totalTax = si.taxes.reduce((s, t) => s + Number(t.taxAmount), 0);
  const igst = interstate ? totalTax : 0;
  const cgst = interstate ? 0 : totalTax / 2;
  const sgst = interstate ? 0 : totalTax / 2;

  return {
    version: "1.1",
    seller: {
      gstin: seller.gstin,
      legalName: seller.legalName,
      stateCode: sellerState,
    },
    buyer: {
      gstin: si.customer.gstin,
      legalName: si.customer.customerName,
      stateCode: buyerState,
    },
    document: {
      supplyType,
      docType,
      docNo: si.name,
      docDate: irpDate(si.postingDate),
    },
    itemList,
    totals: {
      taxableValue: Number(si.netTotal),
      igstValue: igst,
      cgstValue: cgst,
      sgstValue: sgst,
      grandTotal: Number(si.grandTotal),
    },
  };
}

// Live GSP adapter. Every GSP has slightly different endpoint paths, auth
// request/response shapes, and per-header conventions. Rather than one
// monolithic class, we express each GSP as a `GspShape` — a small config
// object the shared LiveIrpAdapter reads. Adding a new GSP is one bag of
// path strings + optional shape mappers.
//
// SUPPORTED (this file):
//   * "generic"  Reference/default shape. Assumes plain REST paths /auth,
//                /invoice, /cancel. Use as a template when onboarding an
//                unlisted GSP.
//   * "cygnet"   Cygnet GSP (India). Paths under /eivital + /eicore per
//                their published sandbox docs; auth accepts the tenant's
//                username/password as `user_name`/`password`, returns
//                `AuthToken`/`Sek`. NOT YET SANDBOX-TESTED — the shape is
//                documented but the endpoints have not been called against
//                Cygnet's sandbox. Verify + adjust when onboarding a real
//                Cygnet customer.
//
// If you're onboarding IRIS / ClearTax / TaxPro / Masters India, copy the
// Cygnet shape as a template, adjust paths + field names to match the GSP's
// docs, and add the new entry to GSP_SHAPES.

export interface IrpCredentials {
  endpoint: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  gstin: string;
}

export interface IrpConfig {
  gspProvider?: string; // "generic" (default) | "cygnet"
}

// Per-GSP shape descriptor. Kept small on purpose — anything requiring
// non-trivial payload transformation should override with a full custom
// class (subclass LiveIrpAdapter, replace ensureToken/generate/cancel).
interface GspShape {
  authPath: string;
  invoicePath: string;
  cancelPath: string;
  // Build the auth body. Different GSPs use different field names
  // (clientId vs client_id vs App_Key, username vs user_name, etc.).
  buildAuthBody: (creds: IrpCredentials) => Record<string, unknown>;
  // Parse the auth response. Return { token, expiresIn } — expiresIn in
  // seconds (defaults to 5h on the caller side when omitted).
  parseAuthResponse: (data: unknown) => { token: string; expiresIn?: number };
  // Optional extra headers the invoice/cancel request needs. Called with
  // the current bearer token so a GSP that also wants token in a header
  // instead of `Authorization: Bearer` can override.
  buildAuthedHeaders: (
    token: string,
    creds: IrpCredentials,
  ) => Record<string, string>;
  // Parse the generate response. Field names vary heavily — Cygnet returns
  // Irn/AckNo/AckDt/SignedQRCode; a generic returns snake_case; some wrap
  // everything in a Data envelope.
  parseGenerateResponse: (data: unknown) => IrnResponse;
  // Body for the cancel call.
  buildCancelBody: (irn: string, reason: string) => Record<string, unknown>;
}

const GENERIC_SHAPE: GspShape = {
  authPath: "/auth",
  invoicePath: "/invoice",
  cancelPath: "/cancel",
  buildAuthBody: (c) => ({
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    username: c.username,
    password: c.password,
    gstin: c.gstin,
  }),
  parseAuthResponse: (data) => {
    const d = data as { token?: string; expiresIn?: number };
    if (!d.token) throw new Error("IRP auth response missing token");
    return { token: d.token, expiresIn: d.expiresIn };
  },
  buildAuthedHeaders: (token, creds) => ({
    authorization: `Bearer ${token}`,
    "x-gstin": creds.gstin,
  }),
  parseGenerateResponse: (data) => {
    const d = data as {
      irn?: string;
      ackNo?: string;
      ackDate?: string;
      signedQRCode?: string;
      qrPayload?: string;
    };
    if (!d.irn || !d.ackNo || !d.ackDate) {
      throw new Error(
        `IRP generate response missing required fields: ${JSON.stringify(d).slice(0, 200)}`,
      );
    }
    return {
      irn: d.irn,
      ackNo: d.ackNo,
      ackDate: new Date(d.ackDate),
      qrPayload: d.signedQRCode ?? d.qrPayload ?? "",
    };
  },
  buildCancelBody: (irn, reason) => ({
    irn,
    cancelReason: "4",
    cancelRemarks: reason.slice(0, 100),
  }),
};

// Cygnet shape — based on their published sandbox API doc conventions.
// NOT YET tested against a real sandbox; verify field names + paths when
// onboarding. Auth: POST /eivital/v1.04/auth returning {AuthToken, Sek,
// TokenExpiry}. Generate: POST /eicore/v1.03/Invoice. Cancel:
// POST /eicore/v1.03/Invoice/Cancel. Cygnet expects `App_Key + App_Secret`
// header pair on every subsequent call in addition to the bearer.
const CYGNET_SHAPE: GspShape = {
  authPath: "/eivital/v1.04/auth",
  invoicePath: "/eicore/v1.03/Invoice",
  cancelPath: "/eicore/v1.03/Invoice/Cancel",
  buildAuthBody: (c) => ({
    action: "ACCESSTOKEN",
    username: c.username,
    password: c.password,
    app_key: c.clientId,
    force_refresh_access_token: "N",
  }),
  parseAuthResponse: (data) => {
    // Cygnet returns { Status: 1, Data: { AuthToken, Sek, TokenExpiry } }
    const d = data as {
      Status?: number;
      Data?: { AuthToken?: string; TokenExpiry?: string | number };
      ErrorDetails?: unknown;
    };
    if (d.Status !== 1 || !d.Data?.AuthToken) {
      throw new Error(
        `Cygnet auth failed: ${JSON.stringify(d.ErrorDetails ?? d).slice(0, 200)}`,
      );
    }
    // TokenExpiry may be a date string or seconds — normalize to expiresIn seconds.
    let expiresIn: number | undefined;
    if (typeof d.Data.TokenExpiry === "number") {
      expiresIn = d.Data.TokenExpiry;
    } else if (typeof d.Data.TokenExpiry === "string") {
      const t = Date.parse(d.Data.TokenExpiry);
      if (!Number.isNaN(t)) expiresIn = Math.floor((t - Date.now()) / 1000);
    }
    return { token: d.Data.AuthToken, expiresIn };
  },
  buildAuthedHeaders: (token, creds) => ({
    authorization: `Bearer ${token}`,
    gstin: creds.gstin,
    user_name: creds.username,
    app_key: creds.clientId,
  }),
  parseGenerateResponse: (data) => {
    // Cygnet: { Status: 1, Data: { Irn, AckNo, AckDt, SignedQRCode, ... } }
    const d = data as {
      Status?: number;
      Data?: {
        Irn?: string;
        AckNo?: string | number;
        AckDt?: string;
        SignedQRCode?: string;
      };
      ErrorDetails?: unknown;
    };
    if (d.Status !== 1 || !d.Data?.Irn || !d.Data.AckNo || !d.Data.AckDt) {
      throw new Error(
        `Cygnet generate failed: ${JSON.stringify(d.ErrorDetails ?? d).slice(0, 200)}`,
      );
    }
    return {
      irn: d.Data.Irn,
      ackNo: String(d.Data.AckNo),
      ackDate: new Date(d.Data.AckDt),
      qrPayload: d.Data.SignedQRCode ?? "",
    };
  },
  buildCancelBody: (irn, reason) => ({
    Irn: irn,
    CnlRsn: "4",
    CnlRem: reason.slice(0, 100),
  }),
};

const GSP_SHAPES: Record<string, GspShape> = {
  generic: GENERIC_SHAPE,
  cygnet: CYGNET_SHAPE,
};

function resolveShape(provider: string | undefined): GspShape {
  const key = (provider ?? "generic").toLowerCase();
  return GSP_SHAPES[key] ?? GENERIC_SHAPE;
}

class LiveIrpAdapter implements IrpAdapter {
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private readonly shape: GspShape;

  constructor(
    private readonly creds: IrpCredentials,
    private readonly config: IrpConfig,
  ) {
    this.shape = resolveShape(config.gspProvider);
  }

  private async ensureToken(): Promise<string> {
    // Refresh 60s before expiry so we don't race a stale token.
    if (this.token && this.tokenExpiresAt > Date.now() + 60_000) {
      return this.token;
    }
    const url = `${this.creds.endpoint.replace(/\/$/, "")}${this.shape.authPath}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.shape.buildAuthBody(this.creds)),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 400);
      throw new Error(`IRP auth failed (${r.status}): ${body}`);
    }
    const parsed = this.shape.parseAuthResponse(await r.json());
    this.token = parsed.token;
    this.tokenExpiresAt = Date.now() + (parsed.expiresIn ?? 5 * 3600) * 1000;
    return this.token;
  }

  async generate(payload: EinvoicePayload): Promise<IrnResponse> {
    const token = await this.ensureToken();
    const url = `${this.creds.endpoint.replace(/\/$/, "")}${this.shape.invoicePath}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.shape.buildAuthedHeaders(token, this.creds),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 800);
      throw new Error(`IRP generate failed (${r.status}): ${body}`);
    }
    return this.shape.parseGenerateResponse(await r.json());
  }

  async cancel(irn: string, reason: string): Promise<{ ok: boolean }> {
    const token = await this.ensureToken();
    const url = `${this.creds.endpoint.replace(/\/$/, "")}${this.shape.cancelPath}`;
    // GSTN cancel reason codes: 1=Duplicate, 2=Data entry error,
    // 3=Order cancelled, 4=Other. Shape decides the field names.
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.shape.buildAuthedHeaders(token, this.creds),
      },
      body: JSON.stringify(this.shape.buildCancelBody(irn, reason)),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 400);
      throw new Error(`IRP cancel failed (${r.status}): ${body}`);
    }
    return { ok: true };
  }
}

// Factory used by the cached getIrpAdapter path. Kept as a function (not
// `new LiveIrpAdapter`) so future dispatch could return an entirely
// different class per gspProvider (e.g., a direct-to-NIC adapter that
// bypasses the GSP layer).
function buildLiveAdapter(creds: IrpCredentials, config: IrpConfig): LiveIrpAdapter {
  return new LiveIrpAdapter(creds, config);
}

// Deterministic stub adapter — no network call. Produces a 64-char hex IRN
// = sha256(payload_canonical), a random-looking ackNo, and a QR payload that
// is the JWS-like `<header>.<claims>.<sig>` shape the real IRP returns.
class StubIrpAdapter implements IrpAdapter {
  async generate(payload: EinvoicePayload): Promise<IrnResponse> {
    const canonical = JSON.stringify(payload);
    const irn = createHash("sha256").update(canonical).digest("hex");
    const ackNo = randomBytes(6).toString("hex").toUpperCase();
    const ackDate = new Date();
    // JWS-shaped QR payload (header.claims.sig) — matches the real IRP
    // return shape so downstream QR decoders don't need a special-case.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const claims = Buffer.from(
      JSON.stringify({
        SellerGstin: payload.seller.gstin,
        BuyerGstin: payload.buyer.gstin ?? "",
        DocNo: payload.document.docNo,
        DocTyp: payload.document.docType,
        DocDt: payload.document.docDate,
        TotInvVal: payload.totals.grandTotal,
        Irn: irn,
        IrnDt: ackDate.toISOString(),
      }),
    ).toString("base64url");
    const qrPayload = `${header}.${claims}.stub-signature`;
    return { irn, ackNo, ackDate, qrPayload };
  }
  async cancel(_irn: string, _reason: string): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

const sharedStub = new StubIrpAdapter();

// Cache LiveIrpAdapter per tenant so we don't re-decrypt secrets on every
// call. Auto-invalidates on integration edit by comparing the cached row's
// `updatedAt` against the live DB row on every getIrpAdapter call. The
// comparison is a tiny indexed read (one row by id + tenantId), so the
// throughput cost is negligible vs. the correctness win.
interface CachedAdapter {
  adapter: LiveIrpAdapter;
  integrationId: string;
  updatedAt: Date;
}
const liveAdapterCache = new Map<string, CachedAdapter>();

/**
 * Return the IRP adapter to use for this tenant. Falls back to StubIrpAdapter
 * when EINVOICE_ADAPTER !== "live" or when the tenant has no active IRP
 * integration configured.
 *
 * When live mode is enabled AND the tenant has no IRP integration, we log
 * a warning + return the stub — the invoice generation flow doesn't break,
 * but the IRN is fake. Operators grep logs for `[einvoice] no live` to spot
 * misconfigured tenants.
 */
// Thrown when IRP generation is attempted in prod with no live integration.
// Routes should catch + return 503 so the invoice is NOT persisted with a
// fake IRN. In dev the stub still runs so onboarding flows don't crash.
export class NoIrpAdapterError extends Error {
  constructor(tenantId: string, reason: string) {
    super(
      `E-Invoicing (IRP) not configured for tenant ${tenantId}: ${reason}. Wire up the IRP integration in Settings → Integrations before generating e-invoices.`,
    );
    this.name = "NoIrpAdapterError";
  }
}

// Returns true when we're allowed to silently fall back to the stub.
// Dev + CI get the stub so flows work pre-integration; prod hard-fails
// unless EINVOICE_ALLOW_STUB=1 is explicitly opted in.
function stubFallbackAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.EINVOICE_ALLOW_STUB === "1";
}

export async function getIrpAdapter(
  prisma: PrismaClient,
  tenantId: string,
): Promise<IrpAdapter> {
  const mode = process.env.EINVOICE_ADAPTER ?? "stub";
  if (mode !== "live") {
    if (stubFallbackAllowed()) return sharedStub;
    throw new NoIrpAdapterError(tenantId, "EINVOICE_ADAPTER is not 'live' and stub fallback is disabled in production");
  }

  // Always read the current integration's identity + updatedAt so the cache
  // can auto-invalidate when the admin edits the credentials. Reads only
  // id/updatedAt/isDefault — no secrets decrypt on the fast path.
  const integHead = await prisma.tenantIntegration.findFirst({
    where: { tenantId, provider: "irp", isActive: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: { id: true, updatedAt: true },
  });
  if (!integHead) {
    if (!stubFallbackAllowed()) {
      throw new NoIrpAdapterError(tenantId, "no active IRP TenantIntegration row");
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[einvoice] no live IRP integration for tenant ${tenantId} — falling back to stub`,
    );
    return sharedStub;
  }

  const cached = liveAdapterCache.get(tenantId);
  if (
    cached &&
    cached.integrationId === integHead.id &&
    cached.updatedAt.getTime() === integHead.updatedAt.getTime()
  ) {
    return cached.adapter;
  }

  // Cache miss OR integration edited — rebuild.
  const integ = await prisma.tenantIntegration.findUnique({
    where: { id: integHead.id },
  });
  if (!integ) {
    if (!stubFallbackAllowed()) throw new NoIrpAdapterError(tenantId, "integration deleted between reads");
    return sharedStub;
  }

  let creds: IrpCredentials;
  try {
    creds = decryptSecrets(integ.secrets as unknown as Prisma.JsonValue) as unknown as IrpCredentials;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(
      `[einvoice] failed to decrypt IRP secrets for tenant ${tenantId}:`,
      e instanceof Error ? e.message : e,
    );
    if (!stubFallbackAllowed()) throw new NoIrpAdapterError(tenantId, "integration secrets could not be decrypted");
    return sharedStub;
  }
  if (!creds?.endpoint || !creds?.clientId || !creds?.username || !creds?.gstin) {
    // eslint-disable-next-line no-console
    console.warn(
      `[einvoice] IRP secrets for tenant ${tenantId} missing required fields`,
    );
    if (!stubFallbackAllowed()) throw new NoIrpAdapterError(tenantId, "integration secrets missing endpoint/clientId/username/gstin");
    return sharedStub;
  }

  const config = (integ.config as unknown as IrpConfig) ?? {};
  const adapter = buildLiveAdapter(creds, config);
  liveAdapterCache.set(tenantId, {
    adapter,
    integrationId: integ.id,
    updatedAt: integ.updatedAt,
  });
  return adapter;
}

/**
 * Test-only escape hatch for bust-the-cache scenarios.
 *
 * Refuses to run in production so a runtime caller can't accidentally
 * trigger a token-fetch storm across every tenant. Real cache invalidation
 * on integration edit happens automatically via TenantIntegration.updatedAt
 * version check in getIrpAdapter — see below.
 */
export function _clearIrpAdapterCache(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "_clearIrpAdapterCache is test-only. Use TenantIntegration edit to invalidate cache in production.",
    );
  }
  liveAdapterCache.clear();
}

// Convenience: full generate-and-persist flow. Callers pass the SI id +
// prisma client + resolved seller GSTIN/legal name (typically from Tenant).
export async function generateAndStoreIrn(
  prisma: PrismaClient,
  siId: string,
  tenantId: string,
): Promise<{ ok: boolean; irn?: string; error?: string }> {
  const tenant = await prisma.tenant.findFirst({ where: { id: tenantId } });
  if (!tenant?.companyGstin)
    return { ok: false, error: "Tenant companyGstin not set" };

  const si = await prisma.salesInvoice.findFirst({
    where: { id: siId, tenantId },
    include: {
      customer: { select: { customerName: true, gstin: true } },
      items: {
        include: { item: { select: { itemName: true, hsnCode: true } } },
      },
      taxes: true,
    },
  });
  if (!si) return { ok: false, error: "SalesInvoice not found" };
  if (si.status !== "Submitted" && si.status !== "Paid")
    return { ok: false, error: "SI must be submitted before IRN generation" };
  if (si.irn && si.irnStatus === "Generated") {
    // Already generated — return the existing IRN. Prevents duplicate calls
    // to the live IRP, which would be rejected with "IRN already exists"
    // (error 2150). Callers that want to force re-issue must cancel first.
    return { ok: true, irn: si.irn };
  }

  const payload = buildEinvoicePayload(si, {
    gstin: tenant.companyGstin,
    legalName: tenant.name,
  });
  try {
    const adapter = await getIrpAdapter(prisma, tenantId);
    const r = await adapter.generate(payload);
    await prisma.salesInvoice.update({
      where: { id: si.id },
      data: {
        irn: r.irn,
        irnQrPayload: r.qrPayload,
        irnAckNo: r.ackNo,
        irnAckDate: r.ackDate,
        irnStatus: "Generated",
        irnLastError: null,
      },
    });
    return { ok: true, irn: r.irn };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    await prisma.salesInvoice.update({
      where: { id: si.id },
      data: { irnStatus: "Failed", irnLastError: msg.slice(0, 500) },
    });
    return { ok: false, error: msg };
  }
}

export async function cancelStoredIrn(
  prisma: PrismaClient,
  siId: string,
  tenantId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const si = await prisma.salesInvoice.findFirst({
    where: { id: siId, tenantId },
    select: { irn: true, irnStatus: true },
  });
  if (!si?.irn) return { ok: false, error: "No IRN to cancel" };
  if (si.irnStatus === "Cancelled") return { ok: true };
  try {
    const adapter = await getIrpAdapter(prisma, tenantId);
    await adapter.cancel(si.irn, reason);
    await prisma.salesInvoice.update({
      where: { id: siId },
      data: { irnStatus: "Cancelled" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
}
