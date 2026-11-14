// What the Payments page says of each Buy button's price, in words: kept apart from the page, which is a Client
// Component, so tests can read it. No imports but types and Stripe's amounts, since the page's browser code uses it.
import type { PriceCheck } from "./payments.ts";
import { stripeMoney } from "./stripe-amounts.ts";

/** What Stripe says of a button's price, in words, and whether it's a problem to fix. */
export function checkWords(check: PriceCheck | undefined): { words: string; problem: boolean } {
  if (!check) return { words: "Not checked: set Stripe's key first.", problem: true };
  switch (check.state) {
    case "on-sale": {
      const amount =
        check.amount !== null
          ? stripeMoney(check.amount, check.currency)
          : check.pricing === "tiered"
            ? "priced in tiers, by how many are bought"
            : "an amount the buyer chooses";
      const every = check.interval
        ? check.interval.every === 1
          ? ` a ${check.interval.unit}`
          : ` every ${check.interval.every} ${check.interval.unit}s`
        : "";
      const what = check.subscription ? `A subscription, ${amount}${every}` : `Bought once, ${amount}`;
      return { words: `${what}${check.name ? ` (${check.name})` : ""}.`, problem: false };
    }
    case "not-a-price":
      return {
        words:
          "No price yet, so the button isn't shown. Put the id of a price in Stripe, price_…, in its Stripe price.",
        problem: true,
      };
    case "missing":
      return {
        words:
          "Stripe has no price with this id. Check it's copied whole, and that it's from the same mode, test or live, as the site's key.",
        problem: true,
      };
    case "metered":
      return {
        words:
          "This price is charged by use, which a Buy button can't sell. Choose a price charged each period, or once.",
        problem: true,
      };
    case "not-on-sale":
      return {
        words: "This price is archived in Stripe, so the button says it isn't on sale. Choose a price that's active.",
        problem: true,
      };
    case "unchecked":
      return {
        words:
          check.reason === "key"
            ? "Stripe refused the site's key. Check it's the restricted key README.md describes, with Prices: Read."
            : "Stripe couldn't be asked just now. Try again in a moment.",
        problem: true,
      };
  }
}
