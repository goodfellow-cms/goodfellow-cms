import { describe, expect, it } from "vitest";
import { stripeAmount, stripeMoney } from "./stripe-amounts.ts";

describe("Stripe's amounts", () => {
  it("are in each currency's smallest unit as Stripe counts it, not as the currency does", () => {
    expect(stripeAmount(1000, "usd")).toBe(10);
    expect(stripeAmount(1000, "JPY")).toBe(1000);
    expect(stripeAmount(1500, "kwd")).toBe(1.5);
    // Whole krónur, which Stripe still gives in hundredths, though the currency has none.
    expect(stripeAmount(10000, "isk")).toBe(100);
    expect(stripeAmount(500, "ugx")).toBe(5);
    // Intl writes a no-break space between the code and the amount.
    expect(stripeMoney(10000, "isk", "en-US").replace(/\s/g, " ")).toBe("ISK 100");
    expect(stripeMoney(1000, "usd", "en-US")).toBe("$10.00");
    expect(stripeMoney(500, "jpy", "en-US")).toBe("¥500");
  });
});
