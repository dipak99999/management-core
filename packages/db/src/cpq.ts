// Configure-Price-Quote — rule-driven Q→A flow over the existing
// variant-matrix.
//
// A CPQ config lives on the parent Item as `customData.cpq = {...}`
// (no schema change needed). The shape:
//
//   {
//     "questions": [
//       { "key": "color",  "label": "Color",  "options": ["Red", "Blue"] },
//       { "key": "size",   "label": "Size",   "options": ["S","M","L"] },
//       { "key": "engrave","label": "Engraving?", "type": "boolean" }
//     ],
//     "priceRules": [
//       { "when": { "engrave": true },       "adjust": { "type": "flat", "amount": 500 } },
//       { "when": { "size": "L" },           "adjust": { "type": "pct",  "percent": 10 } }
//     ],
//     "attributeMap": { "color": "Color", "size": "Size" }
//   }
//
// `attributeMap` maps CPQ question keys → Item attribute names so
// answers can be resolved to a concrete variant via the existing
// variant-matrix machinery.

export interface CpqQuestion {
  key: string;
  label: string;
  type?: "select" | "boolean" | "number";
  options?: string[];
  required?: boolean;
  help?: string;
}

export interface CpqPriceRule {
  when: Record<string, unknown>; // partial match against answers
  adjust: { type: "flat"; amount: number } | { type: "pct"; percent: number };
  label?: string;
}

export interface CpqConfig {
  questions: CpqQuestion[];
  priceRules: CpqPriceRule[];
  attributeMap?: Record<string, string>;
}

export interface CpqQuoteInput {
  basePrice: number;
  answers: Record<string, unknown>;
  config: CpqConfig;
}

export interface CpqQuoteLine {
  label: string;
  amount: number; // signed — positive adds, never used negative in v1
}

export interface CpqQuoteResult {
  ok: boolean;
  missingRequired: string[];
  lines: CpqQuoteLine[];   // base + each rule that matched
  total: number;
  variantAttributes: Record<string, string>; // for variant-matrix lookup
}

function matches(rule: CpqPriceRule, answers: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(rule.when)) {
    if (answers[k] !== v) return false;
  }
  return true;
}

export function computeCpqQuote(input: CpqQuoteInput): CpqQuoteResult {
  const missing: string[] = [];
  for (const q of input.config.questions) {
    if (q.required && (input.answers[q.key] === undefined || input.answers[q.key] === "")) {
      missing.push(q.key);
    }
  }
  const lines: CpqQuoteLine[] = [{ label: "Base", amount: input.basePrice }];
  let subtotal = input.basePrice;
  for (const rule of input.config.priceRules) {
    if (!matches(rule, input.answers)) continue;
    const amt = rule.adjust.type === "flat" ? rule.adjust.amount : subtotal * (rule.adjust.percent / 100);
    subtotal += amt;
    lines.push({ label: rule.label ?? JSON.stringify(rule.when), amount: amt });
  }
  const variantAttributes: Record<string, string> = {};
  for (const [qKey, attrName] of Object.entries(input.config.attributeMap ?? {})) {
    const v = input.answers[qKey];
    if (v != null && v !== "") variantAttributes[attrName] = String(v);
  }
  return {
    ok: missing.length === 0,
    missingRequired: missing,
    lines,
    total: subtotal,
    variantAttributes,
  };
}
