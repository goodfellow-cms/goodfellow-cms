import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSiteContent, serializeContent, shownContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { priceNote } from "../blocks/buy-button.tsx";
import { MEMBER_ROLE } from "./auth.ts";
import { buttonsOn } from "./buttons.ts";
import type { SiteEnv } from "./env.ts";
import { checkPrices, paymentsOverview } from "./payments.ts";
import { stripeFor } from "./stripe.ts";
import { SITE_ENV, testSite } from "./testing/site.ts";
import { fakeStripe } from "./testing/stripe.ts";

const STRIPE = "https://stripe.test";
const PAYMENTS_ENV: SiteEnv = {
  ...SITE_ENV,
  STRIPE_SECRET_KEY: "rk_test_only",
  STRIPE_WEBHOOK_SECRET: "whsec_test_only",
  STRIPE_API_URL: STRIPE,
};

/** The example's own site as visitors see it, with `changes` made to its files. */
async function content(changes: Record<string, unknown> = {}) {
  const files = new Map<string, string>();
  for (const name of await readdir("content", { recursive: true })) {
    const path = join("content", name).split("\\").join("/");
    if (path.endsWith(".json")) files.set(path, await readFile(path, "utf8"));
  }
  for (const [path, value] of Object.entries(changes)) files.set(path, serializeContent(value));
  return shownContent(
    await loadSiteContent({
      read: async (path) => files.get(path),
      list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`)),
    }),
  );
}

/** A Buy button block with `props`. */
const button = (id: string, props: Record<string, unknown>) => ({
  type: "BuyButton",
  props: { id, className: "", label: "Subscribe", price: "", ...props },
});

/** The example's Subscribe page with its Buy button given `price`, and its header with a Buy button of its own. */
async function priced(price: string) {
  const page = JSON.parse(await readFile("content/pages/subscribe.json", "utf8"));
  const section = page.data.content[0];
  section.props.content = section.props.content.map((block: { type: string; props: object }) =>
    block.type === "BuyButton" ? { ...block, props: { ...block.props, price } } : block,
  );
  const header = JSON.parse(await readFile("content/layout/header.json", "utf8"));
  header.data.content.push(button("BuyButton-header", { label: "Buy the report", price: "price_report" }));
  return content({ "content/pages/subscribe.json": page, "content/layout/header.json": header });
}

describe("the Payments page", () => {
  it("lists every Buy button on the site as visitors see it, with what's in its price", async () => {
    const listed = buttonsOn(await priced("price_monthly"));
    expect(listed).toEqual([
      {
        page: "/subscribe",
        part: "page",
        block: "BuyButton-monthly",
        label: "Subscribe for a month at a time",
        price: "price_monthly",
      },
      { page: "/", part: "header", block: "BuyButton-header", label: "Buy the report", price: "price_report" },
    ]);
    // One without a price is listed too, since it's what an owner needs to fix.
    expect(buttonsOn(await content()).map((one) => one.price)).toEqual([""]);
  });

  it("says what Stripe says of each price: on sale and for how much, or what's wrong with it", async () => {
    const stripe = fakeStripe({
      key: "rk_test_only",
      base: STRIPE,
      prices: [
        { id: "price_monthly", product: "prod_members", type: "recurring", nickname: "Monthly" },
        { id: "price_quarterly", product: "prod_members", type: "recurring", interval: { unit: "month", count: 3 } },
        { id: "price_report", product: "prod_report", type: "one_time", amount: 2500 },
        { id: "price_old", product: "prod_report", type: "one_time", active: false },
        { id: "price_used", product: "prod_api", type: "recurring", usage: "metered" },
      ],
    });
    const client = stripeFor(PAYMENTS_ENV, stripe.fetch);
    const checks = await checkPrices(client, [
      "price_monthly",
      "price_quarterly",
      "price_report",
      "price_old",
      "price_used",
      "price_typo",
      "prod_members",
      "",
      "price_monthly",
    ]);
    expect(Object.fromEntries(checks)).toEqual({
      price_monthly: {
        state: "on-sale",
        subscription: true,
        amount: 1000,
        currency: "usd",
        interval: { every: 1, unit: "month" },
        name: "Monthly",
      },
      price_quarterly: {
        state: "on-sale",
        subscription: true,
        amount: 1000,
        currency: "usd",
        interval: { every: 3, unit: "month" },
      },
      price_report: { state: "on-sale", subscription: false, amount: 2500, currency: "usd" },
      price_old: { state: "not-on-sale" },
      price_used: { state: "metered" },
      price_typo: { state: "missing" },
      prod_members: { state: "not-a-price" },
      "": { state: "not-a-price" },
    });
    // A key Stripe refuses is the site's to fix, not the price's.
    stripe.settings.forbidden = true;
    expect(Object.fromEntries(await checkPrices(client, ["price_monthly"]))).toEqual({
      price_monthly: { state: "unchecked", reason: "key" },
    });
  });

  it("asks Stripe about every price at once, so the page waits for the slowest", async () => {
    const stripe = fakeStripe({
      key: "rk_test_only",
      base: STRIPE,
      prices: [
        { id: "price_monthly", product: "prod_members", type: "recurring" },
        { id: "price_report", product: "prod_report", type: "one_time" },
      ],
    });
    // Each answer waits until both prices have been asked about, which asking in turn never would.
    let asked = 0;
    let bothAsked: () => void = () => {};
    const both = new Promise<void>((resolve) => {
      bothAsked = resolve;
    });
    const client = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (++asked === 2) bothAsked();
      await both;
      return stripe.fetch(input, init);
    }) as typeof fetch);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("asked in turn")), 2000));
    const checks = await Promise.race([checkPrices(client, ["price_monthly", "price_report"]), timeout]);
    expect([...checks.values()].map((check) => check.state)).toEqual(["on-sale", "on-sale"]);
  });

  it("is for the site's owners only, and checks prices only where the site has Stripe's key", async () => {
    const { auth, asking, olive, person, signIn, close } = await testSite(PAYMENTS_ENV);
    try {
      const stripe = fakeStripe({
        key: "rk_test_only",
        base: STRIPE,
        prices: [{ id: "price_monthly", product: "prod_members", type: "recurring" }],
      });
      const priced_ = await priced("price_monthly");
      // Read only for an owner, counted.
      let reads = 0;
      const site = async () => {
        reads++;
        return priced_;
      };
      const get = (cookie: string | undefined) => asking(cookie, "GET", "same-origin", "/api/payments/");
      const overview = await paymentsOverview(auth, get(olive), {
        siteEnv: PAYMENTS_ENV,
        content: site,
        stripe: stripeFor(PAYMENTS_ENV, stripe.fetch),
      });
      expect(overview.setUp).toEqual({ address: true, key: true, webhook: true });
      expect(overview.testMode).toBe(true);
      expect(overview.buttons.map((one) => one.check?.state)).toEqual(["on-sale", "missing"]);
      // Without the key, the buttons are listed, unchecked, and the page says what's missing.
      const { STRIPE_SECRET_KEY: _, STRIPE_WEBHOOK_SECRET: __, ...unset } = PAYMENTS_ENV;
      const bare = await paymentsOverview(auth, get(olive), { siteEnv: unset, content: site });
      expect(bare.setUp).toEqual({ address: true, key: false, webhook: false });
      expect(bare.buttons.map((one) => one.check)).toEqual([undefined, undefined]);
      // A reader, or someone not signed in, sees nothing.
      await person("rita@example.org", MEMBER_ROLE);
      const reader = (await signIn("rita@example.org")).cookie;
      reads = 0;
      for (const cookie of [reader, undefined]) {
        await expect(
          paymentsOverview(auth, get(cookie), { siteEnv: PAYMENTS_ENV, content: site }),
        ).rejects.toMatchObject({ name: "EditorsError" });
      }
      // ...and costs no read of the site.
      expect(reads).toBe(0);
    } finally {
      close();
    }
  });
});

describe("a Buy button's note in the editor", () => {
  it("says what's wrong with what's in its price, and nothing for a price's id", () => {
    expect(priceNote("price_1PqRsT")).toBeUndefined();
    expect(priceNote("")).toMatch(/^A site owner puts a Stripe price ID/);
    expect(priceNote("prod_members")).toMatch(/^That's a product's ID, not a price's/);
    expect(priceNote("$10 a month")).toMatch(/^"\$10 a month" isn't a Stripe price ID/);
    for (const price of ["", "prod_members", "$10"]) expect(priceNote(price)).toMatch(/copy its ID/);
  });
});
