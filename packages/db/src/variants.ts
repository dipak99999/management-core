// Item Variants — pure helpers.
//
// A "template" Item (isVariantTemplate=true) owns the shared display
// (name, description, WebsiteItem) plus a set of ATTRIBUTE NAMES the
// operator defined on it. Each variant is its own Item, linked via
// variantOfId, and carries an ATTRIBUTE-VALUES map like
// {"Color":"Red","Size":"S"} in variantAttributes.
//
// This module handles:
//   - Reading / normalising the JSON attribute maps
//   - Matching a customer's storefront selection to the right variant Item
//   - Validating a variant's attributes against its template's declared
//     attribute names (so a "T-shirt in Blue Frosting" gets caught)
//
// Kept dependency-free so vitest can exercise the (surprisingly tricky)
// matching + validation without a live DB.

export type VariantAttrs = Record<string, string>;

/**
 * Coerce whatever came out of Prisma's Json column into a
 * VariantAttrs shape. Returns null for empty / missing / malformed
 * payloads rather than throwing — the caller (route or storefront)
 * decides how to react (usually: treat as not-a-variant).
 */
export function parseVariantAttributes(raw: unknown): VariantAttrs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: VariantAttrs = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0) continue;
    if (v == null) continue;
    // Coerce every value to string — numbers and booleans get stringified
    // (matches how HTML form selects always yield strings).
    out[k] = String(v);
    count++;
  }
  return count > 0 ? out : null;
}

/**
 * Normalise for equality — trim whitespace + drop empty values so
 * "  Red  " compares equal to "Red" but not to "" (empty means the
 * customer hasn't picked that attribute yet).
 */
function normaliseAttrs(attrs: VariantAttrs): VariantAttrs {
  const out: VariantAttrs = {};
  for (const [k, v] of Object.entries(attrs)) {
    const trimmed = v.trim();
    if (trimmed.length > 0) out[k.trim()] = trimmed;
  }
  return out;
}

/**
 * Do two attribute maps refer to the same variant?
 * Equal iff they have the same keys AND the same value for every key.
 * Case-insensitive on both sides — "red" matches "Red".
 */
export function variantsMatch(a: VariantAttrs, b: VariantAttrs): boolean {
  const A = normaliseAttrs(a);
  const B = normaliseAttrs(b);
  const keysA = Object.keys(A);
  if (keysA.length !== Object.keys(B).length) return false;
  for (const k of keysA) {
    const va = A[k]?.toLowerCase();
    const vb = B[k]?.toLowerCase();
    if (va == null || vb == null || va !== vb) return false;
  }
  return true;
}

/**
 * Look up which variant Item corresponds to a customer's storefront
 * selection. Returns null when no variant matches — the storefront
 * disables the "Add to cart" button in that case rather than silently
 * routing to the wrong variant.
 */
export function findVariantByAttributes<
  T extends { id: string; variantAttributes: unknown },
>(variants: T[], selection: VariantAttrs): T | null {
  const target = normaliseAttrs(selection);
  if (Object.keys(target).length === 0) return null;
  for (const v of variants) {
    const attrs = parseVariantAttributes(v.variantAttributes);
    if (!attrs) continue;
    if (variantsMatch(attrs, target)) return v;
  }
  return null;
}

/**
 * Given a set of variant Items, extract the DISTINCT set of attribute
 * names + their possible values (in the order they first appear across
 * variants). Powers the storefront's attribute pickers — one dropdown
 * per attribute name, populated with the values that variant(s) exist for.
 */
export function collectAttributeOptions<
  T extends { variantAttributes: unknown },
>(variants: T[]): { name: string; values: string[] }[] {
  const nameOrder: string[] = [];
  const byName = new Map<string, string[]>();
  for (const v of variants) {
    const attrs = parseVariantAttributes(v.variantAttributes);
    if (!attrs) continue;
    for (const [k, val] of Object.entries(attrs)) {
      if (!byName.has(k)) {
        byName.set(k, []);
        nameOrder.push(k);
      }
      const existing = byName.get(k)!;
      if (!existing.includes(val)) existing.push(val);
    }
  }
  return nameOrder.map((name) => ({ name, values: byName.get(name)! }));
}

// -----------------------------------------------------------------------
// Validation — called at Item create/update time.

export interface ValidateVariantInput {
  isVariantTemplate: boolean;
  variantOfId: string | null | undefined;
  variantAttributes: unknown;
  templateAttributeNames?: string[]; // when known — the template's declared attribute name set
}

/**
 * Enforce the constraints a variant Item must satisfy:
 *   - can't be both a template AND a variant
 *   - a template must NOT reference a template id (nested templates)
 *   - a variant MUST carry variantAttributes with at least one attribute
 *   - a variant's attribute names must be a subset of the template's
 *     declared names (when the template names are known)
 * Returns null on success, or a human-readable error string.
 */
export function validateVariantMetadata(input: ValidateVariantInput): string | null {
  if (input.isVariantTemplate && input.variantOfId) {
    return "An Item cannot be both a variant template AND a variant of another Item.";
  }
  if (!input.variantOfId) {
    // Not a variant — no attribute constraint applies. Attributes on a
    // non-variant are harmless (ignored downstream), we don't reject.
    return null;
  }
  const attrs = parseVariantAttributes(input.variantAttributes);
  if (!attrs) {
    return "A variant Item must have at least one attribute value (e.g. Color, Size).";
  }
  if (input.templateAttributeNames && input.templateAttributeNames.length > 0) {
    const allowed = new Set(
      input.templateAttributeNames.map((n) => n.trim().toLowerCase()),
    );
    const bad: string[] = [];
    for (const k of Object.keys(attrs)) {
      if (!allowed.has(k.trim().toLowerCase())) bad.push(k);
    }
    if (bad.length > 0) {
      return `Unknown attribute(s) for this template: ${bad.join(", ")}. Template declares: ${input.templateAttributeNames.join(", ")}.`;
    }
  }
  return null;
}
