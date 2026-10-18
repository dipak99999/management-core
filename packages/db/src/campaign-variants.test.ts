import { describe, expect, it } from "vitest";
import type { CampaignVariant } from "@prisma/client";
import {
  hashToBucket,
  mergeVariantOverride,
  pickVariantForRecipient,
  standardNormalCdf,
  twoProportionZTest,
} from "./campaign-variants";

// Helper: build a CampaignVariant-ish object. Only the fields
// pickVariantForRecipient / mergeVariantOverride actually read are populated;
// the rest are cast to satisfy the type.
function v(overrides: Partial<CampaignVariant>): CampaignVariant {
  return {
    id: overrides.id ?? "v1",
    tenantId: overrides.tenantId ?? "t1",
    campaignId: overrides.campaignId ?? "c1",
    variantKey: overrides.variantKey ?? "A",
    weightPercent: overrides.weightPercent ?? 50,
    subject: overrides.subject ?? null,
    bodyHtml: overrides.bodyHtml ?? null,
    fromEmail: overrides.fromEmail ?? null,
    fromName: overrides.fromName ?? null,
    totalSent: overrides.totalSent ?? 0,
    totalOpened: overrides.totalOpened ?? 0,
    totalClicked: overrides.totalClicked ?? 0,
    totalBounced: overrides.totalBounced ?? 0,
    isWinner: overrides.isWinner ?? false,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  } as CampaignVariant;
}

describe("pickVariantForRecipient", () => {
  it("returns null on empty variant list", () => {
    expect(pickVariantForRecipient([], "r1")).toBeNull();
  });

  it("is deterministic — same recipient id → same variant", () => {
    const variants = [
      v({ id: "vA", variantKey: "A", weightPercent: 50 }),
      v({ id: "vB", variantKey: "B", weightPercent: 50 }),
    ];
    const first = pickVariantForRecipient(variants, "recipient-alice-abc-123");
    for (let i = 0; i < 10; i++) {
      expect(pickVariantForRecipient(variants, "recipient-alice-abc-123")).toBe(first);
    }
  });

  it("short-circuits to isWinner when one exists (ignoring weights)", () => {
    const variants = [
      v({ id: "vA", variantKey: "A", weightPercent: 90, isWinner: false }),
      v({ id: "vB", variantKey: "B", weightPercent: 10, isWinner: true }),
    ];
    // Try 50 random ids — every one must return the winner.
    for (let i = 0; i < 50; i++) {
      const got = pickVariantForRecipient(variants, `recip-${i}`);
      expect(got?.id).toBe("vB");
    }
  });

  it("weighted distribution roughly matches weights over 10k iterations (±5%)", () => {
    const variants = [
      v({ id: "vA", variantKey: "A", weightPercent: 70 }),
      v({ id: "vB", variantKey: "B", weightPercent: 30 }),
    ];
    const counts: Record<string, number> = { vA: 0, vB: 0 };
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const picked = pickVariantForRecipient(variants, `recip-${i}`);
      counts[picked!.id] = (counts[picked!.id] ?? 0) + 1;
    }
    const aRatio = counts.vA! / N;
    const bRatio = counts.vB! / N;
    expect(aRatio).toBeGreaterThan(0.65); // ~0.70 ± 0.05
    expect(aRatio).toBeLessThan(0.75);
    expect(bRatio).toBeGreaterThan(0.25); // ~0.30 ± 0.05
    expect(bRatio).toBeLessThan(0.35);
  });

  it("three-variant even split roughly matches 33/33/34 (±5%)", () => {
    const variants = [
      v({ id: "vA", variantKey: "A", weightPercent: 33 }),
      v({ id: "vB", variantKey: "B", weightPercent: 33 }),
      v({ id: "vC", variantKey: "C", weightPercent: 34 }),
    ];
    const counts: Record<string, number> = { vA: 0, vB: 0, vC: 0 };
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const picked = pickVariantForRecipient(variants, `id-${i}`);
      counts[picked!.id] = (counts[picked!.id] ?? 0) + 1;
    }
    for (const key of ["vA", "vB", "vC"]) {
      const ratio = counts[key]! / N;
      expect(ratio).toBeGreaterThan(0.28);
      expect(ratio).toBeLessThan(0.38);
    }
  });

  it("absorbs residual weight into the last variant when sum < 100", () => {
    // 40 + 30 = 70 — last 30 buckets fall through to B (last in sort order).
    const variants = [
      v({ id: "vA", variantKey: "A", weightPercent: 40 }),
      v({ id: "vB", variantKey: "B", weightPercent: 30 }),
    ];
    const counts: Record<string, number> = { vA: 0, vB: 0 };
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const picked = pickVariantForRecipient(variants, `x-${i}`);
      counts[picked!.id] = (counts[picked!.id] ?? 0) + 1;
    }
    // A gets ~40%; B gets ~60% (its 30 + residue 30). Not testing exact —
    // just that the fall-through works and no null returned.
    expect(counts.vA! + counts.vB!).toBe(N);
    expect(counts.vB!).toBeGreaterThan(counts.vA!);
  });
});

describe("hashToBucket", () => {
  it("always returns 0..99", () => {
    for (let i = 0; i < 1_000; i++) {
      const b = hashToBucket(`id-${i}`);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("is stable across calls", () => {
    expect(hashToBucket("abc")).toBe(hashToBucket("abc"));
  });

  it("distributes reasonably uniformly across 10k ids (chi-square-ish)", () => {
    const buckets = new Array<number>(100).fill(0);
    for (let i = 0; i < 10_000; i++) buckets[hashToBucket(`id-${i}`)!] += 1;
    // Every bucket should have SOMETHING; extreme empty-bucket runs indicate
    // a broken hash (we don't run a real chi-square, just sanity-check that
    // no bucket is grossly over-/under-represented).
    for (const c of buckets) {
      expect(c).toBeGreaterThan(30); // expected ~100, with normal variance
      expect(c).toBeLessThan(200);
    }
  });
});

describe("twoProportionZTest", () => {
  it("returns not-significant for trivially close proportions", () => {
    const r = twoProportionZTest(50, 100, 51, 100);
    expect(r.isSignificant).toBe(false);
  });

  it("returns significant for clearly separated proportions with large N", () => {
    // 40% vs 20% at N=200 each is ~4.5σ, clearly p<0.05
    const r = twoProportionZTest(80, 200, 40, 200);
    expect(r.isSignificant).toBe(true);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.z).toBeGreaterThan(1.96);
  });

  it("returns z=0 pValue=1 for zero-sample inputs", () => {
    expect(twoProportionZTest(0, 0, 0, 0).pValue).toBe(1);
    expect(twoProportionZTest(0, 0, 0, 0).isSignificant).toBe(false);
  });
});

describe("standardNormalCdf", () => {
  it("Φ(0) = 0.5", () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("Φ(1.96) ≈ 0.975", () => {
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("Φ(-1.96) ≈ 0.025", () => {
    expect(standardNormalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("mergeVariantOverride", () => {
  const campaign = {
    subject: "Camp subj",
    bodyHtml: "<p>Camp body</p>",
    fromEmail: "camp@example.com",
    fromName: "Camp Name",
  };

  it("returns campaign values when variant is null", () => {
    expect(mergeVariantOverride(campaign, null)).toEqual(campaign);
  });

  it("overrides only the fields the variant sets", () => {
    const merged = mergeVariantOverride(campaign, {
      subject: "Variant subj",
      fromEmail: null, // null = fall back to campaign
    });
    expect(merged.subject).toBe("Variant subj");
    expect(merged.fromEmail).toBe("camp@example.com");
    expect(merged.bodyHtml).toBe(campaign.bodyHtml);
    expect(merged.fromName).toBe(campaign.fromName);
  });
});
