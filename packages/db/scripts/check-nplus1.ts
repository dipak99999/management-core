// Heuristic N+1 detector. Scans service route files for the shape:
//
//   for (const x of someList) {
//     ...
//     await prisma.X.find*(...);
//   }
//
// Not every match is a real bug — some are legitimate serial writes to the
// same row (e.g. Decimal increments where parallelism would race). But
// every match is at least worth a comment explaining why it isn't batchable.
//
// Allowlist via `// eslint-disable-next-line nplus1-ok` right before the
// loop. The script treats that as "author acknowledged + intentional" and
// skips. Grep for the comment to audit the exceptions.
//
// Run locally:   pnpm --filter @lumaara/db exec tsx scripts/check-nplus1.ts
// In CI:         same, as an advisory step (does not fail the build; grep
//                the output for new entries during code review).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  "services/accounting-service/src/routes",
  "services/stock-service/src/routes",
  "services/crm-service/src/routes",
  "services/hr-service/src/routes",
  "services/projects-service/src/routes",
  "services/auth-service/src/routes",
];

const SKIP_MARKER = /nplus1-ok/i;
const WINDOW_LINES = 15;

interface Finding {
  file: string;
  loopLine: number;
  findLine: number;
  loopText: string;
  findText: string;
}

function scanFile(path: string): Finding[] {
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");
  const out: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isForOf = /^(\s+)for\s*\(\s*const\s+\w+\s+of\s+/.test(line);
    const isForEachAsync = /^(\s+)\.forEach\(\s*async/.test(line);
    const isMapAsync = /\.map\(\s*async/.test(line);
    if (!isForOf && !isForEachAsync && !isMapAsync) continue;
    // Allow a `nplus1-ok` acknowledgment on the previous non-blank line.
    for (let k = i - 1; k >= 0 && k > i - 3; k--) {
      if (!lines[k].trim()) continue;
      if (SKIP_MARKER.test(lines[k])) {
        i = i; // keep i; just mark skip
        break;
      }
      break;
    }
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    for (let j = i + 1; j < Math.min(i + WINDOW_LINES, lines.length); j++) {
      const inner = lines[j];
      if (!inner.trim()) continue;
      const innerIndentMatch = inner.match(/^(\s*)/);
      const innerIndent = innerIndentMatch ? innerIndentMatch[1].length : 0;
      if (innerIndent <= indent && !isMapAsync) break; // left the loop body
      if (/await\s+(prisma|tx)\.\w+\.find/.test(inner)) {
        // Check for a nplus1-ok comment on the same line or above the find.
        const findLineText = inner;
        const prevLineText = lines[j - 1] ?? "";
        if (SKIP_MARKER.test(findLineText) || SKIP_MARKER.test(prevLineText)) break;
        out.push({
          file: path,
          loopLine: i + 1,
          findLine: j + 1,
          loopText: line.trim(),
          findText: inner.trim(),
        });
        break;
      }
    }
  }
  return out;
}

function walkTs(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full, acc);
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      acc.push(full);
    }
  }
}

const findings: Finding[] = [];
for (const d of SCAN_DIRS) {
  const dir = resolve(ROOT, d);
  const files: string[] = [];
  try {
    walkTs(dir, files);
  } catch {
    continue; // dir may not exist in a subset checkout
  }
  for (const f of files) findings.push(...scanFile(f));
}

if (findings.length === 0) {
  // eslint-disable-next-line no-console
  console.log("No N+1 candidates detected.");
  process.exit(0);
}

// eslint-disable-next-line no-console
console.log(`Found ${findings.length} N+1 candidate(s):\n`);
for (const f of findings) {
  const rel = f.file.replace(ROOT + "/", "");
  // eslint-disable-next-line no-console
  console.log(`${rel}:${f.loopLine}`);
  // eslint-disable-next-line no-console
  console.log(`  loop:  ${f.loopText}`);
  // eslint-disable-next-line no-console
  console.log(`  find:  ${f.findText}  (line ${f.findLine})`);
  // eslint-disable-next-line no-console
  console.log();
}
// eslint-disable-next-line no-console
console.log(
  `Add a \`// nplus1-ok: <why>\` comment on the loop line to acknowledge the pattern`,
);
console.log(
  "and silence the warning for cases where batching is intentional (e.g. Decimal",
);
console.log("accumulators that would race under parallelism).");
// Exit 0 by default — advisory, not a build break. Flip to `process.exit(1)`
// if the backlog drops to zero and you want to enforce it.
process.exit(0);
