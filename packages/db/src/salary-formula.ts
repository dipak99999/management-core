// Salary component formula evaluator.
//
// Formulas reference already-computed components by name in curlies:
//   "{Basic} * 0.1"
//   "({Basic} + {HRA}) * 0.05"
// Only numeric literals, whitespace, +-*/(), and {ComponentName} tokens are
// allowed. Anything else throws — this is the entire security boundary,
// since we use new Function() to evaluate the resulting arithmetic expression.

export interface ComponentInput {
  componentName: string;
  type: "Earning" | "Deduction";
  amount: number | null; // used only when formula is null
  formula: string | null;
}

export interface ComponentEvaluated {
  componentName: string;
  type: "Earning" | "Deduction";
  amount: number; // computed final value
}

// Whitelisted characters for the post-substitution expression: digits, dot,
// spaces, arithmetic ops, parentheses.
const SAFE_EXPR = /^[\d\s.+\-*/()]+$/;
// Only ASCII letters, digits, underscore, space, hyphen allowed inside {}.
const NAME_TOKEN = /\{([A-Za-z0-9_ \-]+)\}/g;

export function evalFormula(
  formula: string,
  ctx: Record<string, number>,
): number {
  // Substitute {Name} tokens with numeric values from ctx.
  const substituted = formula.replace(NAME_TOKEN, (_m, rawName: string) => {
    const name = rawName.trim();
    if (!(name in ctx))
      throw new Error(`Formula references unknown component "${name}"`);
    return String(ctx[name]);
  });
  if (!SAFE_EXPR.test(substituted))
    throw new Error(
      `Formula produced an unsafe expression after substitution: "${substituted}"`,
    );
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(`return (${substituted});`);
    const v = fn() as unknown;
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`Formula did not evaluate to a finite number: ${substituted}`);
    return v;
  } catch (e) {
    throw new Error(
      `Formula evaluation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// Evaluates components in the given order. Formula components are computed
// against a context of all previously computed components, so later formulas
// can reference earlier ones. Round to 4 decimal places to match schema.
export function evaluateComponents(
  components: ComponentInput[],
): ComponentEvaluated[] {
  const ctx: Record<string, number> = {};
  const out: ComponentEvaluated[] = [];
  for (const c of components) {
    let amount: number;
    if (c.formula) {
      amount = evalFormula(c.formula, ctx);
    } else {
      amount = Number(c.amount ?? 0);
    }
    amount = Math.round(amount * 10000) / 10000;
    ctx[c.componentName] = amount;
    out.push({ componentName: c.componentName, type: c.type, amount });
  }
  return out;
}
