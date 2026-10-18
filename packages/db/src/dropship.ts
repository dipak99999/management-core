// Dropshipping — pure helpers for grouping Sales Order lines by supplier
// so SO submit can spawn one Purchase Order Draft per supplier (not one
// PO per line). Called from services/crm-service/src/routes/sales-orders.ts.
//
// Kept dependency-free so vitest can exercise the grouping + validation
// without a DB.

export interface DropshipLineInput<T> {
  row: T;
  isDropship: boolean;
  defaultSupplierId: string | null | undefined;
  itemName?: string | null;
}

export interface DropshipGroup<T> {
  supplierId: string;
  lines: T[];
}

export interface DropshipValidationError {
  message: string;
  rows: unknown[];
}

/**
 * Split cart/SO lines into dropship-groups (one entry per supplier) plus
 * a normal-lines pool. Lines flagged isDropship without a resolved
 * defaultSupplier are collected into `missingSupplier` so the caller
 * can refuse the SO submit with a clear operator-actionable error.
 */
export function partitionDropshipLines<T>(
  lines: DropshipLineInput<T>[],
): {
  groups: DropshipGroup<T>[];
  normal: T[];
  missingSupplier: T[];
} {
  const bySupplier = new Map<string, T[]>();
  const normal: T[] = [];
  const missingSupplier: T[] = [];

  for (const l of lines) {
    if (!l.isDropship) {
      normal.push(l.row);
      continue;
    }
    if (!l.defaultSupplierId) {
      missingSupplier.push(l.row);
      continue;
    }
    const arr = bySupplier.get(l.defaultSupplierId) ?? [];
    arr.push(l.row);
    bySupplier.set(l.defaultSupplierId, arr);
  }

  // Iteration order of Map preserves insertion order — the resulting
  // groups follow the order suppliers first appear in the cart, which
  // makes the generated PO names visually match the SO line order.
  const groups: DropshipGroup<T>[] = [];
  for (const [supplierId, rows] of bySupplier) {
    groups.push({ supplierId, lines: rows });
  }
  return { groups, normal, missingSupplier };
}

/**
 * Human-readable error message when any dropship line lacks a supplier.
 * Uses itemName when available so the operator can jump straight to the
 * right Item and set defaultSupplierId.
 */
export function missingSupplierError<T>(
  missing: DropshipLineInput<T>[],
): string {
  const names = missing
    .map((m) => m.itemName)
    .filter((n): n is string => !!n)
    .slice(0, 5);
  const remaining = missing.length - names.length;
  const list =
    names.length > 0
      ? names.join(", ") + (remaining > 0 ? ` (+${remaining} more)` : "")
      : `${missing.length} item(s)`;
  return `Cannot submit — dropship line(s) without a default supplier: ${list}. Set Item.defaultSupplier and try again.`;
}
