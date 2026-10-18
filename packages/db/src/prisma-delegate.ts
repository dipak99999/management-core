import type { PrismaClient, Prisma } from "@prisma/client";

// Data-driven Prisma delegate lookup. Multiple places (workflow engine,
// report runner, dashboard resolver, bulk-actions, custom-fields uniqueness
// check) resolve a Prisma model's delegate by string (e.g. camelCase of a
// doctype). Prisma's generated types don't expose an index-signature for
// delegates, so callers had scattered `(prisma as any)[name]` — one `any`
// per call site.
//
// This helper centralizes the cast + typed the return so downstream code
// gets autocomplete on the common CRUD methods without needing to know the
// exact model type. Behavior is unchanged; type safety is a tiny bit better.

// Surface we invoke across the codebase. Findmany returns `Record<string,
// unknown>[]` so downstream `.map/.reduce` calls work without extra casts.
// aggregate + groupBy return `unknown` since their result shape is
// arg-dependent — callers cast to their expected shape.
export interface PrismaDelegateLike {
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
  updateMany(args: unknown): Promise<{ count: number }>;
  delete(args: unknown): Promise<Record<string, unknown>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  count(args?: unknown): Promise<number>;
  aggregate(args: unknown): Promise<Record<string, unknown>>;
  groupBy(args: unknown): Promise<Record<string, unknown>[]>;
}

// Returns the delegate or null if the name doesn't map to one (caller
// decides how to handle — usually throw with the requested name).
export function getPrismaDelegate(
  client: PrismaClient | Prisma.TransactionClient,
  name: string,
): PrismaDelegateLike | null {
  const c = client as unknown as Record<string, unknown>;
  const val = c[name];
  if (val && typeof val === "object" && "findFirst" in val) {
    return val as PrismaDelegateLike;
  }
  return null;
}
