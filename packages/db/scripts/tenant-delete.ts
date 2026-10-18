#!/usr/bin/env tsx
/**
 * Purge a tenant and every one of its rows. Relies on the `onDelete: Cascade`
 * relations from `Tenant → *` (every tenant-owned model). GDPR right-to-be-
 * forgotten flow: export first with tenant-export, then run this.
 *
 * Requires `--yes` — destructive.
 *
 * Usage:
 *   pnpm --filter @lumaara/db tenant-delete -- <tenantId>          # dry run
 *   pnpm --filter @lumaara/db tenant-delete -- <tenantId> --yes    # execute
 */

import { prisma } from "../src/index";

async function main() {
  const args = process.argv.slice(2);
  const tenantId = args.find((a) => !a.startsWith("--"));
  const yes = args.includes("--yes");
  if (!tenantId) {
    console.error("Usage: tenant-delete <tenantId> [--yes]");
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { _count: { select: { users: true } } },
  });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  console.log(
    `[delete] tenant "${tenant.name}" (${tenantId}) — ${tenant._count.users} users`,
  );

  if (!yes) {
    console.log("[delete] DRY RUN — pass --yes to execute");
    console.log("[delete] This will CASCADE-DELETE every row belonging to this tenant.");
    return;
  }

  await prisma.tenant.delete({ where: { id: tenantId } });
  console.log("[delete] done");
  await prisma.$disconnect();
}

main();
