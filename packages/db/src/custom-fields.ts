import { PrismaClient, Prisma } from "@prisma/client";
import { getPrismaDelegate } from "./prisma-delegate";

// Doctypes that support a `customData Json?` column. Adding a new doctype:
// (1) add `customData Json?` to the model, (2) list it here, (3) call
// `validateCustomData` in the route's create/update path.

export const CUSTOM_FIELD_DOCTYPES = [
  "Customer",
  "Supplier",
  "Item",
  "Employee",
  // I5: extended
  "Lead",
  "Opportunity",
  "Quotation",
  "SalesOrder",
  "SalesInvoice",
  "PurchaseInvoice",
  "PaymentEntry",
  "Project",
  "Task",
] as const;

export type CustomFieldDoctype = (typeof CUSTOM_FIELD_DOCTYPES)[number];

export function isCustomFieldDoctype(dt: string): dt is CustomFieldDoctype {
  return (CUSTOM_FIELD_DOCTYPES as readonly string[]).includes(dt);
}

export const CUSTOM_FIELD_TYPES = [
  "Text",
  "LongText",
  "Number",
  "Date",
  "Boolean",
  "Select",
  // I1 / I2
  "Link",
  "Table",
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

// I1: which doctypes can be pointed at by a Link field. Kept small so the
// server can validate the target exists in the same tenant without crossing
// a service boundary. Extend cautiously.
export const CUSTOM_FIELD_LINK_TARGETS = [
  "Customer",
  "Supplier",
  "Item",
  "Employee",
  "Lead",
  "Project",
] as const;

const LINK_DELEGATE: Record<string, string> = {
  Customer: "customer",
  Supplier: "supplier",
  Item: "item",
  Employee: "employee",
  Lead: "lead",
  Project: "project",
};

// Validates a customData bag against the tenant's meta for a doctype.
// - Rejects unknown fieldNames (safer than silent-drop; forces users to add
//   a CustomField before sending values).
// - Enforces isRequired when the field is missing/null/"".
// - Coerces each value to the declared type (throws on mismatch).
// - I4: enforces regexPattern + isUnique.
// - I1: Link fields resolve their target row must exist in the same tenant.
// - I2: Table fields recurse per row/subField.
export async function validateCustomData(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  doctype: string,
  incoming: Record<string, unknown> | null | undefined,
  opts?: { docId?: string; hostData?: Record<string, unknown> },
): Promise<Prisma.InputJsonValue | undefined> {
  if (!isCustomFieldDoctype(doctype))
    throw new Error(`Doctype ${doctype} does not support custom fields`);

  const fields = await tx.customField.findMany({
    where: { tenantId, doctype },
  });
  if (fields.length === 0) {
    if (incoming && Object.keys(incoming).length > 0)
      throw new Error(
        `No custom fields defined for ${doctype} — remove customData or define fields first`,
      );
    return undefined;
  }

  const byName = new Map(fields.map((f) => [f.fieldName, f]));
  const bag = incoming ?? {};

  for (const k of Object.keys(bag)) {
    if (!byName.has(k))
      throw new Error(`Unknown custom field "${k}" for ${doctype}`);
  }

  // hostData lets callers pass the parent doctype's field values so
  // hiddenIf expressions can reference them (e.g., `status == "Cancelled"`).
  const hostData = opts?.hostData;

  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = bag[f.fieldName];
    const isEmpty = raw === undefined || raw === null || raw === "";
    // I4: honor hiddenIf on the server too — if the field is hidden per
    // the expression, skip the isRequired check (a client-hidden field
    // can't have a value). Expression evaluates against host doctype
    // fields merged with the current custom-data bag. Errors during
    // evaluation are treated as "field visible" so required stays enforced.
    if (f.hiddenIf) {
      const ctx = { ...(hostData ?? {}), ...bag };
      if (evalHiddenIfServer(f.hiddenIf, ctx)) {
        continue;
      }
    }
    if (isEmpty) {
      if (f.isRequired)
        throw new Error(`Custom field "${f.label}" is required`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    out[f.fieldName] = await coerce(
      tx,
      tenantId,
      f.fieldName,
      f.fieldType,
      f.options,
      raw,
    );

    // I4: regex enforcement on scalar-string values.
    if (f.regexPattern && typeof out[f.fieldName] === "string") {
      let re: RegExp;
      try {
        re = new RegExp(f.regexPattern);
      } catch {
        throw new Error(`Invalid regex on "${f.label}": ${f.regexPattern}`);
      }
      if (!re.test(out[f.fieldName] as string))
        throw new Error(
          `"${f.label}" does not match required pattern: ${f.regexPattern}`,
        );
    }
  }

  // I4: isUnique — cross-row check via JSON path.
  const uniqueFields = fields.filter((f) => f.isUnique);
  if (uniqueFields.length > 0) {
    const delegateName = doctypeDelegate(doctype);
    const del = getPrismaDelegate(tx, delegateName);
    if (del) {
      for (const f of uniqueFields) {
        const value = out[f.fieldName];
        if (value === undefined) continue;
        const clash = await del.findFirst({
          where: {
            tenantId,
            customData: { path: [f.fieldName], equals: value },
            ...(opts?.docId ? { NOT: { id: opts.docId } } : {}),
          },
          select: { id: true },
        });
        if (clash)
          throw new Error(
            `"${f.label}" must be unique — value already used`,
          );
      }
    }
  }

  return Object.keys(out).length > 0
    ? (out as unknown as Prisma.InputJsonValue)
    : undefined;
}

function doctypeDelegate(doctype: string): string {
  return doctype.charAt(0).toLowerCase() + doctype.slice(1);
}

// Server-side hiddenIf evaluator. Same sandbox rules as the client one:
// each context key becomes a parameter (custom fieldNames are snake_case
// per schema — safe as JS identifiers). Errors → false (field visible).
function evalHiddenIfServer(
  expr: string,
  ctx: Record<string, unknown>,
): boolean {
  if (!expr) return false;
  try {
    const keys = Object.keys(ctx);
    const vals = Object.values(ctx);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(...keys, `"use strict"; return (${expr});`);
    return !!fn(...vals);
  } catch {
    return false;
  }
}

async function coerce(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  fieldName: string,
  fieldType: string,
  options: unknown,
  raw: unknown,
): Promise<unknown> {
  switch (fieldType) {
    case "Text":
    case "LongText": {
      if (typeof raw !== "string") throw new Error(`"${fieldName}" must be text`);
      const opts = (options ?? {}) as { maxLength?: number };
      if (opts.maxLength && raw.length > opts.maxLength)
        throw new Error(
          `"${fieldName}" exceeds max length ${opts.maxLength} (got ${raw.length})`,
        );
      return raw;
    }
    case "Number": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) throw new Error(`"${fieldName}" must be a number`);
      const opts = (options ?? {}) as { min?: number; max?: number };
      if (opts.min !== undefined && n < opts.min)
        throw new Error(`"${fieldName}" < min ${opts.min}`);
      if (opts.max !== undefined && n > opts.max)
        throw new Error(`"${fieldName}" > max ${opts.max}`);
      return n;
    }
    case "Date": {
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime()))
        throw new Error(`"${fieldName}" must be a valid date`);
      return d.toISOString().slice(0, 10);
    }
    case "Boolean": {
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === 1 || raw === "1") return true;
      if (raw === "false" || raw === 0 || raw === "0") return false;
      throw new Error(`"${fieldName}" must be a boolean`);
    }
    case "Select": {
      const opts = (options ?? {}) as { choices?: string[] };
      if (!opts.choices || opts.choices.length === 0)
        throw new Error(`"${fieldName}" has no choices configured`);
      if (typeof raw !== "string" || !opts.choices.includes(raw))
        throw new Error(
          `"${fieldName}" must be one of: ${opts.choices.join(", ")}`,
        );
      return raw;
    }
    case "Link": {
      const opts = (options ?? {}) as { linkDoctype?: string };
      if (!opts.linkDoctype)
        throw new Error(
          `"${fieldName}" is a Link field with no linkDoctype configured`,
        );
      if (!(CUSTOM_FIELD_LINK_TARGETS as readonly string[]).includes(opts.linkDoctype))
        throw new Error(
          `"${fieldName}" linkDoctype ${opts.linkDoctype} is not linkable`,
        );
      if (typeof raw !== "string" || !raw)
        throw new Error(`"${fieldName}" must be the target's id string`);
      const delegateName = LINK_DELEGATE[opts.linkDoctype];
      const del = getPrismaDelegate(tx, delegateName);
      if (!del) throw new Error(`"${fieldName}" delegate ${delegateName} missing`);
      const target = await del.findFirst({
        where: { id: raw, tenantId },
        select: { id: true },
      });
      if (!target)
        throw new Error(
          `"${fieldName}" points to a non-existent ${opts.linkDoctype}`,
        );
      return raw;
    }
    case "Table": {
      const opts = (options ?? {}) as {
        subFields?: {
          fieldName: string;
          label?: string;
          fieldType: string;
          options?: unknown;
          isRequired?: boolean;
        }[];
      };
      if (!opts.subFields || opts.subFields.length === 0)
        throw new Error(`"${fieldName}" Table needs at least one subField`);
      if (!Array.isArray(raw))
        throw new Error(`"${fieldName}" must be an array of rows`);
      const outRows: Record<string, unknown>[] = [];
      for (let i = 0; i < raw.length; i++) {
        const row = raw[i] as Record<string, unknown>;
        if (!row || typeof row !== "object")
          throw new Error(`"${fieldName}" row ${i + 1} is not an object`);
        const cell: Record<string, unknown> = {};
        for (const sub of opts.subFields) {
          const v = row[sub.fieldName];
          const isEmpty = v === undefined || v === null || v === "";
          if (isEmpty) {
            if (sub.isRequired)
              throw new Error(
                `"${fieldName}" row ${i + 1}: "${sub.label ?? sub.fieldName}" is required`,
              );
            continue;
          }
          if (sub.fieldType === "Link" || sub.fieldType === "Table")
            throw new Error(
              `"${fieldName}" subField "${sub.fieldName}": Link/Table nesting not supported`,
            );
          // eslint-disable-next-line no-await-in-loop
          cell[sub.fieldName] = await coerce(
            tx,
            tenantId,
            `${fieldName}[${i + 1}].${sub.fieldName}`,
            sub.fieldType,
            sub.options,
            v,
          );
        }
        outRows.push(cell);
      }
      return outRows;
    }
    default:
      throw new Error(
        `Unsupported custom field type "${fieldType}" on "${fieldName}"`,
      );
  }
}
