// Cheque print helper — pure formatter for cheque data + MICR line.
//
// MICR band format (per RBI):
//   <cheque #> <MICR code> <account #> <transaction code>
// where MICR code = 9 digits (City 3 + Bank 3 + Branch 3), transaction
// code is 2 digits (10 = current/savings; 11 = cash credit; etc.).
//
// The band uses E-13B glyphs (⑈ ⑆ ⑇) as delimiters; we emit them as
// their Unicode code points so a downstream MICR-band font renders
// them correctly. If the print stack doesn't have an MICR font, the
// characters fall back to unreadable glyphs — that's fine as this is a
// helper; the print format decides how to render.

export interface ChequeInput {
  payeeName: string;
  amount: number;
  postingDate: Date;
  chequeNumber: string;   // 6 digits typically
  micrCode: string;       // 9 digits — city 3 + bank 3 + branch 3
  accountNumber: string;
  transactionCode?: string; // 2 digits, default "10" (current/savings)
}

export interface ChequeRenderable {
  payeeName: string;
  amountNumeric: string;      // e.g. "1,23,456.00" (Indian grouping)
  amountInWords: string;
  dateDDMMYYYY: string;
  chequeNumber: string;
  micrBand: string;
}

// E-13B delimiters
const ON_US_SYMBOL = "⑆"; // ⑆ (cheque #)
const AMOUNT_SYMBOL = "⑇"; // ⑇ (amount)
const TRANSIT_SYMBOL = "⑈"; // ⑈ (transit / MICR code)
const DASH_SYMBOL = "⑉"; // ⑉ (dash)

// Indian numbering: 1,23,45,678.90 (last 3, then every 2). No paise here.
function fmtAmountINR(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [intPart, decPart = "00"] = rounded.toFixed(2).split(".");
  // Indian grouping
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${grouped}.${decPart}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

// Indian words: Crore, Lakh, Thousand.
function amountToWordsINR(n: number): string {
  const whole = Math.floor(n);
  const paise = Math.round((n - whole) * 100);
  if (whole === 0 && paise === 0) return "Rupees Zero Only";

  const crore = Math.floor(whole / 10000000);
  const rem1 = whole % 10000000;
  const lakh = Math.floor(rem1 / 100000);
  const rem2 = rem1 % 100000;
  const thousand = Math.floor(rem2 / 1000);
  const rem3 = rem2 % 1000;
  const hundred = Math.floor(rem3 / 100);
  const rem4 = rem3 % 100;

  const parts: string[] = [];
  if (crore) parts.push(twoDigit(crore) + " Crore");
  if (lakh) parts.push(twoDigit(lakh) + " Lakh");
  if (thousand) parts.push(twoDigit(thousand) + " Thousand");
  if (hundred) parts.push(ONES[hundred] + " Hundred");
  if (rem4) parts.push((parts.length > 0 ? "and " : "") + twoDigit(rem4));

  const rupees = parts.join(" ").trim() || "Zero";
  const paisePart = paise > 0 ? ` and ${twoDigit(paise)} Paise` : "";
  return `Rupees ${rupees}${paisePart} Only`;
}

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}${mm}${yyyy}`; // used on cheque date grid — no separators
}

// MICR band: ⑆<cheque#>⑆ ⑈<micrCode>⑈ <accountNo>⑉ <txnCode>
export function renderMicrBand(input: {
  chequeNumber: string;
  micrCode: string;
  accountNumber: string;
  transactionCode?: string;
}): string {
  const cheq = input.chequeNumber.replace(/\D/g, "").padStart(6, "0");
  const micr = input.micrCode.replace(/\D/g, "").padStart(9, "0");
  const acct = input.accountNumber.replace(/\D/g, "");
  const txn = (input.transactionCode ?? "10").replace(/\D/g, "").padStart(2, "0");
  return `${ON_US_SYMBOL}${cheq}${ON_US_SYMBOL} ${TRANSIT_SYMBOL}${micr}${TRANSIT_SYMBOL} ${acct}${DASH_SYMBOL} ${txn}`;
}

export function renderCheque(input: ChequeInput): ChequeRenderable {
  return {
    payeeName: input.payeeName,
    amountNumeric: fmtAmountINR(input.amount),
    amountInWords: amountToWordsINR(input.amount),
    dateDDMMYYYY: fmtDate(input.postingDate),
    chequeNumber: input.chequeNumber,
    micrBand: renderMicrBand({
      chequeNumber: input.chequeNumber,
      micrCode: input.micrCode,
      accountNumber: input.accountNumber,
      transactionCode: input.transactionCode,
    }),
  };
}

// Sentinel exports for tests / print format callers that need the raw
// glyphs (e.g. to detect and swap fonts).
export const MICR_SYMBOLS = {
  ON_US: ON_US_SYMBOL,
  AMOUNT: AMOUNT_SYMBOL,
  TRANSIT: TRANSIT_SYMBOL,
  DASH: DASH_SYMBOL,
};

// Also exposed for callers that just want the words function (e.g. to
// pre-render for invoice "amount in words" too).
export { amountToWordsINR, fmtAmountINR };
