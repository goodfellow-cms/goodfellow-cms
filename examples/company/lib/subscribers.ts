// The site's readers, for its admins: who has signed up, who subscribes and until when, giving someone a
// subscription by hand or taking it away, and removing a reader's account. Admins only, as the editors page is
// (`adminAsking()`), from the site's own pages.
import { isMemberRole, MEMBER_ROLE, type SiteAuth } from "./auth.ts";
import { adminAsking, EditorsError, usersWithRole } from "./editors.ts";
import { BY_HAND, currentSubscriptions, type Entitlement, giveByHand, takeAwayByHand } from "./entitlements.ts";

/** Someone's subscription, as the subscribers page shows it. */
export interface ShownSubscription {
  /** When it ends, as an ISO date and time, or `null` for never. */
  until: string | null;
  /** Whether an owner gave it by hand, which the page can take away; anything else was paid for. */
  byHand: boolean;
}

/** A reader, or anyone else with a subscription, as the subscribers page lists them. */
export interface Subscriber {
  id: string;
  email: string;
  name: string;
  /** `member` for a reader who signed up; an editor or admin can be given a subscription too. */
  role: string;
  /** Whether they've chosen a password, from a link sent to their address, which they must before they can sign in. */
  confirmed: boolean;
  /** Their subscriptions that hold now, the one that lasts longest first. */
  subscriptions: ShownSubscription[];
}

/** The latest end first, with no end first of all. */
function lastingLongest(a: ShownSubscription, b: ShownSubscription): number {
  if (a.until === b.until) return 0;
  if (a.until === null) return -1;
  if (b.until === null) return 1;
  return b.until.localeCompare(a.until);
}

function shown(entitlement: Entitlement): ShownSubscription {
  return {
    until: entitlement.expiresAt ? new Date(entitlement.expiresAt).toISOString() : null,
    byHand: entitlement.reference === BY_HAND,
  };
}

/**
 * Every reader, and every editor or admin with a subscription, subscribers first, then by name. Subscriptions are
 * read once for everyone, not for each person, however many readers there are.
 */
export async function listSubscribers(siteAuth: SiteAuth, request: Request): Promise<Subscriber[]> {
  await adminAsking(siteAuth, request);
  const context = await siteAuth.$context;
  const byPerson = new Map<string, ShownSubscription[]>();
  for (const entitlement of await currentSubscriptions(context.adapter)) {
    byPerson.set(entitlement.userId, [...(byPerson.get(entitlement.userId) ?? []), shown(entitlement)]);
  }
  const readers = await usersWithRole(siteAuth, request, MEMBER_ROLE);
  const listed = new Set(readers.map((user) => user.id));
  // Everyone else with a subscription, read together, as many to a query as the database is asked for at once.
  const missing = [...byPerson.keys()].filter((userId) => !listed.has(userId));
  const others: typeof readers = [];
  for (let start = 0; start < missing.length; start += LOOKUP_SIZE) {
    const ids = missing.slice(start, start + LOOKUP_SIZE);
    others.push(
      ...(await context.adapter.findMany<(typeof readers)[number]>({
        model: "user",
        where: [{ field: "id", operator: "in", value: ids }],
        limit: ids.length,
      })),
    );
  }
  const subscribers = [...readers, ...others].map(
    (user): Subscriber => ({
      id: user.id,
      email: user.email,
      name: user.name,
      // An account with no role is a reader's, as removing one reads it (`isMemberRole()`).
      role: isMemberRole((user as { role?: string | null }).role)
        ? MEMBER_ROLE
        : String((user as { role?: string }).role),
      confirmed: user.emailVerified,
      subscriptions: (byPerson.get(user.id) ?? []).sort(lastingLongest),
    }),
  );
  return subscribers.sort((a, b) =>
    a.subscriptions.length > 0 === b.subscriptions.length > 0
      ? a.name.localeCompare(b.name)
      : a.subscriptions.length > 0
        ? -1
        : 1,
  );
}

/** A day, in milliseconds. */
const DAY = 24 * 60 * 60 * 1000;

/** How many accounts are looked up in one query. */
const LOOKUP_SIZE = 100;

/** A subscription an owner gives by hand: to whom, by their account's address, and until when. */
export interface Gift {
  email: string;
  /** When it ends: the end of the day chosen, UTC, or `null` for no end. */
  until: Date | null;
}

/**
 * The gift as asked, checked, since anyone signed in as an admin can send anything: an address, and a day it lasts
 * until, or none. It lasts to the end of that day, UTC, the last moment of it, which the page shows as that day, so a
 * day that's still to come anywhere in the world can be chosen, such as tomorrow where the admin is.
 */
export function giftFrom(body: unknown, now = new Date()): Gift {
  const given = (body ?? {}) as Record<string, unknown>;
  const email = typeof given.email === "string" ? given.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EditorsError(400, "Give the address of the person's account.");
  }
  if (given.until === undefined || given.until === null || given.until === "") return { email, until: null };
  const day = typeof given.until === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(given.until) : null;
  const start = day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : undefined;
  if (!start || Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== given.until) {
    throw new EditorsError(400, "Choose the day it ends, or leave it empty for no end.");
  }
  const until = new Date(start.getTime() + DAY - 1);
  if (until <= now) throw new EditorsError(400, "Choose today or a later day.");
  return { email, until };
}

/**
 * Gives the account with the gift's address a subscription by hand, in place of one given it before; any it paid for
 * stays as it is. The account must exist: a reader signs up first.
 */
export async function giveSubscription(siteAuth: SiteAuth, request: Request, gift: Gift): Promise<void> {
  await adminAsking(siteAuth, request);
  const context = await siteAuth.$context;
  const found = await context.internalAdapter.findUserByEmail(gift.email);
  if (!found) {
    throw new EditorsError(404, `No account has the address ${gift.email}. Ask them to sign up first.`);
  }
  await giveByHand(context.adapter, found.user.id, gift.until);
}

/** The account a change is for, found by its id. */
async function accountById(siteAuth: SiteAuth, userId: string) {
  const user =
    typeof userId === "string" && userId ? await (await siteAuth.$context).internalAdapter.findUserById(userId) : null;
  if (!user) throw new EditorsError(404, "There's no such person.");
  return user as typeof user & { role?: string | null };
}

/**
 * Takes away the subscription an owner gave someone by hand. One they paid for stays: it ends in the payment
 * service, which then ends it here. Members' pages show for at most `PAYWALL_SECONDS` more (lib/paywall.ts).
 */
export async function takeAwaySubscription(siteAuth: SiteAuth, request: Request, userId: string): Promise<void> {
  await adminAsking(siteAuth, request);
  const user = await accountById(siteAuth, userId);
  await takeAwayByHand((await siteAuth.$context).adapter, user.id);
}

/** Removes a reader's account, which also ends their sessions and their subscriptions. Editors are the editors page's. */
export async function removeSubscriber(siteAuth: SiteAuth, request: Request, userId: string): Promise<void> {
  await adminAsking(siteAuth, request);
  const user = await accountById(siteAuth, userId);
  if (!isMemberRole(user.role)) {
    throw new EditorsError(409, "Remove editors and admins from the editors page.");
  }
  await siteAuth.api.removeUser({ headers: request.headers, body: { userId: user.id } });
}
