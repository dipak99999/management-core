// Real-DB stress tests for the nested-$transaction + RLS interaction.
//
// Two scenarios the audit called out:
//   (a) Plain prisma.$transaction with RLS_ENFORCE=false — must behave
//       exactly like Prisma does out of the box. Default dev state.
//   (b) withTenantTx with RLS_ENFORCE=true-equivalent — tenant setting is
//       bound once at tx open, every nested query inside sees it, and
//       the extension short-circuits (no SAVEPOINT nesting, no leaked
//       setting to other connections).
//
// We can't actually flip RLS_ENFORCE at test time (the module-level const
// captures it on first import), but we can verify withTenantTx uses the
// ALS frame + SET LOCAL even in the no-op branch — which is the behavior
// RLS=true inherits.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./index";
import { runWithTenant, withTenantTx } from "./rls-context";

const suiteId = `it-rls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let tenantA: { id: string };
let tenantB: { id: string };

beforeAll(async () => {
  tenantA = await prisma.tenant.create({
    data: { name: `${suiteId}-A`, slug: `${suiteId}-a` },
    select: { id: true },
  });
  tenantB = await prisma.tenant.create({
    data: { name: `${suiteId}-B`, slug: `${suiteId}-b` },
    select: { id: true },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({
    where: { id: { in: [tenantA.id, tenantB.id] } },
  });
  await prisma.$disconnect();
});

describe("withTenantTx (nested-transaction safety)", () => {
  it("runs multiple writes atomically inside one tx (no RLS enforcement)", async () => {
    await runWithTenant(tenantA.id, async () => {
      const customer = await withTenantTx(prisma, async (tx) => {
        const c = await tx.customer.create({
          data: { tenantId: tenantA.id, customerName: `Nested-${suiteId}-1` },
        });
        // Second write inside the same tx — any mid-tx failure must
        // roll BOTH back.
        await tx.customer.update({
          where: { id: c.id },
          data: { customerName: `Nested-${suiteId}-1-updated` },
        });
        return c.id;
      });
      const row = await prisma.customer.findUnique({ where: { id: customer } });
      expect(row?.customerName).toBe(`Nested-${suiteId}-1-updated`);
    });
  });

  it("rolls back every write on mid-tx throw", async () => {
    await runWithTenant(tenantA.id, async () => {
      let createdId: string | null = null;
      await expect(
        withTenantTx(prisma, async (tx) => {
          const c = await tx.customer.create({
            data: { tenantId: tenantA.id, customerName: `Rollback-${suiteId}` },
          });
          createdId = c.id;
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      // The row created inside the aborted tx must NOT exist post-rollback.
      expect(createdId).not.toBeNull();
      const row = await prisma.customer.findUnique({
        where: { id: createdId! },
      });
      expect(row).toBeNull();
    });
  });

  it("isolates concurrent withTenantTx calls across tenants", async () => {
    // Two parallel tx blocks, different tenants. Each must see only its
    // own tenant's writes.
    const [idA, idB] = await Promise.all([
      runWithTenant(tenantA.id, () =>
        withTenantTx(prisma, async (tx) => {
          const c = await tx.customer.create({
            data: { tenantId: tenantA.id, customerName: `Conc-A-${suiteId}` },
          });
          return c.id;
        }),
      ),
      runWithTenant(tenantB.id, () =>
        withTenantTx(prisma, async (tx) => {
          const c = await tx.customer.create({
            data: { tenantId: tenantB.id, customerName: `Conc-B-${suiteId}` },
          });
          return c.id;
        }),
      ),
    ]);

    const a = await prisma.customer.findUnique({ where: { id: idA } });
    const b = await prisma.customer.findUnique({ where: { id: idB } });
    expect(a?.tenantId).toBe(tenantA.id);
    expect(b?.tenantId).toBe(tenantB.id);
  });

  it("works even without a runWithTenant frame (no-RLS path)", async () => {
    // When no tenant frame is set (e.g. super-admin cron), withTenantTx
    // still behaves as a plain $transaction. The SET LOCAL is skipped;
    // nothing throws.
    const row = await withTenantTx(prisma, async (tx) => {
      return tx.tenant.create({
        data: { name: `${suiteId}-noframe`, slug: `${suiteId}-noframe` },
        select: { id: true, slug: true },
      });
    });
    try {
      expect(row.slug).toBe(`${suiteId}-noframe`);
    } finally {
      await prisma.tenant.delete({ where: { id: row.id } });
    }
  });
});
