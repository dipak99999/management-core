// Module 60 — Item Variant Matrix generator.
//
// Given a template's attribute-value matrix, produce all variant
// combinations. `{ Color: ["Red","Blue"], Size: ["S","M","L"] }` →
// 6 combos, each `{ Color: X, Size: Y }`.
//
// Pure — the route feeds this into Prisma createMany.

export interface AttributeMatrix {
  [attributeName: string]: string[]; // e.g. { Color: ["Red","Blue"], Size: ["S","M"] }
}

export type VariantCombo = Record<string, string>;

// Cartesian product across all attribute values. Returns [] for empty
// input or any attribute with an empty value list.
export function generateVariantCombos(matrix: AttributeMatrix): VariantCombo[] {
  const names = Object.keys(matrix);
  if (names.length === 0) return [];
  // Empty value list on any attribute → no combos.
  if (names.some((n) => (matrix[n]?.length ?? 0) === 0)) return [];

  let combos: VariantCombo[] = [{}];
  for (const name of names) {
    const values = matrix[name];
    const next: VariantCombo[] = [];
    for (const c of combos) {
      for (const v of values) {
        next.push({ ...c, [name]: v });
      }
    }
    combos = next;
  }
  return combos;
}

// Derive a variant itemCode from the template code + combo values.
// e.g. "TSHIRT-BASIC" + { Color: "Red", Size: "L" } → "TSHIRT-BASIC-RED-L".
// Values are uppercased and stripped of non-alphanumerics.
export function variantCodeFor(templateCode: string, combo: VariantCombo): string {
  const suffix = Object.values(combo)
    .map((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
  return `${templateCode}-${suffix}`;
}

// Derive a display name for the variant. e.g. "T-Shirt Basic (Red, L)".
export function variantNameFor(templateName: string, combo: VariantCombo): string {
  const suffix = Object.values(combo).join(", ");
  return `${templateName} (${suffix})`;
}
