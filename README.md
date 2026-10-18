# lumaara

A modern, multi-tenant SaaS ERP inspired by ERPNext and Zoho. Node/Express microservices, Next.js microfrontends, PostgreSQL.

## Status

**First vertical slice.** Working end-to-end: signup → login → create Customer → create Sales Invoice. Everything else is coming module-by-module.

## Architecture

```
apps/
  shell/              Next.js host  (port 3000)  - login, nav, proxies to remotes
  accounting-web/     Next.js remote (port 3001) - Customer, Sales Invoice screens
services/
  auth-service/       Express + Prisma (port 4001) - signup, login, JWT, tenants
  accounting-service/ Express + Prisma (port 4002) - Customer, Item, SalesInvoice
packages/
  shared-types/       Cross-package TS types (JWT claims, DTOs)
  db/                 Prisma schema + client (shared across services)
```

**Multi-tenancy:** shared PostgreSQL. Every business row has `tenantId`. Every request carries a JWT with `tenantId`; middleware injects it, and Prisma queries always filter by it.

## Prerequisites

- Node 20+
- pnpm 9+
- Postgres 14+ (either Docker + docker-compose, OR a native install)

## Quick start — one command

```bash
pnpm bootstrap
```

This runs `scripts/bootstrap.sh`, which:
1. Checks Node / pnpm / Postgres prerequisites
2. Installs dependencies
3. Copies `.env.example` → `.env` if missing
4. Starts Postgres (auto-detects: Docker > native)
5. Generates the Prisma client + applies all migrations
6. Seeds the base tenants (`acme`, `demo`) and the demo masters (2 customers, 2 suppliers, 2 items, 1 Sales Invoice)
7. Validates the seed

Then:

```bash
pnpm dev          # boots all 8 web apps + 8 services
# open http://localhost:4556
# log in: demo@lumaara.local / demo1234   (tenant slug: demo)
```

To wipe and reseed (DESTROYS DATA):

```bash
pnpm bootstrap:reset
```

Bootstrap flags:
- `--skip-install` — don't run `pnpm install`
- `--skip-postgres` — assume Postgres already running on `$DATABASE_URL`
- `--prefer-native` — use native Postgres even if Docker is available
- `--reset` — drop + recreate the DB (interactive confirm)

## Manual steps (if you prefer)

```bash
cp .env.example .env
pnpm install

# Start Postgres (leave running)
docker compose up -d postgres          # OR: brew services start postgresql@16

# Generate Prisma client + apply migrations
pnpm db:generate
pnpm db:deploy

# Seed base tenants + demo data
pnpm db:seed
pnpm db:seed:demo

# Run everything (services + apps) in parallel
pnpm dev
```

Then open http://localhost:4556.

## What's here vs. what's next

**Here (first slice):**
- Auth service: signup creates a tenant + admin user; login issues JWT
- Accounting service: Customer + SalesInvoice CRUD, tenant-scoped
- Shell app: login, layout, proxies `/accounting/*` to the accounting-web remote
- Accounting-web app: Customer list/create, Sales Invoice list/create

**Not here yet:**
- Item master, Purchase Invoice, Payment Entry, Journal Entry, GL, reports
- Workflow engine (approvals)
- Fine-grained roles/permissions (only admin for now)
- Multi-currency, tax templates, item pricing
- Other modules: CRM, Stock, Manufacturing, Projects, HR

## Notes vs. ERPNext

Data model deliberately mirrors ERPNext DocType names (Customer, Item, Sales Invoice) so porting logic stays mechanical. Field names use camelCase per JS convention; ERPNext uses snake_case.
