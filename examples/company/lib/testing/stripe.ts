// A stand-in for the parts of Stripe's API the site uses (lib/stripe.ts), for tests: prices, customers, Checkout Sessions and
// their line items, payments and their charges and disputes, subscriptions, and customer portal sessions, kept in memory, with a checkout page that pays and
// sends the site Stripe's events, signed as Stripe signs them. Never used by the site itself.
import { createHmac } from "node:crypto";

/** A price the stand-in sells. */
export interface FakePrice {
  id: string;
  product: string;
  /** `recurring` for a subscription, `one_time` for something bought once. */
  type: "recurring" | "one_time";
  active?: boolean;
}

interface FakeSession {
  id: string;
  object: "checkout.session";
  url: string;
  mode: "payment" | "subscription";
  client_reference_id: string | null;
  customer_email: string | null;
  /** The customer it was made for, or the one Stripe made when it was paid. */
  customer: string | null;
  customer_creation: string | null;
  metadata: Record<string, string>;
  payment_status: "paid" | "unpaid";
  status: "open" | "complete";
  subscription: string | null;
  payment_intent: string | null;
  success_url: string;
  cancel_url: string;
  price: string;
  subscriptionMetadata: Record<string, string>;
}

interface FakeSubscription {
  id: string;
  object: "subscription";
  status: string;
  customer: string;
  metadata: Record<string, string>;
  items: { object: "list"; data: { id: string; current_period_end: number; price: { id: string } }[] };
}

interface FakeCharge {
  id: string;
  object: "charge";
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  disputed: boolean;
}

/** Stripe's form encoding read back into nested objects: `metadata[userId]=…`, `line_items[0][price]=…`. */
function decoded(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const path = key.split(/\[|\]\[|\]/).filter(Boolean);
    let at: Record<string, unknown> = out;
    for (const [index, part] of path.entries()) {
      if (index === path.length - 1) at[part] = value;
      else {
        at[part] ??= {};
        at = at[part] as Record<string, unknown>;
      }
    }
  }
  return out;
}

/** What `sign()` gives: an event's body and the `stripe-signature` header Stripe sends with it. */
export interface SignedEvent {
  body: string;
  signature: string;
}

/** An event's body, and its signature with `secret`, as Stripe makes them (`t=…,v1=…`, HMAC-SHA256). */
export function signEvent(secret: string, event: object, time = Math.floor(Date.now() / 1000)): SignedEvent {
  const body = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(`${time}.${body}`).digest("hex");
  return { body, signature: `t=${time},v1=${v1}` };
}

/**
 * A stand-in for Stripe, at `base`, which only `key` may call. `pay()`, `cancel()` and `refund()` change what it
 * holds as a customer or Stripe would, and give the events Stripe would send.
 */
export function fakeStripe(options: { key: string; base: string; prices: FakePrice[] }) {
  const prices = new Map(options.prices.map((price) => [price.id, { active: true, ...price }]));
  const sessions = new Map<string, FakeSession>();
  const subscriptions = new Map<string, FakeSubscription>();
  /** Each payment's charge, by the payment's id. */
  const charges = new Map<string, FakeCharge>();
  /** Customers, by id, and the ones made with each idempotency key. */
  const customers = new Map<string, { id: string; object: "customer"; email: string | null; metadata: object }>();
  /** What each idempotency key's request was answered with, which Stripe gives again, deleted since or not. */
  const madeWithKey = new Map<string, { id: string; object: "customer"; email: string | null; metadata: object }>();
  /** Each payment's disputes, by the payment's id. */
  const disputes = new Map<string, { id: string; object: "dispute"; payment_intent: string; status: string }[]>();
  /**
   * `idempotency` off makes each request a new one whatever its idempotency key, as once the key's 24 hours have
   * passed; `forbidden` refuses every request as a restricted key without the permission would be.
   */
  const settings = { idempotency: true, forbidden: false };
  let count = 0;
  const next = (prefix: string) => `${prefix}_test${++count}`;
  const json = (value: unknown, status = 200) => Response.json(value, { status });
  /** Stripe's answer for an object it doesn't have, or one a request named as `param`. */
  const missing = (param?: string) =>
    json(
      { error: { type: "invalid_request_error", code: "resource_missing", message: "No such object.", param } },
      param ? 400 : 404,
    );
  const list = <T>(data: T[]) => ({ object: "list", data, has_more: false, url: "" });
  const priceObject = (price: FakePrice & { active: boolean }) => ({
    id: price.id,
    object: "price",
    active: price.active,
    type: price.type,
    product: price.product,
  });
  const shownSession = (session: FakeSession) => {
    const { price: _, subscriptionMetadata: __, ...shown } = session;
    return shown;
  };
  const event = (type: string, object: unknown) => ({
    id: next("evt"),
    object: "event",
    type,
    api_version: "2026-10-28.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  });

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("authorization") !== `Bearer ${options.key}`) {
      return json({ error: { type: "invalid_request_error", message: "Invalid API Key provided." } }, 401);
    }
    if (settings.forbidden) {
      return json({ error: { type: "invalid_request_error", message: "The key doesn't have that permission." } }, 403);
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const body = request.method === "POST" ? decoded(await request.text()) : {};
    if (parts[0] !== "v1") return missing();
    if (parts[1] === "prices" && parts[2] && request.method === "GET") {
      const price = prices.get(parts[2]);
      return price ? json(priceObject(price)) : missing();
    }
    if (parts[1] === "checkout" && parts[2] === "sessions") {
      if (!parts[3] && request.method === "POST") {
        if (body.customer && !customers.has(body.customer as string)) return missing("customer");
        const items = body.line_items as Record<string, { price: string }>;
        const price = prices.get(items?.["0"]?.price ?? "");
        if (!price?.active) return missing();
        const id = next("cs");
        const session: FakeSession = {
          id,
          object: "checkout.session",
          url: `${options.base}/checkout/${id}`,
          mode: body.mode as FakeSession["mode"],
          client_reference_id: (body.client_reference_id as string) ?? null,
          customer_email: (body.customer_email as string) ?? null,
          customer: (body.customer as string) ?? null,
          customer_creation: (body.customer_creation as string) ?? null,
          metadata: (body.metadata as Record<string, string>) ?? {},
          payment_status: "unpaid",
          status: "open",
          subscription: null,
          payment_intent: null,
          success_url: body.success_url as string,
          cancel_url: body.cancel_url as string,
          price: price.id,
          subscriptionMetadata:
            ((body.subscription_data as { metadata?: Record<string, string> })?.metadata as Record<string, string>) ??
            {},
        };
        sessions.set(id, session);
        return json(shownSession(session));
      }
      if (!parts[3] && request.method === "GET") {
        const intent = url.searchParams.get("payment_intent");
        return json(list([...sessions.values()].filter((one) => one.payment_intent === intent).map(shownSession)));
      }
      const session = sessions.get(parts[3] ?? "");
      if (!session) return missing();
      if (parts[4] === "line_items") {
        const price = prices.get(session.price);
        return json(list(price ? [{ id: `li_${session.id}`, object: "item", price: priceObject(price) }] : []));
      }
      return json(shownSession(session));
    }
    if (parts[1] === "customers" && !parts[2] && request.method === "POST") {
      const key = request.headers.get("idempotency-key");
      const earlier = key && settings.idempotency ? madeWithKey.get(key) : undefined;
      if (earlier) return json(earlier);
      const customer = {
        id: next("cus"),
        object: "customer" as const,
        email: (body.email as string) ?? null,
        metadata: (body.metadata as object) ?? {},
      };
      customers.set(customer.id, customer);
      if (key) madeWithKey.set(key, customer);
      return json(customer);
    }
    if (parts[1] === "payment_intents" && parts[2] && request.method === "GET") {
      const charge = charges.get(parts[2]);
      return charge ? json({ id: parts[2], object: "payment_intent", latest_charge: charge }) : missing();
    }
    if (parts[1] === "subscriptions" && !parts[2] && request.method === "GET") {
      const customer = url.searchParams.get("customer");
      const price = url.searchParams.get("price");
      return json(
        list(
          [...subscriptions.values()].filter(
            (one) => one.customer === customer && (!price || one.items.data.some((item) => item.price.id === price)),
          ),
        ),
      );
    }
    if (parts[1] === "disputes" && !parts[2] && request.method === "GET") {
      return json(list(disputes.get(url.searchParams.get("payment_intent") ?? "") ?? []));
    }
    if (parts[1] === "subscriptions" && parts[2] && request.method === "GET") {
      const subscription = subscriptions.get(parts[2]);
      return subscription ? json(subscription) : missing();
    }
    if (parts[1] === "billing_portal" && parts[2] === "sessions" && request.method === "POST") {
      if (!customers.has(body.customer as string)) return missing("customer");
      return json({
        id: next("bps"),
        object: "billing_portal.session",
        url: `${options.base}/portal/${body.customer}`,
      });
    }
    return missing();
  }

  return {
    /** Stripe's API as `fetch` would reach it, for the SDK's fetch client. */
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
    handle,
    sessions,
    subscriptions,
    charges,
    prices,
    customers,
    disputes,
    settings,
    /**
     * Pays a Checkout Session, as the customer would: one-off payments get a payment, subscriptions a subscription
     * paid until `days` from now. Gives the events Stripe sends, in an order of its own.
     */
    pay(sessionId: string, days = 30) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`No session ${sessionId}.`);
      session.payment_status = "paid";
      session.status = "complete";
      // Subscriptions always have a customer, and payments one where the site asked for it.
      if (!session.customer && (session.mode === "subscription" || session.customer_creation === "always")) {
        session.customer = next("cus");
      }
      const events = [];
      if (session.mode === "subscription") {
        const subscription: FakeSubscription = {
          id: next("sub"),
          object: "subscription",
          status: "active",
          customer: session.customer ?? next("cus"),
          metadata: session.subscriptionMetadata,
          items: {
            object: "list",
            data: [
              {
                id: next("si"),
                current_period_end: Math.floor(Date.now() / 1000) + days * 24 * 60 * 60,
                price: { id: session.price },
              },
            ],
          },
        };
        subscriptions.set(subscription.id, subscription);
        session.subscription = subscription.id;
        events.push(event("customer.subscription.created", subscription));
      } else {
        session.payment_intent = next("pi");
        charges.set(session.payment_intent, {
          id: next("ch"),
          object: "charge",
          amount: 1000,
          amount_refunded: 0,
          refunded: false,
          disputed: false,
        });
      }
      events.push(event("checkout.session.completed", shownSession(session)));
      return events;
    },
    /** Ends a subscription, as cancelling it in Stripe would. Gives the event Stripe sends. */
    cancel(subscriptionId: string) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw new Error(`No subscription ${subscriptionId}.`);
      subscription.status = "canceled";
      return event("customer.subscription.deleted", subscription);
    },
    /** Refunds a payment, all of it or `amount`. Gives the event Stripe sends. */
    refund(paymentIntentId: string, amount?: number) {
      const charge = charges.get(paymentIntentId);
      if (!charge) throw new Error(`No payment ${paymentIntentId}.`);
      charge.amount_refunded = amount ?? charge.amount;
      charge.refunded = charge.amount_refunded >= charge.amount;
      return event("charge.refunded", { ...charge, payment_intent: paymentIntentId });
    },
    /** Disputes a payment, as the customer's bank would. Gives the event Stripe sends. */
    dispute(paymentIntentId: string) {
      const charge = charges.get(paymentIntentId);
      if (!charge) throw new Error(`No payment ${paymentIntentId}.`);
      charge.disputed = true;
      const dispute = {
        id: next("dp"),
        object: "dispute" as const,
        payment_intent: paymentIntentId,
        status: "needs_response",
      };
      disputes.set(paymentIntentId, [...(disputes.get(paymentIntentId) ?? []), dispute]);
      return event("charge.dispute.created", { ...dispute });
    },
    /** Closes a payment's dispute as `status` says (the site's `won`, or `lost`). Gives the event Stripe sends. */
    closeDispute(paymentIntentId: string, status: "won" | "lost" = "won") {
      const dispute = disputes.get(paymentIntentId)?.at(-1);
      if (!dispute) throw new Error(`No dispute of ${paymentIntentId}.`);
      dispute.status = status;
      return event("charge.dispute.closed", { ...dispute });
    },
    /** Any event, for checking what the site does with ones it doesn't use, or with a made-up object. */
    event,
  };
}

export type FakeStripe = ReturnType<typeof fakeStripe>;
