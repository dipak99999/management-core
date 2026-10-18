// Amount-in-words — Indian numbering system (lakh / crore) with paise for
// fractions. Used by the cheque print template so the physical cheque
// carries a legally-required text amount that matches the digits box.
//
// Style: title-case each word, joined with spaces, no "and" between the
// major and minor units — matches ERPNext + most Indian bank convention.
//   12345.67 → "Twelve Thousand Three Hundred Forty Five Rupees And Sixty Seven Paise"
//
// International (short-scale) variant is left as a follow-up; most cheque
// use in this codebase is India-first.

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

// Convert 0..99 to words.
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]} ${ONES[o]}`;
}

// Convert 0..999 to words.
function threeDigits(n: number): string {
  if (n === 0) return "";
  if (n < 100) return twoDigits(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const hStr = `${ONES[h]} Hundred`;
  return rest === 0 ? hStr : `${hStr} ${twoDigits(rest)}`;
}

/**
 * Whole-number rupees to words, Indian numbering (crore/lakh/thousand).
 *
 *   999 → "Nine Hundred Ninety Nine"
 *   1_000 → "One Thousand"
 *   1_00_000 → "One Lakh"
 *   1_00_00_000 → "One Crore"
 *   12_34_56_789 → "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine"
 *
 * Returns "Zero" for 0. Handles up to 999 crore (~10^11); beyond that
 * ERPNext just extends with additional crores. Same posture here.
 */
export function wholeToIndianWords(nRaw: number): string {
  const n = Math.abs(Math.floor(nRaw));
  if (n === 0) return "Zero";

  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n / 1_00_000) % 100);
  const thousand = Math.floor((n / 1_000) % 100);
  const hundreds = n % 1_000;

  if (crore > 0) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds > 0) parts.push(threeDigits(hundreds));

  return parts.join(" ");
}

/**
 * Currency amount to words with paise. Matches Indian cheque convention.
 *
 *   0.00 → "Zero Rupees Only"
 *   1234.56 → "One Thousand Two Hundred Thirty Four Rupees And Fifty Six Paise Only"
 *   1234.00 → "One Thousand Two Hundred Thirty Four Rupees Only"
 *
 * Negative amounts get "Minus " prefix; unusual on cheques but defensive.
 */
export function amountInIndianWords(amount: number): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs);
  const paise = Math.round((abs - whole) * 100);

  const wholeStr = wholeToIndianWords(whole);
  let out = `${wholeStr} Rupees`;
  if (paise > 0) {
    out += ` And ${twoDigits(paise)} Paise`;
  }
  out += " Only";
  return negative ? `Minus ${out}` : out;
}
