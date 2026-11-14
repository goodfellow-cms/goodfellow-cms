// The Payments page, for the site's owners: whether the site is set up to take payments, and every Buy button on the
// site as visitors see it, with what Stripe says of its price, so a price that's mistyped, from the other mode (test or
// live), or no longer on sale is found before a reader presses the button. Owners only, as the editors page is
// (`adminAsking()`). It only reads, from Stripe and the site.
import type { SiteContent } from "@goodfellow-cms/core";
import Stripe from "stripe";
import { PRICE_ID } from "../blocks/buy-button.tsx";
import type { SiteAuth } from "./auth.ts";
import { buttonsOn, type ListedButton } from "./buttons.ts";
import { adminAsking } from "./editors.ts";
import type { SiteEnv } from "./env.ts";
import { stripeFor } from "./stripe.ts";

/** What Stripe says of a Buy button's price. */
export type PriceCheck =
  /** On sale: a subscription, for a price that repeats, or something bought once, and for how much. */
  | {
      state: "on-sale";
      subscription: boolean;
      /** In the currency's smallest unit, as Stripe gives it, or `null` for a price that isn't a fixed amount. */
      amount: number | null;
      currency: string;
      /** How often a subscription's price repeats, such as `month`, and every how many of them. */
      interval?: { every: number; unit: string };
      /** The price's own name in Stripe, if it has one. */
      name?: string;
    }
  /** Not a price's id at all, or nothing: the button isn't shown on the site. */
  | { state: "not-a-price" }
  /** No price with that id, as for a mistyped one, or one from the other mode, test or live. */
  | { state: "missing" }
  /** A price Stripe has, archived: the button says it isn't on sale. */
  | { state: "not-on-sale" }
  /** Stripe couldn't be asked: `key` where the key was refused, or lacks the permission; `stripe` for anything else. */
  | { state: "unchecked"; reason: "key" | "stripe" };

/** What the Payments page shows. */
export interface PaymentsOverview {
  /** Which of the settings payments need the site has: its address, Stripe's key, and the webhook's secret. */
  setUp: { address: boolean; key: boolean; webhook: boolean };
  /** Whether the key is a test mode key, which takes no real money. */
  testMode: boolean;
  buttons: (ListedButton & { check?: PriceCheck })[];
}

/** What Stripe says of each of `prices`, asked once each. */
export async function checkPrices(stripe: Stripe, prices: Iterable<string>): Promise<Map<string, PriceCheck>> {
  const checks = new Map<string, PriceCheck>();
  for (const id of new Set(prices)) {
    if (!PRICE_ID.test(id)) {
      checks.set(id, { state: "not-a-price" });
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(id);
      if (!price.active) {
        checks.set(id, { state: "not-on-sale" });
        continue;
      }
      checks.set(id, {
        state: "on-sale",
        subscription: price.type === "recurring",
        amount: price.unit_amount,
        currency: price.currency,
        ...(price.recurring && {
          interval: { every: price.recurring.interval_count, unit: price.recurring.interval },
        }),
        ...(price.nickname && { name: price.nickname }),
      });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
        checks.set(id, { state: "missing" });
      } else {
        const key =
          error instanceof Stripe.errors.StripeAuthenticationError ||
          error instanceof Stripe.errors.StripePermissionError;
        // Logged by its name only, as payments' routes are, so it can be found.
        console.error(`Checking a price failed: ${error instanceof Error ? error.name : "error"}.`);
        checks.set(id, { state: "unchecked", reason: key ? "key" : "stripe" });
      }
    }
  }
  return checks;
}

/**
 * The Payments page's overview, for an owner: the site's settings for payments, and every Buy button on `content`, the
 * site as visitors see it, each with what Stripe says of its price where the site has Stripe's key. Stripe's client is
 * the site's own (`stripeFor()`) unless `stripe` is given.
 */
export async function paymentsOverview(
  siteAuth: SiteAuth,
  request: Request,
  options: { siteEnv: SiteEnv; content: SiteContent; stripe?: Stripe },
): Promise<PaymentsOverview> {
  await adminAsking(siteAuth, request);
  const { siteEnv, content } = options;
  const key = siteEnv.STRIPE_SECRET_KEY ?? "";
  const setUp = {
    address: Boolean(siteEnv.GOODFELLOW_SITE_URL),
    key: Boolean(key),
    webhook: Boolean(siteEnv.STRIPE_WEBHOOK_SECRET),
  };
  const buttons = buttonsOn(content);
  const testMode = /^(?:sk|rk)_test_/.test(key);
  if (!key) return { setUp, testMode, buttons };
  const checks = await checkPrices(
    options.stripe ?? stripeFor(siteEnv),
    buttons.map((button) => button.price),
  );
  return { setUp, testMode, buttons: buttons.map((button) => ({ ...button, check: checks.get(button.price) })) };
}
