import { describe, expect, it } from "vitest";
import { checkFence, haversineMeters } from "./geo-fence";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });

  it("computes Bangalore ↔ Mumbai as ~840 km", () => {
    const d = haversineMeters(12.9716, 77.5946, 19.076, 72.8777);
    expect(d).toBeGreaterThan(830_000);
    expect(d).toBeLessThan(850_000);
  });

  it("returns 100 m for a 100 m north step", () => {
    // 1 deg latitude ≈ 111 km → 100 m ≈ 0.000898 deg.
    const d = haversineMeters(0, 0, 0.000898, 0);
    expect(d).toBeGreaterThan(99);
    expect(d).toBeLessThan(101);
  });
});

describe("checkFence", () => {
  const fence = { latitude: 12.9716, longitude: 77.5946, radiusMeters: 100 };

  it("inside fence → ok", () => {
    const r = checkFence(fence, { latitude: 12.9716, longitude: 77.5946 });
    expect(r.ok).toBe(true);
    expect(r.distanceMeters).toBe(0);
  });

  it("outside fence → not ok", () => {
    // ~200 m north
    const r = checkFence(fence, { latitude: 12.973396, longitude: 77.5946 });
    expect(r.ok).toBe(false);
    expect(r.distanceMeters).toBeGreaterThan(150);
  });

  it("radius=0 → always ok (no fence)", () => {
    const r = checkFence(
      { latitude: 12.9716, longitude: 77.5946, radiusMeters: 0 },
      { latitude: 19.076, longitude: 72.8777 },
    );
    expect(r.ok).toBe(true);
  });
});
