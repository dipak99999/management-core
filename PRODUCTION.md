# Production playbook

Pre-flight checklist, deploy procedure, and the three hardening steps
that aren't on by default (because flipping them breaks the dev loop).

Read this top-to-bottom before your first production boot. The order
matters — some steps assume earlier ones are done.

---

## What's already production-grade

These are wired and defaulted correctly; you shouldn't need to touch
them beyond providing environment configuration.

| Area | Where |
|---|---|
| CORS allowlist (prod-strict, fails boot if `ALLOWED_ORIGINS` unset) | [packages/service-auth/src/security.ts](packages/service-auth/src/security.ts) |
| Security headers (CSP, HSTS, nosniff, frame-deny, Permissions-Policy) | [packages/service-auth/src/security.ts](packages/service-auth/src/security.ts) |
| Graceful shutdown (SIGTERM, drain, Prisma disconnect) | [packages/service-auth/src/graceful.ts](packages/service-auth/src/graceful.ts) |
| Health + readiness + Prometheus `/metrics` endpoints | [packages/service-auth/src/ops.ts](packages/service-auth/src/ops.ts) |
| Structured JSON logging (pino) + request-ids | [packages/service-auth/src/logger.ts](packages/service-auth/src/logger.ts), [ops.ts](packages/service-auth/src/ops.ts) |
| Error capture → ErrorLog table + redacted 500 responses | [ops.ts](packages/service-auth/src/ops.ts) |
| Rate limiting on auth + AI endpoints | [services/auth-service/src/index.ts](services/auth-service/src/index.ts), per-route limiters |
| OpenTelemetry (traces + metrics via OTLP/HTTP) | [packages/service-auth/src/otel.ts](packages/service-auth/src/otel.ts) |
| Prisma tenant-guard middleware (`TENANT_GUARD_MODE=enforce` in prod) | [packages/db/src/tenant-guard.ts](packages/db/src/tenant-guard.ts) |
| Env validation on service boot (fails fast on missing required vars) | [packages/service-auth/src/env-validator.ts](packages/service-auth/src/env-validator.ts) |
| CI: lint, typecheck, DB tests + coverage, service tests, Next build, Playwright e2e | [.github/workflows/ci.yml](.github/workflows/ci.yml) |
| Migration drift check in CI (schema.prisma must match migrations) | [.github/workflows/ci.yml](.github/workflows/ci.yml) |
| Dockerfiles (multistage) for services + web apps | [infra/docker/](infra/docker/) |
| docker-compose.prod.yml with `${VAR:?err}` fail-fast on missing secrets | [docker-compose.prod.yml](docker-compose.prod.yml) |
| One-shot migration runner container (blocks service boot until done) | [docker-compose.prod.yml](docker-compose.prod.yml) `migrate` service |
| Backup/restore verification workflow | [.github/workflows/backup-restore-verify.yml](.github/workflows/backup-restore-verify.yml) |

---

## Pre-flight checklist

Go through this before your first prod boot. Nothing on this list is
optional.

- [ ] **Generate real secrets.** All four of `JWT_SECRET`,
      `PORTAL_JWT_SECRET`, `UNSUBSCRIBE_SECRET`, `MASTER_SECRET_KEY`.
      Each 32+ chars. Use `openssl rand -hex 32`.
- [ ] **Back up `MASTER_SECRET_KEY` offsite.** Losing it bricks every
      TenantIntegration row (encrypted API keys for AI providers, SSO,
      SMTP, etc.) and every AnonymizationArchive. Store it in your
      org's secret vault + a sealed envelope.
- [ ] **Set `ALLOWED_ORIGINS`** to a comma-separated list of real
      origins (e.g. `https://app.example.com,https://portal.example.com`).
      Services refuse to boot in prod without it.
- [ ] **Set `PUBLIC_URL`** to the user-facing base URL. Shows up in
      email links, invoice PDFs, OAuth redirects.
- [ ] **Set `PORTAL_PUBLIC_URL`** separately — customer portal usually
      lives on its own subdomain.
- [ ] **Pick a real SMTP** (SES / SendGrid / Postmark / Mailgun) and
      set the `SMTP_*` vars. Without this, password resets + digests
      silently no-op.
- [ ] **Set `REDIS_URL`** to a real Redis. Without it queues run inline
      and don't persist across restarts — fine for a demo, catastrophic
      for anything with retries or scheduled jobs.
- [ ] **Set `OTEL_EXPORTER_OTLP_ENDPOINT`** to your trace/metrics
      collector. Without it the services run blind.
- [ ] **Set `APP_VERSION`** to the deploying git SHA. Surfaces in logs
      and OTel attributes — invaluable for correlating incidents.
- [ ] **Set `TENANT_GUARD_MODE=enforce`** once you've watched `warn`
      logs for ~a week in staging without legitimate violations.
      Enforce mode makes a cross-tenant query throw instead of just
      log — turning it on with real violations present will 500 those
      requests.
- [ ] **TLS termination.** Services bind HTTP on local ports; put
      Caddy, nginx, or a managed load balancer in front with real
      certs. HSTS auto-emits only when `NODE_ENV=production`.
- [ ] **Database backups** scheduled + verified. Our restore-verify
      CI workflow proves the dump can be reloaded; make sure something
      similar runs on your real DB.
- [ ] **DB connection pool limits** sized for your instance. Prisma
      defaults to 2× num_cpus connections per service process. With
      7 services × N replicas × 2×cpus, you can exhaust the DB fast —
      cap via `?connection_limit=…` on `DATABASE_URL`.
- [ ] **Scheduled Postgres `VACUUM / ANALYZE`.** Auto-vacuum is on by
      default but tune `autovacuum_vacuum_scale_factor` down for the
      hot tables (`gl_entries`, `sales_invoices`, `embeddings`).

---

## Deploy procedure (Docker Compose target)

```bash
# 1. Clone + build on the box
git clone <repo> /opt/lumaara
cd /opt/lumaara
cp .env.example .env
# edit .env — fill in every secret from the checklist above
chmod 600 .env

# 2. Validate the compose stack (fails loud if any secret is missing)
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet

# 3. First boot: migrations run automatically via the `migrate` container,
#    then all services start.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 4. Watch health come up (every service exposes /health + /health/ready)
for p in 4001 4002 4003 4004 4005 4006 4109; do
  curl -sf http://localhost:$p/health/ready | jq .ok
done

# 5. Seed demo data (OPTIONAL, prod should skip)
# docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#   run --rm migrate pnpm --filter @lumaara/db seed
```

Subsequent deploys: `git pull && docker compose … up -d` — the
`migrate` container reruns `prisma migrate deploy` (no-op when there
are no new migrations), then rolling-restarts the services.

---

## Three hardening steps that aren't on by default

Each of these is wired but opt-in. Flip them in staging first.

### 1. Activate RLS context propagation (DB-layer tenant isolation)

Currently services connect to Postgres as the `postgres` superuser.
Row-Level Security policies exist on 5 financial tables (see
[docs/RLS.md](docs/RLS.md) for the POC + full extension pattern) but
superuser connections bypass RLS. Flipping to the `lumaara_app` role
+ enabling `RLS_ENFORCE=true` activates DB-level enforcement in
addition to the existing Prisma tenant-guard middleware.

**Steps:**

1. Create a strong password for `lumaara_app` and rotate it in prod:
   ```sql
   ALTER USER lumaara_app WITH PASSWORD '<openssl-rand-hex-24>';
   ```
2. Update `DATABASE_URL` in your prod env to use `lumaara_app`:
   ```
   DATABASE_URL=postgresql://lumaara_app:<pw>@postgres:5432/lumaara?schema=public
   DATABASE_ADMIN_URL=postgresql://postgres:<pg-pw>@postgres:5432/lumaara?schema=public
   ```
   The `ADMIN_URL` stays as superuser for `prisma migrate deploy`.
3. Set `RLS_ENFORCE=true` in your prod env. The Prisma `$extends`
   wrapper in [packages/db/src/rls-context.ts](packages/db/src/rls-context.ts)
   now wraps every tenant-scoped query in a transaction that sets
   `app.current_tenant_id` from AsyncLocalStorage.
4. Install `runWithTenant(tenantId, next)` in `requireAuth` in
   [packages/service-auth/src/index.ts](packages/service-auth/src/index.ts)
   so every authed request carries its tenantId into ALS.
5. **Migrate multi-statement handlers to `withTenantTx`.** The
   `withRlsExtension` wrapper can only bind the tenant for a single op
   — a route that calls `prisma.$transaction(async (tx) => { ... })`
   runs each statement in its own child-tx and the tenant setting
   doesn't propagate. Replace those with the shared helper:

   ```ts
   // Before:
   await prisma.$transaction(async (tx) => {
     const inv = await tx.salesInvoice.create({ data });
     await tx.gLEntry.createMany({ data: lines });
     return inv;
   });

   // After:
   import { withTenantTx } from "@lumaara/db";
   await withTenantTx(prisma, async (tx) => {
     const inv = await tx.salesInvoice.create({ data });
     await tx.gLEntry.createMany({ data: lines });
     return inv;
   });
   ```

   `withTenantTx` is a no-op pass-through when `RLS_ENFORCE=false`, so
   it's safe to adopt everywhere ahead of the switch. The scope is
   roughly 100 call sites across the services; grep for `\$transaction`.
6. Deploy to staging. Watch logs for `permission denied` errors —
   those indicate routes that bypassed the extension (super-admin
   cross-tenant queries need `runAsSuperAdmin()` + `withSuperAdmin()`).
7. Verify: as `lumaara_app`, `SELECT COUNT(*) FROM customers` should
   return 0 without a tenant context set, and the tenant's actual
   count when `SET LOCAL app.current_tenant_id = '<id>'` is set.

### 2. Extend RLS to all 193 tenant-scoped tables

The POC covers `customers`, `sales_invoices`, `payment_entries`,
`gl_entries`, `salary_slips`. Full extension pattern + runbook lives
at [docs/RLS.md](docs/RLS.md). ~2-3 hours of migration-writing;
biggest single security hardening available.

### 3. Modularize the Postgres schema (optional)

Full plan at [docs/SCHEMA-MODULARIZATION.md](docs/SCHEMA-MODULARIZATION.md).
The POC moved `SubscriptionPlan + TenantSubscription` to a `platform`
schema. Extending to five module schemas (hrms, payroll, finance,
sales, manufacturing) lets you grant per-schema roles so a compromised
HR service literally cannot `SELECT` accounting rows. 1-2 week effort.

---

## Secret rotation

### Rotating `JWT_SECRET` or `PORTAL_JWT_SECRET`

Invalidates every active session. Users must re-login. No data loss.

1. Generate new secret: `openssl rand -hex 32`
2. Deploy with the new value.
3. All existing JWTs fail verification; users bounce to login.

### Rotating `MASTER_SECRET_KEY` (the hard one)

Every encrypted blob (`TenantIntegration.secrets`,
`AnonymizationArchive`, `PlatformAiProvider.secrets`) must be
re-encrypted. Procedure:

1. Set `MASTER_SECRET_KEY_OLD=<current>` AND `MASTER_SECRET_KEY=<new>`.
2. Run the re-encrypt script (write one — not yet checked in):
   decrypt each row with `MASTER_SECRET_KEY_OLD`, re-encrypt with the
   new key, write back. Transactions on each row to avoid partial
   corruption.
3. Verify: `SELECT COUNT(*) FROM tenant_integrations WHERE secrets IS
   NOT NULL;` → every row should decrypt cleanly under the new key.
4. Remove `MASTER_SECRET_KEY_OLD` from env.

**If you lose `MASTER_SECRET_KEY` without a backup:** encrypted rows
are permanently unrecoverable. Super Admin → AI Providers rows and
TenantIntegration credentials will need to be re-entered. Audit log
history remains readable (not encrypted).

### Rotating `SCHEDULER_API_TOKEN`

Rolling restart safe — set `SCHEDULER_API_TOKEN=<old>,<new>` in
services first (if we add multi-token support — currently only
single), redeploy scheduler with just `<new>`.

---

## Observability runbook

The services emit:

- **Structured JSON logs** (pino) with `requestId`, `tenantId`,
  `userId`, `method`, `path`, `status`, `durMs`. One line per
  request. Ship stdout to Loki / CloudWatch / Datadog.
- **Prometheus `/metrics`** on each service. Scrape with:
  ```
  - job_name: lumaara
    static_configs:
      - targets:
          - auth-service:4001
          - accounting-service:4002
          - ...
  ```
  Metrics include request count by route+status, p50/p95/p99 latency,
  Prisma query count.
- **OpenTelemetry traces** when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
  Auto-instruments Express + Prisma + HTTP clients. One trace per
  request, spans across service boundaries via `x-request-id`.

**Alert on:**
- `/health/ready` returning non-200 for > 1 minute (DB connectivity
  lost).
- Any 5xx rate above baseline (every 500 has a stack trace in
  `error_logs` + the service's logs).
- `[tenant-guard]` warn lines in logs after enforcement — those are
  code paths that got the `tenantId` filter wrong.
- Scheduler jobs failing more than 3 times in a row (BullMQ dead-letter
  queue grows).

---

## What's deferred

Items from the earlier evaluation that are documented but not shipped:

| Item | Doc | Why deferred |
|---|---|---|
| Full RLS on all 193 tables | [docs/RLS.md](docs/RLS.md) | 2-3h of mechanical migration work; POC proves pattern |
| Modular DB schema (5 schemas) | [docs/SCHEMA-MODULARIZATION.md](docs/SCHEMA-MODULARIZATION.md) | 1-2 week effort; POC moved 2 tables |
| `MASTER_SECRET_KEY` rotation script | *not checked in* | Write when you first need to rotate — low urgency |
| Automated SBOM + dependency vuln scan on CI | — | Add `pnpm audit` + `osv-scanner` step to ci.yml when ready |
| Multi-region / HA Postgres | — | Depends on your deployment target; patroni / Aurora / Crunchy etc. |

---

## Multi-region HA — decision tree

Lumaara ships as a stateless service tier + one Postgres + one Redis.
Making it multi-region HA means picking a Postgres topology; the service
tier scales horizontally once the DB story is sorted. There's no app
change needed — services pick the right DB via `DATABASE_URL`.

### Scope: what "multi-region HA" actually means

| Goal | What you need |
|---|---|
| **Zero-downtime deploys** | 2+ service replicas behind the LB (already supported — services are stateless). No DB change. |
| **Single-AZ HA (any one node can die)** | Postgres with a hot standby in the same region. 1 min RTO. |
| **Cross-region DR (RTO < 1h)** | Async replica in another region + runbook'd failover. Reads may be stale by seconds. |
| **Active-active across regions** | Not supported. Lumaara assumes a single-primary Postgres — Prisma transactions + RLS SET LOCAL break under multi-master. |

### Postgres topology options

Pick ONE based on your operational posture. All options work with the
app code as-is; only `DATABASE_URL` + `DATABASE_ADMIN_URL` change.

#### A. Managed single-AZ (simplest, dev + small-prod)
- RDS / Cloud SQL / Supabase / Neon with daily snapshots + PITR.
- RTO: minutes (restore from backup).
- RPO: 5 min (PITR) or 24 h (snapshot).
- **Set:** `DATABASE_URL=postgresql://…?connection_limit=20&pool_timeout=30`
- **Monitor:** `/health/ready` on each service; Postgres connection count; disk usage.

#### B. Managed multi-AZ (recommended production baseline)
- AWS RDS Multi-AZ, GCP Cloud SQL HA, Azure Database for PostgreSQL (Flexible — HA mode).
- Synchronous standby in a second AZ; auto-failover on primary failure (~60s).
- RTO: 60s. RPO: 0.
- Cost: ~2× single-AZ.
- **Set:** `DATABASE_URL` points at the HA endpoint; failover is transparent to the app.
- **Monitor:** replication lag ≈ 0 under normal load; alert on > 1s.

#### C. Patroni + etcd (self-hosted HA)
- 3-node Postgres cluster (1 primary + 2 replicas) coordinated by Patroni + etcd + HAProxy.
- Self-managed replacement for RDS Multi-AZ. Only worth it if your org already runs k8s/VMs and wants to avoid managed-DB vendor lock-in.
- Tutorials: Zalando's Patroni + Spilo, Crunchy Postgres Operator.
- Works unchanged with Lumaara — Patroni promotes a replica + HAProxy swings traffic.

#### D. Cross-region DR (async replica)
- Primary in region A, read-replica in region B.
- On region-A failure: promote B, update DNS. RTO 10-30 min (manual) or <5 min (automated).
- RPO: seconds of lag.
- **Note:** reads from the replica are allowed for analytics/reports but Lumaara does NOT currently support read-write splitting — all queries go to the primary endpoint until failover.

#### E. Globally-distributed (CockroachDB / Yugabyte)
- NOT currently supported. These speak Postgres wire protocol but their transaction semantics differ enough that Prisma + RLS + our scheduler leader-lock pattern haven't been tested. If you need this, open an issue first.

### Redis topology
Lumaara uses Redis for:
- BullMQ (background jobs, scheduler)
- Rate limits (shared counters across replicas — see `rate-limit-redis-store.ts`)

Both tolerate a brief Redis outage: BullMQ reconnects; rate limits
return a safe no-op (count=1) during an outage. For prod use ElastiCache
Multi-AZ, Memorystore HA, or a 3-node Redis Sentinel cluster.

### Service-tier scaling
- Services are stateless. Scale `auth-service`, `accounting-service`,
  etc. horizontally with no code change.
- `scheduler` MUST stay single-leader. The built-in Postgres advisory
  lock in `services/scheduler/src/lib/leader-lock.ts` enforces this —
  you can run multiple scheduler replicas; only one becomes active
  leader at a time, the others stand by.
- `mcp-server` can scale horizontally; sessions are keyed by SSE id.

### Backup + restore
- CI job `.github/workflows/backup-restore-verify.yml` already proves
  restore-from-dump works against a fresh DB.
- In production, schedule `pg_dump` or use your managed DB's PITR +
  periodic snapshot-to-S3. Keep at least 30 days.
- Verify monthly by restoring to a staging DB and running smoke tests.

### What to do first
If you're deploying to production for the first time:
1. Start with **Option B** (managed multi-AZ). It's the right default
   for 99% of prod deployments — minimal operational overhead, 60s
   failover, 0 RPO.
2. Add Redis Multi-AZ for the queue + rate-limit tier.
3. Scale services to 2+ replicas per service for zero-downtime deploys.
4. Set up a cross-region replica (**Option D**) once you have paying
   customers and need the RTO/RPO story for SLAs.
