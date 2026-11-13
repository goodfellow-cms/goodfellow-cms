// Payments, through Stripe Checkout, so the site never sees a card: a Buy button (blocks/buy-button.tsx) posts here,
// the site makes a Checkout Session for the price its owners chose for that button, and Stripe's webhook, and the
// page people come back to, write what they bought into the `entitlement` table (lib/entitlements.ts). Every answer
// is read from Stripe itself, never from what the browser or an event's order says, so a replayed, late, or forged
// event can only make the site ask Stripe again.
import Stripe from "stripe";
import { claimRow, type SiteAuth } from "./auth.ts";
import { type EntitlementAdapter, grant } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import { fromThisSite } from "./sign-out.ts";
import { sitePath } from "./site-path.ts";

/** Stripe's client for the site, with its secret key, through `fetch`, as Workers need. */
export function stripeFor(siteEnv: SiteEnv, fetcher?: typeof fetch): Stripe {
  const key = siteEnv.STRIPE_SECRET_KEY;
  if (!key) throw new PaymentsError(503, "This site doesn't take payments yet.");
  const api = siteEnv.STRIPE_API_URL ? new URL(siteEnv.STRIPE_API_URL) : undefined;
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(fetcher),
    maxNetworkRetries: 2,
    timeout: 10_000,
    ...(api && {
      host: api.hostname,
      port: api.port || undefined,
      protocol: api.protocol === "http:" ? ("http" as const) : ("https" as const),
    }),
  });
}

/** A problem a person sees, with the HTTP status the route answers with. */
export class PaymentsError extends Error {
  override name = "PaymentsError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A Buy button, as its page has it: which page, and the button's own id on it. */
export interface ButtonPlace {
  page: string;
  block: string;
}

/** What the site knows about a Buy button: the Stripe price its owners chose for it. */
export interface Button {
  price: string;
}

/** Finds a Buy button on the site as visitors see it now, never as the browser describes it. */
export type FindButton = (place: ButtonPlace) => Promise<Button | undefined>;

/** The place a Buy button's form names, checked, since anyone can post anything. */
export function placeFrom(form: FormData): ButtonPlace {
  const page = form.get("page");
  const block = form.get("block");
  if (typeof page !== "string" || !page.startsWith("/") || page.startsWith("//") || page.length > 500) {
    throw new PaymentsError(400, "That button isn't on any of this site's pages.");
  }
  if (typeof block !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(block)) {
    throw new PaymentsError(400, "That button isn't on any of this site's pages.");
  }
  return { page, block };
}

/** What making a Checkout Session needs. */
export interface CheckoutOptions {
  siteAuth: SiteAuth;
  siteEnv: SiteEnv;
  stripe: Stripe;
  findButton: FindButton;
  /** The Stripe customer the person pays as, made the first time (`accountCustomer()`). */
  customer: (user: { id: string; email: string }) => Promise<string>;
}

/**
 * Where a Buy button's form goes: to sign in first, for someone who isn't, coming back to the page; otherwise to
 * Stripe Checkout, for the price the site's owners gave that button, paid for by the person signed in. The purchase is
 * theirs by their account's id, which Stripe hands back, never by an address the request names; the price is read from
 * the page as it's published, never from the request; and Stripe sends people back only to the site's own address.
 */
export async function checkoutAddress(request: Request, options: CheckoutOptions): Promise<string> {
  const { siteAuth, siteEnv, stripe, findButton } = options;
  if (request.method !== "POST" || !fromThisSite(request)) {
    throw new PaymentsError(403, "Buy from the site's own pages.");
  }
  const siteUrl = siteEnv.GOODFELLOW_SITE_URL;
  if (!siteUrl) throw new PaymentsError(503, "This site doesn't take payments yet.");
  const place = placeFrom(await request.formData());
  const session = await siteAuth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session || session.user.banned) {
    const signIn = new URL("/sign-in/", siteUrl);
    signIn.searchParams.set("next", place.page);
    return signIn.href;
  }
  const button = await findButton(place);
  if (!button) throw new PaymentsError(404, "That button isn't on any of this site's pages.");
  const price = await stripe.prices.retrieve(button.price).catch(() => undefined);
  if (!price?.active) throw new PaymentsError(409, "This isn't on sale at the moment.");
  const subscribing = price.type === "recurring";
  const userId = session.user.id;
  const back = new URL("/api/checkout/done/", siteUrl);
  back.searchParams.set("next", place.page);
  const done = `${back.href}&session_id={CHECKOUT_SESSION_ID}`;
  // The one customer they pay as, so all they pay for is in one place in Stripe's portal.
  const customer = await options.customer({ id: userId, email: session.user.email });
  const checkout = await stripe.checkout.sessions.create({
    mode: subscribing ? "subscription" : "payment",
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: userId,
    customer,
    metadata: { userId },
    ...(subscribing && { subscription_data: { metadata: { userId } } }),
    success_url: done,
    cancel_url: new URL(place.page, siteUrl).href,
  });
  if (!checkout.url) throw new PaymentsError(502, "Stripe didn't start the payment. Try again in a moment.");
  return checkout.url;
}

/** Stripe's id of whatever's in `value`: the id itself, or an object Stripe expanded. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

/** What reading and writing a person's Stripe customer needs of Better Auth's adapter. */
export type CustomerAdapter = Pick<EntitlementAdapter, "updateMany"> & {
  findOne<T>(data: { model: string; where: { field: string; value: string }[] }): Promise<T | null>;
};

/** The Stripe customer a person pays as, which the site wrote from a Checkout Session they paid, if any. */
export async function customerOf(adapter: CustomerAdapter, userId: string): Promise<string | undefined> {
  const user = await adapter.findOne<{ stripeCustomerId?: string | null }>({
    model: "user",
    where: [{ field: "id", value: userId }],
  });
  return user?.stripeCustomerId || undefined;
}

/**
 * The Stripe customer a person pays as: the one the site keeps for them, or, the first time, a new one with their
 * address. Checkouts started at once ask Stripe with the same idempotency key, so they get the same customer; where
 * they still make two (the key's 24 hours passed, or the address changed), the first written is kept, and each reads
 * back what was kept, so every Checkout Session is the one customer's, and the other has nothing.
 */
export async function accountCustomer(
  adapter: CustomerAdapter,
  stripe: Stripe,
  user: { id: string; email: string },
): Promise<string> {
  const kept = await customerOf(adapter, user.id);
  if (kept) return kept;
  const address = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(user.email)));
  const hash = Array.from(address.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const made = await stripe.customers.create(
    { email: user.email, metadata: { userId: user.id } },
    { idempotencyKey: `customer:${user.id}:${hash}` },
  );
  await rememberCustomer(adapter, user.id, made.id);
  return (await customerOf(adapter, user.id)) ?? made.id;
}

/** Keeps the Stripe customer a person paid as, where the site has none for them yet: the first stays. */
async function rememberCustomer(adapter: Pick<EntitlementAdapter, "updateMany">, userId: string, customer?: string) {
  if (!customer) return;
  await adapter.updateMany({
    model: "user",
    where: [
      { field: "id", value: userId },
      { field: "stripeCustomerId", value: null },
    ],
    update: { stripeCustomerId: customer },
  });
}

/** The `reference` of the subscription a person has through Stripe: the Stripe subscription's own id. */
export function subscriptionReference(subscriptionId: string): string {
  return `stripe:${subscriptionId}`;
}

/** The statuses in which a Stripe subscription still gives access, until its period ends. */
const SUBSCRIBED = new Set(["active", "trialing", "past_due"]);

/**
 * Writes a Stripe subscription's state, as Stripe has it now, into the person's entitlements: until its current
 * period ends while it's active (or trialing, or retrying a payment), and none at all otherwise. The person is the one
 * the site named when it made the Checkout Session, in the subscription's metadata, never anything the event says.
 */
export async function applySubscription(adapter: EntitlementAdapter, stripe: Stripe, subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  const reference = subscriptionReference(subscription.id);
  await adapter.deleteMany({
    model: "entitlement",
    where: [
      { field: "userId", value: userId },
      { field: "reference", value: reference },
    ],
  });
  if (!SUBSCRIBED.has(subscription.status)) return;
  const ends = Math.max(...subscription.items.data.map((item) => item.current_period_end));
  if (!Number.isFinite(ends)) return;
  await grant(adapter, { userId, kind: "subscription", reference, expiresAt: new Date(ends * 1000) });
}

/** The products a one-off payment's Checkout Session sold, by their Stripe product ids. */
async function productsOf(stripe: Stripe, sessionId: string): Promise<string[]> {
  const products: string[] = [];
  for await (const item of stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 })) {
    const product = idOf(item.price?.product as string | { id: string } | null | undefined);
    if (product) products.push(product);
  }
  return products;
}

/**
 * The id of the purchase of `product` a Checkout Session paid for: each payment's purchases are rows of their own, so
 * a refund takes back what it paid for, never the same product another payment bought.
 */
export function purchaseId(sessionId: string, product: string): string {
  return `stripe:${sessionId}:${product}`;
}

/** Whether a payment has been refunded, in full or in part, or disputed, as Stripe has it now. */
async function takenBack(stripe: Stripe, paymentIntentId: string): Promise<boolean> {
  const payment = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = payment.latest_charge;
  if (typeof charge === "string") throw new Error("Stripe didn't give the payment's charge.");
  return Boolean(charge && (charge.amount_refunded > 0 || charge.disputed));
}

/**
 * Writes what a Checkout Session bought, as Stripe has it now, into the entitlements of the person the site made it
 * for: once it's paid, never before (some payments take days, and Stripe says when they arrive), a subscription as
 * `applySubscription()` writes it, and a one-off purchase for each product, kept for good, unless its payment has been
 * refunded or disputed since (`revokePayment()`), so coming back with an old Session, or a late event, gives nothing
 * back. Keeps the Stripe customer they paid as (`customerOf()`).
 */
export async function applySession(adapter: EntitlementAdapter, stripe: Stripe, sessionId: string): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const userId = session.client_reference_id;
  if (!userId || session.metadata?.userId !== userId) return;
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  await rememberCustomer(adapter, userId, idOf(session.customer as string | { id: string } | null));
  const subscription = idOf(session.subscription);
  if (session.mode === "subscription" && subscription) return applySubscription(adapter, stripe, subscription);
  if (session.mode !== "payment") return;
  const payment = idOf(session.payment_intent);
  const taken = payment ? await takenBack(stripe, payment) : false;
  for (const product of await productsOf(stripe, session.id)) {
    const id = purchaseId(session.id, product);
    await adapter.deleteMany({ model: "entitlement", where: [{ field: "id", value: id }] });
    if (!taken) await grant(adapter, { id, userId, kind: "purchase", reference: product, expiresAt: null });
  }
}

/**
 * Takes back what a payment bought once it's refunded, in full or in part, or disputed: the purchases of each Checkout
 * Session that took it (`purchaseId()`), from the person the site made it for, leaving what other payments bought. A
 * subscription's payments end nothing by themselves: cancelling the subscription in Stripe does, which then ends it
 * here.
 */
export async function revokePayment(adapter: EntitlementAdapter, stripe: Stripe, paymentIntentId: string) {
  for await (const session of stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 10 })) {
    const userId = session.client_reference_id;
    if (!userId || session.metadata?.userId !== userId || session.mode !== "payment") continue;
    for (const product of await productsOf(stripe, session.id)) {
      await adapter.deleteMany({
        model: "entitlement",
        where: [
          { field: "id", value: purchaseId(session.id, product) },
          { field: "userId", value: userId },
        ],
      });
    }
  }
}

/** The start of the id of the row that says a Stripe event is being handled, or has been. */
export const STRIPE_EVENT_IDENTIFIER = "stripe-event:";

/** How long a handled event's id is kept, in seconds: Stripe retries an event for up to three days. */
export const STRIPE_EVENT_SECONDS = 4 * 24 * 60 * 60;

/**
 * How long a request has to handle an event before another may, in seconds: a request that stopped part way, as a
 * Worker can, leaves its claim, which Stripe's retry then takes over rather than taking it as done.
 */
export const STRIPE_EVENT_LEASE_SECONDS = 5 * 60;

/** What an event's row says: being handled, until `STRIPE_EVENT_LEASE_SECONDS` have passed, or handled. */
const HANDLING = "handling";
const HANDLED = "handled";

/** What the webhook needs of Better Auth's database adapter: entitlements, and the rows that record handled events. */
export type WebhookAdapter = EntitlementAdapter & Parameters<typeof claimRow>[0];

/**
 * Answers Stripe's webhook: checks the event's signature against the body exactly as it came, with
 * `STRIPE_WEBHOOK_SECRET`, before reading anything in it; does each event once, by its id, kept as long as Stripe
 * retries; and reads what the event is about from Stripe again, so its order, and anything in it but which object
 * changed, doesn't matter. An event is claimed while it's handled and marked handled only once it is: one that failed
 * lets go of its claim, one whose request stopped is taken over once its claim has run out, and one still being
 * handled is answered 409, so Stripe tries again later rather than taking it as done.
 */
export async function webhookResponse(
  request: Request,
  options: { siteEnv: SiteEnv; stripe: Stripe; adapter: WebhookAdapter },
): Promise<Response> {
  const { siteEnv, stripe, adapter } = options;
  const secret = siteEnv.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Payments aren't set up.", { status: 503 });
  const signature = request.headers.get("stripe-signature");
  const body = await request.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("No signature.");
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("That isn't Stripe's.", { status: 400 });
  }
  const id = `${STRIPE_EVENT_IDENTIFIER}${event.id}`;
  const claim = () =>
    claimRow(adapter, {
      id,
      identifier: id,
      value: HANDLING,
      expiresAt: new Date(Date.now() + STRIPE_EVENT_LEASE_SECONDS * 1000),
    });
  if (!(await claim())) {
    const row = await adapter.findOne<{ value: string }>({
      model: "verification",
      where: [{ field: "id", value: id }],
    });
    if (row?.value === HANDLED) return new Response(null, { status: 200 });
    // A claim whose request stopped before it finished, once it has run out, taken over by one request only; while it
    // hasn't, it's being handled, and Stripe tries again later.
    await adapter.deleteMany({
      model: "verification",
      where: [
        { field: "id", value: id },
        { field: "value", value: HANDLING },
        { field: "expiresAt", operator: "lte", value: new Date() },
      ],
    });
    if (!(await claim())) return new Response("Being handled.", { status: 409 });
  }
  try {
    await handle(adapter, stripe, event);
  } catch (error) {
    await adapter.deleteMany({ model: "verification", where: [{ field: "id", value: id }] });
    throw error;
  }
  await adapter.updateMany({
    model: "verification",
    where: [{ field: "id", value: id }],
    update: { value: HANDLED, expiresAt: new Date(Date.now() + STRIPE_EVENT_SECONDS * 1000), updatedAt: new Date() },
  });
  return new Response(null, { status: 200 });
}

/** Does what an event says changed, reading it from Stripe again. Events the site doesn't use are left alone. */
async function handle(adapter: EntitlementAdapter, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return applySession(adapter, stripe, event.data.object.id);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return applySubscription(adapter, stripe, event.data.object.id);
    case "charge.refunded":
    case "charge.dispute.created": {
      const paymentIntent = idOf(event.data.object.payment_intent);
      if (paymentIntent) await revokePayment(adapter, stripe, paymentIntent);
      return;
    }
    default:
      return;
  }
}

/**
 * Where someone who has just paid comes back to: the Checkout Session is read from Stripe, and if it's theirs and paid,
 * what it bought is written now, so the page they bought it on shows it straight away rather than once the webhook
 * arrives. Gives where to send them on to: `next`, a page of this site, or the home page.
 */
export async function returnFromCheckout(
  request: Request,
  options: { siteAuth: SiteAuth; stripe: Stripe; adapter: EntitlementAdapter },
): Promise<string> {
  const url = new URL(request.url);
  const next = sitePath(url.searchParams.get("next"));
  const sessionId = url.searchParams.get("session_id") ?? "";
  if (!/^cs_[A-Za-z0-9_]{1,250}$/.test(sessionId)) return next;
  const session = await options.siteAuth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session) return next;
  const checkout = await options.stripe.checkout.sessions.retrieve(sessionId).catch(() => undefined);
  if (checkout?.client_reference_id !== session.user.id) return next;
  await applySession(options.adapter, options.stripe, checkout.id);
  return next;
}

/**
 * Where someone who pays manages what they pay for, or stops: Stripe's own customer portal, for the Stripe customer
 * the site keeps for them (`customerOf()`), coming back to their account page, whether or not what they bought still
 * gives them anything, so they can fix a payment that failed. Only for the person signed in, from the site's own pages.
 */
export async function billingAddress(
  request: Request,
  options: {
    siteAuth: SiteAuth;
    siteEnv: SiteEnv;
    stripe: Stripe;
    customer: (userId: string) => Promise<string | undefined>;
  },
): Promise<string> {
  const { siteAuth, siteEnv, stripe } = options;
  if (request.method !== "POST" || !fromThisSite(request)) {
    throw new PaymentsError(403, "Manage your subscription from the site's own pages.");
  }
  const siteUrl = siteEnv.GOODFELLOW_SITE_URL;
  if (!siteUrl) throw new PaymentsError(503, "This site doesn't take payments yet.");
  const session = await siteAuth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session || session.user.banned) throw new PaymentsError(401, "Sign in first.");
  const customer = await options.customer(session.user.id);
  if (!customer) throw new PaymentsError(404, "You don't pay for anything here.");
  const portal = await stripe.billingPortal.sessions.create({
    customer,
    return_url: new URL("/account/", siteUrl).href,
  });
  return portal.url;
}
