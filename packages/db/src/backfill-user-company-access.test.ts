import { describe, expect, it, vi } from "vitest";
import { backfillUserCompanyAccess } from "./backfill-user-company-access";

function makeDb({
  companies,
  users,
  createManyResult = { count: 0 },
}: {
  companies: { id: string }[];
  users: Array<{
    id: string;
    role: string;
    userRoles: { role: { roleName: string } }[];
  }>;
  createManyResult?: { count: number };
}) {
  const createMany = vi.fn().mockResolvedValue(createManyResult);
  return {
    db: {
      company: { findMany: vi.fn().mockResolvedValue(companies) },
      user: { findMany: vi.fn().mockResolvedValue(users) },
      userCompanyAccess: { createMany },
    } as unknown as Parameters<typeof backfillUserCompanyAccess>[0],
    createMany,
  };
}

describe("backfillUserCompanyAccess", () => {
  it("grandfathers non-admin users across all companies", async () => {
    const { db, createMany } = makeDb({
      companies: [{ id: "co1" }, { id: "co2" }],
      users: [
        { id: "u1", role: "admin", userRoles: [] },
        { id: "u2", role: "user", userRoles: [] },
        { id: "u3", role: "user", userRoles: [] },
      ],
      createManyResult: { count: 4 },
    });
    const r = await backfillUserCompanyAccess(db, "t1");
    expect(r).toEqual({ usersConsidered: 3, adminsSkipped: 1, rowsCreated: 4 });
    // Only 2 non-admins × 2 companies = 4 inserts.
    expect(createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        { tenantId: "t1", userId: "u2", companyId: "co1" },
        { tenantId: "t1", userId: "u2", companyId: "co2" },
        { tenantId: "t1", userId: "u3", companyId: "co1" },
        { tenantId: "t1", userId: "u3", companyId: "co2" },
      ]),
      skipDuplicates: true,
    });
  });

  it("treats SystemManager UserRole as admin", async () => {
    const { db, createMany } = makeDb({
      companies: [{ id: "co1" }],
      users: [
        {
          id: "u1",
          role: "user",
          userRoles: [{ role: { roleName: "SystemManager" } }],
        },
      ],
    });
    const r = await backfillUserCompanyAccess(db, "t1");
    expect(r.adminsSkipped).toBe(1);
    expect(r.rowsCreated).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("short-circuits when the tenant has no companies", async () => {
    const { db, createMany } = makeDb({
      companies: [],
      users: [{ id: "u1", role: "user", userRoles: [] }],
    });
    const r = await backfillUserCompanyAccess(db, "t1");
    expect(r).toEqual({ usersConsidered: 0, adminsSkipped: 0, rowsCreated: 0 });
    expect(createMany).not.toHaveBeenCalled();
  });
});
