# Load-test baseline (shared reference)

The one perf number we agree on. Everyone's laptop runs
`scripts/load-test-local.sh` and gets *different* numbers; the shared
reference below is captured on a dedicated perf box so comparisons
across PRs are meaningful.

Two layers:

- **Microbench** — CPU-bound ops the hot request path runs (bcrypt,
  JSON, SHA-256, Decimal, Intl). Fully self-contained; no stack needed.
  Fast + repeatable: ~15 seconds, run with `node scripts/microbench.mjs`.
  Below is the current reference.
- **Full-stack load test** — HTTP + Prisma + Postgres end-to-end. Needs
  the local stack running. Run with `scripts/load-test-local.sh`; add a
  pasted output under "Full-stack reference" below after refreshing on
  the dedicated perf box.

## Microbench reference

```
host: darwin arm64, Apple M-series
node: v26.3.0
captured: 2026-10-05
```

```
── bcrypt (auth cost paths) ──
  bcrypt.compare (cost=10)         ops/s=      16  p50=  62ms   p95=  72ms   p99=  77ms
  bcrypt.compare (cost=12)         ops/s=       4  p50= 280ms   p95= 320ms   p99= 320ms

── JSON (payload shuffling) ──
  JSON.stringify (small object)    ops/s= 2800000  p50=   0.000ms
  JSON.parse (50-line invoice)     ops/s=   80000  p50=   0.012ms  p95=   0.013ms

── SHA-256 (audit chain + idempotency) ──
  sha256(30-char key)              ops/s= 1200000  p50=   0.000ms
  sha256(32KB blob)                ops/s=   70000  p50=   0.014ms

── scrypt (MASTER_SECRET_KEY derive, cold path) ──
  scryptSync(32-byte key)          ops/s=      30  p50=  33ms   p95=  41ms

── Date / Intl (list rendering) ──
  Date → toISOString()             ops/s= 1100000  p50=   0.001ms
  Intl.DateTimeFormat.format       ops/s=  900000  p50=   0.001ms

── Prisma.Decimal (GL arithmetic) ──
  Decimal reduce (50 lines)        ops/s=  180000  p50=   0.005ms
  Decimal multiplication           ops/s= 1100000  p50=   0.001ms
```

Reference captured 2026-10-05. Values rounded to the nearest significant
figure because exact numbers invite false-precision regressions —
compare against *order of magnitude*, not the trailing digit. The
microbench raw output your laptop produces will differ by a factor of
~0.5–2× depending on CPU; the shape (relative ratios between
operations) is what should be stable.

## Full-stack reference

> _No full-stack reference captured yet._
>
> Boot the stack (`pnpm dev:wait`), then run
> `scripts/load-test-local.sh --no-baseline` on a dedicated perf box
> and paste the output here, replacing this block. Keep the hardware +
> config fences — the raw results fence is what the local script
> extracts for its diff mode.

## How to refresh

### Microbench
1. On the dedicated perf box (or your laptop if that's good enough):

   ```
   node scripts/microbench.mjs
   ```

2. Paste the output into the fenced block above. Round to the nearest
   significant figure.
3. Note the capture date + host info in the fenced hardware block.
4. Commit with a message like `perf: refresh microbench baseline`.

### Full-stack
1. SSH to the dedicated perf box.
2. Pull `main`, boot services (`pnpm dev:wait`), seed demo data.
3. Run:

   ```
   bash scripts/load-test-local.sh --no-baseline
   ```

4. Paste output into the "Full-stack reference" block.
5. Move the OLD reference into "Previous references" with a date header.
6. Commit.

## What a regression looks like

- **Microbench ops/s drops > 25%** on a repeat run of the same box →
  a hot-path op got slower. Common cause: an npm bump pulled in a slower
  implementation (bcrypt JS fallback instead of native, slower Intl).
- **Full-stack breaking-point concurrency drops** → a middleware or
  query got heavier.
- **p95 climbs > 20% at same concurrency** → not a hard rule; call it
  out in the PR description.
- **Error rate becomes non-zero** at nominal load → a bug.

## When to refresh

- Before cutting a release.
- After a schema change touching a hot query path.
- After a dependency bump that affects the request path (Prisma major,
  Express major, Node major, bcrypt lib switch).

Skip refreshing in docs-only or cold-path PRs — the noise outweighs the
signal.

## Previous references

<!-- Keep ~5 entries, oldest at the bottom. Prune older ones; git log
     retains the full history for auditing. -->
