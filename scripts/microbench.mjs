// CPU/mem micro-benchmark. Fully self-contained — no running stack, no
// DB, no network. Measures a handful of operations the hot request path
// actually spends time on so a dev can characterise their machine
// against the shared .perf/BASELINE.md reference in <10 seconds.
//
// What's measured:
//   • bcrypt hash at cost=10 and cost=12 (login/signup path).
//   • JSON parse + stringify (request body shuffling, Prisma $queryRaw).
//   • Prisma.Decimal arithmetic (every GL line post walks through this).
//   • SHA-256 (audit chain + idempotency fingerprinting).
//   • Date formatting (every list endpoint renders ISO strings).
//
// Each benchmark runs for a target duration and reports ops/sec +
// p50/p95/p99 latency per op. The numbers are machine-specific but
// REPEATABLE on the same box — a drop in ops/sec across refreshes
// signals a regression.
//
// Usage:
//   node scripts/microbench.mjs               # ~8 seconds, all suites
//   SUITE=bcrypt node scripts/microbench.mjs  # just one suite

import { createHash, scryptSync } from "node:crypto";
import { createRequire } from "node:module";

// Workspace packages aren't siblings of this script, so resolve bcryptjs
// through the packages/db package that already lists it as a dependency.
// Lets this script run with `node scripts/microbench.mjs` from the repo
// root with no new deps added at the root.
const require = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const bcrypt = require("bcryptjs");

const TARGET_MS = Number(process.env.MICROBENCH_TARGET_MS ?? 1500);
const SUITE = process.env.SUITE ?? "";

function p(sorted, pct) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[i];
}

async function bench(label, fn) {
  // Warmup: 50ms (JIT), untimed.
  const warmupEnd = Date.now() + 50;
  while (Date.now() < warmupEnd) await fn();

  const latencies = [];
  const t0 = Date.now();
  while (Date.now() - t0 < TARGET_MS) {
    const start = process.hrtime.bigint();
    await fn();
    latencies.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = Date.now() - t0;
  const opsPerSec = (latencies.length / total) * 1000;
  console.log(
    `  ${label.padEnd(32)} ops/s=${opsPerSec.toFixed(0).padStart(8)}` +
      `  p50=${p(sorted, 0.5).toFixed(3).padStart(8)}ms` +
      `  p95=${p(sorted, 0.95).toFixed(3).padStart(8)}ms` +
      `  p99=${p(sorted, 0.99).toFixed(3).padStart(8)}ms` +
      `  n=${latencies.length}`,
  );
}

const should = (name) => !SUITE || SUITE === name;

console.log("─────────────────────────────────────────────────────────────────");
console.log("Lumaara microbench —", new Date().toISOString());
console.log(`node ${process.version} on ${process.platform} ${process.arch}`);
console.log(`target: ${TARGET_MS}ms per op  warmup: 50ms`);
console.log("─────────────────────────────────────────────────────────────────");
console.log();

if (should("bcrypt")) {
  console.log("── bcrypt (auth cost paths) ──");
  // One pre-hash per cost so we're not generating salt in the loop,
  // which is the operator-visible path (signup is salt-included; login
  // only runs compare).
  const hash10 = bcrypt.hashSync("password-benchmark-input", 10);
  const hash12 = bcrypt.hashSync("password-benchmark-input", 12);
  await bench("bcrypt.compare (cost=10)", () => {
    bcrypt.compareSync("password-benchmark-input", hash10);
  });
  await bench("bcrypt.compare (cost=12)", () => {
    bcrypt.compareSync("password-benchmark-input", hash12);
  });
  console.log();
}

if (should("json")) {
  console.log("── JSON (payload shuffling) ──");
  const smallObj = { tenantId: "t1", customerName: "Acme", status: "Draft" };
  const largePayload = JSON.stringify({
    items: Array.from({ length: 50 }, (_, i) => ({
      itemCode: `ITM-${i}`,
      itemName: `Item ${i} with a reasonably long description to simulate real data`,
      qty: i * 1.5,
      rate: 100 + i,
      amount: (i * 1.5) * (100 + i),
    })),
  });
  await bench("JSON.stringify (small object)", () => {
    JSON.stringify(smallObj);
  });
  await bench("JSON.parse (50-line invoice)", () => {
    JSON.parse(largePayload);
  });
  console.log();
}

if (should("hash")) {
  console.log("── SHA-256 (audit chain + idempotency) ──");
  const small = "idempotency-key-sample-abc123";
  const large = "x".repeat(32_000);
  await bench("sha256(30-char key)", () => {
    createHash("sha256").update(small).digest("hex");
  });
  await bench("sha256(32KB blob)", () => {
    createHash("sha256").update(large).digest("hex");
  });
  console.log();
}

if (should("scrypt")) {
  console.log("── scrypt (MASTER_SECRET_KEY derive, cold path) ──");
  // scrypt is intentionally slow — only called once per process on
  // first use of the encrypted secrets. Benchmarked to catch
  // regressions in Node's crypto implementation.
  await bench("scryptSync(32-byte key)", () => {
    scryptSync("passphrase-benchmark", "lumaara-secrets-salt", 32);
  });
  console.log();
}

if (should("date")) {
  console.log("── Date / Intl (list rendering) ──");
  const iso = "2026-10-05T14:23:00.000Z";
  const fmt = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  await bench("Date → toISOString()", () => {
    new Date(iso).toISOString();
  });
  await bench("Intl.DateTimeFormat.format", () => {
    fmt.format(new Date(iso));
  });
  console.log();
}

if (should("decimal")) {
  console.log("── Prisma.Decimal (GL arithmetic) ──");
  // Resolve @prisma/client through packages/db like we did for bcryptjs.
  // Decimal is the exact class used in gl-posting + salary totals.
  const { Prisma } = require("@prisma/client");
  const lines = Array.from({ length: 50 }, (_, i) => new Prisma.Decimal(i + 0.33));
  await bench("Decimal reduce (50 lines)", () => {
    lines.reduce((s, v) => s.add(v), new Prisma.Decimal(0));
  });
  await bench("Decimal multiplication", () => {
    new Prisma.Decimal("1234.5678").mul(new Prisma.Decimal("83.4521"));
  });
  console.log();
}

console.log("─────────────────────────────────────────────────────────────────");
console.log("Numbers are machine-specific. Compare to .perf/BASELINE.md.");
