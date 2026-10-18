// Module 55 — Duplicate detection: pure matching helpers.
//
// Given two rows (each carrying normalized name + email + gstin + phone),
// return a similarity score in [0, 100] plus a breakdown of which
// fields matched. Callers use the score to rank candidate pairs;
// operators review + merge in the UI.
//
// Design decisions:
//   * Name similarity uses normalized token overlap (case-insensitive,
//     punctuation-stripped) rather than a heavy Levenshtein — cheap +
//     good enough for "Acme Corp" vs "Acme Corporation" style typos.
//     Levenshtein is a follow-up if empirical accuracy demands it.
//   * Email + GSTIN + PAN + phone are EXACT match after normalize (case
//     for email, whitespace-strip for others). Exact ID match is a
//     strong duplicate signal — worth more weight than fuzzy name.
//   * Weights sum to 100 so `score` is a percentage. Adjustable via
//     the `weights` param if a tenant wants to tune.
//
// Score interpretation (defaults):
//   90+  Near-certain duplicate (exact ID + close name)
//   70+  Likely duplicate — worth reviewing
//   50+  Possible duplicate — surface but expect false positives
//   <50  Ignore

export interface MatchCandidate {
  id: string;
  name: string;
  email?: string | null;
  gstin?: string | null;
  pan?: string | null;
  phone?: string | null;
}

export interface MatchWeights {
  name: number; // default 40
  email: number; // default 25
  gstin: number; // default 25
  pan: number; // default 5
  phone: number; // default 5
}

const DEFAULT_WEIGHTS: MatchWeights = { name: 40, email: 25, gstin: 25, pan: 5, phone: 5 };

export interface MatchResult {
  score: number;
  breakdown: {
    name: number;
    email: number;
    gstin: number;
    pan: number;
    phone: number;
  };
}

// Normalize a name for comparison: lowercase, strip punctuation, strip
// legal-form suffixes (Ltd/LLC/Pvt/Corp/…), collapse whitespace.
const LEGAL_SUFFIXES = new Set([
  "ltd", "limited", "llc", "llp", "inc", "incorporated", "corp", "corporation",
  "pvt", "private", "co", "company", "gmbh", "sa", "spa", "srl", "bv", "nv",
  "ag", "kg", "oy", "ab", "aps",
]);

export function normalizeName(name: string): string {
  const stripped = name
    .toLowerCase()
    .replace(/[.,'"()&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = stripped.split(" ").filter((t) => t && !LEGAL_SUFFIXES.has(t));
  return tokens.join(" ");
}

// Token Jaccard on normalized names, returned as 0-100.
function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const setA = new Set(na.split(" "));
  const setB = new Set(nb.split(" "));
  const intersect = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 0;
  const jaccard = intersect / union;
  // Boost when one is a prefix/subset of the other ("Acme" vs "Acme Corp").
  const smaller = na.length < nb.length ? na : nb;
  const larger = na.length < nb.length ? nb : na;
  const prefixBonus = larger.startsWith(smaller) ? 0.15 : 0;
  return Math.min(100, Math.round((jaccard + prefixBonus) * 100));
}

// Exact-match after normalize. All-or-nothing (100 or 0).
function idFieldMatch(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  return a.trim().toLowerCase() === b.trim().toLowerCase() ? 100 : 0;
}

// Phone match: strip everything but digits then compare last 10.
// Tolerates "+91 98765 43210" vs "9876543210" vs "098765-43210".
function phoneMatch(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const cleanA = a.replace(/\D/g, "").slice(-10);
  const cleanB = b.replace(/\D/g, "").slice(-10);
  if (!cleanA || !cleanB || cleanA.length < 10) return 0;
  return cleanA === cleanB ? 100 : 0;
}

export function scoreCandidatePair(
  a: MatchCandidate,
  b: MatchCandidate,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): MatchResult {
  const breakdown = {
    name: nameSimilarity(a.name, b.name),
    email: idFieldMatch(a.email, b.email),
    gstin: idFieldMatch(a.gstin, b.gstin),
    pan: idFieldMatch(a.pan, b.pan),
    phone: phoneMatch(a.phone, b.phone),
  };
  const totalWeight = weights.name + weights.email + weights.gstin + weights.pan + weights.phone;
  const raw =
    (breakdown.name * weights.name +
      breakdown.email * weights.email +
      breakdown.gstin * weights.gstin +
      breakdown.pan * weights.pan +
      breakdown.phone * weights.phone) /
    totalWeight;
  return { score: Math.round(raw), breakdown };
}

// Scan a list of candidates and return every pair with score >= threshold,
// sorted by score descending. O(n²) — fine for tenant sizes up to a few
// thousand rows per doctype. Beyond that, a blocking strategy (bucket by
// first-3-chars of normalized name) would be the next step.
export interface CandidatePair {
  a: MatchCandidate;
  b: MatchCandidate;
  result: MatchResult;
}

export function findDuplicatePairs(
  candidates: MatchCandidate[],
  threshold = 70,
  weights?: MatchWeights,
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const result = scoreCandidatePair(candidates[i], candidates[j], weights);
      if (result.score >= threshold) {
        pairs.push({ a: candidates[i], b: candidates[j], result });
      }
    }
  }
  pairs.sort((x, y) => y.result.score - x.result.score);
  return pairs;
}
