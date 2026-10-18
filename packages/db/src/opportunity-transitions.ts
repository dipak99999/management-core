// Opportunity status transitions — pure decision helper for propagating
// quote lifecycle events back to the source Opportunity. Called from
// Quotation /convert-to-sales-order and /mark-lost when the quote has an
// opportunityId set (module 30).
//
// Design intent:
//   QuoteWon  → opp advances to Converted. Never regresses (a re-won
//               quote from an already-Converted opp is a no-op).
//   QuoteLost → we DO NOT auto-mark the opp as Lost. An opp can have
//               multiple opp-linked quotes; one going Lost doesn't kill
//               the whole opportunity. We just surface the lostReason on
//               the opp's remarks so admins see WHY a quote failed
//               without opening every child quote.
//
// The route caller decides whether to also copy lostReason onto opp;
// this helper only tells the caller (a) whether to update opp status,
// (b) what the new status should be.

export type OpportunityQuoteEvent = "QuoteWon" | "QuoteLost";

export type OpportunityStatus = "Open" | "Quotation" | "Converted" | "Lost";

export interface OppTransitionResult {
  /** True when opp.status should change to `newStatus`. */
  shouldUpdate: boolean;
  newStatus: OpportunityStatus;
  /** Human-readable audit string the caller can stamp into opp.remarks or a note. */
  auditNote: string;
}

/**
 * Decide what to do with an Opportunity's status when one of its linked
 * quotes hits `event`. Never throws — returns `shouldUpdate: false` for
 * a no-op.
 */
export function nextOppStatusForQuoteEvent(input: {
  currentStatus: OpportunityStatus;
  event: OpportunityQuoteEvent;
  quoteName?: string;
  lostReason?: string;
}): OppTransitionResult {
  const { currentStatus, event } = input;

  if (event === "QuoteWon") {
    // Never regress from Converted or Lost — Converted is terminal
    // (opp already succeeded), Lost is a decision the operator made
    // explicitly and shouldn't be undone by a stray convert.
    if (currentStatus === "Converted" || currentStatus === "Lost") {
      return {
        shouldUpdate: false,
        newStatus: currentStatus,
        auditNote: `Quote ${input.quoteName ?? ""} won but opp already ${currentStatus} — no change`,
      };
    }
    return {
      shouldUpdate: true,
      newStatus: "Converted",
      auditNote: `Converted by quote ${input.quoteName ?? "(unnamed)"}`,
    };
  }

  // QuoteLost — never flip opp to Lost automatically. Multiple quotes
  // may be attached; one loss doesn't kill the deal. Caller can still
  // capture lostReason on opp.remarks (informational).
  return {
    shouldUpdate: false,
    newStatus: currentStatus,
    auditNote: input.lostReason
      ? `Quote ${input.quoteName ?? "(unnamed)"} lost: ${input.lostReason}`
      : `Quote ${input.quoteName ?? "(unnamed)"} lost`,
  };
}

/**
 * Build the merged remarks field for an Opportunity after appending an
 * audit note. Prepends the note with a timestamp for later triage. Kept
 * pure so the route can just call this + write the result.
 */
export function appendOppNote(
  existing: string | null | undefined,
  note: string,
  at: Date = new Date(),
): string {
  const stamped = `[${at.toISOString().slice(0, 10)}] ${note}`;
  if (!existing || !existing.trim()) return stamped;
  return `${existing.trimEnd()}\n${stamped}`;
}
