// isFeatureEnabled smoke. The function was shipped but no routes consume
// it yet; the audit called out "dead feature-flag surface" as a risk.
// This test pins the three branches so when routes DO start consulting
// flags they can rely on the behavior documented in the function.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isFeatureEnabled } from "./ops";

// Build a Prisma mock that returns per-test rows. Keeping it inline keeps
// the test self-contained — we're exercising the branching logic, not a
// real DB roundtrip (packages/db has that for the FeatureFlag model).
let flagRow: { enabled: boolean; rolloutPercent: number } | null = null;

vi.mock("@lumaara/db", () => ({
  prisma: {
    featureFlag: {
      findFirst: async () => flagRow,
    },
  },
}));

describe("isFeatureEnabled", () => {
  beforeEach(() => {
    flagRow = null;
  });
  afterEach(() => {
    flagRow = null;
  });

  it("returns false when no flag row exists", async () => {
    flagRow = null;
    expect(await isFeatureEnabled("tenant-x", "new-ui")).toBe(false);
  });

  it("returns false when the flag row has enabled=false (regardless of rollout)", async () => {
    flagRow = { enabled: false, rolloutPercent: 100 };
    expect(await isFeatureEnabled("tenant-x", "new-ui")).toBe(false);
  });

  it("returns true when enabled + rollout=100", async () => {
    flagRow = { enabled: true, rolloutPercent: 100 };
    expect(await isFeatureEnabled("tenant-x", "new-ui")).toBe(true);
  });

  it("returns false when enabled + rollout=0", async () => {
    flagRow = { enabled: true, rolloutPercent: 0 };
    expect(await isFeatureEnabled("tenant-x", "new-ui")).toBe(false);
  });

  it("is deterministic per (tenantId, key): same inputs → same output across calls", async () => {
    flagRow = { enabled: true, rolloutPercent: 50 };
    const first = await isFeatureEnabled("tenant-fixed", "new-ui");
    const second = await isFeatureEnabled("tenant-fixed", "new-ui");
    expect(second).toBe(first);
  });

  it("splits the tenant population across the rollout percentage", async () => {
    flagRow = { enabled: true, rolloutPercent: 50 };
    // 100 synthetic tenants — their enabled rate should be close to 50%.
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        isFeatureEnabled(`tenant-${i}`, "new-ui"),
      ),
    );
    const enabled = results.filter(Boolean).length;
    // 100 trials with p=0.5 — expect binomial-ish variance; accept 30..70.
    expect(enabled).toBeGreaterThan(30);
    expect(enabled).toBeLessThan(70);
  });
});
