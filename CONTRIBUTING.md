# Contributing to lumaara

Welcome. This is a monorepo that runs as ~7 microservices behind a Next.js shell + microfrontends. See `docs/ARCHITECTURE.md` for the shape.

## Local setup

```bash
# 1. Install
pnpm install

# 2. Bring up Postgres
docker compose up postgres -d

# 3. Generate Prisma client + apply migrations
pnpm --filter @lumaara/db exec prisma generate
pnpm --filter @lumaara/db exec prisma migrate dev

# 4. Seed a demo tenant (optional, idempotent)
pnpm --filter @lumaara/db seed:demo
# admin: demo@lumaara.local / demo1234, tenant: demo

# 5. Run everything (each service on its own port)
pnpm dev
```

## Repo layout

```
apps/           Next.js microfrontends (shell + accounting-web + …) + portal-web
services/      Node/Express microservices (auth, accounting, stock, crm, hr, projects)
packages/db    Prisma schema + shared helpers (GL, tax, salary formula, CSV, dashboards, print-config, events)
packages/print @react-pdf/renderer templates for every printable doctype
packages/service-auth  Shared JWT middleware, perms, portal-auth, ops (logger + metrics)
packages/shared-types  Type-only DTOs shared across services
infra/         Dockerfiles + compose
```

## Adding a business feature

Every new feature roughly follows the same shape:

1. **Schema** — edit `packages/db/prisma/schema.prisma`, add back-relation on `Tenant`, register in `packages/db/src/seed-roles.ts` under `DOCTYPES`.
2. **Route** — add a router file under `services/<domain>-service/src/routes/` and mount it in `src/index.ts`. Use `perms("Doctype")` from `@lumaara/service-auth` for auth.
3. **UI** — add a page under `apps/<domain>-web/app/…`. Cross-service calls go via the `NEXT_PUBLIC_<SERVICE>_URL` env var.
4. **Naming** — always run `nextName(prisma, tenantId, "PREFIX-")` for user-facing doc numbers.
5. **GL** — post via `postGLEntries` from `packages/db/src/gl-posting.ts`. The debit=credit invariant is enforced.

## Testing

Unit tests live next to the code they test (`foo.ts` + `foo.test.ts`). Run:

```bash
pnpm --filter @lumaara/db test
pnpm --filter @lumaara/db test:watch
```

CI runs the same on every push. See `.github/workflows/ci.yml`.

Priority order for adding tests: **pure helpers first** (GL, tax, salary formula, CSV, dashboards, HMAC), then route-level integration once we have a shared test-tenant fixture.

## Coding style

- **TypeScript strict on.** Prefer explicit types over `any`. Where DB types are messy, cast at the boundary — never leak `any` up.
- **One transaction per business operation.** If two writes need to be atomic, wrap in `prisma.$transaction`.
- **Multi-tenancy** — every read/write MUST filter by `tenantId`. Copy from an existing route rather than write from scratch.
- **Comments** — explain WHY, not WHAT. If the WHY is obvious, don't comment.
- **Naming** — camelCase in TypeScript, snake_case in JSON (custom fields).

## Committing

- Follow Conventional Commits: `feat(accounting): …`, `fix(hr): …`, `chore(deps): …`.
- Include a short "what" in the subject and a "why" in the body when it's non-obvious.
- CI must be green before merge.
