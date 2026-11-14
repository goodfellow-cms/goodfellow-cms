import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_ROLE } from "./auth.ts";
import { can, subscribedUntil } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import {
  accountCustomer,
  applySession,
  applySubscription,
  type ButtonPlace,
  billingAddress,
  CHECKOUT_LOCK_SECONDS,
  checkoutAddress,
  customerOf,
  PaymentsError,
  paymentsProblem,
  placeFrom,
  RETURN_WAITS_MS,
  refererPath,
  returnFromCheckout,
  STRIPE_EVENT_IDENTIFIER,
  STRIPE_EVENT_LEASE_SECONDS,
  STRIPE_LOCK_IDENTIFIER,
  STRIPE_LOCK_SECONDS,
  StripeBusy,
  stripeFor,
  webhookResponse,
} from "./stripe.ts";
import { SITE, SITE_ENV, testSite } from "./testing/site.ts";
import { fakeStripe, signEvent } from "./testing/stripe.ts";

const STRIPE = "https://stripe.test";
const PAYMENTS_ENV: SiteEnv = {
  ...SITE_ENV,
  STRIPE_SECRET_KEY: "rk_test_only",
  STRIPE_WEBHOOK_SECRET: "whsec_test_only",
  STRIPE_API_URL: STRIPE,
};
const MONTHLY = { id: "price_monthly", product: "prod_members", type: "recurring" as const };
const REPORT = { id: "price_report", product: "prod_report", type: "one_time" as const };
const CHEAP = { id: "price_cheap", product: "prod_cheap", type: "recurring" as const };
/** A price charged by use, which a Buy button can't sell. */
const METERED = { id: "price_metered", product: "prod_api", type: "recurring" as const, usage: "metered" as const };
/** Another price of the monthly subscription's product. */
const YEARLY = { id: "price_yearly", product: "prod_members", type: "recurring" as const };

/** The site with Stripe, and a page with a monthly subscription's button and a report's. */
async function payments() {
  const site = await testSite(PAYMENTS_ENV);
  const stripe = fakeStripe({ key: "rk_test_only", base: STRIPE, prices: [MONTHLY, REPORT, CHEAP, YEARLY, METERED] });
  const client = stripeFor(PAYMENTS_ENV, stripe.fetch);
  const buttons: Record<string, string> = {
    monthly: MONTHLY.id,
    yearly: YEARLY.id,
    report: REPORT.id,
    metered: METERED.id,
    gone: "price_gone",
  };
  /** Who each button was looked for as. */
  const readers: string[] = [];
  const findButton = async (place: ButtonPlace, reader: string) => {
    readers.push(reader);
    return place.page === "/subscribe" && buttons[place.block] ? { price: buttons[place.block] ?? "" } : undefined;
  };
  const readerId = await site.person("rita@example.org", MEMBER_ROLE);
  const reader = (await site.signIn("rita@example.org")).cookie;
  /** A Buy button's form, posted from the site's own pages, or from `from`. */
  const buying = (cookie: string | undefined, fields: Record<string, string>, from = "same-origin") => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return new Request(`${SITE}/api/checkout/`, {
      method: "POST",
      headers: { ...(cookie && { cookie }), "sec-fetch-site": from },
      body: form,
    });
  };
  const customer = (userId: string) => customerOf(site.context.adapter, userId);
  /** Posts a Buy button's form, with Stripe's client `through`, the site's own unless a test gives another. */
  const checkout = (request: Request, through = client) =>
    checkoutAddress(request, {
      siteAuth: site.auth,
      siteEnv: PAYMENTS_ENV,
      stripe: through,
      findButton,
      customer: (user, stale) => accountCustomer(site.context.adapter, through, user, stale),
      adapter: site.context.adapter,
    });
  /** Sends the site one of Stripe's events, signed with `secret`. */
  const deliver = (event: object, secret = "whsec_test_only") => {
    const signed = signEvent(secret, event);
    return webhookResponse(
      new Request(`${SITE}/api/stripe/webhook/`, {
        method: "POST",
        headers: { "stripe-signature": signed.signature },
        body: signed.body,
      }),
      { siteEnv: PAYMENTS_ENV, stripe: client, adapter: site.context.adapter },
    );
  };
  /** Pays for what a Buy button sells, as the reader, delivering Stripe's events: gives the Checkout Session. */
  const buy = async (block: string) => {
    await checkout(buying(reader, { page: "/subscribe", block }));
    const session = [...stripe.sessions.values()].at(-1);
    for (const event of stripe.pay(session?.id ?? "")) await deliver(event);
    return session;
  };
  return { ...site, stripe, client, buttons, readers, buying, checkout, deliver, buy, customer, readerId, reader };
}

afterEach(() => vi.unstubAllGlobals());

describe("a Buy button's place", () => {
  const form = (fields: Record<string, string>) => {
    const named = new FormData();
    for (const [name, value] of Object.entries(fields)) named.set(name, value);
    return named;
  };

  it("is the page the browser came from for a button a layout renders, which names none", () => {
    expect(placeFrom(form({ page: "", block: "BuyButton-1" }), "/about")).toEqual({
      page: "/about",
      block: "BuyButton-1",
    });
    // Without a page the browser came from, it's on no page.
    expect(() => placeFrom(form({ page: "", block: "BuyButton-1" }))).toThrow(PaymentsError);
    // A page the button names wins over the one the browser says.
    expect(placeFrom(form({ page: "/subscribe", block: "BuyButton-1" }), "/about").page).toBe("/subscribe");
  });

  it("is never on another site, however its address is spelled, so Checkout and the portal never send people there", () => {
    for (const page of [
      "//elsewhere.example",
      "/\\elsewhere.example",
      "/.//elsewhere.example",
      "https://elsewhere.example/",
    ]) {
      expect(() => placeFrom(form({ page, block: "BuyButton-1" }))).toThrow(PaymentsError);
      // Nor where the browser says it came from one, as a layout's button has it.
      expect(() => placeFrom(form({ page: "", block: "BuyButton-1" }), page)).toThrow(PaymentsError);
    }
    // A path of this site's is read as a browser reads it.
    expect(placeFrom(form({ page: "/a/../subscribe", block: "BuyButton-1" })).page).toBe("/subscribe");
  });

  it("comes back to the page a block added, where the button is on the page it's added to", () => {
    expect(placeFrom(form({ page: "/events", back: "/events/2026-12", block: "BuyButton-1" }))).toEqual({
      page: "/events",
      back: "/events/2026-12",
      block: "BuyButton-1",
    });
    // Only one of the site's paths, however another site's address is spelled, and only where it's another page.
    for (const back of [
      "//elsewhere.example",
      "/\\elsewhere.example",
      "/.//elsewhere.example",
      "https://elsewhere.example/",
      "/events",
    ]) {
      expect(placeFrom(form({ page: "/events", back, block: "BuyButton-1" }))).not.toHaveProperty("back");
    }
  });

  it("takes the page the browser came from only from the site's own address", () => {
    const from = (referer?: string) =>
      refererPath(new Request(`${SITE}/api/checkout/`, { headers: referer ? { referer } : {} }), SITE);
    expect(from(`${SITE}/about?x=1#top`)).toBe("/about");
    expect(from("https://elsewhere.example/about")).toBeUndefined();
    expect(from("not an address")).toBeUndefined();
    expect(from()).toBeUndefined();
  });
});

describe("checkout", () => {
  it("looks for the button as the page shows it to the person: its teaser for someone who isn't a member", async () => {
    const { buy, readers, checkout, buying, reader, close } = await payments();
    try {
      await buy("monthly");
      await checkout(buying(reader, { page: "/subscribe", block: "yearly" })).catch(() => undefined);
      expect(readers).toEqual(["everyone", "members"]);
    } finally {
      close();
    }
  });

  it("sells a header's button on the page it was pressed on, coming back to that page", async () => {
    const { stripe, checkout, reader, close } = await payments();
    try {
      const form = new FormData();
      form.set("page", "");
      form.set("back", "/subscribe/2026-12");
      form.set("block", "monthly");
      const request = new Request(`${SITE}/api/checkout/`, {
        method: "POST",
        headers: { cookie: reader ?? "", "sec-fetch-site": "same-origin", referer: `${SITE}/subscribe` },
        body: form,
      });
      expect(await checkout(request)).toMatch(/^https:\/\/stripe\.test\/checkout\//);
      const session = [...stripe.sessions.values()].at(-1);
      expect(session?.cancel_url).toBe(`${SITE}/subscribe/2026-12`);
      expect(session?.success_url).toContain("next=%2Fsubscribe%2F2026-12");
    } finally {
      close();
    }
  });

  it("sells the price the page's owners chose, to the person signed in, coming back to the site", async () => {
    const { stripe, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      // The request names a cheaper price too: only the page's is read.
      const address = await checkout(buying(reader, { page: "/subscribe", block: "monthly", price: CHEAP.id }));
      const session = [...stripe.sessions.values()][0];
      expect(address).toBe(session?.url);
      expect(session).toMatchObject({
        mode: "subscription",
        price: MONTHLY.id,
        client_reference_id: readerId,
        customer: await customer(readerId),
        metadata: { userId: readerId },
        subscriptionMetadata: { userId: readerId },
        cancel_url: `${SITE}/subscribe`,
      });
      expect(session?.success_url).toBe(
        `${SITE}/api/checkout/done/?next=%2Fsubscribe&session_id={CHECKOUT_SESSION_ID}`,
      );
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      expect([...stripe.sessions.values()][1]?.mode).toBe("payment");
    } finally {
      close();
    }
  });

  it("sends someone who isn't signed in to sign in, coming back to the page", async () => {
    const { buying, checkout, stripe, close } = await payments();
    try {
      const address = new URL(await checkout(buying(undefined, { page: "/subscribe", block: "monthly" })));
      expect(`${address.origin}${address.pathname}`).toBe(`${SITE}/sign-in/`);
      expect(address.searchParams.get("next")).toBe("/subscribe");
      expect(stripe.sessions.size).toBe(0);
    } finally {
      close();
    }
  });

  it("is only for the site's own pages, buttons that are on them, and prices on sale", async () => {
    const { buying, checkout, stripe, reader, close } = await payments();
    try {
      await expect(
        checkout(buying(reader, { page: "/subscribe", block: "monthly" }, "cross-site")),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        checkout(
          new Request(`${SITE}/api/checkout/`, { headers: { cookie: reader ?? "", "sec-fetch-site": "same-origin" } }),
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(checkout(buying(reader, { page: "/about", block: "monthly" }))).rejects.toMatchObject({
        status: 404,
      });
      await expect(checkout(buying(reader, { page: "/subscribe", block: "gone" }))).rejects.toMatchObject({
        status: 409,
      });
      (stripe.prices.get(MONTHLY.id) as { active: boolean }).active = false;
      await expect(checkout(buying(reader, { page: "/subscribe", block: "monthly" }))).rejects.toMatchObject({
        status: 409,
      });
      expect(stripe.sessions.size).toBe(0);
    } finally {
      close();
    }
  });

  it("refuses a price charged by use, and anything but a form, before asking Stripe for a Checkout", async () => {
    const { buying, checkout, stripe, reader, close } = await payments();
    try {
      await expect(checkout(buying(reader, { page: "/subscribe", block: "metered" }))).rejects.toMatchObject({
        status: 409,
        message: expect.stringMatching(/charged by use/),
      });
      const notAForm = new Request(`${SITE}/api/checkout/`, {
        method: "POST",
        headers: { cookie: reader ?? "", "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: JSON.stringify({ page: "/subscribe", block: "monthly" }),
      });
      await expect(checkout(notAForm)).rejects.toMatchObject({ status: 400 });
      expect(stripe.sessions.size).toBe(0);
    } finally {
      close();
    }
  });

  it("reads only a page's address and a button's id from the form", () => {
    const form = (fields: { page: string; block?: string }) => {
      const data = new FormData();
      for (const [name, value] of Object.entries(fields)) data.set(name, value);
      return data;
    };
    expect(placeFrom(form({ page: "/subscribe", block: "BuyButton-1" }))).toEqual({
      page: "/subscribe",
      block: "BuyButton-1",
    });
    for (const fields of [
      { page: "https://other.example/", block: "a" },
      { page: "//other.example/", block: "a" },
      { page: "/subscribe", block: "a b" },
      { page: "/subscribe" },
    ]) {
      expect(() => placeFrom(form(fields))).toThrow();
    }
  });
});

describe("the Stripe customer", () => {
  it("is made with their address the first time they buy, and is the one for everything they buy after", async () => {
    const { stripe, buy, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      const first = await buy("report");
      const paidAs = stripe.sessions.get(first?.id ?? "")?.customer;
      expect(paidAs).toMatch(/^cus_/);
      expect(stripe.customers.get(paidAs ?? "")).toMatchObject({
        email: "rita@example.org",
        metadata: { userId: readerId },
      });
      expect(await customer(readerId)).toBe(paidAs);
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      expect([...stripe.sessions.values()].at(-1)?.customer).toBe(paidAs);
      expect(stripe.customers.size).toBe(1);
    } finally {
      close();
    }
  });

  it("is the same one for Checkouts started at once", async () => {
    const { stripe, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      const both = () =>
        Promise.all([
          checkout(buying(reader, { page: "/subscribe", block: "monthly" })),
          checkout(buying(reader, { page: "/subscribe", block: "report" })),
        ]);
      // Stripe gives both the customer the first made, by its idempotency key.
      await both();
      expect(stripe.customers.size).toBe(1);
      const kept = await customer(readerId);
      expect(kept).toMatch(/^cus_/);
      expect(new Set([...stripe.sessions.values()].map((session) => session.customer))).toEqual(new Set([kept]));
    } finally {
      close();
    }
  });

  it("is the one kept when Stripe made two for Checkouts started at once", async () => {
    const { stripe, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      stripe.settings.idempotency = false;
      await Promise.all([
        checkout(buying(reader, { page: "/subscribe", block: "monthly" })),
        checkout(buying(reader, { page: "/subscribe", block: "report" })),
      ]);
      expect(stripe.customers.size).toBe(2);
      const kept = await customer(readerId);
      expect(new Set([...stripe.sessions.values()].map((session) => session.customer))).toEqual(new Set([kept]));
    } finally {
      close();
    }
  });

  it("is kept as the first, whatever a later payment's customer is", async () => {
    const { stripe, buy, customer, readerId, context, client, close } = await payments();
    try {
      const first = await buy("monthly");
      const kept = await customer(readerId);
      expect(kept).toBe(stripe.sessions.get(first?.id ?? "")?.customer);
      // A Session paid as another customer, as one made before the site kept theirs would be.
      const second = await buy("report");
      const session = stripe.sessions.get(second?.id ?? "");
      if (session) session.customer = "cus_other";
      await applySession(context.adapter, client, second?.id ?? "");
      expect(await customer(readerId)).toBe(kept);
    } finally {
      close();
    }
  });
});

/**
 * An adapter like `adapter` whose first entitlement write (`create`, unless `method` says `deleteMany`) waits until
 * `release()`, saying when it starts waiting.
 */
function pausingWrites<T extends object>(adapter: T, method: "create" | "deleteMany" = "create") {
  let waiting = () => {};
  const paused = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let once = true;
  const pausing = new Proxy(adapter, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (name !== method || typeof value !== "function") return value;
      return async (data: { model: string }) => {
        if (data.model === "entitlement" && once) {
          once = false;
          waiting();
          await released;
        }
        return value.call(target, data);
      };
    },
  });
  return { adapter: pausing, paused, release };
}

describe("Stripe's events", () => {
  it("give a subscription nothing while a renewal's payment is retried or left unpaid, and again once it's paid", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      // Stripe moves the period on to the one not paid for yet, then retries the payment.
      for (const status of ["past_due", "unpaid"]) {
        subscription.status = status;
        const item = subscription.items.data[0];
        if (item) item.current_period_end += 30 * 24 * 60 * 60;
        expect((await deliver(stripe.event("customer.subscription.updated", subscription))).status).toBe(200);
        expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      }
      subscription.status = "active";
      await deliver(stripe.event("customer.subscription.updated", subscription));
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
    } finally {
      close();
    }
  });

  it("take away a subscription, a purchase, and nothing else, where Stripe no longer has what an event names", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const subscribedTo = await buy("monthly");
      const purchase = await buy("report");
      // A deleted customer's test data, say: Stripe answers that it has no such object, which retrying never changes.
      const subscription = stripe.subscriptions.get(subscribedTo?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      stripe.subscriptions.delete(subscription.id);
      expect((await deliver(stripe.event("customer.subscription.deleted", subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
      // A payment it no longer has paid for nothing; a Session it no longer has is left alone.
      const paymentIntent = purchase?.payment_intent ?? "";
      stripe.charges.delete(paymentIntent);
      expect(
        (
          await deliver(
            stripe.event("refund.updated", { id: "re_gone", object: "refund", payment_intent: paymentIntent }),
          )
        ).status,
      ).toBe(200);
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
      stripe.sessions.delete(purchase?.id ?? "");
      expect((await deliver(stripe.event("checkout.session.completed", { id: purchase?.id }))).status).toBe(200);
    } finally {
      close();
    }
  });

  it("give a subscription once it's paid, until its period ends, and take it away once it's cancelled", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const [created, completed] = stripe.pay(session?.id ?? "", 30);
      for (const event of [completed, created]) expect((await deliver(event ?? {})).status).toBe(200);
      const until = await subscribedUntil(context.adapter, readerId);
      expect(until?.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
      const rows = await context.adapter.findMany({
        model: "entitlement",
        where: [
          { field: "userId", value: readerId },
          { field: "kind", value: "subscription" },
        ],
      });
      expect(rows).toHaveLength(1);
      const ended = stripe.cancel(session?.subscription ?? "");
      expect((await deliver(ended)).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it.each(["charge.refunded", "refund.created"] as const)(
    "give a purchase for good once it's paid, and take it back once it's refunded (%s)",
    async (type) => {
      const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
      try {
        await checkout(buying(reader, { page: "/subscribe", block: "report" }));
        const session = [...stripe.sessions.values()][0];
        const events = stripe.pay(session?.id ?? "");
        for (const event of events) await deliver(event);
        expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
        expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
        await deliver(stripe.refund(session?.payment_intent ?? "", undefined, type));
        expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
      } finally {
        close();
      }
    },
  );

  it.each(["refund.failed", "refund.updated", "charge.refund.updated"] as const)(
    "give a purchase back once its refund fails, whichever of the refund's events arrives last (%s)",
    async (type) => {
      const { stripe, buy, deliver, context, readerId, close } = await payments();
      try {
        const bought = await buy("report");
        const refunded = stripe.refund(bought?.payment_intent ?? "");
        await deliver(refunded);
        expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
        // The bank refuses the refund, so the money is the site's again.
        await deliver(stripe.failRefund(bought?.payment_intent ?? "", type));
        expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
        // The refund's own event, arriving late, reads the payment as it is now, and takes nothing back.
        await deliver({ ...refunded, id: `${refunded.id}-again` });
        expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
      } finally {
        close();
      }
    },
  );

  it("take back only what the refunded payment bought, and never give it again", async () => {
    const { stripe, buy, deliver, client, context, readerId, close } = await payments();
    try {
      const first = await buy("report");
      const second = await buy("report");
      // Refunding one of two payments for the same thing leaves what the other bought.
      await deliver(stripe.refund(first?.payment_intent ?? "", 100));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
      // The refunded Session, paid as it still is, gives nothing back, coming back to the site or by a late event.
      await applySession(context.adapter, client, first?.id ?? "");
      await deliver(stripe.event("checkout.session.completed", { id: first?.id }));
      const purchases = await context.adapter.findMany({
        model: "entitlement",
        where: [{ field: "userId", value: readerId }],
      });
      expect(purchases).toHaveLength(1);
      // A dispute takes back the other.
      await deliver(stripe.dispute(second?.payment_intent ?? ""));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
      await applySession(context.adapter, client, second?.id ?? "");
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });

  it("take back a purchase refunded while coming back from Checkout writes it", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      const session = [...stripe.sessions.values()].at(-1);
      stripe.pay(session?.id ?? "");
      // Coming back from Checkout reads the payment, unrefunded, then waits on Stripe for what was bought...
      let reading = () => {};
      const read = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input instanceof Request ? input.url : input).includes("/line_items")) {
          reading();
          await released;
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      const coming = applySession(context.adapter, slow, session?.id ?? "");
      await read;
      // ...while the refund's event is handled, which finds nothing to take back yet.
      await deliver(stripe.refund(session?.payment_intent ?? ""));
      release();
      await coming;
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });

  it("write a subscription one request at a time, so a stale read never brings a cancelled one back", async () => {
    const { stripe, client, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()].at(-1);
      stripe.pay(session?.id ?? "");
      const subscription = session?.subscription ?? "";
      // Coming back from Checkout reads the subscription as active, and stops just before writing it...
      const slow = pausingWrites(context.adapter);
      const coming = applySession(slow.adapter, client, session?.id ?? "");
      await slow.paused;
      // ...while it's cancelled, whose event waits for it rather than being overtaken by it.
      const cancelled = stripe.cancel(subscription);
      expect((await deliver(cancelled)).status).toBe(409);
      slow.release();
      await coming;
      expect((await deliver(cancelled)).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("write nothing from a request that ran past its lock, once another has taken it over", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()].at(-1);
      stripe.pay(session?.id ?? "");
      const subscription = session?.subscription ?? "";
      // Coming back from Checkout reads the subscription as active, then stalls past its lock's time...
      let reading = () => {};
      const read = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stalling = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const answer = await stripe.fetch(input, init);
        if (String(input instanceof Request ? input.url : input).includes(`/v1/subscriptions/${subscription}`)) {
          reading();
          await released;
        }
        return answer;
      }) as typeof fetch);
      const coming = applySession(context.adapter, stalling, session?.id ?? "");
      await read;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...while the cancellation's event takes the lock over and ends it.
      expect((await deliver(stripe.cancel(subscription))).status).toBe(200);
      release();
      await expect(coming).rejects.toMatchObject({ name: "StripeBusy" });
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("take back what a request wrote once its lock turns out taken over while it wrote, for the event to come again", async () => {
    const { stripe, client, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()].at(-1);
      stripe.pay(session?.id ?? "");
      // Coming back from Checkout renews its lock, then stalls in the middle of writing an active subscription...
      const slow = pausingWrites(context.adapter);
      const coming = applySession(slow.adapter, client, session?.id ?? "");
      await slow.paused;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...past its lock's time, while the cancellation's event takes the lock over and ends it.
      expect((await deliver(stripe.cancel(session?.subscription ?? ""))).status).toBe(200);
      slow.release();
      await expect(coming).rejects.toMatchObject({ name: "StripeBusy" });
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("are sent again where a request's lock was taken over while it wrote, so a won dispute's purchase comes back", async () => {
    const { stripe, client, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("report");
      const created = stripe.dispute(bought?.payment_intent ?? "");
      // The dispute's event, read while it's open, stalls in the middle of taking the purchase back...
      const slow = pausingWrites(context.adapter, "deleteMany");
      const coming = applySession(slow.adapter, client, bought?.id ?? "");
      await slow.paused;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...past its lock's time, while the site wins the dispute and its event gives the purchase back.
      expect((await deliver(stripe.closeDispute(bought?.payment_intent ?? "", "won"))).status).toBe(200);
      slow.release();
      await expect(coming).rejects.toMatchObject({ name: "StripeBusy" });
      // Stripe sends the event it wasn't answered for again, which reads the dispute as won.
      expect((await deliver(created)).status).toBe(200);
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("never take back the row another request wrote, once it took the lock over", async () => {
    const { stripe, client, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()].at(-1);
      const events = stripe.pay(session?.id ?? "");
      const created = events.find((event) => event.type === "customer.subscription.created");
      // Coming back stalls in the middle of writing the subscription, past its lock's time...
      const slow = pausingWrites(context.adapter);
      const coming = applySession(slow.adapter, client, session?.id ?? "");
      await slow.paused;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...while the subscription's event takes the lock over and writes it as it is.
      expect((await deliver(created ?? {})).status).toBe(200);
      slow.release();
      // The stalled write finds the lock taken, and takes back only a row of its own: there's none, so the
      // subscription the event wrote stays.
      await expect(coming).rejects.toMatchObject({ name: "StripeBusy" });
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("clear no expired lock where nobody holds one, so a lock costs one write", async () => {
    const { stripe, client, buy, context, close } = await payments();
    try {
      const bought = await buy("report");
      const cleared: unknown[] = [];
      const counting = new Proxy(context.adapter, {
        get(target, name, receiver) {
          const value = Reflect.get(target, name, receiver);
          if (name !== "deleteMany" || typeof value !== "function") return value;
          return (data: { model: string; where: { operator?: string }[] }) => {
            if (data.model === "verification" && data.where.some((one) => one.operator === "lt")) cleared.push(data);
            return value.call(target, data);
          };
        },
      });
      await applySession(counting, client, bought?.id ?? "");
      expect(cleared).toEqual([]);
      expect(stripe.sessions.size).toBe(1);
    } finally {
      close();
    }
  });

  it("write a purchase one request at a time, coming back from Checkout and by the event at once", async () => {
    const { stripe, client, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      const session = [...stripe.sessions.values()].at(-1);
      const [completed] = stripe.pay(session?.id ?? "");
      const slow = pausingWrites(context.adapter);
      const coming = applySession(slow.adapter, client, session?.id ?? "");
      await slow.paused;
      // The event, arriving while coming back writes the same purchase, is tried again once it's done.
      expect((await deliver(completed ?? {})).status).toBe(409);
      slow.release();
      await coming;
      expect((await deliver(completed ?? {})).status).toBe(200);
      const purchases = await context.adapter.findMany({
        model: "entitlement",
        where: [{ field: "userId", value: readerId }],
      });
      expect(purchases).toHaveLength(1);
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
    } finally {
      close();
    }
  });

  it("are refused unless Stripe signed them, and read nothing but which object changed", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      // Says it's paid, and for someone else, but Stripe has it unpaid.
      const claimed = stripe.event("checkout.session.completed", {
        ...session,
        payment_status: "paid",
        client_reference_id: "someone-else",
      });
      expect((await deliver(claimed, "whsec_someone_elses")).status).toBe(400);
      const unsigned = await webhookResponse(
        new Request(`${SITE}/api/stripe/webhook/`, { method: "POST", body: JSON.stringify(claimed) }),
        { siteEnv: PAYMENTS_ENV, stripe: stripeFor(PAYMENTS_ENV, stripe.fetch), adapter: context.adapter },
      );
      expect(unsigned.status).toBe(400);
      expect((await deliver(claimed)).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      expect(await subscribedUntil(context.adapter, "someone-else")).toBeUndefined();
    } finally {
      close();
    }
  });

  it("are done once each, by their ids, but again once one failed", async () => {
    const { stripe, buying, checkout, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const [created] = stripe.pay(session?.id ?? "");
      // Stripe can't be reached the first time.
      const handle = stripe.handle;
      let calls = 0;
      const flaky = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        if (calls <= 3) return Response.json({ error: { type: "api_error", message: "Try again." } }, { status: 500 });
        return handle(new Request(input, init));
      }) as typeof fetch);
      const signed = signEvent("whsec_test_only", created ?? {});
      const send = () =>
        webhookResponse(
          new Request(`${SITE}/api/stripe/webhook/`, {
            method: "POST",
            headers: { "stripe-signature": signed.signature },
            body: signed.body,
          }),
          { siteEnv: PAYMENTS_ENV, stripe: flaky, adapter: context.adapter },
        );
      await expect(send()).rejects.toThrow();
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      expect((await send()).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      // Now that it's done, the same event does nothing more.
      const before = calls;
      expect((await send()).status).toBe(200);
      expect(calls).toBe(before);
      const record = await context.adapter.findOne({
        model: "verification",
        where: [{ field: "id", value: `${STRIPE_EVENT_IDENTIFIER}${(created as { id: string }).id}` }],
      });
      expect(record).not.toBeNull();
    } finally {
      close();
    }
  });

  it("write nothing of a Checkout Session, its customer included, once its lock is taken over before writing", async () => {
    const { stripe, buying, checkout, context, readerId, reader, customer, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      const session = [...stripe.sessions.values()][0];
      stripe.pay(session?.id ?? "");
      await context.adapter.updateMany({
        model: "user",
        where: [{ field: "id", value: readerId }],
        update: { stripeCustomerId: null },
      });
      let reading = () => {};
      const read = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (new URL(url).pathname === `/v1/checkout/sessions/${session?.id}`) {
          reading();
          await released;
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      const writing = applySession(context.adapter, slow, session?.id ?? "");
      await read;
      // Another request takes the lock over while this one reads.
      await context.adapter.updateMany({
        model: "verification",
        where: [{ field: "id", value: `${STRIPE_LOCK_IDENTIFIER}session:${session?.id}` }],
        update: { value: "another request" },
      });
      release();
      await expect(writing).rejects.toBeInstanceOf(StripeBusy);
      expect(await customer(readerId)).toBeUndefined();
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });

  it("let go of only their own claim, never one that took theirs over once it ran out", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const [created] = stripe.pay(session?.id ?? "");
      const id = `${STRIPE_EVENT_IDENTIFIER}${(created as { id: string }).id}`;
      let reading = () => {};
      const read = new Promise<void>((resolve) => {
        reading = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      // A request stalls reading the subscription from Stripe, then fails.
      const failing = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (new URL(url).pathname.startsWith("/v1/subscriptions/")) {
          reading();
          await released;
          return Response.json({ error: { type: "invalid_request_error", message: "No." } }, { status: 400 });
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      const signed = signEvent("whsec_test_only", created ?? {});
      const stalled = webhookResponse(
        new Request(`${SITE}/api/stripe/webhook/`, {
          method: "POST",
          headers: { "stripe-signature": signed.signature },
          body: signed.body,
        }),
        { siteEnv: PAYMENTS_ENV, stripe: failing, adapter: context.adapter },
      );
      await read;
      // Its claim and its subscription's lock run out, and Stripe's retry takes them over and handles the event.
      for (const held of [id, `${STRIPE_LOCK_IDENTIFIER}subscription:${session?.subscription}`]) {
        await context.adapter.updateMany({
          model: "verification",
          where: [{ field: "id", value: held }],
          update: { expiresAt: new Date(Date.now() - 1000) },
        });
      }
      expect((await deliver(created ?? {})).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      release();
      await expect(stalled).rejects.toThrow();
      // The stalled one's failure leaves the event handled.
      const record = await context.adapter.findOne<{ value: string }>({
        model: "verification",
        where: [{ field: "id", value: id }],
      });
      expect(record?.value).toBe("handled");
    } finally {
      close();
    }
  });

  it("are taken over once a request that stopped part way has run out of time, and wait while it hasn't", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const [created] = stripe.pay(session?.id ?? "");
      const id = `${STRIPE_EVENT_IDENTIFIER}${(created as { id: string }).id}`;
      // Another request claimed it moments ago, and is still handling it: Stripe is asked to try again later.
      const claimed = (expiresAt: Date) =>
        context.adapter.create({
          model: "verification",
          data: { id, identifier: id, value: "handling", expiresAt, createdAt: new Date(), updatedAt: new Date() },
          forceAllowId: true,
        });
      await claimed(new Date(Date.now() + STRIPE_EVENT_LEASE_SECONDS * 1000));
      expect((await deliver(created ?? {})).status).toBe(409);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      // That request stopped, as a Worker can, and its claim ran out: the retry does it.
      await context.adapter.deleteMany({ model: "verification", where: [{ field: "id", value: id }] });
      await claimed(new Date(Date.now() - 1000));
      expect((await deliver(created ?? {})).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      const record = await context.adapter.findOne<{ value: string; expiresAt: Date }>({
        model: "verification",
        where: [{ field: "id", value: id }],
      });
      expect(record?.value).toBe("handled");
      expect(new Date(record?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);
    } finally {
      close();
    }
  });
});

describe("coming back from Checkout", () => {
  it("writes what was bought now, for the person who bought it, and goes on to a page of this site", async () => {
    const { auth, stripe, client, buying, checkout, context, readerId, reader, person, signIn, close } =
      await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      stripe.pay(session?.id ?? "");
      const back = (cookie: string | undefined, next: string) =>
        new Request(`${SITE}/api/checkout/done/?next=${encodeURIComponent(next)}&session_id=${session?.id}`, {
          headers: { ...(cookie && { cookie }) },
        });
      // Someone else coming back with it writes nothing.
      await person("paul@example.org", MEMBER_ROLE);
      const paul = (await signIn("paul@example.org")).cookie;
      expect(
        await returnFromCheckout(back(paul, "/subscribe"), {
          siteAuth: auth,
          stripe: client,
          adapter: context.adapter,
        }),
      ).toBe("/subscribe");
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      expect(
        await returnFromCheckout(back(reader, "https://other.example/"), {
          siteAuth: auth,
          stripe: client,
          adapter: context.adapter,
        }),
      ).toBe("/");
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
    } finally {
      close();
    }
  });

  it("writes it once more where another request took over writing it meanwhile", async () => {
    const { auth, stripe, client, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const events = stripe.pay(session?.id ?? "");
      const created = events.find((event) => event.type === "customer.subscription.created");
      // Coming back stalls in the middle of writing the subscription, past its lock's time...
      const slow = pausingWrites(context.adapter);
      const coming = returnFromCheckout(
        new Request(`${SITE}/api/checkout/done/?next=%2Fsubscribe&session_id=${session?.id}`, {
          headers: { cookie: reader ?? "" },
        }),
        { siteAuth: auth, stripe: client, adapter: slow.adapter },
      );
      await slow.paused;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...while the subscription's event takes its lock over and writes it, and what coming back wrote is taken
      // away once it finds that out: it writes it again, since no event comes back to it.
      expect((await deliver(created ?? {})).status).toBe(200);
      slow.release();
      expect(await coming).toBe("/subscribe");
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("waits for another request writing the purchase, then writes it, and goes on past the waits", async () => {
    const { auth, stripe, client, buying, checkout, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      stripe.pay(session?.id ?? "");
      // Stripe's event holds the Checkout Session's lock.
      const now = new Date();
      const id = `${STRIPE_LOCK_IDENTIFIER}session:${session?.id}`;
      await context.adapter.create({
        model: "verification",
        data: {
          id,
          identifier: id,
          value: "the event",
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: now,
          updatedAt: now,
        },
        forceAllowId: true,
      });
      const back = () =>
        new Request(`${SITE}/api/checkout/done/?next=%2Fsubscribe&session_id=${session?.id}`, {
          headers: { cookie: reader ?? "" },
        });
      // The event finishes while coming back waits for the second time, so what was bought is written before the
      // page it goes on to reads the paywall again.
      const waited: number[] = [];
      const finishing = async (ms: number) => {
        waited.push(ms);
        if (waited.length === 2) {
          await context.adapter.deleteMany({ model: "verification", where: [{ field: "id", value: id }] });
        }
      };
      expect(
        await returnFromCheckout(back(), { siteAuth: auth, stripe: client, adapter: context.adapter, wait: finishing }),
      ).toBe("/subscribe");
      expect(waited).toEqual(RETURN_WAITS_MS.slice(0, 2));
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      // One that never finishes is waited for as long as the waits go, and then it goes on.
      await context.adapter.deleteMany({ model: "entitlement", where: [{ field: "userId", value: readerId }] });
      await context.adapter.create({
        model: "verification",
        data: {
          id,
          identifier: id,
          value: "the event",
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: now,
          updatedAt: now,
        },
        forceAllowId: true,
      });
      const all: number[] = [];
      const waiting = async (ms: number) => {
        all.push(ms);
      };
      expect(
        await returnFromCheckout(back(), { siteAuth: auth, stripe: client, adapter: context.adapter, wait: waiting }),
      ).toBe("/subscribe");
      expect(all).toEqual(RETURN_WAITS_MS);
    } finally {
      close();
    }
  });

  it("writes nothing that isn't paid yet", async () => {
    const { stripe, client, buying, checkout, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      await applySession(context.adapter, client, [...stripe.sessions.values()][0]?.id ?? "");
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });
});

describe("what Stripe and the site's accounts can come to", () => {
  it("sends a subscriber to Stripe's portal rather than selling them the same subscription again", async () => {
    const { stripe, buy, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      await buy("monthly");
      const sessions = stripe.sessions.size;
      const address = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      expect(address).toBe(`${STRIPE}/portal/${await customer(readerId)}`);
      expect(stripe.sessions.size).toBe(sessions);
      // Something bought once can be bought again.
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      expect(stripe.sessions.size).toBe(sessions + 1);
    } finally {
      close();
    }
  });

  it("sends someone to the portal while their subscription's first payment is on its way, or it's paused", async () => {
    const { stripe, buy, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      const sessions = stripe.sessions.size;
      for (const status of ["incomplete", "paused", "unpaid"] as const) {
        subscription.status = status;
        expect(await checkout(buying(reader, { page: "/subscribe", block: "monthly" }))).toBe(
          `${STRIPE}/portal/${await customer(readerId)}`,
        );
      }
      expect(stripe.sessions.size).toBe(sessions);
      // One whose first payment never came can be paid for again.
      subscription.status = "incomplete_expired";
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      expect(stripe.sessions.size).toBe(sessions + 1);
    } finally {
      close();
    }
  });

  it("sells no second subscription to the same product at another of its prices", async () => {
    const { stripe, buy, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      await buy("monthly");
      const sessions = stripe.sessions.size;
      expect(await checkout(buying(reader, { page: "/subscribe", block: "yearly" }))).toBe(
        `${STRIPE}/portal/${await customer(readerId)}`,
      );
      expect(stripe.sessions.size).toBe(sessions);
    } finally {
      close();
    }
  });

  it("finds a Checkout someone has open for a price by its metadata, without asking for its items", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      const first = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const asked: string[] = [];
      const counting = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push(String(input instanceof Request ? input.url : input));
        return stripe.fetch(input, init);
      }) as typeof fetch);
      expect(await checkout(buying(reader, { page: "/subscribe", block: "monthly" }), counting)).toBe(first);
      expect(stripe.sessions.size).toBe(1);
      expect(asked.filter((url) => url.includes("/line_items"))).toEqual([]);
    } finally {
      close();
    }
  });

  it("starts a Checkout for the price chosen now, expiring one open for another of the product's prices", async () => {
    const { stripe, buttons, buying, checkout, reader, close } = await payments();
    try {
      const monthly = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const [first] = [...stripe.sessions.values()];
      // The yearly button, pressed with the monthly Checkout still open, sells the yearly price, and only that.
      const yearly = await checkout(buying(reader, { page: "/subscribe", block: "yearly" }));
      expect(yearly).not.toBe(monthly);
      const second = [...stripe.sessions.values()].at(-1);
      expect(second?.price).toBe(YEARLY.id);
      expect(first?.status).toBe("expired");
      expect(await checkout(buying(reader, { page: "/subscribe", block: "yearly" }))).toBe(yearly);
      // Owners giving the button another price since does the same.
      buttons.yearly = MONTHLY.id;
      const changed = await checkout(buying(reader, { page: "/subscribe", block: "yearly" }));
      expect(changed).not.toBe(yearly);
      expect(second?.status).toBe("expired");
      expect([...stripe.sessions.values()].filter((one) => one.status === "open").map((one) => one.price)).toEqual([
        MONTHLY.id,
      ]);
    } finally {
      close();
    }
  });

  it("goes on where the other price's Checkout finished between finding it and expiring it", async () => {
    const { stripe, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      // Paid for meanwhile: Stripe won't expire it, and the person now subscribes, so they go to the portal.
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const [first] = [...stripe.sessions.values()];
      /** Stripe's client, with the open Checkout finished (`finish`) just before it's asked to expire it. */
      const finishing = (finish: (id: string) => void) =>
        stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input instanceof Request ? input.url : input);
          const id = /checkout\/sessions\/([^/]+)\/expire$/.exec(url)?.[1];
          if (id) finish(id);
          return stripe.fetch(input, init);
        }) as typeof fetch);
      const paid = finishing((id) => {
        stripe.pay(id);
      });
      expect(await checkout(buying(reader, { page: "/subscribe", block: "yearly" }), paid)).toBe(
        `${STRIPE}/portal/${await customer(readerId)}`,
      );
      expect(first?.status).toBe("complete");
      // Expired on its own meanwhile: nothing was bought, so the price chosen now goes to Checkout.
      const second = await payments();
      try {
        await second.checkout(second.buying(second.reader, { page: "/subscribe", block: "monthly" }));
        const [stale] = [...second.stripe.sessions.values()];
        const expired = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input instanceof Request ? input.url : input);
          if (url.endsWith("/expire") && stale) stale.status = "expired";
          return second.stripe.fetch(input, init);
        }) as typeof fetch);
        const address = await second.checkout(
          second.buying(second.reader, { page: "/subscribe", block: "yearly" }),
          expired,
        );
        expect(address).toMatch(/\/checkout\//);
        expect([...second.stripe.sessions.values()].at(-1)?.price).toBe(YEARLY.id);
      } finally {
        second.close();
      }
    } finally {
      close();
    }
  });

  it("keeps the Checkout a press started once its lock ran out, which writes nothing here", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      let creating = () => {};
      const created = new Promise<void>((resolve) => {
        creating = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (init?.method === "POST" && url.endsWith("/v1/checkout/sessions")) {
          creating();
          await released;
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      // A press stalls while Stripe makes its Checkout...
      const pressed = checkout(buying(reader, { page: "/subscribe", block: "monthly" }), slow);
      await created;
      vi.useFakeTimers({ toFake: ["Date"] });
      // ...through a minute, which the lock outlasts, so another press waits...
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      await expect(checkout(buying(reader, { page: "/subscribe", block: "monthly" }))).rejects.toMatchObject({
        status: 409,
      });
      // ...until its time runs out, when another press takes it over.
      vi.setSystemTime(Date.now() + (CHECKOUT_LOCK_SECONDS - STRIPE_LOCK_SECONDS) * 1000);
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      release();
      // The stalled press still sends its buyer to the Checkout Stripe made for them.
      expect(await pressed).toMatch(new RegExp(`^${STRIPE}/checkout/cs_`));
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("starts no Checkout from a press that took longer than its lock to look, once another has started one", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      let looking = () => {};
      const looked = new Promise<void>((resolve) => {
        looking = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        // Stripe's answer, that nothing is open, is read before the other press, and arrives after it.
        const answer = await stripe.fetch(input, init);
        if (url.includes("/v1/checkout/sessions?")) {
          looking();
          await released;
        }
        return answer;
      }) as typeof fetch);
      // A press stalls while it looks for an open Checkout, past the lock's time, and another takes the lock over...
      const pressed = checkout(buying(reader, { page: "/subscribe", block: "monthly" }), slow);
      await looked;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (CHECKOUT_LOCK_SECONDS + 1) * 1000);
      const other = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      release();
      // ...so the stalled one stops before starting a second Checkout.
      await expect(pressed).rejects.toMatchObject({ status: 409 });
      expect([...stripe.sessions.values()].map((one) => one.url)).toEqual([other]);
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("asks Stripe for a customer's subscriptions without the cancelled ones, which a long-time customer has many of", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      const asked: string[] = [];
      const counting = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        asked.push(String(input instanceof Request ? input.url : input));
        return stripe.fetch(input, init);
      }) as typeof fetch);
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }), counting);
      const listed = asked.filter((url) => new URL(url).pathname === "/v1/subscriptions");
      expect(listed).toHaveLength(1);
      expect(new URL(listed[0] ?? "").searchParams.get("status")).toBeNull();
    } finally {
      close();
    }
  });

  it("goes back to a subscription's Checkout someone has started, rather than start a second", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      const first = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const again = await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      expect(again).toBe(first);
      expect(stripe.sessions.size).toBe(1);
      // Pressed again while the first press is still deciding, it's asked to wait rather than start another.
      let deciding = () => {};
      const decided = new Promise<void>((resolve) => {
        deciding = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const slow = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input instanceof Request ? input.url : input).includes("/v1/subscriptions?")) {
          deciding();
          await released;
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      const pressed = checkout(buying(reader, { page: "/subscribe", block: "monthly" }), slow);
      await decided;
      await expect(checkout(buying(reader, { page: "/subscribe", block: "monthly" }))).rejects.toMatchObject({
        status: 409,
      });
      // So is a press on another price of the same product, which would otherwise start a second subscription to it.
      await expect(checkout(buying(reader, { page: "/subscribe", block: "yearly" }))).rejects.toMatchObject({
        status: 409,
      });
      release();
      expect(await pressed).toBe(first);
      expect(stripe.sessions.size).toBe(1);
    } finally {
      close();
    }
  });

  it("makes a new Stripe customer in place of one Stripe no longer has", async () => {
    const { stripe, client, buy, buying, checkout, customer, context, readerId, reader, auth, asking, close } =
      await payments();
    try {
      await buy("report");
      const gone = (await customer(readerId)) ?? "";
      // Deleted in Stripe, as a customer can be, or never there, as when the site moves from test mode.
      stripe.customers.delete(gone);
      // Its portal has nothing to manage...
      const portal = billingAddress(asking(reader, "POST", "same-origin", "/api/billing/"), {
        siteAuth: auth,
        siteEnv: PAYMENTS_ENV,
        stripe: client,
        customer: (userId) => customerOf(context.adapter, userId),
      });
      await expect(portal).rejects.toMatchObject({ status: 404 });
      // ...and Checkout makes them a new one, which the site keeps.
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const kept = await customer(readerId);
      expect(kept).not.toBe(gone);
      expect(stripe.customers.has(kept ?? "")).toBe(true);
      expect([...stripe.sessions.values()].at(-1)?.customer).toBe(kept);
    } finally {
      close();
    }
  });

  it("says a price Stripe doesn't have isn't on sale, and passes on any other failure", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      await expect(checkout(buying(reader, { page: "/subscribe", block: "gone" }))).rejects.toMatchObject({
        status: 409,
      });
      stripe.settings.forbidden = true;
      const refused = checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      await expect(refused).rejects.toThrow();
      await expect(refused).rejects.not.toBeInstanceOf(PaymentsError);
    } finally {
      close();
    }
  });

  it("leaves alone what Stripe says of an account that's been deleted", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      // A subscription and something bought once, paid for after the account was deleted.
      const events = [];
      for (const block of ["monthly", "report"]) {
        await checkout(buying(reader, { page: "/subscribe", block }));
        events.push(...stripe.pay([...stripe.sessions.values()].at(-1)?.id ?? ""));
      }
      await context.adapter.deleteMany({ model: "user", where: [{ field: "id", value: readerId }] });
      for (const event of events) expect((await deliver(event)).status).toBe(200);
      const left = await context.adapter.findMany({
        model: "entitlement",
        where: [{ field: "userId", value: readerId }],
      });
      expect(left).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("keeps a purchase whose dispute was won, whichever of its events arrives first", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("report");
      const created = stripe.dispute(bought?.payment_intent ?? "");
      const closed = stripe.closeDispute(bought?.payment_intent ?? "", "won");
      await deliver(closed);
      await deliver(created);
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
    } finally {
      close();
    }
  });

  it("gives a purchase back once the site wins its dispute, and not once it's lost", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const won = await buy("report");
      await deliver(stripe.dispute(won?.payment_intent ?? ""));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
      await deliver(stripe.closeDispute(won?.payment_intent ?? "", "won"));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
      // A purchase whose dispute was lost stays taken back.
      await context.adapter.deleteMany({ model: "entitlement", where: [{ field: "userId", value: readerId }] });
      const lost = await buy("report");
      await deliver(stripe.dispute(lost?.payment_intent ?? ""));
      await deliver(stripe.closeDispute(lost?.payment_intent ?? "", "lost"));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });
});

describe("a subscription's payments", () => {
  it("leave an active subscription as it is, however its payments are refunded or disputed", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = bought?.subscription ?? "";
      const until = await subscribedUntil(context.adapter, readerId);
      expect(until).toBeDefined();
      // Access follows the subscription's status, not what was paid for it: refunded in full, by either of the events
      // Stripe sends, or disputed and lost, it stays while Stripe has the subscription active.
      for (const type of ["charge.refunded", "refund.created"] as const) {
        expect((await deliver(stripe.refund(stripe.paymentOf(subscription), undefined, type))).status).toBe(200);
        expect(await subscribedUntil(context.adapter, readerId)).toEqual(until);
      }
      expect((await deliver(stripe.dispute(stripe.paymentOf(subscription)))).status).toBe(200);
      expect((await deliver(stripe.closeDispute(stripe.paymentOf(subscription), "lost"))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toEqual(until);
      // Cancelled at once in Stripe, with nothing refunded, it ends.
      expect((await deliver(stripe.cancel(subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("take away a cancelled subscription's row whatever clock wrote it, as one a little ahead of this one's", async () => {
    const { stripe, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      // Written by a request on another machine, whose clock is a second ahead of this one's.
      const reference = `stripe:${subscription.id}`;
      await context.adapter.deleteMany({ model: "entitlement", where: [{ field: "reference", value: reference }] });
      await context.adapter.create({
        model: "entitlement",
        data: {
          id: reference,
          userId: readerId,
          kind: "subscription",
          reference,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(Date.now() + 1000),
        },
        forceAllowId: true,
      });
      expect((await deliver(stripe.cancel(subscription.id))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("send the event again where a request that stalled after its fence finds its lock taken over", async () => {
    const { stripe, client, buy, deliver, context, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      // Writing the subscription stalls right after its fence, before taking away the row it replaces...
      const slow = pausingWrites(context.adapter, "deleteMany");
      const coming = applySubscription(slow.adapter, client, subscription.id);
      await slow.paused;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (STRIPE_LOCK_SECONDS + 1) * 1000);
      // ...past its lock's time, while a renewal's event takes the lock over and writes the subscription.
      expect((await deliver(stripe.renew(subscription.id))).status).toBe(200);
      slow.release();
      // The stalled write finds its lock taken over and ends in `StripeBusy`, so its event is sent again, which writes
      // the subscription as Stripe has it, whatever the stalled write took away.
      await expect(coming).rejects.toMatchObject({ name: "StripeBusy" });
      expect((await deliver(stripe.event("customer.subscription.updated", subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("take a subscription away from whoever it named, once it names nobody or an account deleted since", async () => {
    const { stripe, buy, deliver, context, person, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      subscription.metadata = {};
      expect((await deliver(stripe.event("customer.subscription.updated", subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      // Given back to the reader, then moved to an account that's gone.
      subscription.metadata = { userId: readerId };
      await deliver(stripe.event("customer.subscription.updated", subscription));
      expect(await subscribedUntil(context.adapter, readerId)).toBeDefined();
      const goneId = await person("gone@example.org", MEMBER_ROLE);
      await context.adapter.delete({ model: "user", where: [{ field: "id", value: goneId }] });
      subscription.metadata = { userId: goneId };
      expect((await deliver(stripe.event("customer.subscription.updated", subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("move to the account the subscription names now", async () => {
    const { stripe, buy, deliver, context, person, readerId, close } = await payments();
    try {
      const bought = await buy("monthly");
      const subscription = stripe.subscriptions.get(bought?.subscription ?? "");
      if (!subscription) throw new Error("No subscription.");
      const otherId = await person("otto@example.org", MEMBER_ROLE);
      subscription.metadata = { ...subscription.metadata, userId: otherId };
      expect((await deliver(stripe.event("customer.subscription.updated", subscription))).status).toBe(200);
      expect(await subscribedUntil(context.adapter, otherId)).toBeDefined();
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe("what Stripe refuses", () => {
  it("is a customer another Checkout is making at that moment: that one's, or try again while it's coming", async () => {
    const { stripe, context, readerId, close } = await payments();
    try {
      const user = { id: readerId, email: "rita@example.org" };
      // The other Checkout keeps its customer while this one's request gets Stripe's conflict...
      const meanwhile = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (init?.method === "POST" && url.endsWith("/v1/customers")) {
          await context.adapter.updateMany({
            model: "user",
            where: [{ field: "id", value: readerId }],
            update: { stripeCustomerId: "cus_other" },
          });
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      stripe.settings.customerConflict = 1;
      expect(await accountCustomer(context.adapter, meanwhile, user)).toBe("cus_other");
      // ...and where it hasn't kept one yet, this one asks to try again.
      await context.adapter.updateMany({
        model: "user",
        where: [{ field: "id", value: readerId }],
        update: { stripeCustomerId: null },
      });
      stripe.settings.customerConflict = 1;
      await expect(accountCustomer(context.adapter, stripeFor(PAYMENTS_ENV, stripe.fetch), user)).rejects.toMatchObject(
        { status: 409 },
      );
    } finally {
      close();
    }
  });

  it("starting a Checkout is passed on, even where the press's lock ran out meanwhile", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      let creating = () => {};
      const created = new Promise<void>((resolve) => {
        creating = resolve;
      });
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const failing = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (init?.method === "POST" && url.endsWith("/v1/checkout/sessions")) {
          creating();
          await released;
          return Response.json(
            { error: { type: "invalid_request_error", message: "The key doesn't have that permission." } },
            { status: 403 },
          );
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      // A press stalls while Stripe refuses to make its Checkout, until another press has taken its lock over.
      const pressed = checkout(buying(reader, { page: "/subscribe", block: "monthly" }), failing);
      await created;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + (CHECKOUT_LOCK_SECONDS + 1) * 1000);
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      release();
      // What went wrong is Stripe's refusal, not another press.
      await expect(pressed).rejects.toMatchObject({ type: "StripePermissionError" });
    } finally {
      vi.useRealTimers();
      close();
    }
  });

  it("expiring another price's Checkout, other than as one that isn't open, is passed on", async () => {
    const { stripe, buying, checkout, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const refusing = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith("/expire")) {
          return Response.json(
            { error: { type: "invalid_request_error", message: "The key doesn't have that permission." } },
            { status: 403 },
          );
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      await expect(checkout(buying(reader, { page: "/subscribe", block: "yearly" }), refusing)).rejects.toMatchObject({
        type: "StripePermissionError",
      });
    } finally {
      close();
    }
  });

  it("reading a Checkout Session on the way back is passed on, unless Stripe doesn't have it", async () => {
    const { auth, stripe, buying, checkout, context, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const back = (id: string, through = stripeFor(PAYMENTS_ENV, stripe.fetch)) =>
        returnFromCheckout(
          new Request(`${SITE}/api/checkout/done/?next=%2Fsubscribe&session_id=${id}`, {
            headers: { cookie: reader ?? "" },
          }),
          { siteAuth: auth, stripe: through, adapter: context.adapter },
        );
      // One Stripe doesn't have goes on to the page...
      expect(await back("cs_test_none")).toBe("/subscribe");
      // ...and any other failure is the route's to log.
      const refusing = stripeFor(PAYMENTS_ENV, (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("/v1/checkout/sessions/cs_")) {
          return Response.json(
            { error: { type: "invalid_request_error", message: "The key doesn't have that permission." } },
            { status: 403 },
          );
        }
        return stripe.fetch(input, init);
      }) as typeof fetch);
      await expect(back(session?.id ?? "", refusing)).rejects.toMatchObject({ type: "StripePermissionError" });
    } finally {
      close();
    }
  });

  it("nothing where the site has no key yet: the webhook says payments aren't set up, for Stripe to try again", async () => {
    const { context, close } = await payments();
    try {
      const { STRIPE_SECRET_KEY: _, ...withoutKey } = PAYMENTS_ENV;
      const signed = signEvent("whsec_test_only", { id: "evt_test", object: "event", type: "ping", data: {} });
      const answer = await webhookResponse(
        new Request(`${SITE}/api/stripe/webhook/`, {
          method: "POST",
          headers: { "stripe-signature": signed.signature },
          body: signed.body,
        }),
        { siteEnv: withoutKey, adapter: context.adapter },
      );
      expect(answer.status).toBe(503);
    } finally {
      close();
    }
  });
});

describe("payments' routes", () => {
  it("answer a problem in its own words, and anything else in words of their own, logging its name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const known = paymentsProblem(new PaymentsError(409, "This isn't on sale at the moment."), "Checkout");
      expect(known.status).toBe(409);
      expect(await known.text()).toBe("This isn't on sale at the moment.");
      expect(log).not.toHaveBeenCalled();
      const other = paymentsProblem(new TypeError("secret detail"), "Opening the customer portal");
      expect(other.status).toBe(500);
      expect(await other.text()).not.toContain("secret");
      expect(log).toHaveBeenCalledWith("Opening the customer portal failed: TypeError.");
    } finally {
      log.mockRestore();
    }
  });

  it("answer a browser's form with a page saying what went wrong, linking back to the page it was on", async () => {
    const pressed = (referer?: string) =>
      new Request(`${SITE}/api/checkout/`, {
        method: "POST",
        headers: { accept: "text/html,application/xhtml+xml", ...(referer && { referer }) },
      });
    const problem = new PaymentsError(409, "Your payment is <already> starting.");
    const page = paymentsProblem(problem, "Checkout", pressed(`${SITE}/subscribe/?x=1`));
    expect(page.status).toBe(409);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await page.text();
    expect(html).toContain("Your payment is &lt;already&gt; starting.");
    expect(html).toContain('<a href="/subscribe/">');
    // Back to the home page from anywhere else.
    for (const referer of ["https://elsewhere.example/page", undefined]) {
      expect(await paymentsProblem(problem, "Checkout", pressed(referer)).text()).toContain('<a href="/">');
    }
  });
});

describe("managing a subscription", () => {
  it("opens Stripe's portal for a subscription the person pays for, from the site's own pages", async () => {
    const { auth, stripe, client, buying, checkout, deliver, context, reader, person, signIn, asking, close } =
      await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      for (const event of stripe.pay(session?.id ?? "")) await deliver(event);
      const portal = (cookie: string | undefined, from = "same-origin") =>
        billingAddress(asking(cookie, "POST", from, "/api/billing/"), {
          siteAuth: auth,
          siteEnv: PAYMENTS_ENV,
          stripe: client,
          customer: (userId) => customerOf(context.adapter, userId),
        });
      const customer = stripe.subscriptions.get(session?.subscription ?? "")?.customer;
      expect(await portal(reader)).toBe(`${STRIPE}/portal/${customer}`);
      await expect(portal(reader, "cross-site")).rejects.toMatchObject({ status: 403 });
      await expect(portal(undefined)).rejects.toMatchObject({ status: 401 });
      await person("paul@example.org", MEMBER_ROLE);
      await expect(portal((await signIn("paul@example.org")).cookie)).rejects.toMatchObject({ status: 404 });
      // Once the subscription stops giving anything, as when its payments fail, the portal still opens, to fix them.
      await deliver(stripe.cancel(session?.subscription ?? ""));
      expect(await portal(reader)).toBe(`${STRIPE}/portal/${customer}`);
    } finally {
      close();
    }
  });
});
