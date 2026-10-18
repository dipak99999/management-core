// EMI calculation + schedule builder for employee loans. Uses standard
// reducing-balance EMI formula:
//   EMI = P × r × (1+r)^n / ((1+r)^n − 1)
// where r is the monthly rate (annualRate / 12 / 100) and n is termMonths.
//
// For a 0% loan, EMI = P / n (equal principal, no interest). Interest for
// each month is `outstanding × r`, principal is `EMI − interest`. A final
// rounding adjustment goes onto the last installment so the schedule sums
// exactly back to P (no drift from repeated rounding).

export interface ScheduleRow {
  installmentNo: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  balanceAfter: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function computeEmi(
  principal: number,
  annualRatePct: number,
  termMonths: number,
): number {
  if (termMonths <= 0) throw new Error("termMonths must be > 0");
  if (annualRatePct <= 0) return round4(principal / termMonths);
  const r = annualRatePct / 12 / 100;
  const pow = Math.pow(1 + r, termMonths);
  return round4((principal * r * pow) / (pow - 1));
}

// Generates the amortization schedule for a fresh loan disbursement.
// disbursementDate is the anchor for the first installment date (dueDate =
// disbursementDate + i months). Returns termMonths rows.
export function buildSchedule(
  principal: number,
  annualRatePct: number,
  termMonths: number,
  disbursementDate: Date,
): ScheduleRow[] {
  const emi = computeEmi(principal, annualRatePct, termMonths);
  const r = annualRatePct / 12 / 100;
  const rows: ScheduleRow[] = [];
  let outstanding = principal;

  for (let i = 1; i <= termMonths; i++) {
    const interest = annualRatePct > 0 ? round4(outstanding * r) : 0;
    let princ = round4(emi - interest);
    // Final installment: adjust for cumulative rounding so schedule sums to P.
    if (i === termMonths) princ = round4(outstanding);
    const total = round4(princ + interest);
    outstanding = round4(outstanding - princ);
    const dueDate = new Date(disbursementDate);
    dueDate.setMonth(dueDate.getMonth() + i);
    rows.push({
      installmentNo: i,
      dueDate,
      principalAmount: princ,
      interestAmount: interest,
      totalAmount: total,
      balanceAfter: outstanding < 0 ? 0 : outstanding,
    });
  }
  return rows;
}
