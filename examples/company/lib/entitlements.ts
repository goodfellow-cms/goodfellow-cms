// What each person is entitled to: a subscription, which the site's paywall asks for, or something bought once, such
// as a download. Payments decide when someone becomes entitled (Stripe, in a pull request to come); this is the only
// file that reads the table. It's a Better Auth model, so it's read through Better Auth's own adapter, which is the
// same on D1, Postgres, and the tests' SQLite.
import type { BetterAuthPlugin } from "better-auth";
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
    },
  } satisfies BetterAuthPlugin;
}

/** What reading and writing entitlements needs of Better Auth's adapter. */
export interface EntitlementAdapter {
  findMany<T>(data: {
    model: string;
    where: { field: string; value: string }[];
    limit?: number;
    offset?: number;
    sortBy?: { field: string; direction: "asc" | "desc" };
  }): Promise<T[]>;
  create<T extends Record<string, unknown>>(data: { model: string; data: T; forceAllowId?: boolean }): Promise<unknown>;
}

/** Whether an entitlement still holds at `now`. */
function holds(entitlement: Pick<Entitlement, "expiresAt">, now: Date): boolean {
  return entitlement.expiresAt === null || entitlement.expiresAt === undefined || new Date(entitlement.expiresAt) > now;
}

/** How many entitlements are read at a time: Better Auth's adapter gives at most 100 unless it's told otherwise. */
const PAGE = 100;

/** Every entitlement someone has, a page at a time in the order of their ids, so none is missed or read twice. */
async function entitlementsOf(adapter: EntitlementAdapter, userId: string): Promise<Entitlement[]> {
  const all: Entitlement[] = [];
  for (;;) {
    const page = await adapter.findMany<Entitlement>({
      model: "entitlement",
      where: [{ field: "userId", value: userId }],
      limit: PAGE,
      offset: all.length,
      sortBy: { field: "id", direction: "asc" },
    });
    all.push(...page);
    if (page.length < PAGE) return all;
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
  entitlement: Pick<Entitlement, "userId" | "kind" | "reference"> & { expiresAt?: Date | null },
): Promise<void> {
  await adapter.create({
    model: "entitlement",
    data: {
      id: generateRandomString(32),
      userId: entitlement.userId,
      kind: entitlement.kind,
      reference: entitlement.reference,
      expiresAt: entitlement.expiresAt ?? null,
      createdAt: new Date(),
    },
    forceAllowId: true,
  });
}
