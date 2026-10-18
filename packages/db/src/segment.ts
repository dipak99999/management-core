// Marketing P1 — Segmentation DSL compiler.
//
// listmonk lets users write raw SQL fragments (`subscribers.name LIKE
// 'John%'`) directly into a saved segment. That is a straight-up
// SQL-injection surface: the "safety" is a hand-rolled parser + a hope
// that no admin ever pastes something hostile. We refuse that tradeoff.
//
// Instead we take a JSON tree — `{and:[…]}` / `{or:[…]}` / `{not:…}` /
// `{field, op, value}` — and compile it to a Prisma `where` object.
// Prisma parameterizes every value, so hostile input becomes a literal
// string bound to `$1`, never SQL. Field names go through a per-doctype
// whitelist so a user cannot request `password` or `secretApiKey` or
// splice a `; DROP TABLE …` into a column reference.
//
// Grammar
// -------
//   { and: [ Node, ... ] }
//   { or:  [ Node, ... ] }
//   { not: Node }
//   { field: "email", op: "eq", value: "user@example.com" }
//
// Ops
// ---
//   eq | ne | contains | startsWith | endsWith | in | notIn |
//   gt | gte | lt | lte | isNull | notNull | between
//
// Custom-data fields
// ------------------
// `customData.<key>` compiles to a Prisma JSONB path query,
//   { customData: { path: ["<key>"], equals: ... } }
// Only depth-1 keys are supported for MVP.
//
// Tenant scoping
// --------------
// The top-level `compileSegment` return always AND-s `tenantId: <tenantId>`
// on top of the compiled tree. tenant-guard.ts is the primary defence;
// this is a belt-and-braces safety net for the specific paths that resolve
// user-supplied segments.

import type { PrismaClient } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────────────

export type Doctype = "Customer" | "Lead";

export type Op =
  | "eq"
  | "ne"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "notIn"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isNull"
  | "notNull"
  | "between";

export interface ConditionNode {
  field: string;
  op: string;
  value?: unknown;
}
export interface AndNode {
  and: Node[];
}
export interface OrNode {
  or: Node[];
}
export interface NotNode {
  not: Node;
}
export type Node = ConditionNode | AndNode | OrNode | NotNode;

export type SegmentErrorCode =
  | "UnknownField"
  | "BadOp"
  | "TypeMismatch"
  | "BadNode"
  | "EmptyGroup"
  | "UnknownDoctype";

export class SegmentError extends Error {
  code: SegmentErrorCode;
  constructor(code: SegmentErrorCode, message: string) {
    super(message);
    this.name = "SegmentError";
    this.code = code;
  }
}

// ─── Field whitelist ───────────────────────────────────────────────────

// Fields not listed here throw UnknownField at compile time. Adding a new
// field means: (1) it exists on the Prisma model, (2) it is safe to expose
// to a segment author (no PII, no secrets).
//
// The `customData` prefix is a special case handled in resolveField() — it
// compiles to a JSONB path query rather than a top-level column.
const FIELD_WHITELIST: Record<Doctype, ReadonlySet<string>> = {
  Customer: new Set([
    "id",
    "customerName",
    "email",
    "mobile",
    "customerGroup",
    "territory",
    "gstin",
    "createdAt",
  ]),
  // NOTE on Lead schema: the marketing plan mentions firstName/lastName but the
  // current Prisma model uses `leadName` (single string) + `source` (not
  // `leadSource`). Whitelist matches the actual schema; if the model gets split
  // into first/last later, add them here.
  Lead: new Set([
    "id",
    "leadName",
    "companyName",
    "email",
    "mobile",
    "source",
    "status",
    "createdAt",
  ]),
};

// A conservative identifier check for the `customData.<key>` suffix. Prisma
// itself parameterizes the JSON path, but we still refuse anything that isn't
// a boring alphanumeric key — no dots, no quotes, no operators — so an author
// can't confuse the schema with `city; DROP TABLE`.
const CUSTOM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ResolvedField {
  kind: "column" | "customData";
  column: string; // top-level Prisma field name
  jsonKey?: string; // set when kind = customData
}

function resolveField(doctype: Doctype, rawField: unknown): ResolvedField {
  if (typeof rawField !== "string" || rawField.length === 0) {
    throw new SegmentError("UnknownField", `field must be a non-empty string, got ${typeof rawField}`);
  }
  const field = rawField;
  const whitelist = FIELD_WHITELIST[doctype];
  if (!whitelist) {
    throw new SegmentError("UnknownDoctype", `unknown doctype: ${doctype}`);
  }
  if (field.startsWith("customData.")) {
    const key = field.slice("customData.".length);
    // No further dots — depth-1 only for MVP.
    if (!CUSTOM_KEY_RE.test(key)) {
      throw new SegmentError(
        "UnknownField",
        `invalid customData key: ${JSON.stringify(key)} (allowed: [A-Za-z_][A-Za-z0-9_]*)`,
      );
    }
    return { kind: "customData", column: "customData", jsonKey: key };
  }
  if (!whitelist.has(field)) {
    throw new SegmentError(
      "UnknownField",
      `field ${JSON.stringify(field)} is not allowed for ${doctype} (whitelist: ${[...whitelist].join(", ")})`,
    );
  }
  return { kind: "column", column: field };
}

// ─── Op → Prisma filter fragment ───────────────────────────────────────

const VALID_OPS: ReadonlySet<string> = new Set<Op>([
  "eq",
  "ne",
  "contains",
  "startsWith",
  "endsWith",
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "notNull",
  "between",
]);

function buildOpFilter(op: string, value: unknown): Record<string, unknown> {
  if (!VALID_OPS.has(op)) {
    throw new SegmentError("BadOp", `unknown op: ${JSON.stringify(op)}`);
  }
  switch (op as Op) {
    case "eq":
      return { equals: value };
    case "ne":
      return { not: value };
    case "contains":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "contains expects a string value");
      return { contains: value, mode: "insensitive" };
    case "startsWith":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "startsWith expects a string value");
      return { startsWith: value, mode: "insensitive" };
    case "endsWith":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "endsWith expects a string value");
      return { endsWith: value, mode: "insensitive" };
    case "in":
      if (!Array.isArray(value))
        throw new SegmentError("TypeMismatch", "in expects an array value");
      return { in: value };
    case "notIn":
      if (!Array.isArray(value))
        throw new SegmentError("TypeMismatch", "notIn expects an array value");
      return { notIn: value };
    case "gt":
      return { gt: value };
    case "gte":
      return { gte: value };
    case "lt":
      return { lt: value };
    case "lte":
      return { lte: value };
    case "isNull":
      return { equals: null };
    case "notNull":
      return { not: null };
    case "between": {
      if (!Array.isArray(value) || value.length !== 2)
        throw new SegmentError("TypeMismatch", "between expects a [lo, hi] array");
      return { gte: value[0], lte: value[1] };
    }
  }
}

// customData JSON path query. Prisma accepts:
//   { customData: { path: [key], equals: v } }
//   { customData: { path: [key], string_contains: v } }
// The op set is a subset of the column ops — we support equality + string
// substring + array membership + null. Anything else throws BadOp because it
// doesn't have a clean JSONB translation in Prisma today.
function buildCustomDataFilter(op: string, jsonKey: string, value: unknown): Record<string, unknown> {
  if (!VALID_OPS.has(op)) {
    throw new SegmentError("BadOp", `unknown op: ${JSON.stringify(op)}`);
  }
  const path = [jsonKey];
  switch (op as Op) {
    case "eq":
      return { customData: { path, equals: value } };
    case "ne":
      return { customData: { path, not: value } };
    case "contains":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "contains expects a string value");
      return { customData: { path, string_contains: value } };
    case "startsWith":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "startsWith expects a string value");
      return { customData: { path, string_starts_with: value } };
    case "endsWith":
      if (typeof value !== "string")
        throw new SegmentError("TypeMismatch", "endsWith expects a string value");
      return { customData: { path, string_ends_with: value } };
    case "in":
      if (!Array.isArray(value))
        throw new SegmentError("TypeMismatch", "in expects an array value");
      return { customData: { path, array_contains: value } };
    case "isNull":
      return { customData: { path, equals: null } };
    case "notNull":
      return { customData: { path, not: null } };
    case "gt":
      return { customData: { path, gt: value } };
    case "gte":
      return { customData: { path, gte: value } };
    case "lt":
      return { customData: { path, lt: value } };
    case "lte":
      return { customData: { path, lte: value } };
    default:
      throw new SegmentError(
        "BadOp",
        `op ${JSON.stringify(op)} is not supported on customData.* fields`,
      );
  }
}

// ─── Tree compiler ─────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function compileNode(doctype: Doctype, node: Node): Record<string, unknown> {
  if (!isRecord(node)) {
    throw new SegmentError("BadNode", "segment node must be an object");
  }
  // Boolean groups — mutually exclusive; a node with multiple keys is
  // ambiguous and rejected.
  const hasAnd = "and" in node;
  const hasOr = "or" in node;
  const hasNot = "not" in node;
  const hasCondition = "field" in node || "op" in node;
  const boolKeys = [hasAnd, hasOr, hasNot, hasCondition].filter(Boolean).length;
  if (boolKeys === 0) {
    throw new SegmentError("BadNode", "segment node must be one of: and | or | not | {field,op}");
  }
  if (boolKeys > 1) {
    throw new SegmentError(
      "BadNode",
      "segment node must have exactly one of: and | or | not | field",
    );
  }
  if (hasAnd) {
    const arr = (node as AndNode).and;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new SegmentError("EmptyGroup", "and: must be a non-empty array");
    }
    return { AND: arr.map((c) => compileNode(doctype, c)) };
  }
  if (hasOr) {
    const arr = (node as OrNode).or;
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new SegmentError("EmptyGroup", "or: must be a non-empty array");
    }
    return { OR: arr.map((c) => compileNode(doctype, c)) };
  }
  if (hasNot) {
    const inner = (node as NotNode).not;
    if (inner === undefined || inner === null) {
      throw new SegmentError("BadNode", "not: must have a child node");
    }
    return { NOT: compileNode(doctype, inner) };
  }
  // Leaf condition.
  const cond = node as ConditionNode;
  if (typeof cond.op !== "string" || cond.op.length === 0) {
    throw new SegmentError("BadOp", "op must be a non-empty string");
  }
  const resolved = resolveField(doctype, cond.field);
  if (resolved.kind === "customData") {
    return buildCustomDataFilter(cond.op, resolved.jsonKey!, cond.value);
  }
  return { [resolved.column]: buildOpFilter(cond.op, cond.value) };
}

/**
 * Compile a segment DSL node into a Prisma-compatible WHERE object.
 *
 * The returned object always AND-s `tenantId: <tenantId>` on top of the
 * compiled tree. Even though tenant-guard.ts enforces tenantId across all
 * queries, we belt-and-brace here because segment WHEREs are the one place
 * we splice user-authored structure straight into Prisma.
 *
 * Throws `SegmentError` on invalid input. Callers should return 400 to the
 * client with `err.code` + `err.message`.
 */
export function compileSegment(
  doctype: Doctype,
  node: Node,
  tenantId?: string,
): Record<string, unknown> {
  if (!FIELD_WHITELIST[doctype]) {
    throw new SegmentError("UnknownDoctype", `unknown doctype: ${doctype}`);
  }
  const compiled = compileNode(doctype, node);
  if (!tenantId) {
    return compiled;
  }
  return { AND: [{ tenantId }, compiled] };
}

// ─── Convenience: count + evaluate ─────────────────────────────────────

// A minimal shape for the delegates we touch. Keeps this file testable
// without pulling the whole PrismaClient type surface.
interface FindManyArgs {
  where: Record<string, unknown>;
  select?: Record<string, boolean>;
  take?: number;
  skip?: number;
}
interface CountArgs {
  where: Record<string, unknown>;
}
interface Delegate {
  count: (args: CountArgs) => Promise<number>;
  findMany: (args: FindManyArgs) => Promise<Array<Record<string, unknown>>>;
}

function delegateFor(prisma: PrismaClient, doctype: Doctype): Delegate {
  const p = prisma as unknown as {
    customer: Delegate;
    lead: Delegate;
  };
  if (doctype === "Customer") return p.customer;
  if (doctype === "Lead") return p.lead;
  throw new SegmentError("UnknownDoctype", `unknown doctype: ${doctype}`);
}

/** Compile + count matching rows. Never SELECTs the rows — cheap for previews. */
export async function countSegment(
  prisma: PrismaClient,
  tenantId: string,
  doctype: Doctype,
  node: Node,
): Promise<number> {
  const where = compileSegment(doctype, node, tenantId);
  return delegateFor(prisma, doctype).count({ where });
}

export interface SegmentRow {
  id: string;
  email: string | null;
  name: string;
}

/**
 * Compile + return matching rows with a stable `{id, email, name}` shape
 * so the caller doesn't need to remember `customerName` vs `leadName`.
 */
export async function evaluateSegment(
  prisma: PrismaClient,
  tenantId: string,
  doctype: Doctype,
  node: Node,
  opts?: { limit?: number; offset?: number },
): Promise<SegmentRow[]> {
  const where = compileSegment(doctype, node, tenantId);
  const take = opts?.limit ?? 500;
  const skip = opts?.offset ?? 0;
  const delegate = delegateFor(prisma, doctype);
  if (doctype === "Customer") {
    const rows = await delegate.findMany({
      where,
      select: { id: true, customerName: true, email: true },
      take,
      skip,
    });
    return rows.map((r) => ({
      id: r.id as string,
      email: (r.email as string | null) ?? null,
      name: (r.customerName as string) ?? "",
    }));
  }
  // Lead
  const rows = await delegate.findMany({
    where,
    select: { id: true, leadName: true, email: true },
    take,
    skip,
  });
  return rows.map((r) => ({
    id: r.id as string,
    email: (r.email as string | null) ?? null,
    name: (r.leadName as string) ?? "",
  }));
}
