// Marketing P3 — Social OAuth + publish route tests.
//
// Coverage (per plan):
//   * OAuth start returns a well-formed URL per platform (LinkedIn, FB, IG, X).
//   * OAuth callback exchanges code, creates SocialAccount + upserts encrypted
//     TenantIntegration row.
//   * Publish LinkedIn: adapter called with correct body, returns
//     platformPostId → row updated.
//   * Publish 4xx path: SocialPostResult status=Failed with error message.
//   * Batch /posts/process: Scheduled+due published; unscheduled untouched.
//   * Token refresh triggered when < 5min to expiry.
//   * Engagement refresh: mock adapter returns metrics, row counters updated.
//
// Approach:
//   * Full @lumaara/db mock (matches the whatsapp.test.ts pattern) so no
//     Postgres and no HTTP calls happen. The adapters are wired through
//     `getSocialAdapter` which is mocked to return per-platform stub
//     objects — real network calls never fire.
//   * `signState` / `verifyState` from social-oauth are not exported; we
//     round-trip through the JWT layer by minting a token here with the
//     same secret + payload shape so we can drive /callback in tests.

import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Types + state --------------------------------------------------

interface SocialAccountRow {
  id: string;
  tenantId: string;
  platform: string;
  externalId: string | null;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  isActive: boolean;
  addedByUserId: string;
  addedAt: Date;
}

interface SocialPostRow {
  id: string;
  tenantId: string;
  authorUserId: string;
  content: string;
  mediaUrls: string[];
  linkUrl: string | null;
  channelIds: string[];
  status: string;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SocialPostResultRow {
  id: string;
  postId: string;
  accountId: string;
  platformPostId: string | null;
  status: string;
  publishedAt: Date | null;
  error: string | null;
  impressions: number;
  likes: number;
  shares: number;
  comments: number;
  clicks: number;
  lastSyncedAt: Date | null;
}

interface TenantIntegrationRow {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  isActive: boolean;
  isDefault: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const state: {
  accounts: SocialAccountRow[];
  posts: SocialPostRow[];
  results: SocialPostResultRow[];
  integrations: TenantIntegrationRow[];
} = {
  accounts: [],
  posts: [],
  results: [],
  integrations: [],
};

let idSeq = 0;
const nextId = (prefix = "id") => `${prefix}_${++idSeq}`;

// ---------- Adapter mock ---------------------------------------------------

interface AdapterStub {
  platform: string;
  getOAuthUrl: ReturnType<typeof vi.fn>;
  exchangeCode: ReturnType<typeof vi.fn>;
  refreshAccessToken: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  refreshEngagement: ReturnType<typeof vi.fn>;
}

function makeAdapterStub(platform: string): AdapterStub {
  return {
    platform,
    getOAuthUrl: vi.fn((state: string, redirectUri: string) => {
      // Realistic per-platform prefixes so tests can assert without a
      // full URL parse.
      const base = {
        LinkedIn: "https://www.linkedin.com/oauth/v2/authorization",
        Facebook: "https://www.facebook.com/v21.0/dialog/oauth",
        Instagram: "https://www.facebook.com/v21.0/dialog/oauth",
        Twitter: "https://twitter.com/i/oauth2/authorize",
      }[platform] ?? "https://example.com/oauth";
      return `${base}?client_id=fake&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    }),
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(),
    publish: vi.fn(),
    refreshEngagement: vi.fn(),
  };
}

const adapterStubs: Record<string, AdapterStub> = {
  LinkedIn: makeAdapterStub("LinkedIn"),
  Facebook: makeAdapterStub("Facebook"),
  Instagram: makeAdapterStub("Instagram"),
  Twitter: makeAdapterStub("Twitter"),
};

// Fake secrets store — the router calls loadSocialCredentials/upsert; we
// return whatever we've configured in `credsByAccount`.
const credsByAccount = new Map<
  string,
  {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    externalId?: string;
    pageId?: string;
    pageAccessToken?: string;
    igUserId?: string;
  }
>();

// ---------- @lumaara/db mock ----------------------------------------------

vi.mock("@lumaara/db", () => {
  const prismaStub = {
    socialAccount: {
      findFirst: async ({ where }: { where: Partial<SocialAccountRow> & { platform?: string; handle?: string; id?: string; tenantId?: string } }) =>
        state.accounts.find(
          (a) =>
            (where.id === undefined || a.id === where.id) &&
            (where.tenantId === undefined || a.tenantId === where.tenantId) &&
            (where.platform === undefined || a.platform === where.platform) &&
            (where.handle === undefined || a.handle === where.handle),
        ) ?? null,
      findMany: async ({ where }: { where: { id?: { in?: string[] }; tenantId?: string; isActive?: boolean } }) => {
        return state.accounts.filter(
          (a) =>
            (where.id?.in === undefined || where.id.in.includes(a.id)) &&
            (where.tenantId === undefined || a.tenantId === where.tenantId) &&
            (where.isActive === undefined || a.isActive === where.isActive),
        );
      },
      create: async ({ data }: { data: Partial<SocialAccountRow> }) => {
        const row: SocialAccountRow = {
          id: nextId("acc"),
          tenantId: String(data.tenantId),
          platform: String(data.platform),
          externalId: data.externalId ?? null,
          handle: String(data.handle),
          displayName: String(data.displayName),
          avatarUrl: data.avatarUrl ?? null,
          accessToken: data.accessToken ?? null,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: (data.tokenExpiresAt as Date | null | undefined) ?? null,
          isActive: data.isActive ?? true,
          addedByUserId: String(data.addedByUserId ?? ""),
          addedAt: new Date(),
        };
        state.accounts.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SocialAccountRow> }) => {
        const idx = state.accounts.findIndex((a) => a.id === where.id);
        if (idx < 0) throw new Error("not found");
        state.accounts[idx] = { ...state.accounts[idx]!, ...data };
        return state.accounts[idx];
      },
      updateMany: async ({ where, data }: { where: { id?: string; tenantId?: string }; data: Partial<SocialAccountRow> }) => {
        let count = 0;
        for (let i = 0; i < state.accounts.length; i++) {
          const a = state.accounts[i]!;
          if (
            (where.id === undefined || a.id === where.id) &&
            (where.tenantId === undefined || a.tenantId === where.tenantId)
          ) {
            state.accounts[i] = { ...a, ...data };
            count++;
          }
        }
        return { count };
      },
      deleteMany: async ({ where }: { where: { id?: string; tenantId?: string } }) => {
        let count = 0;
        for (let i = state.accounts.length - 1; i >= 0; i--) {
          const a = state.accounts[i]!;
          if (
            (where.id === undefined || a.id === where.id) &&
            (where.tenantId === undefined || a.tenantId === where.tenantId)
          ) {
            state.accounts.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
    socialPost: {
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string } }) => {
        const p = state.posts.find(
          (px) =>
            (where.id === undefined || px.id === where.id) &&
            (where.tenantId === undefined || px.tenantId === where.tenantId),
        );
        if (!p) return null;
        // Always attach results — several callers use `include` and we
        // don't bother introspecting the include tree in this stub.
        return {
          ...p,
          results: state.results
            .filter((r) => r.postId === p.id)
            .map((r) => ({
              ...r,
              account: state.accounts.find((a) => a.id === r.accountId) ?? null,
            })),
        };
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const p = state.posts.find((x) => x.id === where.id);
        if (!p) return null;
        // Attach results as a synthetic property so router's `include`
        // shape works.
        return {
          ...p,
          results: state.results
            .filter((r) => r.postId === p.id)
            .map((r) => ({
              ...r,
              account: state.accounts.find((a) => a.id === r.accountId) ?? null,
            })),
        };
      },
      findMany: async ({
        where,
        take,
      }: {
        where?: { tenantId?: string; status?: string; scheduledFor?: { lte?: Date }; publishedAt?: { gte?: Date } };
        take?: number;
      }) => {
        let rows = state.posts.filter(
          (p) =>
            (where?.tenantId === undefined || p.tenantId === where.tenantId) &&
            (where?.status === undefined || p.status === where.status) &&
            (where?.scheduledFor?.lte === undefined ||
              (p.scheduledFor !== null && p.scheduledFor <= where.scheduledFor.lte)),
        );
        if (take) rows = rows.slice(0, take);
        return rows.map((p) => ({
          ...p,
          results: state.results
            .filter((r) => r.postId === p.id)
            .map((r) => ({
              ...r,
              account: state.accounts.find((a) => a.id === r.accountId) ?? null,
            })),
        }));
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<SocialPostRow> }) => {
        const idx = state.posts.findIndex((p) => p.id === where.id);
        if (idx < 0) throw new Error("post not found");
        state.posts[idx] = { ...state.posts[idx]!, ...data, updatedAt: new Date() };
        return state.posts[idx];
      },
    },
    socialPostResult: {
      findMany: async ({
        where,
        take,
      }: {
        where?: {
          status?: string;
          publishedAt?: { gte?: Date };
          platformPostId?: { not: null };
          account?: { tenantId?: string };
        };
        take?: number;
      }) => {
        let rows = state.results.filter(
          (r) =>
            (where?.status === undefined || r.status === where.status) &&
            (where?.publishedAt?.gte === undefined ||
              (r.publishedAt !== null && r.publishedAt >= where.publishedAt.gte)) &&
            (where?.platformPostId === undefined || r.platformPostId !== null),
        );
        if (where?.account?.tenantId !== undefined) {
          rows = rows.filter((r) => {
            const a = state.accounts.find((x) => x.id === r.accountId);
            return a && a.tenantId === where.account!.tenantId;
          });
        }
        if (take) rows = rows.slice(0, take);
        return rows.map((r) => ({
          ...r,
          account: state.accounts.find((a) => a.id === r.accountId),
        }));
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<SocialPostResultRow>;
      }) => {
        const idx = state.results.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("result not found");
        state.results[idx] = { ...state.results[idx]!, ...data };
        return state.results[idx];
      },
    },
    tenantIntegration: {
      findFirst: async ({
        where,
      }: {
        where: { tenantId: string; provider: string; name?: string; isActive?: boolean };
      }) =>
        state.integrations.find(
          (r) =>
            r.tenantId === where.tenantId &&
            r.provider === where.provider &&
            (where.name === undefined || r.name === where.name) &&
            (where.isActive === undefined || r.isActive === where.isActive),
        ) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<TenantIntegrationRow> }) => {
        const idx = state.integrations.findIndex((r) => r.id === where.id);
        if (idx < 0) throw new Error("integration not found");
        state.integrations[idx] = { ...state.integrations[idx]!, ...data, updatedAt: new Date() };
        return state.integrations[idx];
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: {
          tenantId_provider_name: { tenantId: string; provider: string; name: string };
        };
        create: Partial<TenantIntegrationRow>;
        update: Partial<TenantIntegrationRow>;
      }) => {
        const key = where.tenantId_provider_name;
        const idx = state.integrations.findIndex(
          (r) =>
            r.tenantId === key.tenantId &&
            r.provider === key.provider &&
            r.name === key.name,
        );
        if (idx >= 0) {
          state.integrations[idx] = { ...state.integrations[idx]!, ...update, updatedAt: new Date() };
          return state.integrations[idx];
        }
        const row: TenantIntegrationRow = {
          id: nextId("ti"),
          tenantId: key.tenantId,
          provider: key.provider,
          name: key.name,
          isActive: create.isActive ?? true,
          isDefault: create.isDefault ?? false,
          config: (create.config as Record<string, unknown>) ?? {},
          secrets: (create.secrets as Record<string, unknown>) ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.integrations.push(row);
        return row;
      },
    },
    // Router's transactional refresh path — passes a fn(tx), we invoke it
    // with the same prismaStub so all writes land in the shared state.
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      return fn(prismaStub);
    },
  };

  return {
    prisma: prismaStub,
    encryptSecrets: (v: Record<string, unknown>) => ({ enc: false as const, data: v }),
    decryptSecrets: (v: unknown) => {
      if (!v || typeof v !== "object") return {};
      const s = v as { enc?: boolean; data?: Record<string, unknown> };
      if (s.enc === false && s.data) return s.data;
      return s as Record<string, unknown>;
    },
    // Adapter factory returns per-platform stubs so tests can assert on
    // the mocked `publish` / `exchangeCode` / etc.
    getSocialAdapter: (platform: string) => {
      const s = adapterStubs[platform];
      if (!s) throw new Error(`no stub for platform ${platform}`);
      return s;
    },
    loadSocialCredentials: async (
      _prisma: unknown,
      _tenantId: string,
      accountId: string,
      _platform: string,
    ) => credsByAccount.get(accountId) ?? null,
    upsertSocialCredentials: async (
      _prisma: unknown,
      _tenantId: string,
      accountId: string,
      _platform: string,
      creds: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: number;
        externalId?: string;
        pageId?: string;
        pageAccessToken?: string;
        igUserId?: string;
      },
    ) => {
      credsByAccount.set(accountId, creds);
    },
    ensureFreshToken: async (
      _prisma: unknown,
      _tenantId: string,
      accountId: string,
      platform: string,
      creds: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: number;
      },
      _adapter: unknown,
    ) => {
      // Refresh when < 5min to expiry.
      const windowMs = 5 * 60_000;
      if (!creds.expiresAt || creds.expiresAt > Date.now() + windowMs) return creds;
      if (!creds.refreshToken) return creds;
      const stub = adapterStubs[platform];
      if (!stub) return creds;
      const refreshed = await stub.refreshAccessToken(creds.refreshToken);
      const updated = {
        ...creds,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? creds.refreshToken,
        expiresAt: refreshed.expiresAt ?? creds.expiresAt,
      };
      credsByAccount.set(accountId, updated);
      return updated;
    },
    makePkceVerifier: () => "verifier-fixed-for-tests",
    pkceChallenge: (v: string) => `challenge-of-${v}`,
    withCrossTenant: <T extends object>(a: T) => a,
  };
});

// ---------- @lumaara/service-auth mock ------------------------------------

const TENANT_ID = "tenant_abc";
const USER_ID = "user_A";
const JWT_SECRET_TEST = "test-jwt-secret";

vi.mock("@lumaara/service-auth", () => {
  const pass = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: TENANT_ID,
      userId: USER_ID,
    };
    next();
  };
  return {
    requireAuth: pass,
    perms: () => ({
      read: pass,
      write: pass,
      create: pass,
      delete: pass,
      submit: pass,
      cancel: pass,
    }),
    JWT_SECRET: JWT_SECRET_TEST,
    getLogger: () => ({
      child: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
      info() {}, warn() {}, debug() {}, error() {},
    }),
  };
});

// The social.ts route imports checkApprovalRequired from ./approvals. Stub
// it as a no-op that always says "not required" so tests don't need the
// MarketingApproval table.
vi.mock("./approvals", () => ({
  checkApprovalRequired: async () => ({ ok: true }),
}));

// ---------- App factory ---------------------------------------------------

async function makeApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Stamp `req.auth` on every request so route handlers see the mocked
  // tenant/user. Mirrors what the real requireAuth middleware would do.
  app.use((req, _res, next) => {
    (req as unknown as { auth: { tenantId: string; userId: string } }).auth = {
      tenantId: TENANT_ID,
      userId: USER_ID,
    };
    next();
  });
  const { socialRouter } = await import("./social");
  const { socialOAuthRouter } = await import("./social-oauth");
  app.use("/social/oauth", socialOAuthRouter);
  app.use("/social", socialRouter);
  return app;
}

// Mint a state JWT the same way social-oauth's /start does. Only used to
// drive the /callback endpoint from tests.
function mintState(payload: {
  t: string;
  u: string;
  p: string;
  r: string;
  c: string;
  v?: string;
}): string {
  return jwt.sign(payload, JWT_SECRET_TEST, { expiresIn: "15m" });
}

// ---------- Reset ---------------------------------------------------------

beforeEach(() => {
  state.accounts.length = 0;
  state.posts.length = 0;
  state.results.length = 0;
  state.integrations.length = 0;
  credsByAccount.clear();
  idSeq = 0;
  for (const s of Object.values(adapterStubs)) {
    s.exchangeCode.mockReset();
    s.refreshAccessToken.mockReset();
    s.publish.mockReset();
    s.refreshEngagement.mockReset();
    s.getOAuthUrl.mockClear();
  }
});

// =========================================================================
// OAuth start
// =========================================================================

describe("GET /social/oauth/:platform/start", () => {
  it.each([
    ["LinkedIn", "https://www.linkedin.com/oauth/v2/authorization"],
    ["Facebook", "https://www.facebook.com/v21.0/dialog/oauth"],
    ["Instagram", "https://www.facebook.com/v21.0/dialog/oauth"],
    ["Twitter", "https://twitter.com/i/oauth2/authorize"],
  ])("returns a well-formed URL for %s", async (platform, expectedPrefix) => {
    const res = await request(await makeApp())
      .get(`/social/oauth/${platform}/start`)
      .query({ redirectUri: "https://app.example.com/social/callback" });
    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain(expectedPrefix);
    expect(res.body.state).toBeTruthy();
  });

  it("rejects unsupported platforms", async () => {
    const res = await request(await makeApp())
      .get(`/social/oauth/MySpace/start`)
      .query({ redirectUri: "https://app.example.com/social/callback" });
    expect(res.status).toBe(400);
  });

  it("requires redirectUri", async () => {
    const res = await request(await makeApp()).get(`/social/oauth/LinkedIn/start`);
    expect(res.status).toBe(400);
  });

  it("for Twitter, embeds PKCE challenge in the state URL param", async () => {
    const res = await request(await makeApp())
      .get(`/social/oauth/Twitter/start`)
      .query({ redirectUri: "https://app.example.com/social/callback" });
    expect(res.status).toBe(200);
    // State returned is "<jwt>:<challenge>" — challenge-of-<verifier>
    expect(res.body.state).toContain(":challenge-of-verifier-fixed-for-tests");
  });
});

// =========================================================================
// OAuth callback
// =========================================================================

describe("GET /social/oauth/:platform/callback", () => {
  it("exchanges code, creates SocialAccount + upserts TenantIntegration", async () => {
    adapterStubs.LinkedIn!.exchangeCode.mockResolvedValue({
      accessToken: "linkedin-access-token",
      refreshToken: "linkedin-refresh-token",
      expiresAt: Date.now() + 3600_000,
      externalId: "li_person_123",
      handle: "li_person_123",
      displayName: "Ada Lovelace",
      avatarUrl: "https://cdn.example.com/avatar.png",
    });

    const stateToken = mintState({
      t: TENANT_ID,
      u: USER_ID,
      p: "LinkedIn",
      r: "https://app.example.com/social/callback",
      c: "csrf-x",
    });
    const res = await request(await makeApp())
      .get(`/social/oauth/LinkedIn/callback`)
      .query({ code: "auth-code-abc", state: stateToken });

    expect(res.status).toBe(201);
    expect(res.body.platform).toBe("LinkedIn");
    expect(res.body.handle).toBe("li_person_123");
    expect(res.body.displayName).toBe("Ada Lovelace");

    // SocialAccount inserted; credential store received the token blob
    // via upsertSocialCredentials (mocked to write into credsByAccount so
    // the assertions stay simple).
    expect(state.accounts).toHaveLength(1);
    const acc = state.accounts[0]!;
    const stored = credsByAccount.get(acc.id);
    expect(stored).toBeDefined();
    expect(stored!.accessToken).toBe("linkedin-access-token");
    expect(stored!.refreshToken).toBe("linkedin-refresh-token");
    expect(stored!.externalId).toBe("li_person_123");
    // Adapter's exchangeCode called with code + redirectUri + hints.
    expect(adapterStubs.LinkedIn!.exchangeCode).toHaveBeenCalledWith(
      "auth-code-abc",
      "https://app.example.com/social/callback",
      expect.objectContaining({}),
    );
  });

  it("rejects tampered state (bad signature)", async () => {
    const res = await request(await makeApp())
      .get(`/social/oauth/LinkedIn/callback`)
      .query({ code: "auth-code-abc", state: "not-a-real-jwt" });
    expect(res.status).toBe(400);
  });

  it("rejects state/platform mismatch", async () => {
    const stateToken = mintState({
      t: TENANT_ID,
      u: USER_ID,
      p: "Facebook", // state was for Facebook
      r: "https://app.example.com/social/callback",
      c: "csrf-x",
    });
    const res = await request(await makeApp())
      .get(`/social/oauth/LinkedIn/callback`) // callback for LinkedIn
      .query({ code: "auth-code-abc", state: stateToken });
    expect(res.status).toBe(400);
  });

  it("surfaces adapter exchange failures as 502", async () => {
    adapterStubs.LinkedIn!.exchangeCode.mockRejectedValue(new Error("bad code"));
    const stateToken = mintState({
      t: TENANT_ID,
      u: USER_ID,
      p: "LinkedIn",
      r: "https://app.example.com/social/callback",
      c: "csrf-x",
    });
    const res = await request(await makeApp())
      .get(`/social/oauth/LinkedIn/callback`)
      .query({ code: "auth-code-abc", state: stateToken });
    expect(res.status).toBe(502);
  });
});

// =========================================================================
// Publish — LinkedIn happy path
// =========================================================================

describe("POST /social/posts/:id/publish", () => {
  function seedAccountAndPost({
    platform = "LinkedIn",
    scheduledFor,
  }: { platform?: string; scheduledFor?: Date | null } = {}): {
    account: SocialAccountRow;
    post: SocialPostRow;
    result: SocialPostResultRow;
  } {
    const account: SocialAccountRow = {
      id: nextId("acc"),
      tenantId: TENANT_ID,
      platform,
      externalId: "ext_1",
      handle: "acme_official",
      displayName: "Acme Official",
      avatarUrl: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isActive: true,
      addedByUserId: USER_ID,
      addedAt: new Date(),
    };
    state.accounts.push(account);
    const post: SocialPostRow = {
      id: nextId("post"),
      tenantId: TENANT_ID,
      authorUserId: USER_ID,
      content: "hello world",
      mediaUrls: [],
      linkUrl: null,
      channelIds: [account.id],
      status: scheduledFor ? "Scheduled" : "Draft",
      scheduledFor: scheduledFor ?? null,
      publishedAt: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    state.posts.push(post);
    const result: SocialPostResultRow = {
      id: nextId("res"),
      postId: post.id,
      accountId: account.id,
      platformPostId: null,
      status: "Pending",
      publishedAt: null,
      error: null,
      impressions: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
      lastSyncedAt: null,
    };
    state.results.push(result);
    credsByAccount.set(account.id, {
      accessToken: "linkedin-access-token",
      refreshToken: "linkedin-refresh-token",
      expiresAt: Date.now() + 3600_000,
      externalId: "ext_1",
    });
    return { account, post, result };
  }

  it("calls the LinkedIn adapter and marks the post + result Published", async () => {
    const { post } = seedAccountAndPost({ platform: "LinkedIn" });
    adapterStubs.LinkedIn!.publish.mockResolvedValue({ platformPostId: "urn:li:share:9999" });

    const res = await request(await makeApp()).post(`/social/posts/${post.id}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Published");
    // Adapter was called with correct content
    expect(adapterStubs.LinkedIn!.publish).toHaveBeenCalledTimes(1);
    const callArg = adapterStubs.LinkedIn!.publish.mock.calls[0]![0] as {
      content: string;
      mediaUrls: string[];
      linkUrl: string | null;
      account: { platform: string; credentials: { accessToken: string } };
    };
    expect(callArg.content).toBe("hello world");
    expect(callArg.account.platform).toBe("LinkedIn");
    expect(callArg.account.credentials.accessToken).toBe("linkedin-access-token");

    const updated = state.posts[0]!;
    expect(updated.status).toBe("Published");
    expect(updated.publishedAt).toBeInstanceOf(Date);
    const rr = state.results[0]!;
    expect(rr.status).toBe("Published");
    expect(rr.platformPostId).toBe("urn:li:share:9999");
  });

  it("adapter 4xx: marks SocialPostResult Failed with error message", async () => {
    const { post } = seedAccountAndPost({ platform: "LinkedIn" });
    adapterStubs.LinkedIn!.publish.mockRejectedValue(
      new Error("LinkedIn publish failed (401): Unauthorized"),
    );

    const res = await request(await makeApp()).post(`/social/posts/${post.id}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Failed");
    const rr = state.results[0]!;
    expect(rr.status).toBe("Failed");
    expect(rr.error).toContain("Unauthorized");
    const p = state.posts[0]!;
    expect(p.status).toBe("Failed");
    expect(p.failureReason).toContain("LinkedIn");
  });

  it("token refresh triggered when tokenExpiresAt < now + 5min", async () => {
    const { account, post } = seedAccountAndPost({ platform: "LinkedIn" });
    // Overwrite credentials to expire in 60s → within the 5min window.
    credsByAccount.set(account.id, {
      accessToken: "old-token",
      refreshToken: "refresh-tok",
      expiresAt: Date.now() + 60_000,
      externalId: "ext_1",
    });
    adapterStubs.LinkedIn!.refreshAccessToken.mockResolvedValue({
      accessToken: "new-token",
      expiresAt: Date.now() + 3600_000,
    });
    adapterStubs.LinkedIn!.publish.mockResolvedValue({ platformPostId: "urn:li:share:9999" });

    const res = await request(await makeApp()).post(`/social/posts/${post.id}/publish`);
    expect(res.status).toBe(200);
    expect(adapterStubs.LinkedIn!.refreshAccessToken).toHaveBeenCalledWith("refresh-tok");
    // Publish call carried the refreshed token, not the old one.
    const callArg = adapterStubs.LinkedIn!.publish.mock.calls[0]![0] as {
      account: { credentials: { accessToken: string } };
    };
    expect(callArg.account.credentials.accessToken).toBe("new-token");
  });
});

// =========================================================================
// Batch process
// =========================================================================

describe("POST /social/posts/process", () => {
  it("publishes Scheduled+due posts and leaves un-due Scheduled untouched", async () => {
    // Two accounts, two posts. Post A: due 1 min ago. Post B: due 1 hour
    // from now.
    const account = {
      id: nextId("acc"),
      tenantId: TENANT_ID,
      platform: "LinkedIn",
      externalId: "ext_1",
      handle: "h1",
      displayName: "d1",
      avatarUrl: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isActive: true,
      addedByUserId: USER_ID,
      addedAt: new Date(),
    };
    state.accounts.push(account);
    credsByAccount.set(account.id, {
      accessToken: "tok",
      externalId: "ext_1",
    });
    const dueId = nextId("post");
    const futureId = nextId("post");
    state.posts.push(
      {
        id: dueId,
        tenantId: TENANT_ID,
        authorUserId: USER_ID,
        content: "due now",
        mediaUrls: [],
        linkUrl: null,
        channelIds: [account.id],
        status: "Scheduled",
        scheduledFor: new Date(Date.now() - 60_000),
        publishedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: futureId,
        tenantId: TENANT_ID,
        authorUserId: USER_ID,
        content: "future",
        mediaUrls: [],
        linkUrl: null,
        channelIds: [account.id],
        status: "Scheduled",
        scheduledFor: new Date(Date.now() + 60 * 60_000),
        publishedAt: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
    state.results.push({
      id: nextId("res"),
      postId: dueId,
      accountId: account.id,
      platformPostId: null,
      status: "Pending",
      publishedAt: null,
      error: null,
      impressions: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
      lastSyncedAt: null,
    });
    adapterStubs.LinkedIn!.publish.mockResolvedValue({ platformPostId: "urn:li:share:99" });

    const res = await request(await makeApp()).post(`/social/posts/process`);
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(1);
    expect(res.body.published).toBe(1);

    const due = state.posts.find((p) => p.id === dueId)!;
    const future = state.posts.find((p) => p.id === futureId)!;
    expect(due.status).toBe("Published");
    expect(future.status).toBe("Scheduled");
  });
});

// =========================================================================
// Engagement — via the shared helper (importing after mocks are in place)
// =========================================================================

describe("refreshEngagementBatch", () => {
  it("updates row counters from adapter.refreshEngagement", async () => {
    // Seed one published result.
    const acc: SocialAccountRow = {
      id: nextId("acc"),
      tenantId: TENANT_ID,
      platform: "LinkedIn",
      externalId: "ext_e",
      handle: "e",
      displayName: "e",
      avatarUrl: null,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      isActive: true,
      addedByUserId: USER_ID,
      addedAt: new Date(),
    };
    state.accounts.push(acc);
    credsByAccount.set(acc.id, { accessToken: "tok" });
    state.results.push({
      id: nextId("res"),
      postId: "p_ignored",
      accountId: acc.id,
      platformPostId: "urn:li:share:abc",
      status: "Published",
      publishedAt: new Date(),
      error: null,
      impressions: 0,
      likes: 0,
      shares: 0,
      comments: 0,
      clicks: 0,
      lastSyncedAt: null,
    });
    adapterStubs.LinkedIn!.refreshEngagement.mockResolvedValue({
      impressions: 111,
      likes: 22,
      shares: 3,
      comments: 4,
      clicks: 5,
    });

    // Load the module fresh so the mocks take effect, then invoke.
    const mod = await import("./social");
    const r = await mod.refreshEngagementBatch(TENANT_ID);
    expect(r.scanned).toBe(1);
    expect(r.refreshed).toBe(1);

    const rr = state.results[0]!;
    expect(rr.impressions).toBe(111);
    expect(rr.likes).toBe(22);
    expect(rr.shares).toBe(3);
    expect(rr.comments).toBe(4);
    expect(rr.clicks).toBe(5);
    expect(rr.lastSyncedAt).toBeInstanceOf(Date);
  });
});
