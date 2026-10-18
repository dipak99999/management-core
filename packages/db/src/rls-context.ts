// RLS context propagation.
//
// When services connect as the NOSUPERUSER role `lumaara_app`, every
// tenant-scoped SELECT returns 0 rows unless `app.current_tenant_id` is
// set on the connection. This file wires that up transparently:
//
//   1. runWithTenant(tenantId, fn)   — AsyncLocalStorage carrying the
//                                       current request's tenantId
//   2. withRlsExtension(prisma)      — Prisma `$extends` wrapper that
//                                       wraps every tenant-scoped query
//                                       in a transaction and SET LOCAL
//                                       app.current_tenant_id = <tenant>
//
// Opt-in: only active when RLS_ENFORCE=true. Default behaviour (RLS off,
// services connect as superuser) is unchanged. Once the operator flips
// the switch AND rotates DATABASE_URL to lumaara_app, RLS is enforced
// at the DB layer in addition to the existing tenant-guard Prisma
// middleware + application-side `where: { tenantId }` filtering.
//
// Super-admin cross-tenant queries must opt out via runAsSuperAdmin() —
// they bypass the auto-wrap and let the caller use withSuperAdmin() from
// ./rls.ts explicitly.

import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import { TENANT_SCOPED_MODELS } from "./tenant-guard";

interface RlsFrame {
  tenantId: string | null;
  bypassRls: boolean;
  // Set to true inside the transaction-wrap below so a nested Prisma call
  // (re-dispatched through the tx client, which still carries this
  // extension in Prisma 5+) short-circuits instead of wrapping again.
  // Without this, every nested call would open a savepoint and could
  // infinite-recurse if the extension keeps re-firing on tx operations.
  insideWrap?: boolean;
}

const rlsStore = new AsyncLocalStorage<RlsFrame>();

/**
 * Run `fn` with the given tenantId bound to the async context. Any
 * Prisma query made inside this closure (sync or async) will be wrapped
 * in a transaction that sets `app.current_tenant_id` before running.
 *
 * Install this in your request pipeline (typically in requireAuth, right
 * after you resolve the authed user):
 *
 *   return runWithTenant(req.auth.tenantId, () => next());
 */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return rlsStore.run({ tenantId, bypassRls: false }, fn);
}

/**
 * Super-admin opt-out: run `fn` with no tenant context. Prisma queries
 * will NOT be auto-wrapped. The caller is responsible for using
 * `withSuperAdmin()` explicitly to set `app.bypass_rls=true` where
 * policies allow it.
 */
export function runAsSuperAdmin<T>(fn: () => T): T {
  return rlsStore.run({ tenantId: null, bypassRls: true }, fn);
}

export function currentTenantId(): string | null {
  return rlsStore.getStore()?.tenantId ?? null;
}

/**
 * Multi-statement transaction wrapper that binds `app.current_tenant_id`
 * for the entire tx. Use this instead of `prisma.$transaction(...)` in
 * route handlers when RLS_ENFORCE=true is a target configuration.
 *
 * Why: the `withRlsExtension` query extension can only wrap single
 * operations — when it's handed a tx-bound op it doesn't know which
 * outer tx it belongs to, so it opens its own. That produces
 * SAVEPOINT-nesting and isolation surprises (different txs can't see
 * each other's uncommitted writes).
 *
 * `withTenantTx` opens ONE tx, runs SET LOCAL app.current_tenant_id on
 * it, marks the ALS frame as "insideWrap", and runs the callback. Every
 * nested query the callback issues sees the tenant setting and the
 * extension short-circuits.
 *
 *   await withTenantTx(prisma, async (tx) => {
 *     const inv = await tx.salesInvoice.create({ data: ... });
 *     await tx.gLEntry.createMany({ data: ... });
 *     return inv;
 *   });
 *
 * No-op pass-through when RLS_ENFORCE is false: just calls
 * `prisma.$transaction(fn)` directly. Safe to adopt everywhere without
 * waiting for the RLS switch.
 */
export async function withTenantTx<T>(
  client: PrismaClient,
  fn: (
    tx: Omit<
      PrismaClient,
      "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
    >,
  ) => Promise<T>,
): Promise<T> {
  if (!RLS_ENFORCE) {
    // When the extension is a no-op, there's no nested-tx hazard —
    // behave exactly like plain $transaction.
    return client.$transaction(fn);
  }
  const frame = rlsStore.getStore();
  const tenantId = frame?.tenantId;
  return client.$transaction(async (tx) => {
    if (tenantId) {
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        tenantId,
      );
    }
    // Mark the ALS so the extension's $allOperations short-circuits for
    // every call made inside this tx — the SET LOCAL above handles the
    // RLS binding for all of them.
    return rlsStore.run(
      { tenantId: tenantId ?? null, bypassRls: frame?.bypassRls ?? false, insideWrap: true },
      () => fn(tx),
    );
  });
}

const RLS_ENFORCE = process.env.RLS_ENFORCE === "true";

/**
 * Wrap a PrismaClient so every tenant-scoped query runs inside a
 * transaction that sets `app.current_tenant_id`. No-op when
 * RLS_ENFORCE != true (default, so this is safe to install everywhere).
 */
// NOTE: typed as `any` on purpose. Prisma's `$extends` generates a
// union over all 426 models, which exceeds TypeScript's "complex
// union type" ceiling (TS2590). Narrowing with explicit model keys
// defeats the purpose (the extension IS the catch-all). The returned
// shape is still structurally a PrismaClient — just not reflected in
// the type system here. Call sites get back `PrismaClient` typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withRlsExtension<P extends PrismaClient>(client: P): P {
  if (!RLS_ENFORCE) return client;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extend = (client as any).$extends.bind(client);
  return extend({
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }
          const frame = rlsStore.getStore();
          const tenantId = frame?.tenantId;
          // Already inside an RLS tx wrap (nested call re-dispatched
          // through tx[model][op]). Second firing of this extension on
          // the tx client — skip the wrap and let the SET LOCAL that's
          // already active on this connection apply.
          if (frame?.insideWrap) return query(args);
          // No tenant context: either a super-admin cross-tenant query
          // (opt-in via runAsSuperAdmin / withSuperAdmin) or a bug.
          // Let the query run; RLS at the DB layer clamps to zero rows
          // for anything the role lacks a policy for. That's loud
          // enough — the alternative (throwing) would false-positive
          // on super-admin paths that set app.bypass_rls=true.
          if (!tenantId) return query(args);
          // Wrap in a transaction and bind the setting for its scope.
          // `set_config(.., ..., true)` is transaction-local so there's
          // no risk of pool-connection leakage into the next request.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return client.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe(
              `SELECT set_config('app.current_tenant_id', $1, true)`,
              tenantId,
            );
            // Mark the ALS frame so nested extension firings on this tx
            // short-circuit above instead of trying to open a nested wrap.
            return rlsStore.run(
              { tenantId, bypassRls: false, insideWrap: true },
              () => {
                const delegate = tx[lowerFirst(model)];
                const op = operation ?? (query as { name?: string }).name;
                if (delegate && op && typeof delegate[op] === "function") {
                  return delegate[op](args);
                }
                // Last-resort fallback for operations we can't look up by
                // name (e.g. $raw* variants). The SET LOCAL is still active
                // on `tx`, but query() runs on the root client so this path
                // offers no RLS protection — flag loudly if we hit it.
                console.warn(
                  `[rls] cannot dispatch ${model}.${op ?? "?"} through tx; falling back to root client (no RLS binding)`,
                );
                return query(args);
              },
            );
          });
        },
      },
    },
  });
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}
