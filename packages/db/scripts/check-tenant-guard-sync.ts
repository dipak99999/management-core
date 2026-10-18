// Fails if the tenant-guard model list in src/tenant-guard.ts has drifted
// from schema.prisma. Runs in CI to prevent the guard silently missing a
// freshly-added tenant-scoped model.
//
// On drift, prints the diff and exits 1 with the one-liner to regenerate.
//
//   pnpm --filter @lumaara/db exec tsx scripts/check-tenant-guard-sync.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TENANT_SCOPED_MODELS } from "../src/tenant-guard";

const SCHEMA_PATH = resolve(__dirname, "..", "prisma", "schema.prisma");

function modelsWithTenantIdInSchema(): Set<string> {
  const src = readFileSync(SCHEMA_PATH, "utf8");
  const lines = src.split("\n");
  const out = new Set<string>();
  let current: string | null = null;
  for (const line of lines) {
    const m = line.match(/^model\s+(\w+)\s+\{/);
    if (m) {
      current = m[1];
      continue;
    }
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    if (current && /^\s+tenantId\s+/.test(line)) {
      out.add(current);
    }
  }
  return out;
}

const schemaSet = modelsWithTenantIdInSchema();
const guardSet = TENANT_SCOPED_MODELS;

const missingFromGuard = [...schemaSet].filter((m) => !guardSet.has(m)).sort();
const extraInGuard = [...guardSet].filter((m) => !schemaSet.has(m)).sort();

if (missingFromGuard.length === 0 && extraInGuard.length === 0) {
  // eslint-disable-next-line no-console
  console.log(`tenant-guard list in sync (${guardSet.size} models)`);
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error("tenant-guard model list has drifted from schema.prisma:");
if (missingFromGuard.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `  Missing from guard (would leak across tenants silently): ${missingFromGuard.join(", ")}`,
  );
}
if (extraInGuard.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`  In guard but not in schema (stale): ${extraInGuard.join(", ")}`);
}
// eslint-disable-next-line no-console
console.error(
  "\nRegenerate the Set in packages/db/src/tenant-guard.ts from the schema:\n" +
    "  awk '/^model / {m=$2} /^  tenantId / {print \"  \\\"\" m \"\\\",\"}' \\\n" +
    "    packages/db/prisma/schema.prisma | sort -u",
);
process.exit(1);
