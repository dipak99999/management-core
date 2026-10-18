// Lead scoring — pure evaluator for rule-based scoring.
//
// Rule shape: { fieldPath, operator, value, points, applyMode }.
//   fieldPath — dot path into Lead + Lead.customData (see getPath).
//   operator  — eq | neq | contains | present | absent | gt | lt
//   value     — right-hand side as string; coerced by operator
//   applyMode — Add (positive) | Subtract (negative)
//
// Score = sum of matching rule points. Rules evaluate independently
// so ordering doesn't matter (unlike blueprint transitions).

export interface LeadScoreRule {
  fieldPath: string;
  operator: "eq" | "neq" | "contains" | "present" | "absent" | "gt" | "lt";
  value: string | null;
  points: number;
  applyMode: "Add" | "Subtract";
  enabled?: boolean;
}

function getPath(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = record;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function evalRule(rule: LeadScoreRule, record: Record<string, unknown>): boolean {
  const v = getPath(record, rule.fieldPath);
  const rhs = rule.value ?? "";
  switch (rule.operator) {
    case "present":
      return v != null && v !== "";
    case "absent":
      return v == null || v === "";
    case "eq":
      return String(v ?? "") === rhs;
    case "neq":
      return String(v ?? "") !== rhs;
    case "contains":
      return String(v ?? "").toLowerCase().includes(rhs.toLowerCase());
    case "gt": {
      const n = Number(v);
      const r = Number(rhs);
      return Number.isFinite(n) && Number.isFinite(r) && n > r;
    }
    case "lt": {
      const n = Number(v);
      const r = Number(rhs);
      return Number.isFinite(n) && Number.isFinite(r) && n < r;
    }
    default:
      return false;
  }
}

export function scoreLead(
  rules: LeadScoreRule[],
  record: Record<string, unknown>,
): { score: number; matched: LeadScoreRule[] } {
  let score = 0;
  const matched: LeadScoreRule[] = [];
  for (const r of rules) {
    if (r.enabled === false) continue;
    if (evalRule(r, record)) {
      score += r.applyMode === "Subtract" ? -Math.abs(r.points) : Math.abs(r.points);
      matched.push(r);
    }
  }
  return { score, matched };
}
