// Lightweight load test — no deps, uses node:http directly. Measures
// p50/p95/p99/max latency across three realistic scenarios:
//
//   1. COLD: /auth/login (write) + /my-plan (read). Models a new user
//      landing on the shell.
//   2. HOT READ: parallel GET /customers after one login. Models an
//      operator browsing the customer list.
//   3. WRITE: serial POST /customers per worker. Models bulk CSV
//      import or data entry.
//
// Each scenario runs with N concurrent "workers" (default 10, override
// with LOAD_WORKERS env). Report shows the distribution so you can see
// where the tail starts hurting.
//
// Usage:
//   node scripts/load-test.mjs           # default: 10 workers, each scenario
//   LOAD_WORKERS=50 node scripts/load-test.mjs
//
// Assumes services are running: auth-service :4001, accounting-service :4002.

import { request as httpRequest } from "node:http";

const AUTH = "http://127.0.0.1:4001";
const ACC = "http://127.0.0.1:4002";
const WORKERS = Number(process.env.LOAD_WORKERS ?? 10);
const DEMO = { tenantSlug: "demo", email: "demo@lumaara.local", password: "demo1234" };

function timed(fn) {
  return async () => {
    const t = process.hrtime.bigint();
    let ok = true;
    try { await fn(); } catch (e) { ok = false; }
    return { ms: Number(process.hrtime.bigint() - t) / 1_000_000, ok };
  };
}

// Measure a batch: run `work` N times in parallel, return latencies + ok count.
async function measureBatch(work, n) {
  const latencies = [];
  let ok = 0;
  let failed = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    const t = process.hrtime.bigint();
    try {
      await work();
      ok += 1;
    } catch {
      failed += 1;
    }
    latencies.push(Number(process.hrtime.bigint() - t) / 1_000_000);
  }));
  return { latencies, ok, failed };
}

function doReq(url, { method = "GET", body = null, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 100)}`));
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login() {
  const r = await doReq(`${AUTH}/auth/login`, { method: "POST", body: DEMO });
  return r.body.token;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

function reportLatencies(label, latencies, { ok = null, failed = null } = {}) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  const avg = sum / sorted.length;
  const okLabel = ok != null && failed != null
    ? `  ok=${ok}/${ok + failed}`
    : "";
  console.log(
    `  ${label.padEnd(28)} n=${String(sorted.length).padStart(4)}` +
    `  avg=${avg.toFixed(1).padStart(7)}ms` +
    `  p50=${percentile(sorted, 0.5).toFixed(1).padStart(6)}` +
    `  p95=${percentile(sorted, 0.95).toFixed(1).padStart(6)}` +
    `  p99=${percentile(sorted, 0.99).toFixed(1).padStart(6)}` +
    `  max=${sorted[sorted.length - 1].toFixed(1).padStart(6)}` +
    okLabel,
  );
}

// ─── Scenario 1: COLD login + my-plan ─────────────────────────────
// Serial login measurements (parallel logins trip the brute-force
// rate limiter — correct behavior). Then parallel /my-plan from the
// shared token to measure the plan-lookup fan-out cost.
async function scenario1() {
  const loginL = [], planL = [];
  // Serial logins so the brute-force limiter doesn't fire
  let token = "";
  for (let i = 0; i < Math.min(WORKERS, 5); i++) {
    const t = process.hrtime.bigint();
    try { token = await login(); } catch {}
    loginL.push(Number(process.hrtime.bigint() - t) / 1_000_000);
  }
  // Parallel /my-plan
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    const t = process.hrtime.bigint();
    try { await doReq(`${AUTH}/my-plan`, { token }); } catch {}
    planL.push(Number(process.hrtime.bigint() - t) / 1_000_000);
  }));
  console.log("\n═══ Scenario 1: COLD (serial login + parallel /my-plan) ═══");
  reportLatencies("POST /auth/login (serial)", loginL);
  reportLatencies("GET /my-plan (parallel)", planL);
}

// ─── Scenario 2: HOT read /customers ──────────────────────────────
async function scenario2() {
  const token = await loginOnce();
  const latencies = [];
  const warmup = async () => { try { await doReq(`${ACC}/customers`, { token }); } catch {} };
  await warmup();
  await Promise.all(Array.from({ length: WORKERS * 10 }, async () => {
    const t = process.hrtime.bigint();
    try { await doReq(`${ACC}/customers`, { token }); } catch {}
    latencies.push(Number(process.hrtime.bigint() - t) / 1_000_000);
  }));
  console.log(`\n═══ Scenario 2: HOT read (${WORKERS * 10} × GET /customers) ═══`);
  reportLatencies("GET /customers", latencies);
}

// ─── Scenario 3: WRITE path (POST /customers serial per worker) ────
async function scenario3() {
  // One shared token — simulates N concurrent sessions from a single app
  // without tripping the per-email login rate limiter.
  const token = await loginOnce();
  const latencies = [];
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    for (let i = 0; i < 5; i++) {
      const t = process.hrtime.bigint();
      try {
        await doReq(`${ACC}/customers`, {
          method: "POST", token,
          body: { customerName: `LoadTest-W${w}-${i}-${Date.now()}`, customerType: "Company" },
        });
      } catch {}
      latencies.push(Number(process.hrtime.bigint() - t) / 1_000_000);
    }
  }));
  console.log(`\n═══ Scenario 3: WRITE (${WORKERS} workers × 5 POST /customers each) ═══`);
  reportLatencies("POST /customers", latencies);
}

// ─── Scenario 4: BREAKING POINT ramp ──────────────────────────────────
// Ramp concurrency up a geometric step at a time until the p95 crosses
// LATENCY_BUDGET_MS (default 1000) OR the error rate exceeds 1%. Report
// the last-good concurrency level + the first-bad one. This is the
// "when does the system fall over" question that the fixed-worker
// scenarios can't answer.
//
// Target: a GET /customers hot read, since that's the most-called
// endpoint and includes the full requireAuth + Prisma + tenant-guard
// stack. Writes would require idempotency keys per worker; left as
// future work.
async function scenario4() {
  const BUDGET = Number(process.env.LATENCY_BUDGET_MS ?? 1000);
  const MAX_ERR_RATE = Number(process.env.LOAD_ERROR_RATE_BUDGET ?? 0.01);
  const STEPS = (process.env.LOAD_RAMP ?? "10,25,50,100,200,500").split(",").map(Number);
  const token = await loginOnce();
  const read = () => doReq(`${ACC}/customers`, { token });
  console.log(`\n═══ Scenario 4: BREAKING POINT (budget: p95 <= ${BUDGET}ms, err <= ${MAX_ERR_RATE * 100}%) ═══`);
  let lastGood = 0;
  let firstBad = null;
  for (const n of STEPS) {
    const { latencies, ok, failed } = await measureBatch(read, n);
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    const errRate = failed / (ok + failed);
    reportLatencies(`n=${n} concurrent GET /customers`, latencies, { ok, failed });
    if (p95 > BUDGET || errRate > MAX_ERR_RATE) {
      firstBad = { n, p95, errRate };
      break;
    }
    lastGood = n;
  }
  if (firstBad) {
    console.log(
      `\n  → breaking point: ${firstBad.n} concurrent (p95=${firstBad.p95.toFixed(0)}ms, err=${(firstBad.errRate * 100).toFixed(1)}%)`,
    );
    console.log(`  → last-good concurrency: ${lastGood}`);
  } else {
    console.log(`\n  → never broke (max tested: ${STEPS[STEPS.length - 1]})`);
  }
}

// Token shared across scenarios so brute-force limiter doesn't trip.
let SHARED_TOKEN = "";
async function loginOnce() {
  if (!SHARED_TOKEN) SHARED_TOKEN = await login();
  return SHARED_TOKEN;
}

async function main() {
  console.log(`Load test — ${WORKERS} concurrent workers\n`);
  const t0 = Date.now();
  const only = process.env.LOAD_SCENARIO; // "1" | "2" | "3" | "4" | undefined (all)
  if (!only || only === "1") await scenario1();
  if (!only || only === "2") await scenario2();
  if (!only || only === "3") await scenario3();
  if (!only || only === "4") await scenario4();
  console.log(`\nTotal elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
