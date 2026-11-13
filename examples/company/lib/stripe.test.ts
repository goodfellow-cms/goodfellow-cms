import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMBER_ROLE } from "./auth.ts";
import { can, subscribedUntil, subscriptionsOf } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import {
  applySession,
  type ButtonPlace,
  billingAddress,
  checkoutAddress,
  customerOf,
  placeFrom,
  returnFromCheckout,
  STRIPE_EVENT_IDENTIFIER,
  STRIPE_EVENT_LEASE_SECONDS,
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

/** The site with Stripe, and a page with a monthly subscription's button and a report's. */
async function payments() {
  const site = await testSite(PAYMENTS_ENV);
  const stripe = fakeStripe({ key: "rk_test_only", base: STRIPE, prices: [MONTHLY, REPORT, CHEAP] });
  const client = stripeFor(PAYMENTS_ENV, stripe.fetch);
  const buttons: Record<string, string> = { monthly: MONTHLY.id, report: REPORT.id, gone: "price_gone" };
  const findButton = async (place: ButtonPlace) =>
    place.page === "/subscribe" && buttons[place.block] ? { price: buttons[place.block] ?? "" } : undefined;
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
  const checkout = (request: Request) =>
    checkoutAddress(request, { siteAuth: site.auth, siteEnv: PAYMENTS_ENV, stripe: client, findButton, customer });
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
  return { ...site, stripe, client, buttons, buying, checkout, deliver, buy, customer, readerId, reader };
}

afterEach(() => vi.unstubAllGlobals());

describe("checkout", () => {
  it("sells the price the page's owners chose, to the person signed in, coming back to the site", async () => {
    const { stripe, buying, checkout, readerId, reader, close } = await payments();
    try {
      // The request names a cheaper price too: only the page's is read.
      const address = await checkout(buying(reader, { page: "/subscribe", block: "monthly", price: CHEAP.id }));
      const session = [...stripe.sessions.values()][0];
      expect(address).toBe(session?.url);
      expect(session).toMatchObject({
        mode: "subscription",
        price: MONTHLY.id,
        client_reference_id: readerId,
        customer_email: "rita@example.org",
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
  it("is the one someone first paid as, for everything they buy after", async () => {
    const { stripe, buy, buying, checkout, customer, readerId, reader, close } = await payments();
    try {
      // A one-off payment makes a customer only where it's asked to.
      const first = await buy("report");
      expect(first).toMatchObject({ customer_creation: "always", customer_email: "rita@example.org" });
      const paidAs = stripe.sessions.get(first?.id ?? "")?.customer;
      expect(paidAs).toMatch(/^cus_/);
      expect(await customer(readerId)).toBe(paidAs);
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const second = [...stripe.sessions.values()].at(-1);
      expect(second).toMatchObject({ customer: paidAs, customer_email: null });
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

describe("Stripe's events", () => {
  it("give a subscription once it's paid, until its period ends, and take it away once it's cancelled", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "monthly" }));
      const session = [...stripe.sessions.values()][0];
      const [created, completed] = stripe.pay(session?.id ?? "", 30);
      for (const event of [completed, created]) expect((await deliver(event ?? {})).status).toBe(200);
      const until = await subscribedUntil(context.adapter, readerId);
      expect(until?.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
      expect(await subscriptionsOf(context.adapter, readerId)).toHaveLength(1);
      const ended = stripe.cancel(session?.subscription ?? "");
      expect((await deliver(ended)).status).toBe(200);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it("give a purchase for good once it's paid, and take it back once it's refunded", async () => {
    const { stripe, buying, checkout, deliver, context, readerId, reader, close } = await payments();
    try {
      await checkout(buying(reader, { page: "/subscribe", block: "report" }));
      const session = [...stripe.sessions.values()][0];
      const events = stripe.pay(session?.id ?? "");
      for (const event of events) await deliver(event);
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(true);
      expect(await subscribedUntil(context.adapter, readerId)).toBeUndefined();
      await deliver(stripe.refund(session?.payment_intent ?? ""));
      expect(await can(context.adapter, readerId, REPORT.product)).toBe(false);
    } finally {
      close();
    }
  });

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
