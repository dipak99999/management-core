import { describe, expect, it } from "vitest";
import {
  composeSalarySlipBody,
  composeSalarySlipEmail,
  composeSalarySlipSubject,
} from "./salary-slip-email";

const baseInput = {
  slipName: "SS-0042",
  employeeName: "Priya Sharma",
  periodStart: new Date(Date.UTC(2026, 5, 1)),
  periodEnd: new Date(Date.UTC(2026, 5, 30)),
  grossPay: 82500,
  totalDeduction: 12300,
  netPay: 70200,
  tenantName: "Acme Ltd",
  earnings: [
    { componentName: "Basic", amount: 50000 },
    { componentName: "HRA", amount: 25000 },
    { componentName: "Special", amount: 7500 },
  ],
  deductions: [
    { componentName: "PF", amount: 6000 },
    { componentName: "TDS", amount: 6300 },
  ],
};

describe("composeSalarySlipSubject", () => {
  it("includes tenant prefix + slip name + period", () => {
    expect(
      composeSalarySlipSubject({
        slipName: "SS-0042",
        periodStart: new Date(Date.UTC(2026, 5, 1)),
        periodEnd: new Date(Date.UTC(2026, 5, 30)),
        tenantName: "Acme Ltd",
      }),
    ).toBe("Acme Ltd · Salary slip SS-0042 — 2026-06-01 → 2026-06-30");
  });

  it("omits tenant prefix when null", () => {
    expect(
      composeSalarySlipSubject({
        slipName: "SS-0001",
        periodStart: new Date(Date.UTC(2026, 0, 1)),
        periodEnd: new Date(Date.UTC(2026, 0, 31)),
        tenantName: null,
      }),
    ).toBe("Salary slip SS-0001 — 2026-01-01 → 2026-01-31");
  });
});

describe("composeSalarySlipBody", () => {
  it("includes employee name + period + gross/net", () => {
    const body = composeSalarySlipBody(baseInput);
    expect(body).toContain("Priya Sharma");
    expect(body).toContain("2026-06-01 → 2026-06-30");
    expect(body).toContain("82,500.00");
    expect(body).toContain("70,200.00");
  });

  it("renders earnings rows", () => {
    const body = composeSalarySlipBody(baseInput);
    expect(body).toContain("Basic");
    expect(body).toContain("HRA");
    expect(body).toContain("50,000.00");
  });

  it("renders deductions rows", () => {
    const body = composeSalarySlipBody(baseInput);
    expect(body).toContain("PF");
    expect(body).toContain("TDS");
    expect(body).toContain("6,000.00");
  });

  it("escapes HTML in component names + employee name", () => {
    const body = composeSalarySlipBody({
      ...baseInput,
      employeeName: "<Priya>",
      earnings: [{ componentName: "Sneaky <b>bold</b>", amount: 100 }],
    });
    expect(body).toContain("&lt;Priya&gt;");
    expect(body).toContain("Sneaky &lt;b&gt;bold&lt;/b&gt;");
    expect(body).not.toContain("<b>bold</b>");
  });

  it("shows placeholder when no earnings/deductions", () => {
    const body = composeSalarySlipBody({
      ...baseInput,
      earnings: [],
      deductions: [],
    });
    expect(body).toContain("No earning components");
    expect(body).toContain("No deductions");
  });

  it("defaults currency to INR", () => {
    const body = composeSalarySlipBody(baseInput);
    expect(body).toContain("INR");
  });

  it("respects overridden currency", () => {
    const body = composeSalarySlipBody({ ...baseInput, currency: "USD" });
    expect(body).toContain("USD");
    expect(body).not.toContain("70,200.00 INR");
  });

  it("slip name appears at the footer with code tag", () => {
    const body = composeSalarySlipBody(baseInput);
    expect(body).toContain("<code>SS-0042</code>");
  });
});

describe("composeSalarySlipEmail (wrapper)", () => {
  it("returns both subject + body", () => {
    const r = composeSalarySlipEmail(baseInput);
    expect(r.subject).toContain("SS-0042");
    expect(r.body).toContain("Priya Sharma");
  });
});
