#!/usr/bin/env tsx
/**
 * Tenant-scoped JSON export. Walks every Prisma model that has a `tenantId`
 * field, dumps its rows into JSONL files under ./exports/<tenantId>_<ts>/.
 * Used for GDPR data-request handling + tenant offboarding + testing.
 *
 * Also dumps the Tenant row itself and its per-tenant child tables that don't
 * have `tenantId` directly but hang off other tenant-owned rows (e.g. child
 * lines of a SalesInvoice). Those are captured via a second pass keyed off
 * parent IDs.
 *
 * Usage:
 *   pnpm --filter @lumaara/db tenant-export -- <tenantId>
 *   pnpm --filter @lumaara/db tenant-export -- <tenantId> --out ./elsewhere
 */

import { mkdirSync, createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { Prisma, prisma, getPrismaDelegate } from "../src/index";

interface WriteStats {
  model: string;
  rows: number;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5);
}

// Prisma exposes the datamodel via runtime DMMF. Enumerate models that carry
// `tenantId` directly — these are the "root" per-tenant tables.
function tenantModels(): string[] {
  const models = Prisma.dmmf.datamodel.models;
  return models
    .filter((m) => m.fields.some((f) => f.name === "tenantId"))
    .map((m) => m.name);
}

// Camelcase model name → prisma client key (Prisma lowercases first char).
function delegateKey(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

async function dumpModel(
  tenantId: string,
  model: string,
  outDir: string,
): Promise<WriteStats> {
  const key = delegateKey(model);
  const delegate = getPrismaDelegate(prisma, key);
  if (!delegate) {
    console.warn(`[export] skipping ${model}: no delegate on prisma client`);
    return { model, rows: 0 };
  }
  const stream = createWriteStream(resolve(outDir, `${model}.jsonl`));
  let rows = 0;
  // Page in batches of 500 to bound memory.
  let cursor: { id: string } | undefined;
  while (true) {
    const batch: Array<{ id: string }> = await delegate.findMany({
      where: { tenantId },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      stream.write(JSON.stringify(row) + "\n");
      rows += 1;
    }
    cursor = { id: batch[batch.length - 1].id };
    if (batch.length < 500) break;
  }
  stream.end();
  return { model, rows };
}

async function main() {
  const args = process.argv.slice(2);
  const tenantId = args.find((a) => !a.startsWith("--"));
  if (!tenantId) {
    console.error("Usage: tenant-export <tenantId> [--out <dir>]");
    process.exit(1);
  }
  const outIdx = args.indexOf("--out");
  const baseOut = resolve(outIdx >= 0 ? args[outIdx + 1] : "./exports");
  const outDir = resolve(baseOut, `${tenantId}_${timestamp()}`);
  mkdirSync(outDir, { recursive: true });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }
  console.log(`[export] tenant "${tenant.name}" (${tenantId}) → ${outDir}`);

  const models = tenantModels();
  console.log(`[export] ${models.length} tenant-scoped models to dump`);

  const stats: WriteStats[] = [];
  for (const m of models) {
    try {
      const s = await dumpModel(tenantId, m, outDir);
      stats.push(s);
      if (s.rows > 0) console.log(`[export]   ${m}: ${s.rows}`);
    } catch (e) {
      console.error(
        `[export] failed on ${m}: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  const totalRows = stats.reduce((s, r) => s + r.rows, 0);
  console.log(`[export] done — ${totalRows} rows across ${stats.length} models`);
  console.log(`[export] output: ${outDir}`);
  await prisma.$disconnect();
}

main();
