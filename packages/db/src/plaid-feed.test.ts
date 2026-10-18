import { describe, expect, it, vi } from "vitest";
import { fetchPlaidTransactions, validatePlaidCreds } from "./plaid-feed";

describe("validatePlaidCreds", () => {
  it("passes when all three secrets set", () => {
    const c = validatePlaidCreds({
      plaidClientId: "cid",
      plaidSecret: "sec",
      plaidAccessToken: "tok",
    });
    expect(c.clientId).toBe("cid");
    expect(c.env).toBe("sandbox"); // default
  });

  it("throws when any secret missing", () => {
    expect(() => validatePlaidCreds({ plaidClientId: "cid", plaidSecret: "sec" })).toThrow(
      /not configured/,
    );
    expect(() => validatePlaidCreds({})).toThrow(/not configured/);
  });

  it("accepts explicit environment", () => {
    const c = validatePlaidCreds({
      plaidClientId: "cid",
      plaidSecret: "sec",
      plaidAccessToken: "tok",
      plaidEnv: "production",
    });
    expect(c.env).toBe("production");
  });

  it("falls back to sandbox for unknown env", () => {
    const c = validatePlaidCreds({
      plaidClientId: "cid",
      plaidSecret: "sec",
      plaidAccessToken: "tok",
      plaidEnv: "moon",
    });
    expect(c.env).toBe("sandbox");
  });
});

describe("fetchPlaidTransactions", () => {
  const creds = { clientId: "cid", secret: "sec", accessToken: "tok" } as const;

  it("inverts Plaid amounts + normalizes fields", async () => {
    const stub = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        transactions: [
          {
            transaction_id: "txn_1",
            date: "2026-09-25",
            name: "Amazon.com",
            merchant_name: "Amazon",
            amount: 12.34, // Plaid: OUTFLOW
            payment_meta: { reference_number: "REF-42" },
          },
          {
            transaction_id: "txn_2",
            date: "2026-09-26",
            name: "Salary",
            amount: -5000, // Plaid: INFLOW
          },
        ],
        total_transactions: 2,
        request_id: "r",
      }),
    })) as unknown as typeof fetch;
    const out = await fetchPlaidTransactions(creds, "2026-09-01", "2026-09-30", stub);
    expect(out).toHaveLength(2);
    expect(out[0].description).toBe("Amazon");
    expect(out[0].amount).toBe(-12.34); // outflow → negative
    expect(out[0].referenceNumber).toBe("REF-42");
    expect(out[1].amount).toBe(5000); // inflow → positive
  });

  it("throws with Plaid error message on non-2xx", async () => {
    const stub = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "Re-auth needed" },
      }),
    })) as unknown as typeof fetch;
    await expect(fetchPlaidTransactions(creds, "2026-09-01", "2026-09-30", stub)).rejects.toThrow(
      /Re-auth needed/,
    );
  });

  it("paginates when result count reaches page size", async () => {
    const page1 = new Array(500).fill(null).map((_, i) => ({
      transaction_id: `t${i}`,
      date: "2026-09-25",
      name: `n${i}`,
      amount: 1,
    }));
    const page2 = [{ transaction_id: "t500", date: "2026-09-26", name: "last", amount: 2 }];
    let hop = 0;
    const stub = vi.fn(async () => {
      const page = hop === 0 ? page1 : page2;
      hop++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ transactions: page, total_transactions: 501, request_id: "r" }),
      };
    }) as unknown as typeof fetch;
    const out = await fetchPlaidTransactions(creds, "2026-09-01", "2026-09-30", stub);
    expect(out).toHaveLength(501);
    expect(stub).toHaveBeenCalledTimes(2);
  });
});
