// Marketing P2 — A/B winner-picker tick tests.
//
// Prisma + service-auth mocked at the module boundary so the tick runs in
// pure-JS mode. Focus is on the promotion policy: min-sends threshold,
// campaign-age gate, existing-winner short-circuit, effect-size gate,
// statistical-significance gate.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mocks ---------------------------------------------------------------

const prismaMock = {
  campaign: {
    findMany: vi.fn(),
  },
  campaignVariant: {
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  }),
};

vi.mock("@lumaara/db", async () => {
  const real = await vi.importActual<typeof import("@lumaara/db")>("@lumaara/db");
  return {
    ...real,
    prisma: prismaMock,
    withCrossTenant: <T extends object>(args: T) => args,
    // Use the real twoProportionZTest — the whole point of the "significance
    // gate" test is to exercise the actual math.
    twoProportionZTest: real.twoProportionZTest,
  };
});

vi.mock("@lumaara/service-auth", () => ({
  getLogger: () => ({
    child: () => ({
      info: () => undefined,
      warn: () => undefined,
    }),
  }),
}));

async function loadTick() {
  const { runAbWinnerTick } = await import("./ab-winner");
  return runAbWinnerTick;
}

function resetMocks() {
  prismaMock.campaign.findMany.mockReset();
  prismaMock.campaignVariant.findMany.mockReset();
  prismaMock.campaignVariant.update.mockReset();
  prismaMock.campaignVariant.updateMany.mockReset();
  prismaMock.$transaction.mockReset();
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock);
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
  prismaMock.campaignVariant.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.campaignVariant.update.mockResolvedValue({ id: "vX" });
}

function makeCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: "camp-1",
    tenantId: "t1",
    name: "Camp",
    sentAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3h ago
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    ...overrides,
  };
}

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: "v",
    tenantId: "t1",
    campaignId: "camp-1",
    variantKey: "A",
    weightPercent: 50,
    subject: null,
    bodyHtml: null,
    fromEmail: null,
    fromName: null,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalBounced: 0,
    isWinner: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("runAbWinnerTick", () => {
  beforeEach(() => {
    resetMocks();
    delete process.env.AB_WINNER_ENABLE;
    delete process.env.AB_WINNER_MIN_SENDS;
    delete process.env.AB_WINNER_MIN_AGE_MS;
    delete process.env.AB_WINNER_MIN_RELATIVE_LIFT;
  });

  it("no-op when AB_WINNER_ENABLE unset", async () => {
    const run = await loadTick();
    const r = await run();
    expect(r).toEqual({ scanned: 0, promoted: 0, skipped: 0, errors: 0 });
    expect(prismaMock.campaign.findMany).not.toHaveBeenCalled();
  });

  it("skips when total sends across variants < AB_WINNER_MIN_SENDS", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    process.env.AB_WINNER_MIN_SENDS = "500";
    prismaMock.campaign.findMany.mockResolvedValue([makeCampaign()]);
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ id: "vA", variantKey: "A", totalSent: 100, totalOpened: 50 }),
      makeVariant({ id: "vB", variantKey: "B", totalSent: 100, totalOpened: 20 }),
    ]);
    const run = await loadTick();
    const r = await run();
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.promoted).toBe(0);
    expect(prismaMock.campaignVariant.update).not.toHaveBeenCalled();
  });

  it("skips when a winner already exists", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    process.env.AB_WINNER_MIN_SENDS = "100";
    prismaMock.campaign.findMany.mockResolvedValue([makeCampaign()]);
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ id: "vA", variantKey: "A", totalSent: 500, isWinner: true }),
      makeVariant({ id: "vB", variantKey: "B", totalSent: 500 }),
    ]);
    const run = await loadTick();
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it("skips when only 1 variant", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    prismaMock.campaign.findMany.mockResolvedValue([makeCampaign()]);
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ id: "vA", variantKey: "A", totalSent: 1000 }),
    ]);
    const run = await loadTick();
    const r = await run();
    expect(r.skipped).toBe(1);
  });

  it("skips when effect size < 20% relative lift even if significant", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    process.env.AB_WINNER_MIN_SENDS = "100";
    prismaMock.campaign.findMany.mockResolvedValue([makeCampaign()]);
    // 40% vs 38% at N=10k each — statistically significant but only ~5% lift.
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ id: "vA", variantKey: "A", totalSent: 10_000, totalOpened: 4000 }),
      makeVariant({ id: "vB", variantKey: "B", totalSent: 10_000, totalOpened: 3800 }),
    ]);
    const run = await loadTick();
    const r = await run();
    expect(r.skipped).toBe(1);
    expect(r.promoted).toBe(0);
  });

  it("promotes when lift >= 20% AND significance p<0.05", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    process.env.AB_WINNER_MIN_SENDS = "100";
    prismaMock.campaign.findMany.mockResolvedValue([makeCampaign()]);
    // 40% vs 20% at N=500 each — clearly significant AND 2× lift.
    prismaMock.campaignVariant.findMany.mockResolvedValue([
      makeVariant({ id: "vA", variantKey: "A", totalSent: 500, totalOpened: 200 }),
      makeVariant({ id: "vB", variantKey: "B", totalSent: 500, totalOpened: 100 }),
    ]);
    const run = await loadTick();
    const r = await run();
    expect(r.promoted).toBe(1);
    expect(r.skipped).toBe(0);
    // Winner is vA (higher rate)
    expect(prismaMock.campaignVariant.update).toHaveBeenCalledWith({
      where: { id: "vA" },
      data: { isWinner: true },
    });
  });

  it("skips when campaign is too new (< AB_WINNER_MIN_AGE_MS)", async () => {
    process.env.AB_WINNER_ENABLE = "1";
    process.env.AB_WINNER_MIN_AGE_MS = String(2 * 60 * 60 * 1000);
    // Campaign only 10 minutes old — the query filter should exclude it.
    // We simulate that by returning an empty candidate list, since the
    // WHERE clause is what does the age filter.
    prismaMock.campaign.findMany.mockResolvedValue([]);
    const run = await loadTick();
    const r = await run();
    expect(r.scanned).toBe(0);
    expect(r.promoted).toBe(0);
    // Verify the tick did apply the age cutoff in its query.
    const call = prismaMock.campaign.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });
});
