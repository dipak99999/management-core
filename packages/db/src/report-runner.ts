import { PrismaClient } from "@prisma/client";
import { getDoctypeMeta, type DoctypeMeta } from "./report-meta";
import { getPrismaDelegate } from "./prisma-delegate";

// Report definition — sent from the frontend, stored on SavedReport, and
// executed by runReport. All validation happens against the doctype meta.

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "contains";

export interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface Sort {
  field: string;
  dir: "asc" | "desc";
}

export interface ReportDefinition {
  columns: string[];
  filters: Filter[];
  sortBy: Sort[];
  limit?: number;
}

export interface ReportResult {
  columns: { key: string; label: string; type: string }[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

// Build a Prisma `where` clause from filters. Only fields that appear in
// `meta.filterableFields` are accepted; a dotted key (e.g. "customer.customerName")
// becomes a nested `{ customer: { customerName: ... } }` clause.
function buildWhere(meta: DoctypeMeta, filters: Filter[]): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const f of filters) {
    if (!meta.filterableFields.includes(f.field))
      throw new Error(`Field "${f.field}" is not filterable on ${meta.doctype}`);
    const column = meta.columns.find((c) => c.key === f.field);
    if (!column) throw new Error(`Unknown field "${f.field}"`);

    const value = coerceForType(column.type, f.value, f.op);
    const prismaOp = filterToPrisma(f.op, value, column.type);
    assignDotted(where, f.field, prismaOp);
  }
  return where;
}

function coerceForType(
  type: string,
  value: unknown,
  op: FilterOp,
): unknown {
  if (op === "in") {
    if (!Array.isArray(value)) throw new Error(`Filter op "in" requires an array value`);
    return value.map((v) => coerceOne(type, v));
  }
  return coerceOne(type, value);
}

function coerceOne(type: string, value: unknown): unknown {
  if (value === null || value === "") return null;
  switch (type) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "date": {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
      return d;
    }
    case "boolean":
      return value === true || value === "true";
    default:
      return String(value);
  }
}

function filterToPrisma(op: FilterOp, value: unknown, type: string): unknown {
  switch (op) {
    case "eq":
      return value;
    case "neq":
      return { not: value };
    case "gt":
      return { gt: value };
    case "gte":
      return { gte: value };
    case "lt":
      return { lt: value };
    case "lte":
      return { lte: value };
    case "in":
      return { in: value };
    case "contains":
      if (type !== "string")
        throw new Error(`Filter op "contains" only valid on string fields`);
      return { contains: value, mode: "insensitive" };
    default:
      throw new Error(`Unsupported filter op: ${op}`);
  }
}

// Merges { customer: { customerName: x } } into an existing where object.
function assignDotted(obj: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

// Build a Prisma `select` clause that pulls just the requested columns +
// each dotted relation's parent field (so we can traverse in projection).
function buildSelect(meta: DoctypeMeta, columns: string[]): Record<string, unknown> {
  const select: Record<string, unknown> = { id: true };
  for (const key of columns) {
    if (!meta.columns.find((c) => c.key === key))
      throw new Error(`Unknown column "${key}" on ${meta.doctype}`);
    const parts = key.split(".");
    if (parts.length === 1) {
      select[parts[0]] = true;
    } else {
      // Nested relation: select { relationName: { select: { field: true } } }
      let cur = select;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!cur[p] || typeof cur[p] !== "object") cur[p] = { select: {} };
        cur = (cur[p] as { select: Record<string, unknown> }).select;
      }
      cur[parts[parts.length - 1]] = true;
    }
  }
  return select;
}

function buildOrderBy(meta: DoctypeMeta, sortBy: Sort[]): unknown[] {
  const out: unknown[] = [];
  for (const s of sortBy) {
    if (!meta.sortableFields.includes(s.field))
      throw new Error(`Field "${s.field}" is not sortable on ${meta.doctype}`);
    const one: Record<string, unknown> = {};
    assignDotted(one, s.field, s.dir);
    out.push(one);
  }
  return out;
}

// Projects a Prisma result row into a flat object keyed by column paths.
function projectRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of columns) {
    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let v: any = row;
    for (const p of parts) {
      v = v == null ? null : v[p];
    }
    // Prisma Decimals arrive as objects with a toString() method; normalize to numbers.
    if (v && typeof v === "object" && typeof v.toString === "function" && "d" in v) {
      out[key] = Number(v.toString());
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else {
      out[key] = v ?? null;
    }
  }
  return out;
}

export async function runReport(
  prisma: PrismaClient,
  tenantId: string,
  doctype: string,
  def: ReportDefinition,
): Promise<ReportResult> {
  const meta = getDoctypeMeta(doctype);
  if (!meta) throw new Error(`Doctype "${doctype}" is not reportable`);
  if (!def.columns || def.columns.length === 0)
    throw new Error("At least one column is required");

  const where = { ...buildWhere(meta, def.filters ?? []), tenantId };
  const orderBy = buildOrderBy(meta, def.sortBy ?? []);
  const select = buildSelect(meta, def.columns);
  const requestedLimit = Math.min(def.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const delegate = getPrismaDelegate(prisma, meta.delegate);
  if (!delegate) throw new Error(`No Prisma delegate for ${meta.doctype}`);

  // Query one over the limit to detect truncation.
  const rows = await delegate.findMany({
    where,
    orderBy,
    select,
    take: requestedLimit + 1,
  });
  const truncated = rows.length > requestedLimit;
  const visible = truncated ? rows.slice(0, requestedLimit) : rows;

  const columnMetas = def.columns.map((k) => {
    const c = meta.columns.find((x) => x.key === k)!;
    return { key: c.key, label: c.label, type: c.type };
  });
  return {
    columns: columnMetas,
    rows: visible.map((r: Record<string, unknown>) => projectRow(r, def.columns)),
    total: visible.length,
    truncated,
  };
}
