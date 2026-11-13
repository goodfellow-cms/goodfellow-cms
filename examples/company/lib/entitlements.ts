// What each person is entitled to: a subscription, which the site's paywall asks for, or something bought once, such
// as a download. Payments decide when someone becomes entitled (Stripe, in a pull request to come); this is the only
// file that reads the table. It's a Better Auth model, so it's read through Better Auth's own adapter, which is the
// same on D1, Postgres, and the tests' SQLite.
import type { BetterAuthPlugin, Where } from "better-auth";
import { generateRandomString } from "better-auth/crypto";

/** What an entitlement is: a `subscription`, which runs until it ends, or a `purchase`, which is kept. */
export const ENTITLEMENT_KINDS = ["subscription", "purchase"] as const;
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

/** One thing someone is entitled to. */
export interface Entitlement {
  id: string;
  userId: string;
  kind: EntitlementKind;
  /** What it's for, such as the payment service's price or product id. */
  reference: string;
  /** When it ends, or `null` for never. */
  expiresAt: Date | null;
  createdAt: Date;
}

/** The table, for Better Auth's adapter, which `migrations.test.ts` checks the migration against. */
export function entitlements() {
  return {
    id: "entitlements",
    schema: {
      entitlement: {
        fields: {
          userId: {
            type: "string",
            required: true,
            references: { model: "user", field: "id", onDelete: "cascade" },
            index: true,
          },
          kind: { type: "string", required: true },
          reference: { type: "string", required: true },
          expiresAt: { type: "date", required: false },
          createdAt: { type: "date", required: true },
        },
      },
      // The Stripe customer a person pays as (lib/stripe.ts), which the site writes from the first Checkout Session
      // they pay, and nothing they send can set, so it lasts when what they bought ends, for Stripe's portal.
      user: { fields: { stripeCustomerId: { type: "string", required: false, input: false } } },
    },
  } satisfies BetterAuthPlugin;
}

/** What reading and writing entitlements needs of Better Auth's adapter. */
export interface EntitlementAdapter {
  findMany<T>(data: {
    model: string;
    where: Where[];
    limit?: number;
    offset?: number;
    sortBy?: { field: string; direction: "asc" | "desc" };
  }): Promise<T[]>;
  create<T extends Record<string, unknown>>(data: { model: string; data: T; forceAllowId?: boolean }): Promise<unknown>;
  updateMany(data: { model: string; where: Where[]; update: Record<string, unknown> }): Promise<number>;
  deleteMany(data: { model: string; where: Where[] }): Promise<number>;
}

/** The `reference` of a subscription an owner gave someone by hand, on the subscribers page (lib/subscribers.ts). */
export const BY_HAND = "by-hand";

/** Whether an entitlement still holds at `now`. */
function holds(entitlement: Pick<Entitlement, "expiresAt">, now: Date): boolean {
  return entitlement.expiresAt === null || entitlement.expiresAt === undefined || new Date(entitlement.expiresAt) > now;
}

/** How many entitlements are read at a time: Better Auth's adapter gives at most 100 unless it's told otherwise. */
const PAGE = 100;

/**
 * Every entitlement matching `where`, a page at a time in the order of their ids, so none is missed or read twice.
 */
async function entitlementsWhere(adapter: EntitlementAdapter, where: Where[]): Promise<Entitlement[]> {
  const all: Entitlement[] = [];
  for (;;) {
    const page = await adapter.findMany<Entitlement>({
      model: "entitlement",
      where,
      limit: PAGE,
      offset: all.length,
      sortBy: { field: "id", direction: "asc" },
    });
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/** Every entitlement someone has. */
function entitlementsOf(adapter: EntitlementAdapter, userId: string): Promise<Entitlement[]> {
  return entitlementsWhere(adapter, [{ field: "userId", value: userId }]);
}

/**
 * Every subscription that holds at `now`, whoever's it is, for the subscribers page: asked of the database as ones
 * with no end, then ones ending after `now`, so the periods paid for long ago, which stay recorded, are never read.
 */
export async function currentSubscriptions(adapter: EntitlementAdapter, now = new Date()): Promise<Entitlement[]> {
  const kind = { field: "kind", value: "subscription" };
  const [endless, ending] = await Promise.all([
    entitlementsWhere(adapter, [kind, { field: "expiresAt", value: null }]),
    entitlementsWhere(adapter, [kind, { field: "expiresAt", operator: "gt", value: now }]),
  ]);
  return [...endless, ...ending].filter((entitlement) => holds(entitlement, now));
}

/** Takes away the subscription an owner gave someone by hand, if they have one, leaving any they paid for. */
export async function takeAwayByHand(adapter: EntitlementAdapter, userId: string): Promise<void> {
  await adapter.deleteMany({
    model: "entitlement",
    where: [
      { field: "userId", value: userId },
      { field: "kind", value: "subscription" },
      { field: "reference", value: BY_HAND },
    ],
  });
}

/**
 * Gives someone a subscription by hand, until `expiresAt` or with no end, in place of one given them before. Each is
 * one write, so a write that fails leaves the gift before as it was: the one given before is changed where there is
 * one, and a new one is added where there isn't. The database holds one a person (`entitlement_by_hand_idx`), so where
 * another admin's gift is added in between, adding this one is refused, and that one is changed instead. When two
 * admins give someone one at once, the one the database writes last stays.
 */
export async function giveByHand(adapter: EntitlementAdapter, userId: string, expiresAt: Date | null): Promise<void> {
  const where: Where[] = [
    { field: "userId", value: userId },
    { field: "kind", value: "subscription" },
    { field: "reference", value: BY_HAND },
  ];
  const change = () =>
    adapter.updateMany({ model: "entitlement", where, update: { expiresAt, createdAt: new Date() } });
  if ((await change()) > 0) return;
  try {
    await grant(adapter, { userId, kind: "subscription", reference: BY_HAND, expiresAt });
  } catch (error) {
    // Refused for another admin's gift, which is changed instead; anything else is this write's own failure.
    if ((await change()) === 0) throw error;
  }
}

/** Whether someone is entitled to `reference` now. */
export async function can(adapter: EntitlementAdapter, userId: string, reference: string, now = new Date()) {
  return (await entitlementsOf(adapter, userId)).some(
    (entitlement) => entitlement.reference === reference && holds(entitlement, now),
  );
}

/**
 * Whether someone subscribes now, which the paywall asks for, and until when: the latest end of the subscriptions
 * they have, `null` where one never ends, or `undefined` where they have none.
 */
export async function subscribedUntil(
  adapter: EntitlementAdapter,
  userId: string,
  now = new Date(),
): Promise<Date | null | undefined> {
  const current = (await entitlementsOf(adapter, userId)).filter(
    (entitlement) => entitlement.kind === "subscription" && holds(entitlement, now),
  );
  if (current.length === 0) return undefined;
  if (current.some((entitlement) => !entitlement.expiresAt)) return null;
  return new Date(Math.max(...current.map((entitlement) => new Date(entitlement.expiresAt ?? 0).getTime())));
}

/** Records that someone is entitled to something, as a payment does. */
export async function grant(
  adapter: EntitlementAdapter,
  entitlement: Pick<Entitlement, "userId" | "kind" | "reference"> & {
    expiresAt?: Date | null;
    id?: string;
    /** When it's written, where the caller marks its own row by it (now, otherwise). */
    createdAt?: Date;
  },
): Promise<void> {
  await adapter.create({
    model: "entitlement",
    data: {
      // An id of the caller's own names what gave it, such as one payment, so that alone can be taken back.
      id: entitlement.id ?? generateRandomString(32),
      userId: entitlement.userId,
      kind: entitlement.kind,
      reference: entitlement.reference,
      expiresAt: entitlement.expiresAt ?? null,
      createdAt: entitlement.createdAt ?? new Date(),
    },
    forceAllowId: true,
  });
}
