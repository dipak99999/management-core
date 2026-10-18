// Minimum-viable coverage for mcp-server's LumaaraClient config loader and
// JWT state. Fills the "no tests at all" gap — real MCP protocol coverage
// would require boot + a stub SDK client and is out of scope for MVP.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfigFromEnv, LumaaraClient } from "./lumaara-client";

describe("loadConfigFromEnv", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.LUMAARA_AUTH_URL;
    delete process.env.LUMAARA_ACCOUNTING_URL;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("falls back to localhost defaults when env vars are unset", () => {
    const cfg = loadConfigFromEnv();
    expect(cfg.authUrl).toBe("http://localhost:4101");
    expect(cfg.accountingUrl).toBe("http://localhost:4102");
  });

  it("uses env values when set", () => {
    process.env.LUMAARA_AUTH_URL = "https://auth.example.com";
    process.env.LUMAARA_ACCOUNTING_URL = "https://acct.example.com";
    const cfg = loadConfigFromEnv();
    expect(cfg.authUrl).toBe("https://auth.example.com");
    expect(cfg.accountingUrl).toBe("https://acct.example.com");
  });
});

describe("LumaaraClient JWT state", () => {
  const cfg = loadConfigFromEnv();

  it("starts without a JWT when constructed with null", () => {
    const c = new LumaaraClient(cfg, null);
    expect(c.hasJwt()).toBe(false);
    expect(c.getJwt()).toBeNull();
  });

  it("carries the JWT it was constructed with", () => {
    const c = new LumaaraClient(cfg, "token-xyz");
    expect(c.hasJwt()).toBe(true);
    expect(c.getJwt()).toBe("token-xyz");
  });

  it("setJwt updates the stored token; null clears it", () => {
    const c = new LumaaraClient(cfg, null);
    c.setJwt("t1");
    expect(c.getJwt()).toBe("t1");
    c.setJwt(null);
    expect(c.hasJwt()).toBe(false);
  });
});
