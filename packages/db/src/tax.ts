import { Prisma } from "@prisma/client";

// Shared tax-computation helpers. Two responsibilities:
//   resolveTaxTemplate  — load + snapshot tax template rows (multi-row or
//                         legacy single-row fallback).
//   computeTaxLines     — apply chargeType rules per row to produce final
//                         taxAmount values (compound / cascading support).
//
// Charge types (B10):
//   "On Net Total"          — default. amount = netTotal × rate/100.
//   "On Previous Row Total" — compound. amount = (netTotal + Σprior) × rate/100.
//   "Actual"                — literal `row.amount` (ignore rate).

type AnyClient = Prisma.TransactionClient | { taxTemplate: unknown };

export interface ResolvedTaxRow {
  description: string;
  rate: number;
  accountId: string;
  chargeType: "On Net Total" | "On Previous Row Total" | "Actual";
  amount: number; // used only when chargeType = "Actual"
}

export interface ResolvedTaxTemplate {
  id: string;
  name: string;
  rows: ResolvedTaxRow[];
}

// Load a tax template + rows and normalize to ResolvedTaxTemplate. Prefers
// multi-row `rows[]`; falls back to legacy header rate+account as one virtual
// row (charge type "On Net Total"). Throws on missing template.
export async function resolveTaxTemplate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  taxTemplateId: string | null | undefined,
  templateType: "Sales" | "Purchase",
): Promise<ResolvedTaxTemplate | null> {
  if (!taxTemplateId) return null;
  const t = await tx.taxTemplate.findFirst({
    where: { id: taxTemplateId, tenantId, templateType },
    include: { rows: { orderBy: { sortOrder: "asc" } } },
  });
  if (!t) throw new Error(`Invalid ${templateType.toLowerCase()} tax template`);
  const rows: ResolvedTaxRow[] =
    t.rows.length > 0
      ? t.rows.map(
          (r: {
            description: string;
            rate: Prisma.Decimal;
            accountId: string;
            chargeType: string;
            amount: Prisma.Decimal;
          }) => ({
            description: r.description,
            rate: Number(r.rate),
            accountId: r.accountId,
            chargeType:
              (r.chargeType as ResolvedTaxRow["chargeType"]) ?? "On Net Total",
            amount: Number(r.amount),
          }),
        )
      : t.rate != null && t.accountId
        ? [
            {
              description: `${t.name} @ ${t.rate.toString()}%`,
              rate: Number(t.rate),
              accountId: t.accountId as string,
              chargeType: "On Net Total" as const,
              amount: 0,
            },
          ]
        : [];
  if (rows.length === 0)
    throw new Error("Tax template has no rows configured");
  return { id: t.id, name: t.name, rows };
}

export interface ComputedTaxLine {
  description: string;
  rate: Prisma.Decimal;
  accountId: string;
  taxAmount: Prisma.Decimal;
  chargeType: string;
  taxTemplateId?: string | null;
}

// Iterate rows in order; for each, compute taxAmount using its chargeType +
// the running sum of prior taxAmounts. Returns lines in the same order for
// snapshot persistence.
export function computeTaxLines(
  netTotal: Prisma.Decimal,
  rows: ResolvedTaxRow[],
): ComputedTaxLine[] {
  const out: ComputedTaxLine[] = [];
  let priorSum = new Prisma.Decimal(0);
  for (const r of rows) {
    let amount: Prisma.Decimal;
    if (r.chargeType === "Actual") {
      amount = new Prisma.Decimal(r.amount);
    } else if (r.chargeType === "On Previous Row Total") {
      amount = netTotal.add(priorSum).mul(r.rate).div(100);
    } else {
      // "On Net Total" (default)
      amount = netTotal.mul(r.rate).div(100);
    }
    out.push({
      description: r.description,
      rate: new Prisma.Decimal(r.rate),
      accountId: r.accountId,
      taxAmount: amount,
      chargeType: r.chargeType,
    });
    priorSum = priorSum.add(amount);
  }
  return out;
}

// B11 item-wise tax. Groups line-items by effective taxTemplateId (line's own
// override or fall-back to the invoice-level template), computes tax per
// group against that group's line-total, then aggregates all resulting rows
// by (accountId, description, rate, chargeType) so the SI/PI ends up with
// one snapshot row per unique tax dimension.
//
// - `lines` — the invoice's line items with their amount + optional per-line
//   taxTemplateId override.
// - `invoiceLevelTemplateId` — used when a line has no per-line override.
// - `loadTemplate` — caller-provided fn to resolve a templateId → rows. This
//   keeps this helper synchronous around templates the caller pre-loaded.
export function computeInvoiceTaxLines(
  lines: { amount: Prisma.Decimal; taxTemplateId?: string | null }[],
  invoiceLevelTemplateId: string | null | undefined,
  loadTemplate: (id: string | null | undefined) => ResolvedTaxRow[] | null,
): ComputedTaxLine[] {
  // Group line amounts by effective templateId.
  const groups = new Map<string, Prisma.Decimal>();
  for (const l of lines) {
    const effectiveId = l.taxTemplateId ?? invoiceLevelTemplateId ?? "";
    if (!effectiveId) continue;
    groups.set(effectiveId, (groups.get(effectiveId) ?? new Prisma.Decimal(0)).add(l.amount));
  }

  // Compute per-group + collect all rows.
  const perGroup: ComputedTaxLine[][] = [];
  for (const [templateId, groupTotal] of groups) {
    const rows = loadTemplate(templateId);
    if (!rows) continue;
    const groupLines = computeTaxLines(groupTotal, rows).map((r) => ({
      ...r,
      taxTemplateId: templateId,
    }));
    perGroup.push(groupLines);
  }

  // Aggregate across groups: same (accountId, description, rate, chargeType)
  // → sum taxAmount so the SI snapshot doesn't carry duplicates when e.g.
  // multiple item-level templates all posted to "GST Payable @ 18%".
  const merged = new Map<
    string,
    ComputedTaxLine
  >();
  for (const rows of perGroup) {
    for (const r of rows) {
      const key = `${r.accountId}::${r.description}::${r.rate.toString()}::${r.chargeType}`;
      const prev = merged.get(key);
      if (prev) {
        prev.taxAmount = prev.taxAmount.add(r.taxAmount);
      } else {
        merged.set(key, { ...r });
      }
    }
  }
  return [...merged.values()];
}

