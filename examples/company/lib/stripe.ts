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

/**
 * The answer a payments route gives for `error`: a `PaymentsError` in its own words and status, and anything else as
 * a 500 in words that say nothing about it, logged by its name only, with what was being done, so it can be found.
 */
export function paymentsProblem(error: unknown, doing: string): Response {
  const known = error instanceof PaymentsError;
  if (!known) console.error(`${doing} failed: ${error instanceof Error ? error.name : "error"}.`);
  return new Response(known ? error.message : "Something went wrong. Try again in a moment.", {
    status: known ? error.status : 500,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Whether Stripe refused a request because it has no such object, or none named as `param` where one is given. */
function isMissing(error: unknown, param?: string): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "resource_missing" &&
    (param === undefined || error.param === param)
  );
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
  /**
   * The Stripe customer the person pays as, made the first time (`accountCustomer()`), or in place of `stale`, one
   * Stripe no longer has.
   */
  customer: (user: { id: string; email: string }, stale?: string) => Promise<string>;
  /** Better Auth's adapter, which holds the lock that starts one subscription's Checkout at a time. */
  adapter: PaymentsAdapter;
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
  // A price Stripe doesn't have isn't on sale; any other failure, such as a key without the permission, is the site's.
  const price = await stripe.prices.retrieve(button.price).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (!price?.active) throw new PaymentsError(409, "This isn't on sale at the moment.");
  const subscribing = price.type === "recurring";
  const product = idOf(price.product as string | { id: string }) ?? price.id;
  const userId = session.user.id;
  const back = new URL("/api/checkout/done/", siteUrl);
  back.searchParams.set("next", place.page);
  const done = `${back.href}&session_id={CHECKOUT_SESSION_ID}`;
  const page = new URL(place.page, siteUrl).href;
  const user = { id: userId, email: session.user.email };
  // The one customer they pay as, so all they pay for is in one place in Stripe's portal: where Stripe no longer has
  // the one the site kept (deleted there, or the site moved from test mode), a new one in its place.
  let customer = await options.customer(user);
  const create = (customer: string) =>
    stripe.checkout.sessions.create({
      mode: subscribing ? "subscription" : "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: userId,
      customer,
      // The product and price too, which a second press finds an open Checkout by (`openCheckout()`).
      metadata: { userId, product, price: price.id },
      ...(subscribing && { subscription_data: { metadata: { userId } } }),
      success_url: done,
      cancel_url: page,
    });
  const start = async (): Promise<string> => {
    let checkout: Stripe.Checkout.Session;
    try {
      checkout = await create(customer);
    } catch (error) {
      if (!isMissing(error, "customer")) throw error;
      customer = await options.customer(user, customer);
      checkout = await create(customer);
    }
    if (!checkout.url) throw new PaymentsError(502, "Stripe didn't start the payment. Try again in a moment.");
    return checkout.url;
  };
  // Something bought once can be bought again.
  if (!subscribing) return start();
  // A subscription, one request at a time for each person and product, so a second press, a second tab, or another of
  // its prices (yearly beside monthly) can't start a second subscription to the same thing before the first is paid
  // for: someone who already has it manages it, and one who has started paying for it goes back to that Checkout.
  // The Checkout this press started, if any, which is theirs to pay even where its lock ran out while it started.
  let started: string | undefined;
  try {
    const lock = `checkout:${userId}:${product}`;
    return await withStripeLock(
      options.adapter,
      lock,
      async (fence) => {
        if (await subscribed(stripe, customer, product)) {
          return (await stripe.billingPortal.sessions.create({ customer, return_url: page })).url;
        }
        const open = await openCheckout(stripe, customer, product, price.id);
        if (open) return open;
        // Renewed just before starting one: a press that took longer than the lock to look, so another may have
        // started one meanwhile, stops here rather than start a second.
        await fence();
        started = await start();
        return started;
      },
      CHECKOUT_LOCK_SECONDS,
    );
  } catch (error) {
    if (error instanceof StripeBusy) {
      if (error.takenOver && started) return started;
      throw new PaymentsError(409, "Your payment is already starting. Try again in a moment.");
    }
    throw error;
  }
}

/**
 * How a subscription ends for good. Any other, its first payment still on its way (`incomplete`, as a bank debit's is
 * for days), paused or unpaid included, is one the person still has, for the portal to manage rather than a second.
 */
const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * Whether `customer` has a subscription to any of `product`'s prices that hasn't ended (`ENDED`), whether or not it
 * gives anything.
 */
async function subscribed(stripe: Stripe, customer: string, product: string): Promise<boolean> {
  try {
    // Stripe's list leaves out cancelled subscriptions unless asked for them, so a long-time customer's are few.
    for await (const subscription of stripe.subscriptions.list({ customer, limit: 100 })) {
      if (ENDED.has(subscription.status)) continue;
      if (subscription.items.data.some((item) => idOf(item.price.product as string | { id: string }) === product)) {
        return true;
      }
    }
    return false;
  } catch (error) {
    // A customer Stripe no longer has pays for nothing; Checkout makes them a new one.
    if (isMissing(error, "customer")) return false;
    throw error;
  }
}

/**
 * The address of a subscription's Checkout Session `customer` has open for `price`, if any, to go back to rather than
 * start another: by the product and price the site named in its metadata, so it's one list of Sessions, not a request
 * for each one's items. One open for another of the product's prices, as when they pressed the monthly button and now
 * the yearly, or owners have changed the button's price since, is expired, so they pay only the price they chose now,
 * and never both.
 */
async function openCheckout(
  stripe: Stripe,
  customer: string,
  product: string,
  price: string,
): Promise<string | undefined> {
  let found: string | undefined;
  const others: string[] = [];
  try {
    for await (const session of stripe.checkout.sessions.list({ customer, status: "open", limit: 100 })) {
      if (session.mode !== "subscription" || session.metadata?.product !== product) continue;
      if (session.metadata?.price === price && session.url && !found) found = session.url;
      else others.push(session.id);
    }
  } catch (error) {
    if (!isMissing(error, "customer")) throw error;
  }
  for (const id of others) {
    // One paid for or expired meanwhile can't be expired: the next press finds the subscription it made, if any.
    await stripe.checkout.sessions.expire(id).catch(() => {
      throw new PaymentsError(409, "Your payment is already starting. Try again in a moment.");
    });
  }
  return found;
}

/** Stripe's id of whatever's in `value`: the id itself, or an object Stripe expanded. */
function idOf(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

/** What reading and writing a person's Stripe customer needs of Better Auth's adapter. */
export type CustomerAdapter = Pick<EntitlementAdapter, "updateMany"> & {
  findOne<T>(data: { model: string; where: { field: string; value: string }[] }): Promise<T | null>;
};

/**
 * The Stripe customer a person pays as, if any: made the first time they went to Checkout, whether or not they paid
 * (`accountCustomer()`), or written from a Checkout Session they paid.
 */
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
  stale?: string,
): Promise<string> {
  // One Stripe no longer has is forgotten, unless another request has already put a new one in its place.
  if (stale) {
    await adapter.updateMany({
      model: "user",
      where: [
        { field: "id", value: user.id },
        { field: "stripeCustomerId", value: stale },
      ],
      update: { stripeCustomerId: null },
    });
  }
  const kept = await customerOf(adapter, user.id);
  if (kept) return kept;
  const address = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(user.email)));
  const hash = Array.from(address.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const made = await stripe.customers.create(
    { email: user.email, metadata: { userId: user.id } },
    // In place of a stale one, a key of its own, or Stripe would give back the customer the key first made.
    { idempotencyKey: `customer:${user.id}:${hash}${stale ? `:${stale}` : ""}` },
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

/**
 * The statuses in which a Stripe subscription still gives access, until its period ends. Not while a renewal's payment
 * is being retried (`past_due`), or once Stripe leaves it `unpaid`, since Stripe has already moved its period on to the
 * one not paid for: it gives access again once the payment goes through and it's `active`.
 */
const SUBSCRIBED = new Set(["active", "trialing"]);

/** What writing what Stripe says needs of Better Auth's adapter: entitlements, and the rows that hold its locks. */
export type PaymentsAdapter = EntitlementAdapter & Parameters<typeof claimRow>[0];

/** The start of the id of the row a request holds while it writes what one Stripe object gave (`withStripeLock()`). */
export const STRIPE_LOCK_IDENTIFIER = "stripe-lock:";

/** How long a request may hold a Stripe object's lock, in seconds, before another may take it over. */
export const STRIPE_LOCK_SECONDS = 60;

/**
 * How long starting a subscription's Checkout may hold its lock: longer, since it asks Stripe up to three times
 * (subscriptions, open Sessions, a new one), each of which can take 30 seconds with its retries.
 */
export const CHECKOUT_LOCK_SECONDS = 120;

/** Thrown where another request is writing what the same Stripe object gave, for this one to be tried again later. */
export class StripeBusy extends Error {
  override name = "StripeBusy";
  /**
   * Whether this request wrote, or tried to, before finding another had taken its lock over, so what it wrote was
   * taken back; otherwise the other request is writing it, and this one wrote nothing.
   */
  readonly takenOver: boolean;
  constructor(message: string, takenOver = false) {
    super(message);
    this.takenOver = takenOver;
  }
}

/**
 * Runs `write` holding the lock on one Stripe object (a subscription, or a Checkout Session), a row only one request
 * can write (`claimRow()`), so reading it from Stripe and writing what it gives never overlap with another request's:
 * one that read it earlier can't write what it read over a newer state, or write the same rows at once. The lock is
 * taken before anything is read, so whoever holds it reads Stripe as it is now. Throws `StripeBusy` where another
 * request holds it; one past `STRIPE_LOCK_SECONDS`, left by a request that stopped or stalled, is taken over, and
 * `write` calls the `fence` it's given right before writing, which stops a request whose lock was taken over. The
 * database can't renew the lock and write in one step (D1 has no transactions), so a request that stalls after its
 * fence finds out when it lets the lock go: it then runs the `undo` it gave its fence, if any, and throws `StripeBusy`
 * in place of whatever `write` gave or threw, so Stripe sends the event again and it's written as Stripe has it then.
 */
async function withStripeLock<T>(
  adapter: PaymentsAdapter,
  object: string,
  write: (fence: Fence) => Promise<T>,
  seconds = STRIPE_LOCK_SECONDS,
): Promise<T> {
  const id = `${STRIPE_LOCK_IDENTIFIER}${object}`;
  const holder = crypto.randomUUID();
  const claim = () =>
    claimRow(adapter, { id, identifier: id, value: holder, expiresAt: new Date(Date.now() + seconds * 1000) });
  // Taken at once where nobody holds it; one past its time, left by a request that stopped or stalled, is cleared and
  // taken then, so a lock nobody holds costs one write.
  if (!(await claim())) {
    await adapter.deleteMany({
      model: "verification",
      where: [
        { field: "id", value: id },
        { field: "expiresAt", operator: "lt", value: new Date() },
      ],
    });
    if (!(await claim())) throw new StripeBusy("Another request is writing what this gave.");
  }
  let undo: (() => Promise<void>) | undefined;
  // Whether this request came to write, which only a lock still held makes safe.
  let fenced = false;
  // Called just before writing: renews the lock for this request, or, where another request has taken it over since
  // (this one ran past its time), stops here, so a write from an older read never lands after a newer one.
  const fence: Fence = async (undoing) => {
    const renewed = await adapter.updateMany({
      model: "verification",
      where: [
        { field: "id", value: id },
        { field: "value", value: holder },
      ],
      update: { expiresAt: new Date(Date.now() + seconds * 1000), updatedAt: new Date() },
    });
    if (renewed === 0) throw new StripeBusy("Another request took over writing what this gave.");
    fenced = true;
    undo = undoing;
  };
  const release = () =>
    adapter.deleteMany({
      model: "verification",
      where: [
        { field: "id", value: id },
        { field: "value", value: holder },
      ],
    });
  let done: { written: T } | { failure: unknown };
  try {
    done = { written: await write(fence) };
  } catch (failure) {
    done = { failure };
  }
  // Gone, the lock was taken over while this wrote, so what it wrote, or failed to (the other request's rows can be in
  // the way), may be older than what the other request did. One that wrote nothing here, such as starting a Checkout,
  // which only asks Stripe, keeps what it got.
  if ((await release()) === 0 && fenced) {
    await undo?.();
    throw new StripeBusy("Another request took over writing what this gave while it wrote.", true);
  }
  if ("failure" in done) throw done.failure;
  return done.written;
}

/**
 * Renews a Stripe object's lock just before writing (`withStripeLock()`), with what takes the write back if the lock
 * turns out to have been taken over while it was written.
 */
type Fence = (undo?: () => Promise<void>) => Promise<void>;

/**
 * Writes a Stripe subscription's state, as Stripe has it now, into the person's entitlements: until its current
 * period ends while it's active (or trialing), and none at all otherwise, nor where Stripe no longer has it. The person is the one
 * the site named when it made the Checkout Session, in the subscription's metadata, never anything the event says.
 */
export function applySubscription(adapter: PaymentsAdapter, stripe: Stripe, subscriptionId: string): Promise<void> {
  return withStripeLock(adapter, `subscription:${subscriptionId}`, async (fence) => {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId).catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
    // One Stripe no longer has, as once an owner deletes its customer or test data, gives nothing, whoever it was for.
    if (!subscription) {
      await adapter.deleteMany({
        model: "entitlement",
        where: [{ field: "reference", value: subscriptionReference(subscriptionId) }],
      });
      return;
    }
    const userId = subscription.metadata?.userId;
    // An account deleted since took its entitlements with it, and writing one for it would fail on every retry.
    if (!userId || !(await stillHere(adapter, userId))) return;
    const reference = subscriptionReference(subscription.id);
    const remove = (only: { field: string; value: Date }[] = []) =>
      adapter.deleteMany({
        model: "entitlement",
        where: [{ field: "userId", value: userId }, { field: "reference", value: reference }, ...only],
      });
    // When this writes, which marks its own row, so taking it back never takes the row another request wrote.
    const written = new Date();
    // Where another request takes the lock over while this writes, the row this wrote, if it's still there, is taken
    // away again, so a stale read never keeps a cancelled subscription, and the event, sent again, writes it as Stripe
    // has it then; a row the other request wrote is left as it is. Accepted: a request stopped (as a Worker can be)
    // after writing and before letting the lock go takes nothing away, so a subscription cancelled meanwhile stays
    // until the end of the period this read, which it had paid for.
    await fence(async () => {
      await remove([{ field: "createdAt", value: written }]);
    });
    await remove();
    if (!SUBSCRIBED.has(subscription.status)) return;
    const ends = Math.max(...subscription.items.data.map((item) => item.current_period_end));
    if (!Number.isFinite(ends)) return;
    // Its id is the subscription's own, so however it's written there's one row for it.
    const expiresAt = new Date(ends * 1000);
    await grant(adapter, { id: reference, userId, kind: "subscription", reference, expiresAt, createdAt: written });
  });
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

/**
 * How a dispute ends that leaves the payment the site's: won, or an inquiry closed without the money taken. Any other,
 * open or lost, counts against the payment.
 */
const KEPT_DISPUTE = new Set(["won", "warning_closed"]);

/**
 * Whether a payment has been refunded, in full or in part, or is disputed, as Stripe has it now: a dispute the site
 * has won doesn't count, so the purchase comes back once it's closed (`charge.dispute.closed`), as it does once a refund
 * fails (`refund.failed`, `refund.updated`, or `charge.refund.updated`), which Stripe takes off `amount_refunded`.
 */
async function takenBack(stripe: Stripe, paymentIntentId: string): Promise<boolean> {
  const payment = await stripe.paymentIntents
    .retrieve(paymentIntentId, { expand: ["latest_charge"] })
    .catch((error: unknown) => {
      if (isMissing(error)) return undefined;
      throw error;
    });
  // A payment Stripe no longer has paid for nothing.
  if (!payment) return true;
  const charge = payment.latest_charge;
  if (typeof charge === "string") throw new Error("Stripe didn't give the payment's charge.");
  if (!charge) return false;
  if (charge.amount_refunded > 0) return true;
  if (!charge.disputed) return false;
  for await (const dispute of stripe.disputes.list({ payment_intent: paymentIntentId, limit: 100 })) {
    if (!KEPT_DISPUTE.has(dispute.status)) return true;
  }
  return false;
}

/** Whether the account `userId` still exists: what Stripe says of one that's been deleted is left alone. */
async function stillHere(adapter: PaymentsAdapter, userId: string): Promise<boolean> {
  return Boolean(await adapter.findOne({ model: "user", where: [{ field: "id", value: userId }] }));
}

/**
 * Writes what a Checkout Session bought, as Stripe has it now, into the entitlements of the person the site made it
 * for: once it's paid, never before (some payments take days, and Stripe says when they arrive), a subscription as
 * `applySubscription()` writes it, and a one-off purchase for each product, kept for good, unless its payment has been
 * refunded or disputed since (`takenBack()`), so coming back with an old Session, or a late event, gives nothing
 * back, even where the refund is handled while this writes. Keeps the Stripe customer they paid as (`customerOf()`).
 */
export function applySession(adapter: PaymentsAdapter, stripe: Stripe, sessionId: string): Promise<void> {
  return withStripeLock(adapter, `session:${sessionId}`, (fence) => writeSession(adapter, stripe, sessionId, fence));
}

/** `applySession()`, with the Checkout Session's lock held. */
async function writeSession(adapter: PaymentsAdapter, stripe: Stripe, sessionId: string, fence: Fence): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(sessionId).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  // One Stripe no longer has bought nothing it can say; its payment's events, if any, take back what it did.
  if (!session) return;
  const userId = session.client_reference_id;
  if (!userId || session.metadata?.userId !== userId) return;
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  if (!(await stillHere(adapter, userId))) return;
  // Every write after the fence, the customer too, so a request whose lock was taken over writes nothing.
  await fence();
  await rememberCustomer(adapter, userId, idOf(session.customer as string | { id: string } | null));
  const subscription = idOf(session.subscription);
  if (session.mode === "subscription" && subscription) return applySubscription(adapter, stripe, subscription);
  if (session.mode !== "payment") return;
  const payment = idOf(session.payment_intent);
  const taken = payment ? await takenBack(stripe, payment) : false;
  const products = await productsOf(stripe, session.id);
  // Nothing to take back if the lock is lost while writing: a refund or dispute is looked for again below, and the
  // event sent again writes the rest, so a purchase isn't lost where a dispute was won meanwhile.
  await fence();
  const ids = products.map((product) => purchaseId(session.id, product));
  for (const [index, product] of products.entries()) {
    const id = ids[index] as string;
    await adapter.deleteMany({ model: "entitlement", where: [{ field: "id", value: id }] });
    if (!taken) await grant(adapter, { id, userId, kind: "purchase", reference: product, expiresAt: null });
  }
  // A refund the webhook handled while this read the products found nothing to take back yet, so it's looked for
  // again now that the purchases are written; one after this is handled after them, and takes them back itself.
  if (payment && !taken && (await takenBack(stripe, payment))) {
    for (const id of ids) await adapter.deleteMany({ model: "entitlement", where: [{ field: "id", value: id }] });
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

/**
 * What an event's row says: being handled, until `STRIPE_EVENT_LEASE_SECONDS` have passed (`handling:` and the
 * request's own id), or handled.
 */
const HANDLING = "handling";
const HANDLED = "handled";

/** What the webhook needs of Better Auth's database adapter: entitlements, and the rows that record handled events. */

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
  options: { siteEnv: SiteEnv; stripe: Stripe; adapter: PaymentsAdapter },
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
  // This request's own claim, so one that fails lets go only of the claim it holds, never of one that took its over
  // once its lease ran out, or of the event that one marked handled.
  const mine = `${HANDLING}:${crypto.randomUUID()}`;
  const held = [
    { field: "id", value: id },
    { field: "value", value: mine },
  ];
  const claim = () =>
    claimRow(adapter, {
      id,
      identifier: id,
      value: mine,
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
        { field: "value", operator: "ne", value: HANDLED },
        { field: "expiresAt", operator: "lte", value: new Date() },
      ],
    });
    if (!(await claim())) return new Response("Being handled.", { status: 409 });
  }
  try {
    await handle(adapter, stripe, event);
  } catch (error) {
    await adapter.deleteMany({ model: "verification", where: held });
    // Another request is writing the same subscription or payment: Stripe tries again once it's done.
    if (error instanceof StripeBusy) return new Response("Being written.", { status: 409 });
    throw error;
  }
  // Done, whichever request holds the claim now: one that took it over finds the event handled when it lets go.
  await adapter.updateMany({
    model: "verification",
    where: [{ field: "id", value: id }],
    update: { value: HANDLED, expiresAt: new Date(Date.now() + STRIPE_EVENT_SECONDS * 1000), updatedAt: new Date() },
  });
  return new Response(null, { status: 200 });
}

/** Does what an event says changed, reading it from Stripe again. Events the site doesn't use are left alone. */
async function handle(adapter: PaymentsAdapter, stripe: Stripe, event: Stripe.Event): Promise<void> {
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
    case "charge.refund.updated":
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      // Refunded or disputed, open or lost, what the payment bought is taken back; a refund that failed, or a dispute
      // won, gives it back: `applySession()` reads which from Stripe as it is now, so events in any order agree.
      const paymentIntent = idOf(event.data.object.payment_intent);
      if (!paymentIntent) return;
      for await (const session of stripe.checkout.sessions.list({ payment_intent: paymentIntent, limit: 10 })) {
        await applySession(adapter, stripe, session.id);
      }
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
  options: { siteAuth: SiteAuth; stripe: Stripe; adapter: PaymentsAdapter },
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
  // Another request writing it, usually Stripe's event, writes it as Stripe has it now, so that's as good as this
  // writing it. One that took this one's lock over meanwhile took back what this wrote, and no event comes back here,
  // so it's written once more.
  const write = async () => {
    try {
      await applySession(options.adapter, options.stripe, checkout.id);
      return true;
    } catch (error) {
      if (!(error instanceof StripeBusy)) throw error;
      return !error.takenOver;
    }
  };
  if (!(await write())) await write();
  return next;
}

/**
 * Where someone who pays manages what they pay for, or stops: Stripe's own customer portal, for the Stripe customer
 * the site keeps for them (`customerOf()`), coming back to their account page, whether or not what they bought still
 * gives them anything, so they can fix a payment that failed. Someone who has been to Checkout without paying has a
 * customer too, whose portal has nothing in it yet; only someone who has never been there is told they pay for
 * nothing here. Only for the person signed in, from the site's own pages.
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
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: new URL("/account/", siteUrl).href,
    });
    return portal.url;
  } catch (error) {
    // A customer Stripe no longer has has nothing to manage; the next Checkout makes them a new one.
    if (isMissing(error, "customer")) throw new PaymentsError(404, "You don't pay for anything here.");
    throw error;
  }
}
