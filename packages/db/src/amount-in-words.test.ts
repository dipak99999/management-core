import { describe, expect, it } from "vitest";
import {
  amountInIndianWords,
  wholeToIndianWords,
} from "./amount-in-words";

describe("wholeToIndianWords", () => {
  it("0 → Zero", () => {
    expect(wholeToIndianWords(0)).toBe("Zero");
  });
  it("1..19 use ones table", () => {
    expect(wholeToIndianWords(1)).toBe("One");
    expect(wholeToIndianWords(9)).toBe("Nine");
    expect(wholeToIndianWords(11)).toBe("Eleven");
    expect(wholeToIndianWords(19)).toBe("Nineteen");
  });
  it("20..99 use tens table", () => {
    expect(wholeToIndianWords(20)).toBe("Twenty");
    expect(wholeToIndianWords(45)).toBe("Forty Five");
    expect(wholeToIndianWords(99)).toBe("Ninety Nine");
  });
  it("hundreds", () => {
    expect(wholeToIndianWords(100)).toBe("One Hundred");
    expect(wholeToIndianWords(999)).toBe("Nine Hundred Ninety Nine");
  });
  it("thousands", () => {
    expect(wholeToIndianWords(1000)).toBe("One Thousand");
    expect(wholeToIndianWords(1234)).toBe(
      "One Thousand Two Hundred Thirty Four",
    );
  });
  it("lakhs", () => {
    expect(wholeToIndianWords(100_000)).toBe("One Lakh");
    expect(wholeToIndianWords(1_23_456)).toBe(
      "One Lakh Twenty Three Thousand Four Hundred Fifty Six",
    );
  });
  it("crores", () => {
    expect(wholeToIndianWords(1_00_00_000)).toBe("One Crore");
    expect(wholeToIndianWords(12_34_56_789)).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine",
    );
  });
  it("floors fractionals", () => {
    expect(wholeToIndianWords(999.9)).toBe("Nine Hundred Ninety Nine");
  });
  it("negative → abs treated (caller handles sign)", () => {
    expect(wholeToIndianWords(-42)).toBe("Forty Two");
  });
});

describe("amountInIndianWords", () => {
  it("0.00 → Zero Rupees Only", () => {
    expect(amountInIndianWords(0)).toBe("Zero Rupees Only");
  });
  it("whole amount ends in Rupees Only", () => {
    expect(amountInIndianWords(1234)).toBe(
      "One Thousand Two Hundred Thirty Four Rupees Only",
    );
  });
  it("fractional amount adds paise", () => {
    expect(amountInIndianWords(1234.56)).toBe(
      "One Thousand Two Hundred Thirty Four Rupees And Fifty Six Paise Only",
    );
  });
  it("rounds paise to nearest integer", () => {
    // 12.345 → 12 rupees, 34.5 paise → rounds to 35 paise (banker's round)
    expect(amountInIndianWords(12.345)).toContain("Thirty Five Paise");
  });
  it("1 paise", () => {
    expect(amountInIndianWords(100.01)).toContain("One Paise");
  });
  it("50 paise (common Indian coin)", () => {
    expect(amountInIndianWords(50.5)).toBe(
      "Fifty Rupees And Fifty Paise Only",
    );
  });
  it("large amount with paise", () => {
    // 12,34,567.89 → 12 lakh, 34 thousand, 567 rupees + 89 paise
    expect(amountInIndianWords(12_34_567.89)).toBe(
      "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees And Eighty Nine Paise Only",
    );
  });
  it("negative amount → prefixed Minus", () => {
    expect(amountInIndianWords(-100)).toBe(
      "Minus One Hundred Rupees Only",
    );
  });
  it("zero paise fraction (0.001) rounds down → no paise clause", () => {
    // 0.001 rounds to 0 paise
    expect(amountInIndianWords(1.001)).toBe("One Rupees Only");
  });
});
