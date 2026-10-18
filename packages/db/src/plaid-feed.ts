// Plaid bank feed adapter.
//
// Uses the Plaid Item Access Token flow — see
// https://plaid.com/docs/api/products/transactions/ for the reference.
//
// Config lives on TenantIntegration.secrets (encrypted per repo convention):
//   {
//     plaidClientId: "...",
//     plaidSecret: "...",
//     plaidAccessToken: "...",       // per bank item, one per Account
//     plaidEnv: "sandbox" | "development" | "production" (default: sandbox)
//   }
//
// The route calls `fetchPlaidTransactions()` with those secrets + a date
// range; this function returns a normalized list. Route layer inserts a
// BankStatement + BankTransaction rows using the existing reconcile
// machinery. Zero external deps — plain fetch against Plaid's REST API.
//
// When Plaid creds aren't set: `fetchPlaidTransactions` throws a
// well-formed error the route surfaces as 400.

export interface PlaidCreds {
  clientId: string;
  secret: string;
  accessToken: string;
  env?: "sandbox" | "development" | "production";
}

export interface NormalizedTxn {
  transactionDate: Date;
  description: string;
  amount: number; // signed: + = money in, − = money out (Plaid inverts)
  referenceNumber: string | null;
  externalId: string; // Plaid transaction_id for de-dupe
}

const BASE_URLS = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

// Raw Plaid response shape — narrow subset we consume.
interface PlaidTxnRaw {
  transaction_id: string;
  date: string; // YYYY-MM-DD
  name: string;
  merchant_name?: string;
  amount: number; // positive = OUTFLOW in Plaid semantics; invert to store
  check_number?: string;
  payment_meta?: {
    reference_number?: string | null;
    check_number?: string | null;
  };
}

interface PlaidTxnResponse {
  transactions: PlaidTxnRaw[];
  total_transactions: number;
  request_id: string;
  error?: { error_code?: string; error_message?: string };
}

// Ensure creds are present + non-empty. Throws a stable error so the
// route can distinguish "not configured" (400 with clear message) from
// "Plaid API failure" (502 with the upstream code).
export function validatePlaidCreds(secrets: Record<string, unknown>): PlaidCreds {
  const clientId = typeof secrets.plaidClientId === "string" ? secrets.plaidClientId : "";
  const secret = typeof secrets.plaidSecret === "string" ? secrets.plaidSecret : "";
  const accessToken =
    typeof secrets.plaidAccessToken === "string" ? secrets.plaidAccessToken : "";
  const env =
    typeof secrets.plaidEnv === "string" && (secrets.plaidEnv === "sandbox" || secrets.plaidEnv === "development" || secrets.plaidEnv === "production")
      ? secrets.plaidEnv
      : "sandbox";
  if (!clientId || !secret || !accessToken) {
    throw new Error(
      "Plaid not configured — set plaidClientId, plaidSecret, and plaidAccessToken on the TenantIntegration.secrets bag",
    );
  }
  return { clientId, secret, accessToken, env };
}

// Fetch + paginate. Plaid caps at 500 txns per call, so we loop.
export async function fetchPlaidTransactions(
  creds: PlaidCreds,
  fromDate: string, // YYYY-MM-DD
  toDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedTxn[]> {
  const base = BASE_URLS[creds.env ?? "sandbox"];
  const url = `${base}/transactions/get`;
  const all: NormalizedTxn[] = [];
  let offset = 0;
  const pageSize = 500;
  for (let hop = 0; hop < 20; hop++) {
    const body = {
      client_id: creds.clientId,
      secret: creds.secret,
      access_token: creds.accessToken,
      start_date: fromDate,
      end_date: toDate,
      options: { count: pageSize, offset },
    };
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `Plaid ${res.status}`;
      try {
        const err = (await res.json()) as PlaidTxnResponse;
        if (err.error?.error_message) msg = `Plaid: ${err.error.error_code ?? "error"} — ${err.error.error_message}`;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    const data = (await res.json()) as PlaidTxnResponse;
    for (const t of data.transactions) {
      all.push({
        externalId: t.transaction_id,
        transactionDate: new Date(`${t.date}T00:00:00Z`),
        description: t.merchant_name ?? t.name,
        // Plaid: positive = money OUT of account. Invert so + = deposit.
        amount: -Number(t.amount),
        referenceNumber:
          t.payment_meta?.reference_number ??
          t.payment_meta?.check_number ??
          t.check_number ??
          null,
      });
    }
    offset += data.transactions.length;
    if (data.transactions.length < pageSize || offset >= data.total_transactions) break;
  }
  return all;
}
