import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addSuppression, isSuppressed, removeSuppression } from "./suppression";

// Fake Prisma — matches the shape actually used by suppression.ts (only
// prisma.suppression.{findUnique,upsert,delete}). Cast to PrismaClient since
// we're only exercising a tiny slice of the surface.
interface FakeState {
  findUnique?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
}

function fakePrisma(state: FakeState = {}): PrismaClient {
  return {
    suppression: {
      findUnique: state.findUnique ?? vi.fn().mockResolvedValue(null),
      upsert: state.upsert ?? vi.fn().mockResolvedValue({}),
      delete: state.delete ?? vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("isSuppressed", () => {
  it("returns the Suppression row when the address is blocked", async () => {
    const row = { id: "s1", tenantId: "t1", email: "alice@example.com", reason: "HardBounce" };
    const findUnique = vi.fn().mockResolvedValue(row);
    const prisma = fakePrisma({ findUnique });

    const result = await isSuppressed(prisma, "t1", "alice@example.com");

    expect(result).toEqual(row);
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "alice@example.com" } },
    });
  });

  it("returns null when the address is not suppressed", async () => {
    const prisma = fakePrisma({ findUnique: vi.fn().mockResolvedValue(null) });
    expect(await isSuppressed(prisma, "t1", "clean@example.com")).toBeNull();
  });

  it("lookups are case-insensitive — Alice@Example.COM hits alice@example.com", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "s1" });
    const prisma = fakePrisma({ findUnique });

    await isSuppressed(prisma, "t1", "Alice@Example.COM");

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "alice@example.com" } },
    });
  });

  it("trims surrounding whitespace before lookup", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = fakePrisma({ findUnique });

    await isSuppressed(prisma, "t1", "  bob@example.com  ");

    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "bob@example.com" } },
    });
  });

  it("returns null for empty / whitespace-only input without hitting the DB", async () => {
    const findUnique = vi.fn();
    const prisma = fakePrisma({ findUnique });

    expect(await isSuppressed(prisma, "t1", "")).toBeNull();
    expect(await isSuppressed(prisma, "t1", "   ")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("addSuppression", () => {
  it("upserts a row with lowercased email", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "s1" });
    const prisma = fakePrisma({ upsert });

    await addSuppression(prisma, "t1", {
      email: "Alice@Example.COM",
      reason: "Complaint",
      source: "sendgrid",
      detail: "spam-report",
      campaignId: "c1",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "alice@example.com" } },
      create: {
        tenantId: "t1",
        email: "alice@example.com",
        reason: "Complaint",
        source: "sendgrid",
        detail: "spam-report",
        campaignId: "c1",
      },
      update: {
        reason: "Complaint",
        source: "sendgrid",
        detail: "spam-report",
        campaignId: "c1",
      },
    });
  });

  it("is idempotent — calling twice hits upsert both times without erroring", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "s1" });
    const prisma = fakePrisma({ upsert });

    await addSuppression(prisma, "t1", { email: "x@y.com", reason: "Manual" });
    await addSuppression(prisma, "t1", { email: "x@y.com", reason: "Manual" });

    expect(upsert).toHaveBeenCalledTimes(2);
    // Both calls target the same unique key.
    expect(upsert.mock.calls[0][0].where).toEqual(upsert.mock.calls[1][0].where);
  });

  it("defaults missing source/detail/campaignId to null in the create payload", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "s1" });
    const prisma = fakePrisma({ upsert });

    await addSuppression(prisma, "t1", { email: "x@y.com", reason: "Import" });

    const call = upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ source: null, detail: null, campaignId: null });
  });

  it("throws when email is empty", async () => {
    const prisma = fakePrisma();
    await expect(
      addSuppression(prisma, "t1", { email: "", reason: "Manual" }),
    ).rejects.toThrow(/email is required/);
  });
});

describe("removeSuppression", () => {
  it("deletes the row using the case-insensitive lookup key", async () => {
    const del = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ delete: del });

    await removeSuppression(prisma, "t1", "Bob@Example.COM");

    expect(del).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: "t1", email: "bob@example.com" } },
    });
  });

  it("is a no-op when the row does not exist (P2025 swallowed)", async () => {
    const err = Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
    const del = vi.fn().mockRejectedValue(err);
    const prisma = fakePrisma({ delete: del });

    await expect(removeSuppression(prisma, "t1", "ghost@example.com")).resolves.toBeUndefined();
  });

  it("re-throws non-P2025 errors so ops isn't silently blind to real issues", async () => {
    const err = Object.assign(new Error("connection lost"), { code: "P1001" });
    const del = vi.fn().mockRejectedValue(err);
    const prisma = fakePrisma({ delete: del });

    await expect(removeSuppression(prisma, "t1", "x@y.com")).rejects.toThrow(/connection lost/);
  });

  it("skips DB call for empty input", async () => {
    const del = vi.fn();
    const prisma = fakePrisma({ delete: del });
    await removeSuppression(prisma, "t1", "");
    expect(del).not.toHaveBeenCalled();
  });
});
