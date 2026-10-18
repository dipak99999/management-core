// F1: Email/SMS template rendering. Substitutes {{key}} tokens with values
// from a plain string→value map. Missing keys render as empty string; the
// helper accepts an `onMissing` callback so callers can log/collect warnings.
//
// Dotted-path support (P3): keys with dots like `{{brand.primaryColor}}` are
// resolved by walking the vars object (`vars.brand.primaryColor`) OR by an
// exact flat lookup (`vars["brand.primaryColor"]`) — flat lookup wins when
// both exist for back-compat. This lets callers pre-flatten if they want.

const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export function renderTemplate(
  tpl: string,
  vars: Record<string, unknown>,
  onMissing?: (key: string) => void,
): string {
  return tpl.replace(TOKEN, (_m, key: string) => {
    const resolved = resolveKey(vars, key);
    if (resolved.missing) {
      onMissing?.(key);
      return "";
    }
    const v = resolved.value;
    if (v == null) return "";
    return String(v);
  });
}

// ── Lookup helper ──────────────────────────────────────────────────────
// Exported so callers who need "was this present or not" can share the
// same resolution rules the renderer uses.
export function resolveKey(
  vars: Record<string, unknown>,
  key: string,
): { missing: boolean; value: unknown } {
  // 1) Exact flat key wins (back-compat + explicit override path).
  if (key in vars) return { missing: false, value: vars[key] };
  // 2) Walk the dotted path if the key contains dots.
  if (key.includes(".")) {
    const parts = key.split(".");
    let cursor: unknown = vars;
    for (const p of parts) {
      if (cursor && typeof cursor === "object" && p in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[p];
      } else {
        return { missing: true, value: undefined };
      }
    }
    return { missing: false, value: cursor };
  }
  return { missing: true, value: undefined };
}
