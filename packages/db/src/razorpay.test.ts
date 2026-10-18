import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPaymentSignature } from "./razorpay";

describe("verifyPaymentSignature", () => {
  it("returns true when the client-supplied signature matches", () => {
    const secret = "rzp_secret";
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ456";
    const sig = createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(verifyPaymentSignature(secret, orderId, paymentId, sig)).toBe(true);
  });

  it("returns false for a bad signature", () => {
    expect(verifyPaymentSignature("s", "o", "p", "wrong")).toBe(false);
  });

  it("returns false when order id was swapped", () => {
    const secret = "s";
    const sig = createHmac("sha256", secret).update("order1|pay1").digest("hex");
    expect(verifyPaymentSignature(secret, "order2", "pay1", sig)).toBe(false);
  });
});
