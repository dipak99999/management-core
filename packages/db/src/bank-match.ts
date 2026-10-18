// Bank reconciliation — pure candidate scoring. Called by
// services/accounting-service/src/routes/bank-reconciliation.ts to rank
// possible GL matches for a single bank transaction. Ranking-based (not
// binary) so multi-candidate cases surface as top-N AutoSuggested rows
// instead of being silently left Unmatched (which is what the previous
// "exactly 1 candidate" rule did).
//
// Kept in packages/db so vitest can exercise the ranking without a DB.

export interface BankTxnLike {
  amount: number;                 // signed — positive = credit (inflow), negative = debit (outflow)
  transactionDate: Date | string;
  description: string | null;
  referenceNumber: string | null;
}

export interface GlEntryLike {
  id: string;
  postingDate: Date | string;
  debit: number;
  credit: number;
  remarks: string | null;
  // Voucher metadata — used for reference-token matching. The route passes
  // the joined voucher name (e.g. "SINV-0042") so we can compare against
  // the bank txn's referenceNumber / description.
  voucherName?: string | null;
}

export interface MatchScore {
  glEntry: GlEntryLike;
  score: number;                  // 0..1
  reasons: string[];              // human-readable, shown in UI tooltip
}

// -----------------------------------------------------------------------
// Scoring components. Each returns 0..1; the overall score is a weighted
// sum. Weights sum to 1.0 so the top score is always <= 1.

const W_AMOUNT = 0.55;   // must-have — a bank txn matches an entry iff the money moved
const W_DATE   = 0.25;   // strong signal but banks post 1-3d late
const W_REF    = 0.15;   // voucher name/reference — a smoking gun when present
const W_DESC   = 0.05;   // free-text similarity — noisiest, lowest weight

/**
 * Amount match. 1.0 for exact (within 0.01 rounding); grades down linearly
 * up to ±5%; below that returns 0. The reconciler shouldn't pair a bank
 * txn with an entry whose amount differs by more than a rounding error —
 * but the ±5% band exists so bank fees / partial-write-offs are surfaced
 * as low-confidence suggestions rather than hidden entirely.
 */
export function scoreAmount(txn: BankTxnLike, gl: GlEntryLike): number {
  const glAbs = Math.abs(gl.debit - gl.credit);
  const txnAbs = Math.abs(txn.amount);
  if (glAbs === 0 && txnAbs === 0) return 1;
  if (glAbs === 0 || txnAbs === 0) return 0;
  const delta = Math.abs(glAbs - txnAbs);
  if (delta < 0.01) return 1;
  const pct = delta / Math.max(glAbs, txnAbs);
  if (pct > 0.05) return 0;
  // Linear grade: 0% delta → 1.0, 5% delta → 0.
  return 1 - pct / 0.05;
}

/**
 * Date proximity. 1.0 same day; grades down linearly to 0 at ±14 days.
 * Zero beyond 14 (a bank posting more than 2 weeks off the source entry
 * is almost certainly a different transaction).
 */
export function scoreDate(txn: BankTxnLike, gl: GlEntryLike): number {
  const t = new Date(txn.transactionDate).getTime();
  const g = new Date(gl.postingDate).getTime();
  const diffDays = Math.abs(t - g) / (24 * 60 * 60 * 1000);
  if (diffDays > 14) return 0;
  return 1 - diffDays / 14;
}

/**
 * Reference token match. 1.0 when the GL entry's voucher name appears
 * (case-insensitive) in the bank txn's reference OR description. This is
 * the smoking-gun signal — when SINV-0042 shows up in the memo, we're
 * essentially certain.
 */
export function scoreReference(txn: BankTxnLike, gl: GlEntryLike): number {
  const name = gl.voucherName?.trim();
  if (!name) return 0;
  const needle = name.toLowerCase();
  const hay =
    `${txn.referenceNumber ?? ""} ${txn.description ?? ""}`.toLowerCase();
  return hay.includes(needle) ? 1 : 0;
}

/**
 * Description similarity — a light Jaccard on whitespace-split tokens
 * against the GL entry's remarks. Low weight because bank descriptions
 * are often bank-formatted (e.g. "UPI/DR/…") that share no tokens with
 * the operator's remarks even for a correct match.
 */
export function scoreDescription(txn: BankTxnLike, gl: GlEntryLike): number {
  const a = tokenize(txn.description);
  const b = tokenize(gl.remarks);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function tokenize(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),  // drop short filler ("to", "of", "-")
  );
}

/**
 * Overall match score with breakdown of reasons — used for the tooltip
 * on the UI's suggestions list so accountants understand *why* a match
 * was proposed and can spot-check.
 */
export function scoreMatch(txn: BankTxnLike, gl: GlEntryLike): MatchScore {
  const parts = {
    amount: scoreAmount(txn, gl),
    date: scoreDate(txn, gl),
    ref: scoreReference(txn, gl),
    desc: scoreDescription(txn, gl),
  };
  const score =
    W_AMOUNT * parts.amount +
    W_DATE * parts.date +
    W_REF * parts.ref +
    W_DESC * parts.desc;

  const reasons: string[] = [];
  if (parts.amount === 1) reasons.push("Exact amount");
  else if (parts.amount > 0) reasons.push(`Amount within ${((1 - parts.amount) * 5).toFixed(1)}%`);
  if (parts.date === 1) reasons.push("Same day");
  else if (parts.date > 0) reasons.push(`Within ${Math.round((1 - parts.date) * 14)} days`);
  if (parts.ref === 1) reasons.push(`Reference matches ${gl.voucherName}`);
  if (parts.desc > 0.3) reasons.push("Description overlap");

  return { glEntry: gl, score, reasons };
}

/**
 * Rank candidates. Filters out zero-amount-score entries (they're
 * definitely wrong, not just low-confidence) and returns the top N above
 * the confidence floor sorted by score descending.
 */
export function rankCandidates(
  txn: BankTxnLike,
  candidates: GlEntryLike[],
  opts: { topN?: number; minScore?: number } = {},
): MatchScore[] {
  const { topN = 5, minScore = 0.4 } = opts;
  return candidates
    .map((gl) => scoreMatch(txn, gl))
    .filter((s) => s.score >= minScore && scoreAmount(txn, s.glEntry) > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
