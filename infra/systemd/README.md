# systemd deploy — quick reference

Full walkthrough lives in [docs/DEPLOY-BAREMETAL.md](../../docs/DEPLOY-BAREMETAL.md). This file is a per-unit map for on-call.

## Units in this directory

| Unit | Role | Depends on | Notes |
|---|---|---|---|
| `lumaara-migrate.service` | one-shot | postgresql | Runs `prisma migrate deploy` and exits. Every other unit's `After=` includes this. |
| `lumaara-auth.service` | backend :4001 | migrate | JWT issuance, signup/login |
| `lumaara-accounting.service` | backend :4002 | migrate, postgres, redis | Sales/purchase invoices, GL, payments |
| `lumaara-crm.service` | backend :4004 | migrate | Leads/opps/campaigns |
| `lumaara-hr.service` | backend :4005 | migrate | Employees/payroll/leave |
| `lumaara-projects.service` | backend :4006 | migrate | Projects/tasks/timesheets |
| `lumaara-stock.service` | backend :4003 | migrate | Inventory/warehouses |
| `lumaara-scheduler.service` | backend :4009 | migrate, redis | Cron jobs (recurring invoices, sweeps) |
| `lumaara-web-*.service` (× 8) | Next.js apps :3000-3007 | backends | Standalone Next.js bundles |
| `lumaara.target` | umbrella | all above | `systemctl start lumaara.target` = full boot |

## Why `pnpm start` (not `node dist/index.js`)

Every backend service is a TypeScript app that imports from workspace packages like `@lumaara/db`, `@lumaara/service-auth`. Those packages ship **source `.ts` files as their `main` entry**, not compiled JS. When you `tsc` a service, the compiler resolves those imports to source files and emits a deeply-nested `dist/services/<name>/src/index.js` — but at runtime, Node can't load the `.ts` files those imports resolve to.

Two options, we chose the pragmatic one:

1. **What we do**: `pnpm start` runs `tsx src/index.ts`. `tsx` transpiles on-the-fly, is fast, is used in prod by many companies. First-request cost is negligible after warmup.
2. **The refactor**: build every workspace package to JS with proper `main` entries pointing at `dist/`. That's a workspace-wide change (packages/*/package.json + tsconfig + build scripts). Deferred as a separate initiative.

If you notice memory or startup-time issues under real load, revisit option 2.

## Install (one-time per host)

```bash
# 1. System user + dirs
sudo useradd --system --home /opt/lumaara --shell /usr/sbin/nologin lumaara
sudo mkdir -p /opt/lumaara /etc/lumaara /var/log/lumaara /var/lumaara/backups
sudo chown -R lumaara:lumaara /opt/lumaara /var/log/lumaara /var/lumaara

# 2. Deploy the code (rsync or git clone into /opt/lumaara). Run pnpm install
#    + pnpm build once from an ops shell as the lumaara user.
sudo -u lumaara -H bash -c 'cd /opt/lumaara && pnpm install --frozen-lockfile && pnpm build'

# 3. Drop the env file (chmod 600!)
sudo cp /path/to/prepared-env /etc/lumaara/env
sudo chmod 600 /etc/lumaara/env
sudo chown lumaara:lumaara /etc/lumaara/env

# 4. Install units + readiness probe helper
sudo cp infra/systemd/*.service infra/systemd/*.target /etc/systemd/system/
sudo install -m 0755 infra/systemd/wait-ready.sh /opt/lumaara/infra/systemd/wait-ready.sh
sudo systemctl daemon-reload
sudo systemctl enable lumaara.target

# 5. First boot — migrations run, then backends, then frontends
sudo systemctl start lumaara.target
sudo systemctl status lumaara-migrate lumaara-auth lumaara-accounting
```

## Common ops

```bash
# Rolling restart of a single service (5-10s downtime for that service only)
sudo systemctl restart lumaara-accounting

# Rolling restart of ALL services (Reload doesn't work — nodejs doesn't handle SIGHUP)
sudo systemctl restart 'lumaara-*.service'

# Watch startup + subsequent logs (JSON structured; pipe to jq for humans)
sudo journalctl -u lumaara-accounting -f -o cat | jq

# After merging a schema change: re-run migrations, then restart backends
sudo systemctl restart lumaara-migrate
sudo systemctl restart 'lumaara-*-service.service'

# Confirm every unit is healthy
sudo systemctl status 'lumaara-*.service' 'lumaara-web-*.service'
```

## Readiness probes

Every backend unit uses `ExecStartPost=/opt/lumaara/infra/systemd/wait-ready.sh <port> 60`
so `systemctl start` doesn't return until the app answers `/health/ready` with
a 200. Consequence: a rolling restart of a single unit never causes a 502 at
nginx — the socket only enters the ready set once the DB pool is up + Prisma
has finished attaching tenant-guard. If the probe misses its 60s deadline the
unit is marked failed and the Restart=on-failure backoff kicks in.

## What to check when a unit fails to start

1. `sudo journalctl -u <unit> --since '5 min ago'` — the actual error.
2. `/etc/lumaara/env` — every required secret present, all ≥32 chars.
3. Port collision: `sudo ss -tlnp | grep :4002` — anything else listening?
4. DB reachability: `sudo -u lumaara pg_isready -h $DB_HOST`.
5. Working directory exists + `pnpm install` completed: `sudo -u lumaara ls /opt/lumaara/services/accounting-service/node_modules`.
