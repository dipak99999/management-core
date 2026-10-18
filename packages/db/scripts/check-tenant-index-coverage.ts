// Flags tenant-scoped models (any model with a `tenantId` column) that
// lack an index starting with `tenantId`. A missing index turns every
// per-tenant list query into a full table scan under multi-tenant load.
//
// What counts as "covered":
//   • `tenantId @unique`                       — unique implies btree
//   • `tenantId String @id`                    — rare, but counts
//   • `@@index([tenantId, …])`                 — standard case
//   • `@@index([tenantId])`                    — standalone
//   • `@@unique([tenantId, …])`                — unique multi-column
//   • `@@id([tenantId, …])`                    — composite primary
//
// What does NOT count:
//   • `@@index([someOtherFk, …])` where `someOtherFk` is tenant-scoped.
//     Transitive scoping doesn't help Postgres: `WHERE tenantId = $1`
//     still needs an index on tenantId to be fast.
//
// Runs in CI (packages/db/package.json → check:tenant-index); fail on any
// miss so a newly-added tenant-scoped table can't ship without an index.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA_PATH = resolve(__dirname, "..", "prisma", "schema.prisma");

interface ModelInfo {
  name: string;
  hasTenantId: boolean;
  tenantIdInlineUnique: boolean;
  tenantIdInlineId: boolean;
  compositeKeys: string[][]; // normalized: [["tenantId","email"], ...]
}

function parseSchema(src: string): ModelInfo[] {
  const out: ModelInfo[] = [];
  const lines = src.split("\n");
  let m: ModelInfo | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const start = line.match(/^model\s+(\w+)\s+\{/);
    if (start) {
      m = {
        name: start[1],
        hasTenantId: false,
        tenantIdInlineUnique: false,
        tenantIdInlineId: false,
        compositeKeys: [],
      };
      continue;
    }
    if (!m) continue;
    if (line.startsWith("}")) {
      out.push(m);
      m = null;
      continue;
    }
    const field = line.match(/^\s+(\w+)\s+/);
    if (field && field[1] === "tenantId") {
      m.hasTenantId = true;
      if (line.includes("@unique")) m.tenantIdInlineUnique = true;
      if (/@id\b/.test(line)) m.tenantIdInlineId = true;
    }
    const comp = line.match(/^\s+@@(?:index|unique|id)\(\[([^\]]+)\]/);
    if (comp) {
      const fields = comp[1]
        .split(",")
        .map((f) => f.trim().replace(/\(.*/, "")); // strip (sort: Desc)
      m.compositeKeys.push(fields);
    }
  }
  return out;
}

const schema = readFileSync(SCHEMA_PATH, "utf8");
const models = parseSchema(schema);
const tenantScoped = models.filter((m) => m.hasTenantId);
const uncovered: string[] = [];
for (const m of tenantScoped) {
  if (m.tenantIdInlineUnique || m.tenantIdInlineId) continue;
  const covered = m.compositeKeys.some((fields) => fields[0] === "tenantId");
  if (!covered) uncovered.push(m.name);
}

if (uncovered.length === 0) {
  // eslint-disable-next-line no-console
  console.log(
    `tenant-index coverage OK (${tenantScoped.length} tenant-scoped models, all have a tenantId-leading index or unique)`,
  );
  process.exit(0);
}
// eslint-disable-next-line no-console
console.error(
  "Models with `tenantId` but no index/unique starting with tenantId:",
);
for (const name of uncovered) {
  // eslint-disable-next-line no-console
  console.error(`  ${name}`);
}
// eslint-disable-next-line no-console
console.error(
  "\nAdd `@@index([tenantId])` (or a composite starting with tenantId) to each.\n" +
    "Direct queries like `prisma.X.findMany({ where: { tenantId } })` otherwise do a full table scan.",
);
process.exit(1);
