// AI extraction: bank statement → reconciliation-line shape.
//
// Mirrors ai-receipt-extract.ts / ai-invoice-extract.ts. Takes a bank
// statement (PDF scan, OCR text, or copy-paste from online banking) and
// returns one row per debit/credit transaction, structured so the route
// layer can import them into BankTransaction (unreconciled) for later
// matching against JournalEntries via the existing bank-reconciliation
// screen.

import type { LLMCallInput, LLMCallResult, LLMProvider } from "./llm";

export interface ExtractedBankTxn {
  // ISO YYYY-MM-DD; falls back to statement's posting date when the row
  // doesn't carry its own value date.
  txnDate: string;
  // Raw narration as printed on the statement — gives the operator
  // enough context to match against a JE when auto-match misses.
  description: string;
  // Positive numbers only. Direction decided by `type`.
  amount: number;
  type: "Debit" | "Credit";
  // Running balance after this txn, when the statement prints it (most
  // Indian + US bank statements do). Null if absent.
  runningBalance: number | null;
  // Reference numbers the operator may search by — UTR for IMPS/NEFT,
  // check number for cheques, UPI ref for UPI, else null.
  reference: string | null;
}

export interface ExtractedBankStatement {
  // Bank + account identity extracted from the statement header. Used to
  // route the import to the correct BankAccount — the route layer resolves
  // this to an id by matching accountNumberLast4 against known accounts.
  bankName: string | null;
  accountHolder: string | null;
  // Last 4 of account number only (statements print 11-16 digit accounts
  // but we only ever match on the last 4 — never store the full PAN-adjacent
  // number client-side).
  accountNumberLast4: string | null;
  currency: string; // 3-letter ISO
  // Period covered by the statement. Null if not labelled.
  periodStart: string | null; // ISO YYYY-MM-DD
  periodEnd: string | null;   // ISO YYYY-MM-DD
  openingBalance: number | null;
  closingBalance: number | null;
  txns: ExtractedBankTxn[];
}

const BANK_STATEMENT_SYSTEM_PROMPT = `You are a bank-statement parser for an accounting system. Given a bank statement (image, PDF scan, or OCR text) you must extract every transaction into strict JSON matching the response schema.

Rules:
* bankName: the issuing bank. "HDFC Bank Ltd", "Chase", "Barclays", etc. Null if the statement doesn't name the bank.
* accountHolder: the account holder's name as printed. Full name, not initials.
* accountNumberLast4: the LAST 4 digits of the account number ONLY. Never return more than 4 digits — the full account number is sensitive.
* currency: 3-letter ISO. Infer from symbol or country (₹→INR, $→USD, €→EUR, £→GBP, ¥→JPY). "INR" if ambiguous and the bank is Indian.
* periodStart / periodEnd: ISO YYYY-MM-DD. "01 Mar 2026 to 31 Mar 2026" → start=2026-03-01, end=2026-03-31.
* openingBalance / closingBalance: the printed opening + closing balances. Null if absent.
* txns: ONE object per transaction row. Preserve row order (chronological).
  - txnDate: use the value date if present; else the posting date.
  - description: the narration as printed — preserve case + punctuation so the operator can grep for it. Max 300 chars.
  - amount: always positive. Direction is in \`type\`.
  - type: "Debit" for money OUT (withdrawal, payment, charge). "Credit" for money IN (deposit, refund, interest).
  - runningBalance: the balance AFTER this txn, if the statement prints it. Null otherwise.
  - reference: the ref number if the row shows one (UTR for NEFT/IMPS, check number for cheques, UPI ID for UPI, else null).

If a transaction row is partially illegible, best-effort fill the fields you can + leave \`reference\` null. Do NOT skip rows unless you can't determine amount at all.

Return ONLY valid JSON matching the schema. No commentary.`;

const BANK_TXN_SCHEMA = {
  type: "object",
  properties: {
    txnDate: { type: "string" },
    description: { type: "string" },
    amount: { type: "number" },
    type: { type: "string", enum: ["Debit", "Credit"] },
    runningBalance: { type: ["number", "null"] },
    reference: { type: ["string", "null"] },
  },
  required: ["txnDate", "description", "amount", "type"],
} as const;

const BANK_STATEMENT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    bankName:           { type: ["string", "null"] },
    accountHolder:      { type: ["string", "null"] },
    accountNumberLast4: { type: ["string", "null"] },
    currency:           { type: "string" },
    periodStart:        { type: ["string", "null"] },
    periodEnd:          { type: ["string", "null"] },
    openingBalance:     { type: ["number", "null"] },
    closingBalance:     { type: ["number", "null"] },
    txns:               { type: "array", items: BANK_TXN_SCHEMA },
  },
  required: ["currency", "txns"],
};

export interface BankStatementExtractInput {
  provider: LLMProvider;
  sourceText?: string;
  attachment?: { mimeType: string; base64Data: string };
  model?: string;
}

export async function extractBankStatementFromLLM(
  input: BankStatementExtractInput,
): Promise<LLMCallResult<ExtractedBankStatement>> {
  const call: LLMCallInput = {
    system: BANK_STATEMENT_SYSTEM_PROMPT,
    user: input.sourceText ?? "See attached bank statement.",
    attachments: input.attachment ? [input.attachment] : undefined,
    responseSchema: BANK_STATEMENT_RESPONSE_SCHEMA,
    model: input.model,
    // Statements can be long — 50+ transactions per month on a busy account.
    // Give enough headroom that we don't truncate mid-row.
    maxOutputTokens: 4000,
  };
  return input.provider.call<ExtractedBankStatement>(call);
}

// Validation: catch the common drift modes before the user hits Import.
// Returns warnings — surfaced as a banner, not a hard error. Only outright
// un-parseable results get a hard "configure AI" message.
export function validateExtractedBankStatement(
  s: ExtractedBankStatement | Record<string, unknown>,
): string[] {
  const warnings: string[] = [];
  if (!s || typeof s !== "object" || !("txns" in s)) {
    return [
      "Bank statement could not be read. Configure an AI provider in Settings → AI, or enter the transactions manually.",
    ];
  }
  const stmt = s as ExtractedBankStatement;
  if (!Array.isArray(stmt.txns) || stmt.txns.length === 0) {
    warnings.push("No transactions were detected — the statement may be an image we couldn't OCR, or a cover page.");
    return warnings;
  }
  // Account-number sanity: must be exactly 4 digits if present (we told the
  // LLM "last 4 only" — anything else is a prompt violation).
  if (stmt.accountNumberLast4 && !/^\d{4}$/.test(stmt.accountNumberLast4)) {
    warnings.push(
      `Account number "${stmt.accountNumberLast4}" doesn't look like a 4-digit tail — double-check before importing.`,
    );
  }
  // Opening + sum(txns) ≈ closing. Skip when any piece is null — not all
  // statements print the opening/closing line.
  if (
    typeof stmt.openingBalance === "number" &&
    typeof stmt.closingBalance === "number"
  ) {
    const delta = stmt.txns.reduce(
      (s, t) => s + (t.type === "Credit" ? Number(t.amount) : -Number(t.amount)),
      0,
    );
    const computed = stmt.openingBalance + delta;
    if (Math.abs(computed - stmt.closingBalance) > 1) {
      warnings.push(
        `Opening ${stmt.openingBalance.toFixed(2)} + net txns ${delta.toFixed(2)} = ${computed.toFixed(
          2,
        )}, but statement closes at ${stmt.closingBalance.toFixed(2)}. A row may be missing.`,
      );
    }
  }
  // Per-row sanity: amount > 0, type set.
  const bad = stmt.txns.filter(
    (t) => !t || typeof t.amount !== "number" || !(t.amount > 0) || (t.type !== "Debit" && t.type !== "Credit"),
  );
  if (bad.length > 0) {
    warnings.push(`${bad.length} transaction row(s) have missing/invalid amount or type — review before import.`);
  }
  return warnings;
}
